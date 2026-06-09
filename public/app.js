/* public/app.js — Cotizador Medio Angular
   Versión limpia:
   - Catálogo por variantes: corporativo / social / experto
   - Orden por sort_group / sort_order
   - Stepper responsivo de 5 pasos
   - Textos largos del stepper en dos líneas controladas
   - Sección 2) Operación, montaje y logística con estética clara
   - Sección 5) Enviar cotización simplificada
   - Aviso de Privacidad dentro de Enviar cotización
   - Checkbox de estimación automática
   - Honeypot anti-bot
*/

(() => {
  const isLocalHost =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    /^192\.168\./.test(location.hostname) ||
    /^10\./.test(location.hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(location.hostname);

  const API_BASE =
    window.API_BASE ||
    (isLocalHost ? 'http://localhost:4000' : 'https://cotizador-local-jp.onrender.com');

  const API = {
    catalog: `${API_BASE}/catalog`,
    quote: `${API_BASE}/quotes`
  };

  const $ = (sel) => document.querySelector(sel);

  const VARIANT = (() => {
    const p = location.pathname.toLowerCase();
    if (p.includes('corporativo')) return 'corporativo';
    if (p.includes('social')) return 'social';
    return 'experto';
  })();

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
      'Boda',
      'Graduación',
      'Cumpleaños',
      'Aniversario de boda',
      '15 años',
      'Baby Shower',
      'Fiestas patrias',
      'Halloween',
      'Otro social'
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
      'Boda',
      'Graduación',
      'Cumpleaños',
      'Aniversario de boda',
      '15 años',
      'Baby Shower',
      'Fiestas patrias',
      'Halloween',
      'Otro Social'
    ]
  };

  const LOGISTICS_SORT_GROUPS = new Set([150, 160, 170, 180, 190]);

  const LOGISTICS_CATEGORIES = [
    'Personal técnico',
    'Personal',
    'Viáticos',
    'Viaticos',
    'Hospedajes',
    'Hospedaje',
    'Transportes',
    'Transporte',
    'Fletes',
    'Flete'
  ];

  function getCotizadorChannel() {
    const path = String(window.location?.pathname || '').toLowerCase();

    if (path.includes('corporativo')) return 'corporativo';
    if (path.includes('social')) return 'social';

    return null;
  }

  function pushCotizadorEvent(baseEvent, extra = {}) {
    const channel = getCotizadorChannel();

    if (!channel) return;

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: `${baseEvent}_${channel}`,
      cotizador_tipo: channel,
      ...extra
    });
  }

  const els = {
    grid: $('#catalogGrid') || $('#grid') || $('.catalog'),
    search: $('#search') || $('#q'),
    category: $('#filterCategory') || $('#category'),
    cartRows: $('#cartRows') || $('tbody#cart'),
    send: $('#sendQuote') || $('#btnSend') || $('#enviar'),
    acceptPrivacy: $('#acceptPrivacy') || $('#chkPrivacy'),
    acceptEstimateTerms: $('#acceptEstimateTerms'),
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
    selectionBar: $('#selectionBar'),
    selectionBarText: $('#selectionBarText'),
    selectionBarButton: $('#selectionBarButton'),
    opsSection: $('#operationLogisticsSection'),
    opsGrid: $('#operationLogisticsGrid'),
    estimateTermsBlock: $('#estimateTermsBlock'),
    honeypot: null
  };

  let CATALOG = [];
  const CART = new Map();

  const toNFC = (v) => {
    if (typeof v !== 'string') return v;

    let s = v.normalize('NFC');

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

  const numberOr = (v, fallback = 999) => {
    if (v === undefined || v === null || String(v).trim() === '') return fallback;
    const n = Number(String(v).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
  };

  const _norm = (s) => (s ?? '').toString().normalize('NFC').toLowerCase();
  const _tags = (s) => _norm(s).split(/[,\s/|]+/).filter(Boolean);

  function compareCatalogItems(a, b) {
    return (
      (numberOr(a.sortGroup) - numberOr(b.sortGroup)) ||
      (numberOr(a.sortOrder) - numberOr(b.sortOrder)) ||
      String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' })
    );
  }

  function isLogisticsItem(item) {
    const group = numberOr(item.sortGroup);
    const categoryNorm = _norm(item.category);

    if (LOGISTICS_SORT_GROUPS.has(group)) return true;

    return LOGISTICS_CATEGORIES.some((cat) => categoryNorm === _norm(cat));
  }

  function getCategorySortInfo(items) {
    const map = new Map();

    items.forEach((item) => {
      const category = String(item.category || '').trim();
      if (!category) return;

      const group = numberOr(item.sortGroup);
      const order = numberOr(item.sortOrder);

      const prev = map.get(category);

      if (!prev) {
        map.set(category, {
          category,
          sortGroup: group,
          sortOrder: order
        });
        return;
      }

      if (
        group < prev.sortGroup ||
        (group === prev.sortGroup && order < prev.sortOrder)
      ) {
        map.set(category, {
          category,
          sortGroup: group,
          sortOrder: order
        });
      }
    });

    return Array.from(map.values()).sort((a, b) =>
      (a.sortGroup - b.sortGroup) ||
      (a.sortOrder - b.sortOrder) ||
      a.category.localeCompare(b.category, 'es', { sensitivity: 'base' })
    );
  }

  function passesVariant(it) {
    if (VARIANT === 'experto') return true;

    const t = _tags(it.section);
    if (!t.length) return false;

    if (VARIANT === 'corporativo') {
      return t.includes('corporativo') ||
        t.includes('todos') ||
        t.includes('ambos') ||
        t.includes('all');
    }

    if (VARIANT === 'social') {
      return t.includes('social') ||
        t.includes('todos') ||
        t.includes('ambos') ||
        t.includes('all');
    }

    return true;
  }

  function formatDateInputValue(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 8);

    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;

    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }

  function parseDMYDate(value) {
    const raw = String(value || '').trim();
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);

    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);

    if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
    if (year < 1900 || year > 2100) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;

    const date = new Date(year, month - 1, day);

    const isSameDate =
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day;

    if (!isSameDate) return null;

    return { day, month, year, date };
  }

  function isValidEventDate(value) {
    return !!parseDMYDate(value);
  }

  function eventDateToISO(value) {
    const parsed = parseDMYDate(value);
    if (!parsed) return '';

    const D = String(parsed.day).padStart(2, '0');
    const M = String(parsed.month).padStart(2, '0');
    const Y = String(parsed.year);

    return `${Y}-${M}-${D}`;
  }

  function setEventDateValidity(show = false) {
    const inp = els.eventDate;
    if (!inp) return false;

    const value = String(inp.value || '').trim();
    const ok = isValidEventDate(value);

    if (show) {
      inp.setCustomValidity(ok ? '' : 'Ingresa una fecha válida con formato dd/mm/aaaa.');
    } else if (ok) {
      inp.setCustomValidity('');
    }

    return ok;
  }

  function attachEventDateMask() {
    const inp = els.eventDate;
    if (!inp) return;

    inp.setAttribute('inputmode', 'numeric');
    inp.setAttribute('maxlength', '10');
    inp.setAttribute('placeholder', 'dd / mm / aaaa');

    inp.addEventListener('input', () => {
      const formatted = formatDateInputValue(inp.value);
      inp.value = formatted;

      if (formatted.length === 10 && isValidEventDate(formatted)) {
        inp.setCustomValidity('');
      }
    });

    inp.addEventListener('blur', () => {
      inp.value = formatDateInputValue(inp.value);
      setEventDateValidity(true);
    });
  }

  function ensureHoneypotField() {
    let input =
      document.querySelector('#website') ||
      document.querySelector('input[name="website"]');

    if (input) return input;

    input = document.createElement('input');
    input.type = 'text';
    input.id = 'website';
    input.name = 'website';
    input.autocomplete = 'off';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');

    Object.assign(input.style, {
      position: 'absolute',
      left: '-9999px',
      top: 'auto',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none'
    });

    document.body.appendChild(input);

    return input;
  }

  function applyEventTypeOptions() {
    const sel = els.eventType;
    if (!sel) return;

    const list = EVENT_TYPES[VARIANT] || EVENT_TYPES.experto;

    sel.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = 'Selecciona...';
    sel.appendChild(placeholder);

    list.forEach((eventType) => {
      const option = document.createElement('option');
      option.value = eventType;
      option.textContent = eventType;
      sel.appendChild(option);
    });
  }

  function injectGlobalStyles() {
    if (document.getElementById('cotizadorDynamicStyles')) return;

    const style = document.createElement('style');
    style.id = 'cotizadorDynamicStyles';
    style.textContent = `
      #cotizadorTopStepper{
        flex-wrap: nowrap;
      }

      #cotizadorTopStepper .cotizador-step-label{
        line-height: 1.08;
      }

      #cotizadorTopStepper .cotizador-step-line{
        min-width: 18px;
      }

      @media (max-width: 1100px){
        #cotizadorTopStepper{
          flex-wrap: wrap;
          gap: 12px !important;
        }

        #cotizadorTopStepper .cotizador-step-item{
          flex: 1 1 170px !important;
          min-width: 150px !important;
        }

        #cotizadorTopStepper .cotizador-step-line{
          display: none !important;
        }

        #cotizadorTopStepper .cotizador-step-label{
          font-size: 14px !important;
        }
      }

      @media (max-width: 640px){
        #cotizadorTopStepper .cotizador-step-item{
          flex: 1 1 100% !important;
          min-width: 100% !important;
        }

        #cotizadorTopStepper .cotizador-step-circle{
          width: 34px !important;
          height: 34px !important;
          font-size: 15px !important;
        }

        #cotizadorTopStepper .cotizador-step-label{
          font-size: 14px !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function removeDuplicatedFlowIntro() {
    const block = document.getElementById('cotizadorFlowSteps');
    if (block) block.remove();
  }

  function ensureTopProgressStepper() {
    const path = String(window.location?.pathname || '').toLowerCase();
    const isPublicCotizador = path.includes('corporativo') || path.includes('social');

    if (isPublicCotizador) {
      document.querySelectorAll('nav.stepper, .stepper, .stepper__inner, [aria-label="Flujo del cotizador"]').forEach(el => el.remove());
      return;
    }

    injectGlobalStyles();

    const existing = document.getElementById('cotizadorTopStepper');

    const candidates = Array.from(document.querySelectorAll('div, section, nav'))
      .filter((el) => {
        if (el.id === 'catalogGrid') return false;
        if (el.id === 'operationLogisticsGrid') return false;
        if (el.closest('#catalogGrid')) return false;
        if (el.closest('#operationLogisticsGrid')) return false;
        if (els.grid && el.contains(els.grid)) return false;
        if (els.cartRows && el.contains(els.cartRows)) return false;
        if (els.form && el.contains(els.form)) return false;

        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();

        return (
          text.includes('Selección') &&
          text.includes('Tu selección') &&
          text.includes('Datos') &&
          text.includes('Envío') &&
          !text.includes('Flujo del cotizador') &&
          text.length < 260
        );
      })
      .sort((a, b) => {
        const ta = (a.textContent || '').replace(/\s+/g, ' ').trim().length;
        const tb = (b.textContent || '').replace(/\s+/g, ' ').trim().length;
        return ta - tb;
      });

    let host = existing || candidates[0];

    if (!host) {
      host = document.createElement('div');
      host.id = 'cotizadorTopStepper';

      const catalogSection =
        document.getElementById('catalogSection') ||
        els.grid?.closest('section') ||
        els.grid?.closest('.section') ||
        els.grid?.parentNode;

      if (catalogSection && catalogSection.parentNode) {
        catalogSection.parentNode.insertBefore(host, catalogSection);
      } else {
        document.body.insertBefore(host, document.body.firstChild);
      }
    }

    host.id = 'cotizadorTopStepper';
    host.innerHTML = '';

    Object.assign(host.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      width: '100%',
      boxSizing: 'border-box'
    });

    const steps = [
      ['Selección de', 'productos'],
      ['Operación, montaje', 'y logística'],
      ['Tu selección'],
      ['Datos'],
      ['Envío']
    ];

    steps.forEach((lines, index) => {
      const item = document.createElement('div');
      item.className = 'cotizador-step-item';

      Object.assign(item.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: index === 1 ? '210px' : 'auto',
        flexShrink: '0'
      });

      const circle = document.createElement('div');
      circle.className = 'cotizador-step-circle';
      circle.textContent = String(index + 1);

      Object.assign(circle.style, {
        width: '36px',
        height: '36px',
        borderRadius: '999px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: '900',
        fontSize: '15px',
        background: index === 0 ? '#ff8a12' : '#f1f1f1',
        color: index === 0 ? '#ffffff' : '#666666',
        border: index === 0 ? '0' : '1px solid #d8d8d8',
        boxShadow: index === 0 ? '0 6px 14px rgba(255,138,18,.25)' : 'none',
        flexShrink: '0'
      });

      const text = document.createElement('div');
      text.className = 'cotizador-step-label';

      Object.assign(text.style, {
        fontWeight: '900',
        fontSize: '14px',
        lineHeight: '1.08',
        color: index === 0 ? '#ff8a12' : '#666666',
        whiteSpace: 'normal'
      });

      lines.forEach((line, lineIndex) => {
        const span = document.createElement('span');
        span.textContent = line;
        span.style.display = 'block';
        if (lineIndex > 0) span.style.marginTop = '1px';
        text.appendChild(span);
      });

      item.appendChild(circle);
      item.appendChild(text);
      host.appendChild(item);

      if (index < steps.length - 1) {
        const line = document.createElement('div');
        line.className = 'cotizador-step-line';

        Object.assign(line.style, {
          height: '1px',
          background: '#dedede',
          flex: '1 1 auto',
          minWidth: '16px'
        });

        host.appendChild(line);
      }
    });

    return host;
  }

  function normalizeSectionTitles() {
    const setFirstHeadingText = (container, text) => {
      if (!container) return;

      const heading = Array.from(container.children).find((el) =>
        ['H1', 'H2', 'H3'].includes(el.tagName)
      );

      if (heading) heading.textContent = text;
    };

    const catalogSection =
      document.getElementById('catalogSection') ||
      els.grid?.closest('section') ||
      els.grid?.closest('.section') ||
      els.grid?.closest('.card');

    const cartSection =
      document.getElementById('cartSection') ||
      els.cartRows?.closest('section') ||
      els.cartRows?.closest('.section') ||
      els.cartRows?.closest('.card');

    const clientData =
      document.getElementById('clientDataSection') ||
      els.name?.closest('section') ||
      els.name?.closest('.section') ||
      els.name?.closest('.card');

    const finalCard =
      document.getElementById('finalSection') ||
      els.send?.closest('section') ||
      els.send?.closest('.section') ||
      els.send?.closest('.card');

    setFirstHeadingText(catalogSection, '1) Selección de productos');
    setFirstHeadingText(cartSection, '3) Tu selección');
    setFirstHeadingText(clientData, '4) ¿A dónde enviamos tu cotización?');
    setFirstHeadingText(finalCard, '5) Enviar cotización');
  }

  function ensureOperationLogisticsSection() {
    let section = document.getElementById('operationLogisticsSection');

    if (section) {
      section.style.scrollMarginTop = '140px';

      const card = section.querySelector('.operation-logistics-card');
      if (card && !card.children.length) styleOperationCard(card);

      els.opsSection = section;
      els.opsGrid = document.getElementById('operationLogisticsGrid');
      return section;
    }

    section = document.createElement('section');
    section.id = 'operationLogisticsSection';
    section.className = 'section operation-logistics-section';
    section.style.marginTop = '24px';
    section.style.scrollMarginTop = '140px';

    const card = document.createElement('div');
    card.className = 'card operation-logistics-card';

    styleOperationCard(card);

    const grid = document.createElement('div');
    grid.id = 'operationLogisticsGrid';
    grid.className = els.grid ? els.grid.className : 'catalog';
    grid.style.marginTop = '22px';

    section.appendChild(card);
    section.appendChild(grid);

    const cartSection =
      document.getElementById('cartSection') ||
      els.cartRows?.closest('section') ||
      els.cartRows?.closest('.section') ||
      els.cartRows?.closest('.card');

    const clientData =
      document.getElementById('clientDataSection') ||
      els.form ||
      document.getElementById('finalSection');

    if (cartSection && cartSection.parentNode) {
      cartSection.parentNode.insertBefore(section, cartSection);
    } else if (clientData && clientData.parentNode) {
      clientData.parentNode.insertBefore(section, clientData);
    } else {
      document.body.appendChild(section);
    }

    els.opsSection = section;
    els.opsGrid = grid;

    return section;
  }

  function styleOperationCard(card) {
    card.innerHTML = '';

    Object.assign(card.style, {
      padding: '32px',
      borderRadius: '24px',
      border: '1px solid rgba(0,0,0,.08)',
      background: '#ffffff',
      color: '#111111',
      boxShadow: '0 14px 34px rgba(0,0,0,.08)'
    });

    const h2 = document.createElement('h2');
    h2.textContent = '2) Operación, montaje y logística';

    Object.assign(h2.style, {
      marginTop: '0',
      marginBottom: '20px',
      color: '#111111'
    });

    const p1 = document.createElement('p');
    p1.textContent = 'Para garantizar la correcta instalación, operación y cuidado del equipo, todas las rentas requieren transporte, montaje, operación o supervisión por parte de Medio Angular.';

    const p2 = document.createElement('p');
    p2.textContent = 'Estos conceptos se revisan de forma personalizada, ya que cada propuesta debe ajustarse a la cantidad de equipo, ubicación, horarios, accesos y condiciones reales de cada evento.';

    const p3 = document.createElement('p');
    p3.textContent = 'Puedes agregar los conceptos que ya tengas claros. En cualquier caso, esta cotización es una estimación automática y será revisada por un especialista antes de confirmar los costos finales.';

    card.appendChild(h2);

    [p1, p2, p3].forEach((p) => {
      Object.assign(p.style, {
        color: '#555555',
        lineHeight: '1.5',
        margin: '0 0 14px'
      });
      card.appendChild(p);
    });
  }

  function getFinalCard() {
    return (
      document.getElementById('finalSection') ||
      els.send?.closest('section') ||
      els.send?.closest('.section') ||
      els.send?.closest('.card') ||
      els.form ||
      document.body
    );
  }

  function getActionBox(finalCard) {
    if (els.send) {
      const sendBox =
        els.send.closest('.finalBox') ||
        els.send.closest('.sendBox') ||
        els.send.closest('.card') ||
        els.send.parentNode;

      if (sendBox && sendBox !== finalCard) return sendBox;
    }

    let box = document.getElementById('sendActionBox');

    if (!box) {
      box = document.createElement('div');
      box.id = 'sendActionBox';
      finalCard.appendChild(box);
    }

    return box;
  }

  function cleanFinalSectionHeadings(finalCard, actionBox) {
    normalizeSectionTitles();

    Array.from(actionBox.querySelectorAll('h1, h2, h3')).forEach((h) => {
      const text = (h.textContent || '').replace(/\s+/g, ' ').trim();

      if (
        text.includes('Enviar cotización') ||
        text.includes('Aviso de Privacidad') ||
        text.includes('Aviso de privacidad')
      ) {
        h.remove();
      }
    });

    Array.from(finalCard.children).forEach((el) => {
      if (el === actionBox) return;
      if (['H1', 'H2', 'H3'].includes(el.tagName)) return;

      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();

      if (text === 'Para poder enviar la cotización, acepta el aviso de privacidad.') {
        el.remove();
      }
    });

    Array.from(actionBox.querySelectorAll('p, div')).forEach((el) => {
      if (el.id === 'estimateTermsBlock') return;
      if (el.id === 'privacyInlineBlock') return;

      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();

      if (
        text === 'Para poder enviar la cotización, acepta el aviso de privacidad.' ||
        text === 'Aviso de Privacidad' ||
        text === 'Aviso de privacidad'
      ) {
        el.remove();
      }
    });
  }

  function styleActionBox(actionBox) {
    Object.assign(actionBox.style, {
      border: '1px solid rgba(255,138,18,.28)',
      borderRadius: '20px',
      background: 'rgba(255,138,18,.06)',
      padding: '28px',
      marginTop: '22px'
    });
  }

  function ensureEstimateTermsCheckbox() {
    let chk = document.getElementById('acceptEstimateTerms');

    const finalCard = getFinalCard();
    const actionBox = getActionBox(finalCard);

    styleActionBox(actionBox);
    cleanFinalSectionHeadings(finalCard, actionBox);

    let estimateBlock = document.getElementById('estimateTermsBlock');

    if (!estimateBlock) {
      estimateBlock = document.createElement('div');
      estimateBlock.id = 'estimateTermsBlock';

      const estimateLabel = document.createElement('label');

      Object.assign(estimateLabel.style, {
        display: 'grid',
        gridTemplateColumns: '22px 1fr',
        columnGap: '12px',
        alignItems: 'start',
        cursor: 'pointer',
        lineHeight: '1.45',
        margin: '0'
      });

      chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.id = 'acceptEstimateTerms';
      chk.name = 'acceptEstimateTerms';

      Object.assign(chk.style, {
        margin: '4px 0 0 0',
        width: '16px',
        height: '16px'
      });

      const span = document.createElement('span');
      span.textContent = 'Entiendo que recibiré en mi correo un presupuesto estimado generado automáticamente y que, para garantizar el éxito de mi evento, un especialista técnico de Medio Angular validará posteriormente, sin costo, la viabilidad técnica, de montaje y logística.';

      estimateLabel.appendChild(chk);
      estimateLabel.appendChild(span);
      estimateBlock.appendChild(estimateLabel);
    } else {
      chk = estimateBlock.querySelector('#acceptEstimateTerms') || chk;
    }

    Object.assign(estimateBlock.style, {
      padding: '0',
      borderRadius: '0',
      background: 'transparent',
      border: '0',
      margin: '0 0 18px'
    });

    if (estimateBlock.parentNode !== actionBox) {
      actionBox.insertBefore(estimateBlock, actionBox.firstChild);
    }

    els.acceptEstimateTerms = chk;
    els.estimateTermsBlock = estimateBlock;

    return chk;
  }

  function ensurePrivacySectionIsOnlyPrivacy() {
    const privacy = els.acceptPrivacy;
    if (!privacy) return;

    const privacyLabel = privacy.closest('label');
    if (!privacyLabel) return;

    const finalCard = getFinalCard();
    const actionBox = getActionBox(finalCard);

    styleActionBox(actionBox);
    cleanFinalSectionHeadings(finalCard, actionBox);

    Object.assign(privacyLabel.style, {
      display: 'grid',
      gridTemplateColumns: '22px 1fr',
      columnGap: '12px',
      alignItems: 'start',
      lineHeight: '1.45',
      cursor: 'pointer',
      margin: '0 0 18px'
    });

    Object.assign(privacy.style, {
      margin: '4px 0 0 0',
      width: '16px',
      height: '16px'
    });

    let privacyBlock = document.getElementById('privacyInlineBlock');

    if (!privacyBlock) {
      privacyBlock = document.createElement('div');
      privacyBlock.id = 'privacyInlineBlock';
    }

    privacyBlock.innerHTML = '';

    Object.assign(privacyBlock.style, {
      margin: '0',
      padding: '0',
      border: '0'
    });

    privacyBlock.appendChild(privacyLabel);

    hideOriginalPrivacySection(finalCard);

    const estimateBlock = document.getElementById('estimateTermsBlock');

    if (estimateBlock && estimateBlock.parentNode === actionBox) {
      if (estimateBlock.nextSibling !== privacyBlock) {
        actionBox.insertBefore(privacyBlock, estimateBlock.nextSibling);
      }
    } else if (privacyBlock.parentNode !== actionBox) {
      actionBox.insertBefore(privacyBlock, actionBox.firstChild);
    }

    const sendText = ensureSendText(actionBox);

    if (sendText.previousElementSibling !== privacyBlock) {
      actionBox.insertBefore(sendText, privacyBlock.nextSibling);
    }

    if (els.send && els.send.parentNode !== actionBox) {
      actionBox.appendChild(els.send);
    }
  }

  function getSendText(actionBox) {
    return Array.from(actionBox.querySelectorAll('p, div'))
      .find((el) => {
        if (el.id === 'privacyInlineBlock') return false;
        if (el.id === 'estimateTermsBlock') return false;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return text.startsWith('Al enviar, recibirás tu cotización por correo');
      });
  }

  function ensureSendText(actionBox) {
    let sendText = getSendText(actionBox);

    if (!sendText) {
      sendText = document.createElement('p');
      sendText.textContent = 'Al enviar, recibirás tu cotización por correo. Revisa tu bandeja de entrada; si no la encuentras, revisa también SPAM.';
    }

    Object.assign(sendText.style, {
      margin: '0 0 18px',
      color: '#5c4637',
      lineHeight: '1.45'
    });

    if (sendText.parentNode !== actionBox) {
      if (els.send && els.send.parentNode === actionBox) {
        actionBox.insertBefore(sendText, els.send);
      } else {
        actionBox.appendChild(sendText);
      }
    }

    return sendText;
  }

  function hideOriginalPrivacySection(finalCard) {
    const originalPrivacySection =
      document.getElementById('privacySection') ||
      Array.from(document.querySelectorAll('section, .section, .card')).find((el) => {
        if (el === finalCard) return false;
        if (finalCard.contains(el)) return false;

        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return text.includes('Aviso de privacidad') && text.length < 900;
      });

    if (originalPrivacySection && originalPrivacySection !== finalCard) {
      originalPrivacySection.style.display = 'none';
    }
  }

  function cleanupOldTermsWrappers() {
    const wrap = document.getElementById('termsCheckboxesWrap');
    if (wrap && !wrap.children.length) wrap.remove();
  }

  async function loadCatalog() {
    try {
      const res = await fetch(API.catalog, { credentials: 'omit' });
      const data = await res.json();

      CATALOG = Array.isArray(data)
        ? data.map((r) => {
            const categoryRaw = r.category ?? r.Categoria ?? '';
            let sectionRaw = r.section ?? r.seccion ?? r.section_name ?? r.sectionName ?? '';

            if (!sectionRaw) {
              const catLower = String(categoryRaw || '').toLowerCase();
              if (/(^|[,\s])(?:corporativo|social|todos|ambos|all)(?=($|[,\s]))/.test(catLower)) {
                sectionRaw = categoryRaw;
              }
            }

            const sortGroup = numberOr(r.sortGroup ?? r.sort_group ?? r.sortgroup, 999);
            const sortOrder = numberOr(r.sortOrder ?? r.sort_order ?? r.sortorder, 999);

            return {
              sku: toNFC(r.sku || r.SKU || ''),
              name: toNFC(r.name || r.Nombre || r.descripcion || r.description || ''),
              desc: toNFC(r.desc || r.Descripcion || r.description || ''),
              price: Number(r.price ?? r.Precio ?? r.dailyPrice ?? 0) || 0,
              category: toNFC(categoryRaw || ''),
              section: toNFC(sectionRaw || ''),
              image: String(r.image || r.img || r.imageUrl || r.image_url || r.imagen || r.photo || r.url || '').trim(),
              sortGroup,
              sortOrder
            };
          })
        : [];

      CATALOG.sort(compareCatalogItems);

      fillCategories();
      renderCatalog();
      renderOperationLogisticsCatalog();
    } catch (e) {
      console.error('Catálogo error:', e);
      CATALOG = [];
      renderCatalog();
      renderOperationLogisticsCatalog();
    }
  }

  function fillCategories() {
    const sel = els.category;
    if (!sel) return;

    const base = CATALOG
      .filter(passesVariant)
      .filter((item) => !isLogisticsItem(item));

    const cats = getCategorySortInfo(base);

    sel.innerHTML = '';

    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'Todas';
    sel.appendChild(all);

    cats.forEach(({ category }) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      sel.appendChild(option);
    });
  }

  function renderCatalog() {
    const grid = els.grid;
    if (!grid) return;

    const q = (els.search?.value || '').trim().toLowerCase();
    const cat = (els.category?.value || '').trim().toLowerCase();

    const pool = CATALOG
      .filter(passesVariant)
      .filter((item) => !isLogisticsItem(item))
      .sort(compareCatalogItems);

    const rows = pool
      .filter((it) => {
        const okCat = !cat || cat === 'todas' || (it.category || '').toLowerCase() === cat;
        const hit =
          !q ||
          (it.sku || '').toLowerCase().includes(q) ||
          (it.name || '').toLowerCase().includes(q) ||
          (it.desc || '').toLowerCase().includes(q) ||
          (it.category || '').toLowerCase().includes(q);

        return okCat && hit;
      })
      .sort(compareCatalogItems);

    grid.innerHTML = '';

    if (!rows.length) {
      const empty = document.createElement('div');
      empty.style.opacity = '.85';
      empty.textContent = 'No se encontraron resultados.';
      grid.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();

    rows.forEach((item, index) => {
      frag.appendChild(createProductCard(item, index));
    });

    grid.appendChild(frag);
  }

  function renderOperationLogisticsCatalog() {
    const grid = els.opsGrid || document.getElementById('operationLogisticsGrid');
    if (!grid) return;

    const rows = CATALOG
      .filter(passesVariant)
      .filter(isLogisticsItem)
      .sort(compareCatalogItems);

    grid.innerHTML = '';

    if (!rows.length) {
      const empty = document.createElement('div');
      empty.style.opacity = '.85';
      empty.textContent = 'No se encontraron productos de operación, montaje o logística.';
      grid.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();

    rows.forEach((item, index) => {
      const card = createProductCard(item, index);
      card.dataset.logistics = '1';
      frag.appendChild(card);
    });

    grid.appendChild(frag);
  }

  function createProductCard(item, index = 999) {
    const card = document.createElement('div');
    card.className = 'product';

    const imgBox = document.createElement('div');
    imgBox.className = 'imgBox';

    const img = document.createElement('img');
    const imgSrc = item.image || item.imageUrl || item.image_url;

    if (imgSrc) {
      const isPriorityImage = index < 4;

      img.loading = isPriorityImage ? 'eager' : 'lazy';
      img.decoding = 'async';
      img.fetchPriority = isPriorityImage ? 'high' : 'low';
      img.setAttribute('fetchpriority', isPriorityImage ? 'high' : 'low');
      img.width = 480;
      img.height = 320;

      img.src = imgSrc;
      img.alt = item.name || item.sku;
      img.onerror = () => {
        img.remove();
        const ph = document.createElement('div');
        ph.className = 'ph';
        imgBox.appendChild(ph);
      };
      imgBox.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'ph';
      imgBox.appendChild(ph);
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

    const qtyLabel = document.createElement('label');
    qtyLabel.textContent = 'Cantidad';

    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.min = '1';
    qtyInput.value = '1';
    qtyInput.className = 'input';

    qtyField.appendChild(qtyLabel);
    qtyField.appendChild(qtyInput);

    const daysField = document.createElement('div');
    daysField.className = 'field';

    const daysLabel = document.createElement('label');
    daysLabel.textContent = 'Días';

    const daysInput = document.createElement('input');
    daysInput.type = 'number';
    daysInput.min = '1';
    daysInput.value = '1';
    daysInput.className = 'input';

    daysField.appendChild(daysLabel);
    daysField.appendChild(daysInput);

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
      addToCart(item, qtyInput.value, daysInput.value);
      pushCotizadorEvent('prod_agregado', {
        sku: item.sku || '',
        producto: item.name || '',
        categoria: item.category || ''
      });

      card.dataset.added = '1';
      addBtn.textContent = 'Agregado ✓';
      addBtn.disabled = true;

      if (isLogisticsItem(item)) {
        updateSelectionBar('cart');
      } else {
        updateSelectionBar('operation');
      }
    });

    line2.appendChild(addBtn);
    controls.appendChild(line2);

    card.appendChild(controls);

    if (CART.has(item.sku)) {
      addBtn.textContent = 'Agregado ✓';
      addBtn.disabled = true;
      card.dataset.added = '1';
    }

    return card;
  }

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
        days: intOr(days, 1, 1)
      });
    }

    renderCart();
  }

  function removeFromCart(sku) {
    CART.delete(sku);
    renderCart();
    renderCatalog();
    renderOperationLogisticsCatalog();
  }

  function renderCart() {
    const tbody = els.cartRows;
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!CART.size) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.style.opacity = '.8';
      td.textContent = 'Aún no has agregado productos.';
      tr.appendChild(td);
      tbody.appendChild(tr);

      if (els.send) els.send.disabled = true;
      hideSelectionBar();
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
      inQty.addEventListener('change', () => {
        row.qty = intOr(inQty.value, 1, 1);
      });
      tdQty.appendChild(inQty);

      const tdDays = document.createElement('td');
      const inDays = document.createElement('input');
      inDays.type = 'number';
      inDays.min = '1';
      inDays.value = row.days;
      inDays.className = 'input';
      inDays.addEventListener('change', () => {
        row.days = intOr(inDays.value, 1, 1);
      });
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

  function validateForm(show = false) {
    const estimateAccepted = !!els.acceptEstimateTerms?.checked;

    const r = {
      name: !!els.name?.value.trim(),
      email: !!els.email?.value.trim() && els.email.value.includes('@'),
      email2: true,
      eventType: !!els.eventType?.value,
      eventDate: setEventDateValidity(show),
      eventLocation: !!els.eventLocation?.value.trim(),
      privacy: !!els.acceptPrivacy?.checked,
      estimateTerms: estimateAccepted
    };

    const ok =
      r.name &&
      r.email &&
      r.eventType &&
      r.eventDate &&
      r.eventLocation &&
      r.privacy &&
      r.estimateTerms;

    if (show) {
      els.name?.setCustomValidity(r.name ? '' : 'Requerido');
      els.email?.setCustomValidity(r.email ? '' : 'Correo inválido');
      els.email2?.setCustomValidity('');
      els.eventType?.setCustomValidity(r.eventType ? '' : 'Selecciona un tipo');
      els.eventLocation?.setCustomValidity(r.eventLocation ? '' : 'Indica la ubicación');

      if (els.acceptEstimateTerms) {
        els.acceptEstimateTerms.setCustomValidity(
          r.estimateTerms
            ? ''
            : 'Debes aceptar que recibirás un presupuesto estimado y que un especialista técnico validará posteriormente la viabilidad técnica, de montaje y logística.'
        );
      }
    }

    return ok;
  }

  function setSelectionBarMode(mode = 'operation') {
    if (!els.selectionBarButton) return;

    if (mode === 'cart') {
      els.selectionBarButton.textContent = 'Continuar a tu selección';
      els.selectionBarButton.dataset.action = 'continue-cart';
      return;
    }

    els.selectionBarButton.textContent = 'Continuar a operación y logística';
    els.selectionBarButton.dataset.action = 'continue-operation-logistics';
  }

  function updateSelectionBar(mode = 'operation') {
    const count = CART.size;

    if (!els.selectionBar || !els.selectionBarText) return;

    if (count <= 0) {
      hideSelectionBar();
      return;
    }

    const label = count === 1
      ? 'Tu selección: 1 producto agregado'
      : `Tu selección: ${count} productos agregados`;

    els.selectionBarText.textContent = label;

    setSelectionBarMode(mode);

    els.selectionBar.classList.add('is-visible');
    els.selectionBar.setAttribute('aria-hidden', 'false');
  }

  function hideSelectionBar() {
    if (!els.selectionBar) return;

    els.selectionBar.classList.remove('is-visible');
    els.selectionBar.setAttribute('aria-hidden', 'true');
  }

  function scrollToSection(selector) {
    const target = document.querySelector(selector);
    if (!target) return;

    const offset = 145;
    const y = target.getBoundingClientRect().top + window.scrollY - offset;

    window.scrollTo({
      top: Math.max(0, y),
      behavior: 'smooth'
    });
  }

  function scrollToCartSection() {
    const cartSection =
      document.getElementById('cartSection') ||
      els.cartRows?.closest('section') ||
      els.cartRows?.closest('.section') ||
      els.cartRows?.closest('.card');

    if (cartSection) {
      const offset = 145;
      const y = cartSection.getBoundingClientRect().top + window.scrollY - offset;

      window.scrollTo({
        top: Math.max(0, y),
        behavior: 'smooth'
      });
    } else {
      scrollToSection('#clientDataSection');
    }
  }

  async function sendQuote() {
    if (!CART.size) return alert('Agrega al menos un producto.');

    if (els.eventDate) {
      els.eventDate.value = formatDateInputValue(els.eventDate.value);
    }

    if (!els.acceptEstimateTerms?.checked) {
      alert('Antes de enviar, acepta que recibirás un presupuesto estimado y que un especialista técnico validará posteriormente la viabilidad técnica, de montaje y logística.');
      els.acceptEstimateTerms?.focus();
      return;
    }

    if (!validateForm(true)) return els.form?.reportValidity?.();

    if (!els.acceptPrivacy?.checked) {
      return alert('Debes aceptar el Aviso de Privacidad.');
    }

    const items = Array.from(CART.values()).map((x) => ({
      sku: x.sku,
      qty: intOr(x.qty, 1, 1),
      days: intOr(x.days, 1, 1)
    }));

    const dateISO = eventDateToISO(els.eventDate?.value || '');

    if (!dateISO) {
      els.eventDate?.setCustomValidity('Ingresa una fecha válida con formato dd/mm/aaaa.');
      els.form?.reportValidity?.();
      return;
    }

    const payload = {
      client: {
        name: toNFC(els.name?.value || ''),
        email: toNFC(els.email?.value || ''),
        company: toNFC(els.company?.value || ''),
        phone: toNFC(els.phone?.value || ''),
        eventType: toNFC(els.eventType?.value || ''),
        eventDate: dateISO,
        eventLocation: toNFC(els.eventLocation?.value || '')
      },
      items,
      acceptPrivacy: !!els.acceptPrivacy?.checked,
      acceptEstimateTerms: !!els.acceptEstimateTerms?.checked,
      website: els.honeypot?.value || ''
    };

    try {
      if (els.send) els.send.disabled = true;

      const res = await fetch(API.quote, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const text = await res.text().catch(() => '');

      if (!res.ok) {
        console.error('POST /quotes falló', {
          status: res.status,
          statusText: res.statusText,
          body: text
        });

        alert(`No se pudo enviar la cotización.\nHTTP ${res.status} ${res.statusText}\n${text.slice(0, 400)}`);
        return;
      }

      pushCotizadorEvent('lead_final', {
        total_items: items.length,
        event_type: payload.client.eventType || ''
      });

      alert('¡Cotización enviada! Revisa tu bandeja de entrada; si no la encuentras, revisa también SPAM.');

      CART.clear();
      renderCart();
      renderCatalog();
      renderOperationLogisticsCatalog();
    } catch (e) {
      console.error('Send quote error:', e);
      alert('Ocurrió un problema al enviar la cotización. Intenta más tarde.');
    } finally {
      if (els.send) els.send.disabled = false;
    }
  }

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
      else {
        inp.focus();
        try { inp.click(); } catch {}
      }
    });
  }

  function hookupExternalCalendarButton() {
    const textInput = document.querySelector(
      '#eventDate, input[name="event_date"], input[placeholder*="dd"][placeholder*="aaaa"]'
    );

    if (!textInput) return;

    try {
      if (textInput.type === 'date') textInput.type = 'text';
    } catch {}

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
      position: 'fixed',
      left: '8px',
      top: '8px',
      width: '1px',
      height: '1px',
      opacity: '0.01',
      border: 0,
      padding: 0,
      margin: 0,
      background: 'transparent'
    });

    const syncToNative = () => {
      const parsed = parseDMYDate(textInput.value);

      if (parsed) {
        const D = String(parsed.day).padStart(2, '0');
        const M = String(parsed.month).padStart(2, '0');
        const Y = String(parsed.year);
        native.value = `${Y}-${M}-${D}`;
      }
    };

    textInput.addEventListener('blur', syncToNative);

    native.addEventListener('change', () => {
      const v = native.value;

      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const [Y, M, D] = v.split('-');
        textInput.value = `${D}/${M}/${Y}`;
        textInput.setCustomValidity('');
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
          if (typeof native.showPicker === 'function') {
            native.showPicker();
          } else {
            native.focus();
            native.click();
          }
        });
      };

      ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach((evt) =>
        opener.addEventListener(evt, openPicker, { passive: false })
      );
    }
  }

  function setupPrivacyPopup() {
    const link = els.privacyLink;
    if (!link) return;

    link.addEventListener('click', (e) => {
      e.preventDefault();

      const w = window.open(link.getAttribute('href'), 'privacy', 'width=720,height=600');

      if (!w) location.href = link.getAttribute('href');
    });
  }

  function init() {
    els.honeypot = ensureHoneypotField();

    removeDuplicatedFlowIntro();
    ensureTopProgressStepper();
    applyEventTypeOptions();
    attachEventDateMask();
    hookupExternalCalendarButton();
    injectDateButton();
    ensureOperationLogisticsSection();
    ensureEstimateTermsCheckbox();
    ensurePrivacySectionIsOnlyPrivacy();
    cleanupOldTermsWrappers();
    normalizeSectionTitles();
    setupPrivacyPopup();
    loadCatalog();
    renderCart();

    if (els.send) els.send.addEventListener('click', sendQuote);
    if (els.search) els.search.addEventListener('input', renderCatalog);
    if (els.category) els.category.addEventListener('change', renderCatalog);

    document.addEventListener('click', (ev) => {
      const continueSelectionBtn = ev.target.closest('[data-action="continue-selection"]');

      if (continueSelectionBtn) {
        ev.preventDefault();
        pushCotizadorEvent('paso_operacion_logistica');
        scrollToSection('#operationLogisticsSection');
        hideSelectionBar();
        return;
      }

      const continueOpsBtn = ev.target.closest('[data-action="continue-operation-logistics"]');

      if (continueOpsBtn) {
        ev.preventDefault();
        pushCotizadorEvent('paso_operacion_logistica');
        scrollToSection('#operationLogisticsSection');
        hideSelectionBar();
        return;
      }

      const continueCartBtn = ev.target.closest('[data-action="continue-cart"]');

      if (continueCartBtn) {
        ev.preventDefault();
        pushCotizadorEvent('paso_tu_seleccion');
        scrollToCartSection();
        hideSelectionBar();
        return;
      }

      const backToCatalogBtn = ev.target.closest('[data-action="back-to-catalog"]');

      if (backToCatalogBtn) {
        ev.preventDefault();
        scrollToSection('#catalogSection');
        updateSelectionBar('operation');
        return;
      }

      const continueClientDataBtn = ev.target.closest('[data-action="continue-client-data"]');

      if (continueClientDataBtn) {
        ev.preventDefault();
        pushCotizadorEvent('paso_datos');
        scrollToSection('#clientDataSection');
        return;
      }

      const continueFinalBtn = ev.target.closest('[data-action="continue-final"]');

      if (continueFinalBtn) {
        ev.preventDefault();
        pushCotizadorEvent('paso_revision');
        scrollToSection('#finalSection');
      }
    });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();