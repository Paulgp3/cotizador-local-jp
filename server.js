// server.js — Cotizador Medio Angular (ESM)
// Incluye: PDF, SendGrid, exportación XLSX con ZIP y token admin, firma de PDFs
// AJUSTE: Catálogo con "description" y compatibilidad imageUrl/image_url.

import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import { z } from "zod";
import { parse as parseCSV } from "csv-parse/sync";
import crypto from "crypto";
import Database from "better-sqlite3";
import sgMail from "@sendgrid/mail";
import ExcelJS from "exceljs";
import archiver from "archiver";
import iconv from "iconv-lite";
import cron from "node-cron";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";

// ---------------------------- Boot & paths ----------------------------
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------------------------- Config ----------------------------
const app = express();
const PORT = Number(process.env.PORT || 4000);

const IVA_RATE = Number(process.env.IVA_RATE ?? 0.16);
const DEFAULT_DEPOSIT_RATE = Number(process.env.DEFAULT_DEPOSIT_RATE ?? 0);

const CORS_ORIGIN     = process.env.CORS_ORIGIN || "*";
const QUOTE_BASE_URL  = process.env.QUOTE_BASE_URL || `http://localhost:${PORT}`;

const COMPANY_NAME    = process.env.COMPANY_NAME || "Medio Angular";
const COMPANY_EMAIL   = process.env.COMPANY_EMAIL || "cotizacion@medioangular.com";
const COMPANY_PHONE   = process.env.COMPANY_PHONE || "5530997587";
const COMPANY_WEBSITE = process.env.COMPANY_WEBSITE || "www.medioangular.com";

const HEADER_IMAGE_PATH = process.env.HEADER_IMAGE_PATH || "";

const FILE_SIGNING_SECRET   = process.env.FILE_SIGNING_SECRET || "cambia-esto-por-un-secreto-largo-unico-32+chars";
const FILE_URL_TTL_MINUTES  = Number(process.env.FILE_URL_TTL_MINUTES || 10080);

const SEND_EMAILS = String(process.env.SEND_EMAILS || "false").toLowerCase() === "true";
const SG_KEY  = process.env.SENDGRID_API_KEY || "";
const SG_FROM = process.env.SENDGRID_FROM || `Medio Angular <${COMPANY_EMAIL}>`;
const SG_BCC  = process.env.SENDGRID_BCC || COMPANY_EMAIL;
const SG_CALENDLY = process.env.SENDGRID_CALENDLY_URL || "";
if (SG_KEY) sgMail.setApiKey(SG_KEY);

const LOGO_URL = process.env.LOGO_URL || "";
const LOGO_INLINE_FROM_URL = String(process.env.LOGO_INLINE_FROM_URL || "false").toLowerCase() === "true";
const LOGO_WIDTH_PX = Number(process.env.LOGO_WIDTH_PX || 135);
const LOGO_URL_ALLOWED_HOSTS = (process.env.LOGO_URL_ALLOWED_HOSTS || "medioangular.com,cdn.medioangular.com")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

const EXPORTS_ENABLED     = String(process.env.EXPORTS_ENABLED ?? "true").toLowerCase() === "true";
const EXPORTS_WEEKLY_CRON = process.env.EXPORTS_WEEKLY_CRON || "0 8 * * 1";
const EXPORTS_TZ          = process.env.EXPORTS_TZ || "America/Mexico_City";
const EXPORTS_WEEKLY_TO   = (process.env.EXPORTS_WEEKLY_TO || COMPANY_EMAIL).split(",").map(s=>s.trim()).filter(Boolean);
const EXPORTS_ZIP_PASSWORD= process.env.EXPORTS_ZIP_PASSWORD || "";

const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || "").trim();

// ---------------------------- Middlewares ----------------------------
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "img-src": ["'self'", "data:", "https:"],
      "style-src": ["'self'", "https:", "'unsafe-inline'"],
      "script-src": ["'self'"]
    }
  }
}));
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "3mb" }));
app.use(morgan("dev"));

// Rate limit para /quotes
const quotesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

// ---------------------------- Static (front) ----------------------------
app.use("/public", express.static(path.join(__dirname, "public")));
app.get("/", (_req, res)=> res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/avisoprivacidad.html", (_req, res)=> res.sendFile(path.join(__dirname, "public", "avisoprivacidad.html")));

// ---------------------------- Data & DB ----------------------------
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const PRIVATE_QUOTES_DIR = path.join(DATA_DIR, "quotes");
if (!fs.existsSync(PRIVATE_QUOTES_DIR)) fs.mkdirSync(PRIVATE_QUOTES_DIR, { recursive: true });

const EXPORTS_DIR = path.join(DATA_DIR, "exports");
if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "cotizador.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  company TEXT,
  phone TEXT,
  UNIQUE(email, name, company, phone)
);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY,
  quote_id TEXT NOT NULL UNIQUE,
  client_id INTEGER,
  event_type TEXT,
  event_name TEXT,
  event_date TEXT,
  event_location TEXT,
  subtotal REAL,
  discount REAL,
  iva REAL,
  total REAL,
  delivery_fee REAL DEFAULT 0,
  file_name TEXT,
  created_at TEXT,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY,
  quote_id INTEGER NOT NULL,
  sku TEXT, name TEXT, category TEXT,
  qty INTEGER, days INTEGER,
  daily_price REAL,
  subtotal REAL,
  auto_rate REAL,
  excluded INTEGER,
  FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_quotes_quoteid ON quotes(quote_id);
CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes(created_at);
`);

const stUpsertClient = db.prepare(`
INSERT INTO clients (name,email,company,phone) VALUES (@name,@email,@company,@phone)
ON CONFLICT(email, name, company, phone) DO UPDATE SET name=excluded.name
RETURNING id;
`);

const stInsertQuote = db.prepare(`
INSERT INTO quotes (quote_id, client_id, event_type, event_name, event_date, event_location,
  subtotal, discount, iva, total, delivery_fee, file_name, created_at)
VALUES (@quote_id, @client_id, @event_type, @event_name, @event_date, @event_location,
  @subtotal, @discount, @iva, @total, @delivery_fee, @file_name, @created_at)
RETURNING id, created_at;
`);

const stInsertItem = db.prepare(`
INSERT INTO quote_items (quote_id, sku, name, category, qty, days, daily_price, subtotal, auto_rate, excluded)
VALUES (@quote_id, @sku, @name, @category, @qty, @days, @daily_price, @subtotal, @auto_rate, @excluded)
`);

const stExportRows = db.prepare(`
SELECT
  q.quote_id,
  c.name as client_name,
  c.company as client_company,
  c.email  as client_email,
  c.phone  as client_phone,
  q.event_type, q.event_name, q.event_date, q.event_location,
  q.subtotal, q.discount, q.iva, q.total,
  q.created_at
FROM quotes q
LEFT JOIN clients c ON c.id = q.client_id
ORDER BY q.created_at DESC, q.id DESC
`);

// ---------------------------- Catálogo ----------------------------
const CANDIDATE_FILES = [
  path.join(DATA_DIR, "catalogo_normalizado_2025.csv"),
  path.join(DATA_DIR, "catalog.csv"),
  path.join(DATA_DIR, "catalog.json")
];

const toBool = (v, def = true) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return def;
  return !["0","false","no","inactive","inactivo","f","off"].includes(s);
};
// --- Normalizador de acentos (Ç/ç -> Á/á) + NFC ---
function fixAccents(s) {
  if (!s) return s;
  return String(s).normalize('NFC')
    .replace(/([A-Z])ç(?=[A-Z])/g, '$1Á') // LçMPARA -> LÁMPARA
    .replace(/Ç/g, 'Á')
    .replace(/ç/g, 'á');
}

function normalizeRow(row) {
  // Lee campos con distintos alias del CSV
  const sku       = row.sku ?? row.SKU ?? '';
  const name      = row.name ?? row.Nombre ?? row.descripcion ?? row.description ?? '';
  const category  = row.category ?? row.Categoria ?? '';
  let   section   = row.section ?? row.seccion ?? row.section_name ?? row.sectionName ?? '';
  const desc      = row.desc ?? row.Descripcion ?? row.description ?? '';

  // Precios/depósito
  const dailyPrice   = Number(row.dailyPrice ?? row.price ?? row.Precio ?? 0) || 0;
  const depositRate_ = Number(row.depositRate ?? row.Deposito ?? row.deposit ?? NaN);

  // Imagen
  const imageUrl = row.imageUrl ?? row.image_url ?? row.image ?? row.img ?? row.imagen ?? row.url ?? '';

  // Si no vino 'section', intenta derivarla desde la categoría
  if (!section) {
    const catLower = String(category || '').toLowerCase();
    if (/(corporativo|social|todos|ambos|all)/.test(catLower)) section = catLower;
  }

  return {
    sku: String(sku || '').trim(),
    name: fixAccents(String(name || '').trim()),
    category: fixAccents(String(category || '').trim()),
    section: fixAccents(String(section || '').trim()),
    dailyPrice,
    depositRate: Number.isNaN(depositRate_) ? DEFAULT_DEPOSIT_RATE : depositRate_,
    imageUrl,
    image_url: imageUrl,
    description: fixAccents(String(desc || '').trim()),
    active: toBool(row.active ?? row.Activo ?? true, true),
    discountable: toBool(row.discountable ?? row.Descuento ?? true, true),
  };
}


function loadCatalog(){
  const p = CANDIDATE_FILES.find(f => fs.existsSync(f));
  if (!p) return [];
  try{
    if (p.endsWith(".json")){
      const raw = JSON.parse(fs.readFileSync(p,"utf8"));
      return (Array.isArray(raw)?raw:[]).map(normalizeRow).filter(x=>x.active);
    }
    if (p.endsWith(".csv")){
      const buf = fs.readFileSync(p);
      let csvStr = buf.toString("utf8");
      if (/[ÃÂ�]/.test(csvStr)) { try { csvStr = iconv.decode(buf,"win1252"); } catch {} }
      if (csvStr.charCodeAt(0) === 0xFEFF) csvStr = csvStr.slice(1);
      const rows = parseCSV(csvStr,{columns:true,skip_empty_lines:true});
      return rows.map(normalizeRow).filter(x=>x.active);
    }
  }catch(e){
    console.error("Error cargando catálogo:", e);
  }
  return [];
}

let CATALOG = loadCatalog();
const reloadCatalog = () => ((CATALOG = loadCatalog()), CATALOG.length);

const findProduct = ({sku,name})=>{
  const s=String(sku||"").trim().toLowerCase();
  const n=String(name||"").trim().toLowerCase();
  let prod=null;
  if(s) prod = CATALOG.find(p=>(p.sku||"").toLowerCase()===s);
  if(!prod && n) prod = CATALOG.find(p=>(p.name||"").toLowerCase()===n);
  return prod||null;
};

// ---------------------------- Utils ----------------------------
const peso = (n)=> new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(n);

function toDMY(s) {
  if (!s) return "-";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (!isNaN(d)) {
    const pad=(x)=>String(x).padStart(2,"0");
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
  }
  return String(s);
}

function daysDiscountRate(days){
  if (days <= 1) return 0;
  if (days === 2) return 0.15;
  if (days >= 3 && days <= 6) return 0.20;
  if (days >= 7 && days < 30) return 0.50;
  return 0.60;
}
function isExcludedFromDiscount(line){
  const cat = String(line.category || "").toLowerCase();
  const name = String(line.name || "").toLowerCase();
  if (cat === "personal" || cat === "otros") return true;
  if (/(viatic|viático|viaticos|viáticos)/i.test(name)) return true;
  if (/(hosped)/i.test(name)) return true;
  if (/(flete)/i.test(name)) return true;
  return false;
}

function resolveHeaderImage(){
  const pths = [
    HEADER_IMAGE_PATH && (path.isAbsolute(HEADER_IMAGE_PATH) ? HEADER_IMAGE_PATH : path.join(__dirname, HEADER_IMAGE_PATH)),
    path.join(__dirname, "header.png"),
    path.join(__dirname, "header.jpg"),
    path.join(__dirname, "header.jpeg")
  ].filter(Boolean);
  return pths.find(p => fs.existsSync(p)) || null;
}
function resolveLogoImage(){
  const candidates = ["logo.png","logo.jpg","logo.jpeg"].map(f=>path.join(__dirname,"public",f)).concat(
    ["logo.png","logo.jpg","logo.jpeg"].map(f=>path.join(__dirname,f))
  );
  return candidates.find(p=>fs.existsSync(p)) || null;
}

const b64url = (buf)=> Buffer.from(buf).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
const signIdAndExp = (id, expTs)=> {
  const h = crypto.createHmac("sha256", FILE_SIGNING_SECRET);
  h.update(`${id}:${expTs}`); return b64url(h.digest());
};
const isSafeFileName = (name)=> /^[A-Za-z0-9._-]+$/.test(name);

const SEQ_FILE = path.join(DATA_DIR, "sequence.json");
function readSeq(){ try{ return JSON.parse(fs.readFileSync(SEQ_FILE,"utf8")).last ?? 99; } catch{ return 99; } }
function writeSeq(n){ fs.writeFileSync(SEQ_FILE, JSON.stringify({ last:n }, null, 2)); }
function nextSeq(){ const n = readSeq()+1; writeSeq(n); return n; }
function buildQuoteId(client){
  const t = String(client?.eventType || "").toLowerCase();
  const prefix = t.includes("corpor") ? "C" : (t.includes("social") ? "S" : "O");
  const seq = nextSeq();
  return `${prefix}-${seq}`;
}

// ---------------------------- PDF ----------------------------
function createQuotePDF({ quoteId, client, calc }){
  return new Promise((resolve, reject) => {
    const outDir = PRIVATE_QUOTES_DIR;
    if(!fs.existsSync(outDir)) fs.mkdirSync(outDir,{recursive:true});
    const outPath = path.join(outDir, `${quoteId}.pdf`);

    const doc = new PDFDocument({ size: "LETTER", margin: 40 });
    const stream = fs.createWriteStream(outPath);
    stream.on("finish", () => resolve(path.basename(outPath)));
    stream.on("error", reject);
    doc.pipe(stream);

    const pageW   = doc.page.width;
    const contentW= pageW - doc.page.margins.left - doc.page.margins.right;
    const startX  = doc.page.margins.left;

    let y = 36;
    const headerImg = resolveHeaderImage();
    if (headerImg){
      doc.image(headerImg, startX, y, { fit:[contentW,110], align:"center" });
      y += 118;
    } else {
      doc.fontSize(20).text(COMPANY_NAME, startX, y);
      const hdrRight = [COMPANY_EMAIL, COMPANY_PHONE, COMPANY_WEBSITE].filter(Boolean).join(" • ");
      if (hdrRight) doc.fontSize(9).fillColor("gray").text(hdrRight, startX, y+4, { width: contentW, align:"right" }).fillColor("black");
      y += 28;
    }

    doc.fontSize(28).text("Cotización de Servicios", startX, y, { width: contentW, align: "center" });
    y += 28;
    doc.moveTo(startX, y).lineTo(startX + contentW, y).stroke();
    y += 12;

    const gap = 18;
    const leftW = Math.floor(contentW * 0.5) - 8;
    const rightX = startX + leftW + 16;
    const putRow = (left, right) => {
      if (!(left || right)) return;
      doc.fontSize(11).text(left || "", startX, y, { width:leftW });
      doc.fontSize(11).text(right|| "", rightX, y, { width:contentW-leftW-16 });
      y += gap;
    };

    const eventDateDMY = toDMY(client.eventDate);
    const elaboracionDMY = toDMY(dayjs().format("YYYY-MM-DD"));

    putRow(`Cliente: ${client.name || "-"}`, `Email: ${client.email || "-"}`);
    if (client.company) putRow(`Empresa: ${client.company}`, client.phone ? `Teléfono: ${client.phone}` : "");
    else if (client.phone) putRow("", `Teléfono: ${client.phone}`);
    putRow(`Tipo de evento: ${client.eventType || "-"}`, `Fecha de evento: ${eventDateDMY}`);
    putRow(`Ubicación: ${client.eventLocation || "-"}`, `Número de cotización: ${quoteId}`);
    putRow(`Fecha de elaboración: ${elaboracionDMY}`, "");

    y += 6;
    const skuW = 60, cantW = 40, diasW = 40, puW = 70, totW = 90;
    const descW = contentW - (skuW + cantW + diasW + puW + totW);
    const xSku = startX, xDesc = xSku+skuW, xCant = xDesc+descW, xDias = xCant+cantW, xPU = xDias+diasW, xTot = xPU+puW;

    const headerCell = (txt, x, w, align="left") => doc.fontSize(11).text(txt, x, y, { width:w, align });
    headerCell("SKU", xSku, skuW);
    headerCell("Descripción", xDesc, descW);
    headerCell("Cant", xCant, cantW, "right");
    headerCell("Días", xDias, diasW, "right");
    headerCell("P.U.", xPU, puW, "right");
    headerCell("Total", xTot, totW, "right");
    y += 16; doc.moveTo(startX, y).lineTo(startX + contentW, y).stroke(); y += 6;

    for (const l of calc.lines){
      doc.fontSize(10);
      const hSku  = doc.heightOfString(String(l.sku || ""), { width: skuW });
      const hDesc = doc.heightOfString(String(l.name || ""), { width: descW });
      const hCant = doc.heightOfString(String(l.qty), { width: cantW });
      const hDias = doc.heightOfString(String(l.days), { width: diasW });
      const hPU   = doc.heightOfString(peso(l.dailyPrice), { width: puW });
      const hTot  = doc.heightOfString(peso(l.subtotal), { width: totW });
      const rowH  = Math.max(doc.currentLineHeight(), hSku, hDesc, hCant, hDias, hPU, hTot) + 2;

      if (y + rowH > doc.page.height - 180){ doc.addPage(); y = doc.y; }

      doc.text(String(l.sku || ""), xSku, y, { width: skuW });
      doc.text(String(l.name || ""), xDesc, y, { width: descW });
      doc.text(String(l.qty), xCant, y, { width: cantW, align: "right" });
      doc.text(String(l.days), xDias, y, { width: diasW, align: "right" });
      doc.text(peso(l.dailyPrice), xPU, y, { width: puW, align: "right" });
      doc.text(peso(l.subtotal), xTot, y, { width: totW, align: "right" });

      y += rowH;
    }

    y += 10;
    const valueW = totW, valueX = xTot;
    const labelW = 160, labelX = Math.max(startX, valueX - labelW - 10);
    const row = (label, val, bold=false) => {
      doc.fontSize(bold ? 12 : 10);
      doc.text(label, labelX, y, { width: labelW, align:"right" });
      doc.text(peso(val), valueX, y, { width: valueW, align:"right" });
      y += bold ? 18 : 16;
    };
    if ((calc.discount ?? 0) > 0) row("Descuento de renta:", -calc.discount);
    if ((calc.deliveryFee ?? 0) > 0) row("Flete:", calc.deliveryFee);
    row("Subtotal:", calc.subtotal);
    row(`IVA (${Math.round(IVA_RATE*100)}%):`, calc.iva);
    row("Total:", calc.total, true);

    y += 10;
    doc.fontSize(10).text("Observaciones:", startX, y); y += 14;
    const obsTxt = [
      "Esta cotización es de carácter informativo. Para verificar los costos finales, por favor comunícate con nosotros al 55 3099 7587 o por WhatsApp al 55 4055 9280.",
      "Con gusto te asistiremos, ya que los precios pueden variar dependiendo de la logística y las condiciones del montaje.",
      "Servicios sujetos a disponibilidad.",
      "Vigencia de la cotización: 15 días."
    ].join("\n");
    doc.fontSize(9).fillColor("gray").text(obsTxt, startX, y, { width: contentW, align:"left" }).fillColor("black");

    const footer = [COMPANY_NAME, COMPANY_PHONE, COMPANY_EMAIL, COMPANY_WEBSITE].filter(Boolean).join(" • ");
    if (footer){
      const footerY = doc.page.height - 40;
      doc.fontSize(8).fillColor("gray").text(footer, startX, footerY, { width: contentW, align:"center" }).fillColor("black");
    }

    doc.end();
  });
}

// ---------------------------- Cálculos ----------------------------
const ClientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  company: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  eventType: z.string().min(1),
  eventDate: z.string().min(1),
  eventLocation: z.string().min(1)
});
const ItemInSchema = z.object({
  sku: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  qty: z.number().int().positive(),
  days: z.number().int().positive()
});
const QuoteInSchema = z.object({
  client: ClientSchema,
  items: z.array(ItemInSchema).min(1),
  discountRate: z.number().min(0).max(1).optional().default(0),
  discountFixed: z.number().nonnegative().optional().default(0),
  discountApplyTo: z.enum(["discountable","all"]).optional().default("discountable"),
  deliveryFee: z.number().nonnegative().optional().default(0),
  notes: z.string().optional().nullable(),
});

function buildLines(items){
  const missing = [];
  const lines = items.map(it=>{
    const prod = findProduct({ sku: it.sku, name: it.name });
    if (!prod) { missing.push(it.sku || it.name || "?"); return null; }
    return {
      sku: prod.sku, name: prod.name, category: prod.category,
      dailyPrice: Number(prod.dailyPrice || 0),
      depositRate: Number(prod.depositRate || DEFAULT_DEPOSIT_RATE),
      discountable: prod.discountable !== false,
      qty: it.qty, days: it.days
    };
  }).filter(Boolean);
  return { lines, missing };
}

function computeTotals({ items, discountRate=0, discountFixed=0, discountApplyTo="discountable", deliveryFee=0 }){
  const lines = items.map(it=>{
    const subtotal = it.dailyPrice * it.qty * it.days;
    const deposit = (it.depositRate||0) * subtotal;
    const excluded = isExcludedFromDiscount(it) || it.discountable === false;
    const dr = excluded ? 0 : daysDiscountRate(it.days);
    const autoDiscount = subtotal * dr;
    return {...it, subtotal, deposit, autoDiscount, autoRate: dr, excluded};
  });

  const merchandise = lines.reduce((a,l)=>a+l.subtotal,0);
  const autoDiscountTotal = lines.reduce((a,l)=>a+(l.autoDiscount||0),0);

  const eligibleBase = (discountApplyTo==="all")
    ? merchandise
    : lines.filter(l => !l.excluded).reduce((a,l)=>a+l.subtotal,0);

  const pctExtra = eligibleBase * (discountRate || 0);
  const maxFixed = Math.max(0, eligibleBase - pctExtra);
  const fixedExtra = Math.min(discountFixed || 0, maxFixed);
  const extraDiscount = pctExtra + fixedExtra;

  const discount = autoDiscountTotal + extraDiscount;

  const subtotal = merchandise - discount + deliveryFee;
  const iva = subtotal * IVA_RATE;
  const total = subtotal + iva;
  const depositTotal = lines.reduce((a,l)=>a+l.deposit,0);

  return {
    lines, merchandise,
    discount,
    discountBreakdown: { autoDiscountTotal, extraDiscount, discountRate, discountApplyTo },
    deliveryFee, subtotal, iva, total, depositTotal, ivaRate: IVA_RATE
  };
}

// ---------------------------- Email ----------------------------
async function sendQuoteEmail({ toEmail, clientName, eventLabel, quoteId, pdfPath }){
  if (!SEND_EMAILS || !SG_KEY || !toEmail) return { sent:false, reason:"disabled-or-missing-key-or-recipient" };

  const subject = `${clientName}, tu cotización de equipo para ${eventLabel || "tu evento"}`;
  const attachments = [{
    content: fs.readFileSync(pdfPath).toString("base64"),
    filename: `${quoteId}.pdf`,
    type: "application/pdf",
    disposition: "attachment"
  }];

  const width = LOGO_WIDTH_PX;
  const widthAttr = `width="${width}"`;
  const imgStyle  = `width:${width}px;height:auto;max-width:${width}px;display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic`;
  const logoCid   = "logoEmailCID";

  const allowedHost = (u)=>{
    try { return LOGO_URL_ALLOWED_HOSTS.includes(new URL(u).host.toLowerCase()); }
    catch { return false; }
  };

  let logoHtml = "";
  if (LOGO_URL && allowedHost(LOGO_URL)) {
    if (LOGO_INLINE_FROM_URL) {
      try {
        const resp = await fetch(LOGO_URL);
        const buf = Buffer.from(await resp.arrayBuffer());
        const mime = resp.headers.get("content-type") || "image/png";
        attachments.push({
          content: buf.toString("base64"),
          filename: "logo",
          type: mime,
          disposition: "inline",
          content_id: logoCid
        });
        logoHtml = `<div style="margin:6px 0 10px"><img ${widthAttr} src="cid:${logoCid}" alt="${COMPANY_NAME}" style="${imgStyle}"/></div>`;
      } catch {
        logoHtml = `<div style="margin:6px 0 10px"><img ${widthAttr} src="${LOGO_URL}" alt="${COMPANY_NAME}" style="${imgStyle}"/></div>`;
      }
    } else {
      logoHtml = `<div style="margin:6px 0 10px"><img ${widthAttr} src="${LOGO_URL}" alt="${COMPANY_NAME}" style="${imgStyle}"/></div>`;
    }
  } else if (LOGO_URL) {
    console.log("LOGO_URL bloqueado por host no permitido:", (()=>{ try{return new URL(LOGO_URL).host;}catch{return LOGO_URL;} })());
  } else {
    const logoPath = resolveLogoImage();
    if (logoPath) {
      const ext  = path.extname(logoPath).toLowerCase();
      const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
      attachments.push({
        content: fs.readFileSync(logoPath).toString("base64"),
        filename: path.basename(logoPath),
        type: mime,
        disposition: "inline",
        content_id: logoCid
      });
      logoHtml = `<div style="margin:6px 0 10px"><img ${widthAttr} src="cid:${logoCid}" alt="${COMPANY_NAME}" style="${imgStyle}"/></div>`;
    }
  }

  const blocks = [];
  blocks.push(
    `<p style="margin:0 0 8px">Hola ${clientName},</p>`,
    `<p style="margin:0 0 8px">¡Gracias por usar nuestro cotizador!</p>`,
    `<p style="margin:0 0 8px">Como lo solicitaste, adjuntamos la propuesta estimada para tu evento: ${eventLabel || "—"}.</p>`,
    `<p style="margin:0 0 8px">En Medio Angular, sabemos que cada proyecto es único y que el éxito de un evento depende de cada detalle. Por ello, esta cotización es un punto de partida para que tengas una idea de costos y el equipo recomendado.</p>`,
    `<p style="margin:0 0 8px">Para asegurar que el proyecto se adapte perfectamente a tu visión y necesidades, te invitamos a agendar una llamada de 15 minutos con uno de nuestros especialistas. En esta llamada podremos:</p>`,
    `<ul style="margin:0 0 8px 18px;padding:0">
       <li>Garantizar que tu proyecto cuente con la selección de equipo ideal para su éxito.</li>
       <li>Revisar la logística, la ubicación de tu evento y los detalles del montaje.</li>
       <li>Revisar los costos finales y ofrecerte la mejor solución.</li>
       <li>Aclarar cualquier duda técnica que tengas sobre el montaje o el funcionamiento de los equipos.</li>
     </ul>`,
    SG_CALENDLY
      ? `<p style="margin:0 0 8px">Puedes agendar la llamada aquí: ${SG_CALENDLY}</p>`
      : `<p style="margin:0 0 8px">Puedes responder directamente a este correo para que nosotros te contactemos.</p>`,
    `<p style="margin:16px 0 6px">Saludos cordiales,</p>`,
    logoHtml,
    `<p style="margin:0 0 8px">Equipo de Medio Angular<br>Of. ${COMPANY_PHONE}<br>${COMPANY_EMAIL}<br>${COMPANY_WEBSITE}</p>`
  );

  const personalization = {
    to: [{ email: toEmail }],
    bcc: (SG_BCC && SG_BCC !== toEmail) ? [{ email: SG_BCC }] : []
  };

  const msg = {
    from: SG_FROM,
    subject,
    html: blocks.join(""),
    personalizations: [personalization],
    attachments
  };

  try{
    const resp = await sgMail.send(msg);
    console.log("SendGrid OK:", resp?.[0]?.statusCode);
    return { sent:true };
  }catch(err){
    console.error("SendGrid error:", err?.response?.body || err);
    return { sent:false, reason: err?.response?.body || err?.message || "sendgrid-error" };
  }
}

// ---------------------------- API ----------------------------
app.get("/api/health", (_req,res)=>{
  res.json({
    ok:true,
    iva: IVA_RATE,
    catalog: CATALOG.length,
    emails: { enabled: SEND_EMAILS, hasKey: !!SG_KEY, bcc: SG_BCC ? [SG_BCC] : [] },
    admin: { tokenLen: ADMIN_TOKEN.length },
    exports: {
      enabled: EXPORTS_ENABLED,
      dir: path.relative(__dirname, EXPORTS_DIR),
      weekly: { cron: EXPORTS_WEEKLY_CRON, tz: EXPORTS_TZ, to: EXPORTS_WEEKLY_TO },
      zipPassOn: !!EXPORTS_ZIP_PASSWORD
    }
  });
});

app.get("/catalog", (_req,res)=> res.json(CATALOG));
app.post("/catalog/reload", (_req,res)=> res.json({ ok:true, total: reloadCatalog() }));

app.get("/pdf/:id", (req,res)=>{
  const id = req.params.id || "";
  const { sig, exp } = req.query;
  const expNum = Number(exp);
  if (!id || !isSafeFileName(id)) return res.status(400).send("Bad Request");
  if (!sig || !expNum) return res.status(401).send("Missing signature");
  if (Date.now() > expNum) return res.status(410).send("Link expired");
  const expected = signIdAndExp(id, expNum);
  if (sig !== expected) return res.status(403).send("Invalid signature");

  const filePath = path.join(PRIVATE_QUOTES_DIR, id);
  const rel = path.relative(PRIVATE_QUOTES_DIR, filePath);
  if (rel.startsWith("..")) return res.status(400).send("Bad Request");
  if (!fs.existsSync(filePath)) return res.status(404).send("Archivo no encontrado");

  res.setHeader("Cache-Control","private, no-store");
  res.sendFile(filePath);
});

// ---------------------------- Normalizador /quotes ----------------------------
const upload = multer();
app.use("/quotes", upload.none());                                 // multipart/form-data
app.use("/quotes", express.urlencoded({ extended: true }));         // x-www-form-urlencoded
app.use("/quotes", express.json());                                 // application/json

app.use("/quotes", (req, _res, next) => {
  const b = req.body || {};

  const maybeJSON = (x) => {
    if (typeof x === "string") { try { return JSON.parse(x); } catch { return x; } }
    return x;
  };
  const toNum = (v) => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(String(v).replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  };
  const first = (...vals) => vals.find(v => v !== undefined && v !== null && v !== "");

  const pick = (prefix, key, fallback) =>
    b[`${prefix}.${key}`] ?? b[`${prefix}[${key}]`] ?? b[key] ?? fallback;

  let client = maybeJSON(b.client);
  if (!client || typeof client !== "object") client = {};
  client.name    = first(client.name,    pick("client","name"),    b.name);
  client.email   = first(client.email,   pick("client","email"),   b.email);
  client.company = first(client.company, pick("client","company"), b.company);
  client.phone   = first(client.phone,   pick("client","phone"),   b.phone);

  let event = maybeJSON(b.event);
  if (!event || typeof event !== "object") event = {};
  event.type     = first(event.type,     pick("event","type"),     b.eventType);
  event.date     = first(event.date,     pick("event","date"),     b.eventDate);
  event.location = first(event.location, pick("event","location"), b.eventLocation);

  if (typeof event.date === "string") {
    const m = event.date.trim().match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{4})$/);
    if (m) event.date = `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  }

  client.eventType     = first(client.eventType,     event.type);
  client.eventDate     = first(client.eventDate,     event.date);
  client.eventLocation = first(client.eventLocation, event.location);

  let items = maybeJSON(b.items);
  if (!Array.isArray(items)) {
    const bucket = {};
    for (const [k, v] of Object.entries(b)) {
      const m =
        k.match(/^items(?:\[(\d+)\]|\.(\d+))\[(\w+)\]$/) ||
        k.match(/^items(?:\[(\d+)\]|\.(\d+))\.(\w+)$/);
      if (m) {
        const i = Number(m[1] ?? m[2]);
        const f = m[3];
        (bucket[i] ||= {})[f] = v;
      }
    }
    items = Object.keys(bucket)
      .sort((a, c) => Number(a) - Number(c))
      .map((i) => {
        const r = bucket[i];
        const qty  = toNum(r.quantity ?? r.qty ?? r.cantidad) ?? 1;
        const days = toNum(r.days ?? r.dias) ?? 1;
        return {
          sku: String(r.sku ?? "").trim(),
          name: r.name,
          qty,
          days,
          description: r.description ?? ""
        };
      })
      .filter(x => x.sku || x.name);
  } else {
    items = items.map(it => {
      const qty  = toNum(it.quantity ?? it.qty) ?? 1;
      const days = toNum(it.days) ?? 1;
      return { sku: it.sku, name: it.name, qty, days, description: it.description ?? "" };
    });
  }

  const discountRate  = toNum(b.discountRate);
  const discountFixed = toNum(b.discountFixed);
  const deliveryFee   = toNum(b.deliveryFee);
  const notes         = first(b.notes, b.observaciones);

  const acceptPrivacy = !!(b.acceptPrivacy ?? b.privacy ?? b["accept-privacy"] ?? b["accept_privacy"]);

  req.body = {
    client,
    items,
    acceptPrivacy,
    ...(discountRate  !== undefined ? { discountRate }  : {}),
    ...(discountFixed !== undefined ? { discountFixed } : {}),
    ...(deliveryFee   !== undefined ? { deliveryFee }   : {}),
    ...(notes         !== undefined ? { notes }         : {}),
  };

  console.log("NORMALIZED /quotes ->", JSON.stringify(req.body));
  next();
});

// Crear cotización (con rate-limit)
app.post("/quotes", quotesLimiter, async (req,res)=>{
  const parsed = (QuoteInSchema.safeParse(req.body));
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const data = parsed.data;

  const { lines, missing } = buildLines(data.items);
  if (missing.length) return res.status(400).json({ error: `Productos no encontrados: ${missing.join(", ")}` });

  const calc = computeTotals({
    items: lines,
    discountRate: data.discountRate || 0,
    discountFixed: data.discountFixed || 0,
    discountApplyTo: data.discountApplyTo || "discountable",
    deliveryFee: data.deliveryFee || 0
  });

  const quoteId = buildQuoteId(data.client);
  const pdfName = `${quoteId}.pdf`;
  const pdfFullPath = path.join(PRIVATE_QUOTES_DIR, pdfName);

  await createQuotePDF({ quoteId, client: data.client, calc });

  const expTs = Date.now() + FILE_URL_TTL_MINUTES * 60 * 1000;
  const sig = signIdAndExp(pdfName, expTs);
  const pdfUrlSigned = `${QUOTE_BASE_URL}/pdf/${encodeURIComponent(pdfName)}?exp=${expTs}&sig=${encodeURIComponent(sig)}`;

  const createdAt = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const tx = db.transaction(() => {
    const clientRow = stUpsertClient.get({
      name: data.client.name,
      email: data.client.email || null,
      company: data.client.company || null,
      phone: data.client.phone || null
    });
    const q = stInsertQuote.get({
      quote_id: quoteId,
      client_id: clientRow.id,
      event_type: data.client.eventType || null,
      event_name: data.client.eventType || null,
      event_date: data.client.eventDate || null,
      event_location: data.client.eventLocation || null,
      subtotal: calc.subtotal,
      discount: calc.discount,
      iva: calc.iva,
      total: calc.total,
      delivery_fee: data.deliveryFee || 0,
      file_name: pdfName,
      created_at: createdAt
    });
    for (const l of calc.lines) {
      stInsertItem.run({
        quote_id: q.id,
        sku: l.sku || null,
        name: l.name || null,
        category: l.category || null,
        qty: l.qty,
        days: l.days,
        daily_price: l.dailyPrice,
        subtotal: l.subtotal,
        auto_rate: l.autoRate,
        excluded: l.excluded ? 1 : 0
      });
    }
    return { quoteRow: q, clientRow };
  });
  const persist = tx();

  let email = { sent:false };
  try{
    email = await sendQuoteEmail({
      toEmail: data.client.email,
      clientName: data.client.name,
      eventLabel: data.client.eventType || "",
      quoteId,
      pdfPath: pdfFullPath
    });
  }catch(e){
    console.error("Email error:", e);
  }

  res.json({
    ok:true,
    quoteId,
    createdAt: persist.quoteRow.created_at,
    pdf: pdfName,
    pdfUrl: pdfUrlSigned,
    totals: { subtotal: calc.subtotal, discount: calc.discount, iva: calc.iva, total: calc.total },
    emailed: email.sent,
    emailReason: email.reason || null
  });
});

// --------- Admin export protegido con token y ZIP opcional ----------
function requireAdmin(req,res,next){
  const t = (req.headers["x-admin-token"] || "").toString().trim();
  if (!ADMIN_TOKEN || t !== ADMIN_TOKEN) {
    return res.status(401).json({ ok:false, error:"Unauthorized" });
  }
  next();
}

async function exportClientsXlsx() {
  const rows = stExportRows.all();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Clientes");

  ws.columns = [
    { header: "Nombre completo", key: "nombre", width: 32 },
    { header: "Empresa", key: "empresa", width: 28 },
    { header: "Correo", key: "correo", width: 32 },
    { header: "Teléfono", key: "telefono", width: 18 },
    { header: "Tipo de evento", key: "tipo", width: 16 },
    { header: "Fecha del evento", key: "fecha_evento", width: 16 },
    { header: "Ubicación del evento", key: "ubicacion", width: 28 },
    { header: "Fecha de la cotización", key: "fecha_cot", width: 20 },
    { header: "Número de cotización", key: "folio", width: 14 },
    { header: "Descuento", key: "descuento", width: 14 },
    { header: "Sub total", key: "subtotal", width: 14 },
    { header: "IVA", key: "iva", width: 14 },
    { header: "Total", key: "total", width: 14 }
  ];

  const formatMoney = (n)=> typeof n==="number" ? n : Number(n||0);

  ws.addRows(rows.map(r => ({
    nombre: r.client_name || "",
    empresa: r.client_company || "",
    correo: r.client_email || "",
    telefono: r.client_phone || "",
    tipo: r.event_type || "",
    fecha_evento: toDMY(r.event_date || ""),
    ubicacion: r.event_location || "",
    fecha_cot: toDMY((r.created_at || "").split(" ")[0]),
    folio: r.quote_id || "",
    descuento: formatMoney(r.discount),
    subtotal: formatMoney(r.subtotal),
    iva: formatMoney(r.iva),
    total: formatMoney(r.total)
  })));

  ["descuento","subtotal","iva","total"].forEach(k => ws.getColumn(k).numFmt = '"$"#,##0.00;-"$"#,##0.00');

  const stamp = dayjs().format("YYYYMMDD");
  const xlsxPath = path.join(EXPORTS_DIR, `clientes-${stamp}.xlsx`);
  await wb.xlsx.writeFile(xlsxPath);

  const zipPath = path.join(EXPORTS_DIR, `clientes-${stamp}.zip`);
  await new Promise(async (resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    out.on("close", resolve);
    out.on("error", reject);

    if (EXPORTS_ZIP_PASSWORD) {
      try {
        const { default: archiverEncrypted } = await import('archiver-zip-encrypted');
        archiver.registerFormat('zip-encrypted', archiverEncrypted);
        const zip = archiver.create('zip-encrypted', {
          zlib: { level: 9 },
          encryptionMethod: 'aes256',
          password: EXPORTS_ZIP_PASSWORD
        });
        zip.on("error", reject);
        zip.pipe(out);
        zip.file(xlsxPath, { name: path.basename(xlsxPath) });
        zip.finalize();
        return;
      } catch {
        console.warn("archiver-zip-encrypted no disponible, se generará ZIP sin cifrar.");
      }
    }

    const zip = archiver("zip", { zlib: { level: 9 }});
    zip.on("error", reject);
    zip.pipe(out);
    zip.file(xlsxPath, { name: path.basename(xlsxPath) });
    zip.finalize();
  });

  const encrypted = !!EXPORTS_ZIP_PASSWORD;
  return { xlsxPath, zipPath, rows: rows.length, encrypted };
}

async function sendExportNow(toList = []) {
  const to = (toList && toList.length ? toList : EXPORTS_WEEKLY_TO).map(email => ({ email }));
  const { xlsxPath, zipPath, rows, encrypted } = await exportClientsXlsx();

  const attachments = [];
  attachments.push({
    content: fs.readFileSync(zipPath).toString("base64"),
    filename: path.basename(zipPath),
    type: "application/zip",
    disposition: "attachment"
  });

  const personalization = {
    to,
    bcc: (SG_BCC && !to.some(t => t.email === SG_BCC)) ? [{ email: SG_BCC }] : []
  };

  const msg = {
    from: SG_FROM,
    subject: `Clientes / Cotizaciones (export ${dayjs().format("DD/MM/YYYY")})`,
    html: `<p>Export automática con ${rows} registros.</p>`,
    personalizations: [personalization],
    attachments
  };
  const resp = await sgMail.send(msg);
  return { rows, status: resp?.[0]?.statusCode || 202, file: path.relative(__dirname, zipPath), zipped: true, encrypted, mode: "zip" };
}

app.post("/admin/export/clients/send-now", requireAdmin, async (req,res)=>{
  try{
    if (!SEND_EMAILS || !SG_KEY) return res.status(400).json({ ok:false, error:"Email deshabilitado o falta SENDGRID_API_KEY" });
    const to = (String(req.query.to||"").split(",").map(s=>s.trim()).filter(Boolean));
    const r = await sendExportNow(to);
    res.json({ ok:true, ...r, sentTo: to.length? to: EXPORTS_WEEKLY_TO, bcc: SG_BCC ? [SG_BCC] : [] });
  }catch(e){
    console.error(e);
    res.status(500).json({ ok:false, error: "SendGrid ZIP failed: " + (e?.message || e), detail: e?.response?.body || null });
  }
});

// ---------------------------- Tareas programadas ----------------------------
if (EXPORTS_ENABLED && SEND_EMAILS && SG_KEY) {
  try{
    cron.schedule(EXPORTS_WEEKLY_CRON, async ()=>{
      try{ await sendExportNow(EXPORTS_WEEKLY_TO); }
      catch(e){ console.error("Weekly export error:", e); }
    }, { timezone: EXPORTS_TZ });
    console.log(`Weekly export ON (${EXPORTS_WEEKLY_CRON} tz=${EXPORTS_TZ})`);
  }catch(e){
    console.warn("No se pudo programar export semanal:", e?.message || e);
  }
}

// ---------------------------- 404 ----------------------------
app.use((_req,res)=> res.status(404).json({ error: "Not found" }));

// ---------------------------- Start ----------------------------
app.listen(PORT, ()=>{
  console.log(`Cotizador Medio Angular en http://localhost:${PORT}`);
  console.log(`Emails: ${SEND_EMAILS ? (SG_KEY ? "ON" : "OFF (sin API key)") : "OFF"}`);
  console.log(`Admin token len: ${ADMIN_TOKEN.length}`);
  console.log(`Exports: ${EXPORTS_ENABLED ? "ON" : "OFF"} | ZIP password: ${EXPORTS_ZIP_PASSWORD ? "ON" : "OFF"}`);
});
