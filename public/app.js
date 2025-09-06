/* public/app.js — Front-only (VARIANTS + JSON POST schema fixed) */
(() => {
  const API_BASE = 'https://cotizador-local-jp.onrender.com';
  const API = {
  catalog: `${API_BASE}/catalog`,
  quote:   `${API_BASE}/quotes`
};

  const $ = (sel) => document.querySelector(sel);

  // ---------- Variante por URL/archivo ----------
  const VARIANT = (() => {
    const p = location.pathname.toLowerCase();
    if (p.includes('corporativo')) return 'corporativo';
    if (p.includes('social')) return 'social';
    return 'experto';
  })();

  // ---------- Tipos de evento por variante ----------
  const EVENT_TYPES = {
    experto: [
      'Kick-off / Reunión de planificación',
      'Capacitación / Taller de desarrollo',
      'Evento de networking & Team building',
      'Evento con clientes',
      'Lanzamiento de producto',
      'Seminario / conferencia especializada',
      'Convención anual',
      'Evento de responsabilidad social',
      'Fiesta de fin de año',
      'Otro corporativo',
      'Boda','Graduación','Cumpleaños','Aniversario de boda','15 años',
      'Baby Shower','Fiestas patrias','Halloween','Otro social'
    ],
    corporativo: [
      'Kick-off / Reunión de planificación',
      'Capacitación / Taller de desarrollo',
      'Evento de networking & Team building',
      'Evento con clientes',
      'Lanzamiento de producto',
      'Seminario / conferencia especializada',
      'Convención anual',
      'Evento de responsabilidad social',
      'Fiesta de fin de año',
      'Otro Corporativo'
    ],
    social: [
      'Boda','Graduación','Cumpleaños','Aniversario de boda','15 años',
      'Baby Shower','Fiestas patrias','Halloween','Otro Social'
    ]
  };

  // ---------- Helpers ----------
  // Normaliza y corrige artefactos típicos (em dash y diacríticos en “ACIÓN”)
const toNFC = (v) => {
  if (typeof v !== 'string') return v;
  let s = v.normalize('NFC');

  // 1) Guión / en-dash / em-dash entre letras ⇒ ó/Ó  (Iluminaci—n → Iluminación)
  s = s.replace(/(\p{L})[—–-](\p{L})/gu, (m, a, b) => {
    const upper = a === a.toUpperCase() && b === b.toUpperCase();
    return a + (upper ? 'Ó' : 'ó') + b;
  });

  // 2) ACI + (combinantes o î/Î/^/ˆ) + N  ⇒  ACIÓN  (ILUMINACÎN / ILUMINACIÎN → ILUMINACIÓN)
  s = s
    .replace(/ACI[\u0300-\u036F]+N/g, 'ACIÓN')
    .replace(/aci[\u0300-\u036F]+n/g, 'ación')
    .replace(/ACI[îÎ\u02C6\u0302\^ˆ]N/g, 'ACIÓN')
    .replace(/aci[îÎ\u02C6\u0302\^ˆ]n/g, 'ación');

  return s;
};

  const intOr = (v, min = 1, def = 1) => {
    const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
    return Number.isNaN(n) ? def : Math.max(min, n);
  };
  const _norm = (s) => (s ?? '').toString().normalize('NFC').toLowerCase();
  const _tags = (s) => _norm(s).split(/[,\s/|]+/).filter(Boolean);

  // ---------- DOM ----------
  const els = {
    grid: $('#catalogGrid') || $('#grid') || $('.catalog'),
    search: $('#search') || $('#q'),
    category: $('#filterCategory') || $('#category'),
    cartRows: $('#cartRows') || $('tbody#cart'),
    send: $('#sendQuote') || $('#btnSend') || $('#enviar'),
    acceptPrivacy: $('#acceptPrivacy') || $('#chkPrivacy'),
    form: $('#clientForm') || $('form'),
    name: $('#name'),
    company: $('#company'),
    email: $('#email'),
    email2: $('#email2'),
    phone: $('#phone'),
    eventType: $('#eventType') || $('#tipoEvento'),
    eventDate: $('#eventDate') || $('input[type="date"]'),
    eventLocation: $('#eventLocation') || $('#ubicacion'),
    privacyLink:
      document.querySelector('[data-open-privacy]') ||
      document.querySelector('a[href$="avisoprivacidad.html"]'),
  };

  // ---------- Estado ----------
  let CATALOG = [];
  const CART = new Map();

  // ---------- Filtro por variante ----------
  function passesVariant(it) {
    if (VARIANT === 'experto') return true; // sin filtro
    const t = _tags(it.section);
    if (!t.length) return false; // si no trae section, ocúltalo en variantes
    if (VARIANT === 'corporativo') return t.includes('corporativo') || t.includes('todos') || t.includes('ambos') || t.includes('all');
    if (VARIANT === 'social')      return t.includes('social')      || t.includes('todos') || t.includes('ambos') || t.includes('all');
    return true;
  }

  function applyEventTypeOptions() {
    const sel = els.eventType;
    if (!sel) return;
    const list = EVENT_TYPES[VARIANT] || EVENT_TYPES.experto;
    sel.innerHTML =
      `<option value="" disabled selected>Selecciona...</option>` +
      list.map(s => `<option value="${s}">${s}</option>`).join('');
  }

  // ---------- Catálogo ----------
  async function loadCatalog() {
    try {
      const res = await fetch(API.catalog, { credentials: 'omit' });
      const data = await res.json();

      CATALOG = Array.isArray(data) ? data.map((r) => {
        // Normaliza category y section (deriva section si backend no la manda)
        const categoryRaw = r.category ?? r.Categoria ?? '';
        let sectionRaw = r.section ?? r.seccion ?? r.section_name ?? r.sectionName ?? '';

        // Si no vino section, intenta derivarla desde category cuando ahí vienen las etiquetas
        if (!sectionRaw) {
          const catLower = String(categoryRaw || '').toLowerCase();
          if (/(^|[,\s])(?:corporativo|social|todos|ambos|all)(?=($|[,\s]))/.test(catLower)) {
            sectionRaw = categoryRaw; // úsalo como section
          }
        }

        return {
          sku: toNFC(r.sku || r.SKU || ''),
          name: toNFC(r.name || r.Nombre || r.descripcion || r.description || ''),
          desc: toNFC(r.desc || r.Descripcion || r.description || ''),
          price: Number(r.price ?? r.Precio ?? 0) || 0,
          category: toNFC(categoryRaw || ''),
          section: toNFC(sectionRaw || ''),
          image: String(r.image || r.img || r.imageUrl || r.image_url || r.imagen || r.photo || r.url || '').trim(),
        };
      }) : [];

      fillCategories();
      renderCatalog();
    } catch (e) {
      console.error('Catálogo error:', e);
      CATALOG = [];
      renderCatalog();
    }
  }

  function fillCategories() {
    const sel = els.category;
    if (!sel) return;
    // Solo categorías de los productos visibles para la variante
    const base = CATALOG.filter(passesVariant);
    const cats = Array.from(
      new Set(base.map((x) => String(x.category || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'es'));
    sel.innerHTML =
      `<option value="">Todas</option>` +
      cats.map((c) => `<option value="${c}">${c}</option>`).join('');
  }

  function renderCatalog() {
    const grid = els.grid;
    if (!grid) return;

    const q = (els.search?.value || '').trim().toLowerCase();
    const cat = (els.category?.value || '').trim().toLowerCase();

    const pool = CATALOG.filter(passesVariant);

    const rows = pool.filter((it) => {
      const okCat = !cat || cat === 'todas' || (it.category || '').toLowerCase() === cat;
      const hit =
        !q ||
        (it.sku || '').toLowerCase().includes(q) ||
        (it.name || '').toLowerCase().includes(q) ||
        (it.desc || '').toLowerCase().includes(q) ||
        (it.category || '').toLowerCase().includes(q);
      return okCat && hit;
    });

    grid.innerHTML = '';
    if (!rows.length) {
      grid.innerHTML = '<div style="opacity:.85">No se encontraron resultados.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'product';

      const imgBox = document.createElement('div');
      imgBox.className = 'imgBox';
      const img = document.createElement('img');
      const imgSrc = item.image || item.imageUrl || item.image_url;
      if (imgSrc) {
        img.src = imgSrc;
        img.alt = item.name || item.sku;
        img.onerror = () => { img.remove(); const ph = document.createElement('div'); ph.className = 'ph'; imgBox.appendChild(ph); };
        imgBox.appendChild(img);
      } else {
        const ph = document.createElement('div'); ph.className = 'ph'; imgBox.appendChild(ph);
      }
      card.appendChild(imgBox);

      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = item.name || item.sku;
      card.appendChild(title);

      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = item.desc || '';
      card.appendChild(desc);

      const controls = document.createElement('div');
      controls.className = 'controls';

      const line1 = document.createElement('div');
      line1.className = 'line';

      const qtyField = document.createElement('div');
      qtyField.className = 'field';
      qtyField.innerHTML = `<label>Cantidad</label><input type="number" min="1" value="1" class="input" />`;
      const daysField = document.createElement('div');
      daysField.className = 'field';
      daysField.innerHTML = `<label>Días</label><input type="number" min="1" value="1" class="input" />`;

      line1.appendChild(qtyField);
      line1.appendChild(daysField);
      controls.appendChild(line1);

      const line2 = document.createElement('div');
      line2.className = 'line';
      const addBtn = document.createElement('button');
      addBtn.className = 'btn';
      addBtn.type = 'button';
      addBtn.textContent = 'Agregar';
      addBtn.addEventListener('click', () => {
        const qty  = qtyField.querySelector('input')?.value;
        const days = daysField.querySelector('input')?.value;
        addToCart(item, qty, days);
        card.dataset.added = '1';
        addBtn.textContent = 'Agregado ✓';
        addBtn.disabled = true;
      });
      line2.appendChild(addBtn);
      controls.appendChild(line2);

      card.appendChild(controls);

      if (CART.has(item.sku)) {
        addBtn.textContent = 'Agregado ✓';
        addBtn.disabled = true;
        card.dataset.added = '1';
      }

      frag.appendChild(card);
    });

    grid.appendChild(frag);
  }

  // ---------- Carrito ----------
  function addToCart(item, qty, days) {
    if (!item?.sku) return;
    if (CART.has(item.sku)) {
      const cur = CART.get(item.sku);
      cur.qty = intOr(qty, 1, cur.qty || 1);
      cur.days = intOr(days, 1, cur.days || 1);
    } else {
      CART.set(item.sku, {
        sku: item.sku,
        name: item.name || item.sku,
        desc: item.desc || '',
        qty: intOr(qty, 1, 1),
        days: intOr(days, 1, 1),
      });
    }
    renderCart();
  }

  function removeFromCart(sku) {
    CART.delete(sku);
    renderCart();
    renderCatalog();
  }

  function renderCart() {
    const tbody = els.cartRows;
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!CART.size) {
      tbody.innerHTML = `<tr><td colspan="5" style="opacity:.8">Aún no has agregado productos.</td></tr>`;
      if (els.send) els.send.disabled = true;
      return;
    }

    const frag = document.createDocumentFragment();
    Array.from(CART.values()).forEach((row) => {
      const tr = document.createElement('tr');

      const tdSku = document.createElement('td');
      tdSku.textContent = row.sku;

      const tdDesc = document.createElement('td');
      tdDesc.textContent = row.name || row.desc || row.sku;

      const tdQty = document.createElement('td');
      const inQty = document.createElement('input');
      inQty.type = 'number';
      inQty.min = '1';
      inQty.value = row.qty;
      inQty.className = 'input';
      inQty.addEventListener('change', () => { row.qty = intOr(inQty.value, 1, 1); });
      tdQty.appendChild(inQty);

      const tdDays = document.createElement('td');
      const inDays = document.createElement('input');
      inDays.type = 'number';
      inDays.min = '1';
      inDays.value = row.days;
      inDays.className = 'input';
      inDays.addEventListener('change', () => { row.days = intOr(inDays.value, 1, 1); });
      tdDays.appendChild(inDays);

      const tdActions = document.createElement('td');
      const rm = document.createElement('button');
      rm.className = 'btn danger';
      rm.type = 'button';
      rm.textContent = 'Quitar';
      rm.addEventListener('click', () => removeFromCart(row.sku));
      tdActions.appendChild(rm);

      tr.appendChild(tdSku);
      tr.appendChild(tdDesc);
      tr.appendChild(tdQty);
      tr.appendChild(tdDays);
      tr.appendChild(tdActions);
      frag.appendChild(tr);
    });

    tbody.appendChild(frag);
    if (els.send) els.send.disabled = false;
  }

  // ---------- Popup Aviso de Privacidad ----------
  (function privacyPopup() {
    const link = els.privacyLink;
    if (!link) return;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const w = window.open(link.getAttribute('href'), 'privacy', 'width=720,height=600');
      if (!w) location.href = link.getAttribute('href');
    });
  })();

  // ---------- Validación ----------
  function validateForm(show = false) {
    const r = {
      name: !!els.name?.value.trim(),
      email: !!els.email?.value.trim() && els.email.value.includes('@'),
      email2: (els.email2?.value.trim() || '') === (els.email?.value.trim() || ''),
      eventType: !!els.eventType?.value,
      eventDate: !!els.eventDate?.value,
      eventLocation: !!els.eventLocation?.value.trim(),
      privacy: !!els.acceptPrivacy?.checked,
    };
    const ok = r.name && r.email && r.email2 && r.eventType && r.eventDate && r.eventLocation && r.privacy;
    if (show) {
      els.name?.setCustomValidity(r.name ? '' : 'Requerido');
      els.email?.setCustomValidity(r.email ? '' : 'Correo inválido');
      els.email2?.setCustomValidity(r.email2 ? '' : 'Debe coincidir');
      els.eventType?.setCustomValidity(r.eventType ? '' : 'Selecciona un tipo');
      els.eventDate?.setCustomValidity(r.eventDate ? '' : 'Indica la fecha');
      els.eventLocation?.setCustomValidity(r.eventLocation ? '' : 'Indica la ubicación');
    }
    return ok;
  }

  // ---------- Envío (JSON alineado al server) ----------
  async function sendQuote() {
    if (!CART.size) return alert('Agrega al menos un producto.');
    if (!validateForm(true)) return els.form?.reportValidity?.();
    if (!els.acceptPrivacy?.checked) return alert('Debes aceptar el Aviso de Privacidad.');

    const items = Array.from(CART.values()).map((x) => ({
      sku: x.sku,
      qty: intOr(x.qty, 1, 1),
      days: intOr(x.days, 1, 1),
    }));

    // dd/mm/aaaa -> yyyy-mm-dd
    const raw = toNFC(els.eventDate?.value || '');
    let dateISO = raw;
    const m = raw.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{4})$/);
    if (m) { const D=m[1].padStart(2,'0'), M=m[2].padStart(2,'0'), Y=m[3]; dateISO = `${Y}-${M}-${D}`; }

    const payload = {
      client: {
        name: toNFC(els.name?.value || ''),
        email: toNFC(els.email?.value || ''),
        company: toNFC(els.company?.value || ''),
        phone: toNFC(els.phone?.value || ''),
        eventType: toNFC(els.eventType?.value || ''),
        eventDate: dateISO,
        eventLocation: toNFC(els.eventLocation?.value || ''),
      },
      items
      // discountRate/Fixed/deliveryFee opcionales aquí si los usas
    };

    try {
      if (els.send) els.send.disabled = true;
      const res = await fetch(API.quote, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text().catch(()=>'');
      if (!res.ok) {
        console.error('POST /quotes falló', { status: res.status, statusText: res.statusText, body: text });
        alert(`No se pudo enviar la cotización.\nHTTP ${res.status} ${res.statusText}\n${text.slice(0,400)}`);
        return;
      }
      alert('¡Cotización enviada! Revisa tu correo.');
      CART.clear(); renderCart();
    } catch (e) {
      console.error('Send quote error:', e);
      alert('Ocurrió un problema al enviar la cotización. Intenta más tarde.');
    } finally {
      if (els.send) els.send.disabled = false;
    }
  }

  // ---------- Botón calendario (nativo) ----------
  function injectDateButton() {
    const inp = els.eventDate;
    if (!inp) return;
    if (document.getElementById('btnEventCalendar')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Elegir fecha';
    btn.setAttribute('aria-label', 'Elegir fecha');
    btn.textContent = '📅';
    btn.style.marginLeft = '6px';
    btn.style.padding = '6px 8px';
    btn.style.borderRadius = '8px';
    btn.style.border = '1px solid #444';
    btn.style.background = 'transparent';
    btn.style.cursor = 'pointer';
    inp.insertAdjacentElement('afterend', btn);
    btn.addEventListener('click', () => {
      if (typeof inp.showPicker === 'function') inp.showPicker();
      else { inp.focus(); try { inp.click(); } catch {} }
    });
  }

  // ---------- Botón externo (compat) ----------
  function hookupExternalCalendarButton() {
    const textInput = document.querySelector(
      '#eventDate, input[name="event_date"], input[placeholder*="dd"][placeholder*="aaaa"]'
    );
    if (!textInput) return;

    try { if (textInput.type === 'date') textInput.type = 'text'; } catch {}

    let wrap = textInput.closest('.date-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'date-wrap';
      textInput.parentNode.insertBefore(wrap, textInput);
      wrap.appendChild(textInput);
    }

    let native = wrap.querySelector('input[type="date"][data-native-picker]');
    if (!native) {
      native = document.createElement('input');
      native.type = 'date';
      native.setAttribute('data-native-picker', '');
      native.setAttribute('aria-hidden', 'true');
      native.tabIndex = -1;
      wrap.appendChild(native);
    }

    Object.assign(native.style, {
      position: 'fixed', left: '8px', top: '8px',
      width: '1px', height: '1px', opacity: '0.01',
      border: 0, padding: 0, margin: 0, background: 'transparent',
    });

    const syncToNative = () => {
      const m = (textInput.value || '')
        .trim()
        .match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{4})$/);
      if (m) {
        const D = m[1].padStart(2, '0'),
              M = m[2].padStart(2, '0'),
              Y = m[3];
        native.value = `${Y}-${M}-${D}`;
      }
    };
    textInput.addEventListener('blur', syncToNative);

    native.addEventListener('change', () => {
      const v = native.value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const [Y, M, D] = v.split('-');
        textInput.value = `${D}/${M}/${Y}`;
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
        textInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    const opener = document.getElementById('btnEventCalendar');
    if (opener) {
      const openPicker = (e) => {
        e.preventDefault();
        e.stopPropagation();
        requestAnimationFrame(() => {
          native.showPicker?.() || native.click?.() || native.focus();
        });
      };
      ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach((evt) =>
        opener.addEventListener(evt, openPicker, { passive: false })
      );
    }
  }

  // ---------- Init ----------
  function init() {
    applyEventTypeOptions();
    hookupExternalCalendarButton();
    injectDateButton();
    loadCatalog();
    renderCart();

    if (els.send) els.send.addEventListener('click', sendQuote);
    if (els.search) els.search.addEventListener('input', renderCatalog);
    if (els.category) els.category.addEventListener('change', renderCatalog);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
