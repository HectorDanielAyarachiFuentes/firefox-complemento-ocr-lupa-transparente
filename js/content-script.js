/**
 * Content Script para Firefox WebExtension
 * Lupa OCR Transparente en Tiempo Real
 * Características: Agrupamiento Semántico de Frases, Detección de Idioma en Vivo,
 * Superposición Exacta, Modo Lectura y Fallback OCR Visual con Captura de Pantalla.
 */

(() => {
  if (window.__LUPA_OCR_INJECTED__) return;
  window.__LUPA_OCR_INJECTED__ = true;

  let hostEl = null;
  let shadowRoot = null;
  let isLensActive = false;
  let isPaused = false;
  let isScanning = false;
  let currentOpacity = 16;
  let currentMode = 'overlay'; // 'overlay' | 'reader'
  let sourceLang = 'auto';
  let targetLang = 'es';
  let detectedSourceLang = null;
  let scanDebounceTimer = null;
  let lastScannedSignature = '';

  const ICONS = {
    logo: `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><defs><linearGradient id="lupa-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse"><stop stop-color="#79a6ff"/><stop offset="1" stop-color="#b79bff"/></linearGradient></defs><circle cx="10.5" cy="10.5" r="7" stroke="url(#lupa-grad)" stroke-width="2.2"/><path d="M15.8 15.8 21 21" stroke="url(#lupa-grad)" stroke-width="2.6"/><path d="M7.6 9.3h5.8M7.6 12h4" stroke="#eaf0ff" stroke-width="1.7"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
    play: `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><polygon points="7 4.5 19 12 7 19.5 7 4.5"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6.5" y="4.5" width="3.8" height="15" rx="1"/><rect x="13.7" y="4.5" width="3.8" height="15" rx="1"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`,
    droplet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>`,
    lensMode: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8.5h8M7 12h10M7 15.5h6"/></svg>`,
    readerMode: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M4 6h16M4 10.5h16M4 15h10M4 19.5h7"/></svg>`,
    arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
    camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`
  };

  function createLensDOM() {
    if (hostEl) return;

    hostEl = document.createElement('div');
    hostEl.id = 'lupa-extension-host';
    hostEl.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;';

    shadowRoot = hostEl.attachShadow({ mode: 'open' });

    // Estilos embebidos directos en Shadow DOM
    const baseStyle = document.createElement('style');
    baseStyle.textContent = `
      :host, #lupa-wrapper, .lens {
        --pad: 8px;
        --bar-h: 42px;
        --r: 14px;
        --accent: #79a6ff;
        --accent-2: #b79bff;
        --ok: #4ade80;
        --warn: #fbbf24;
        --err: #f87171;
        --ink: #eaf0ff;
        --ink-dim: #9aa6c4;
        --line: rgba(255, 255, 255, 0.14);
        --panel: rgba(15, 18, 30, 0.94);
        --panel-hi: rgba(255, 255, 255, 0.08);
        --glass: ${currentOpacity / 100};
        --glass-rgb: 9, 13, 24;
        --ui-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-family: var(--ui-font);
        color: var(--ink);
      }
      * { box-sizing: border-box; }
      button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; }

      .lens {
        position: relative;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      .glass {
        position: absolute;
        inset: 0;
        border-radius: var(--r);
        background: rgba(var(--glass-rgb), var(--glass));
        backdrop-filter: saturate(120%);
        -webkit-backdrop-filter: saturate(120%);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 12px 40px rgba(0, 0, 0, 0.45);
        transition: background 0.15s ease;
      }
      .frame {
        position: absolute;
        inset: 0;
        border-radius: var(--r);
        pointer-events: none;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), inset 0 0 0 1.5px rgba(121, 166, 255, 0.9);
      }
      .bar {
        position: absolute;
        top: 0; left: 0; right: 0;
        height: var(--bar-h);
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 8px 0 12px;
        background: var(--panel);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        color: var(--ink);
        border-radius: var(--r) var(--r) 10px 10px;
        border-bottom: 1px solid var(--line);
        pointer-events: auto;
        z-index: 10;
      }
      .brand { display: flex; align-items: center; gap: 8px; cursor: move; }
      .logo { width: 22px; height: 22px; display: grid; place-items: center; }
      .dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--ok);
        box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.25);
        transition: background 0.2s, box-shadow 0.2s;
      }
      .lens[data-state="busy"] .dot {
        background: var(--accent);
        box-shadow: 0 0 0 3px rgba(121, 166, 255, 0.35);
        animation: pulse 1s infinite;
      }
      .lens[data-state="paused"] .dot {
        background: var(--warn);
        box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.35);
      }
      @keyframes pulse { 50% { transform: scale(1.3); } }
      .status-text { font-size: 12px; color: var(--ink-dim); white-space: nowrap; }

      .chip {
        display: flex; align-items: center; gap: 6px;
        height: 28px; padding: 0 10px;
        border-radius: 9px;
        background: var(--panel-hi);
        border: 1px solid var(--line);
        color: var(--ink);
        font-size: 12px; font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
      }
      .chip:hover { background: rgba(255, 255, 255, 0.14); }
      #targetLabel { color: var(--accent); }

      .tools { display: flex; align-items: center; gap: 2px; }
      .tool {
        width: 30px; height: 30px; border-radius: 9px;
        display: grid; place-items: center;
        color: var(--ink-dim);
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .tool:hover { background: var(--panel-hi); color: #fff; }
      .tool.active { background: rgba(121, 166, 255, 0.25); color: var(--accent); }
      .tool-close:hover { background: rgba(239, 68, 68, 0.25); color: #fca5a5; }

      .progress {
        position: absolute; z-index: 12;
        top: var(--bar-h); left: 14px; right: 14px; height: 2px;
        border-radius: 2px; overflow: hidden; opacity: 0; transition: opacity 0.2s;
        background: transparent;
      }
      .lens[data-busy="1"] .progress { opacity: 1; }
      .progress::after {
        content: ""; position: absolute; inset: 0; width: 40%;
        background: linear-gradient(90deg, transparent, var(--accent), var(--accent-2), transparent);
        animation: slide-bar 1s linear infinite;
      }
      @keyframes slide-bar { from { transform: translateX(-100%); } to { transform: translateX(260%); } }

      .stage {
        position: absolute;
        top: var(--bar-h); bottom: 0; left: 0; right: 0;
        pointer-events: none;
        overflow: hidden;
      }
      .overlay-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
        overflow: visible;
      }
      .lens[data-mode="reader"] .overlay-layer { display: none; }
      .blk {
        position: absolute;
        display: block;
        border-radius: 6px;
        padding: 3px 8px;
        line-height: 1.35;
        font-family: var(--ui-font);
        background: rgba(10, 14, 26, 0.95);
        color: #f8fafc;
        border: 1px solid rgba(121, 166, 255, 0.5);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08);
        pointer-events: auto;
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        width: max-content;
        min-width: max-content;
        max-width: none;
        box-sizing: border-box;
        z-index: 5;
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
        animation: blk-appear 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes blk-appear {
        from { opacity: 0; transform: scale(0.96); }
        to { opacity: 1; transform: scale(1); }
      }
      .blk:hover {
        background: rgba(15, 23, 42, 0.98);
        border-color: rgba(121, 166, 255, 0.9);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.8), 0 0 10px rgba(121, 166, 255, 0.4);
        transform: translateY(-1px);
        z-index: 10;
      }

      .reader {
        position: absolute; inset: 0;
        z-index: 9;
        background: rgba(10, 14, 26, 0.96);
        color: var(--ink);
        padding: 16px;
        overflow-y: auto;
        pointer-events: auto;
        font-size: 14px;
        line-height: 1.6;
      }

      .pop {
        position: absolute;
        top: calc(var(--bar-h) + 6px);
        right: 10px;
        background: rgba(15, 18, 30, 0.98);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 12px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(16px);
        z-index: 20;
        width: 220px;
        pointer-events: auto;
      }
      .pop-title { font-size: 12px; font-weight: 600; color: var(--ink-dim); margin-bottom: 8px; }
      .seg-btn {
        padding: 6px 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--line);
        border-radius: 6px;
        color: #fff;
        font-size: 12px;
        cursor: pointer;
        text-align: left;
      }
      .seg-btn:hover { background: rgba(121, 166, 255, 0.2); border-color: var(--accent); }
    `;
    shadowRoot.appendChild(baseStyle);

    // Contenedor principal de la lente flotante
    const wrapper = document.createElement('div');
    wrapper.id = 'lupa-wrapper';
    wrapper.style.cssText = 'position:absolute;left:100px;top:100px;width:540px;height:340px;min-width:240px;min-height:160px;pointer-events:none;';

    wrapper.innerHTML = `
      <div id="lens" class="lens" data-mode="${currentMode}" data-theme="dark" data-state="idle">
        <div class="glass" id="glass"></div>
        <div class="frame"></div>

        <!-- Barra superior interactiva -->
        <header id="bar" class="bar">
          <div class="brand" id="brand" data-drag title="Arrastra para mover la lente">
            <span class="logo">${ICONS.logo}</span>
            <span class="dot" id="dot"></span>
            <span class="status-text" id="statusText">Lista</span>
          </div>

          <button id="langBtn" class="chip" title="Idioma original" type="button">
            <span id="langLabel">${sourceLang === 'auto' && detectedSourceLang ? detectedSourceLang.toUpperCase() : sourceLang.toUpperCase()}</span>
            <span class="arrow">${ICONS.arrow}</span>
            <span id="targetLabel">${targetLang.toUpperCase()}</span>
          </button>

          <div class="spacer" id="spacer" data-drag style="flex:1;cursor:move;height:100%;"></div>

          <div class="tools">
            <button id="modeBtn" class="tool" type="button" title="Alternar vista (Lente / Lector)">${ICONS.lensMode}</button>
            <button id="ocrVisualBtn" class="tool" type="button" title="Forzar OCR Visual de Imagen/Pantalla">${ICONS.camera}</button>
            <button id="opacityBtn" class="tool" type="button" title="Transparencia del cristal">${ICONS.droplet}</button>
            <button id="pauseBtn" class="tool" type="button" title="Pausar / Reanudar escaneo">${ICONS.pause}</button>
            <button id="refreshBtn" class="tool" type="button" title="Traducir ahora">${ICONS.refresh}</button>
            <button id="closeBtn" class="tool tool-close" type="button" title="Cerrar Lupa">${ICONS.close}</button>
          </div>
        </header>

        <div class="progress" id="progress"></div>

        <!-- Escenario de visualización transparente -->
        <main id="stage" class="stage">
          <div id="overlayLayer" class="overlay-layer"></div>
          <article id="reader" class="reader" hidden></article>
        </main>

        <!-- Tiradores de redimensionado -->
        <div class="resize-handle rh-nw" data-dir="nw" style="position:absolute;top:0;left:0;width:14px;height:14px;cursor:nwse-resize;pointer-events:auto;z-index:15;"></div>
        <div class="resize-handle rh-ne" data-dir="ne" style="position:absolute;top:0;right:0;width:14px;height:14px;cursor:nesw-resize;pointer-events:auto;z-index:15;"></div>
        <div class="resize-handle rh-sw" data-dir="sw" style="position:absolute;bottom:0;left:0;width:14px;height:14px;cursor:nesw-resize;pointer-events:auto;z-index:15;"></div>
        <div class="resize-handle rh-se" data-dir="se" style="position:absolute;bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize;pointer-events:auto;z-index:15;"></div>
        <div class="resize-handle rh-n"  data-dir="n"  style="position:absolute;top:0;left:14px;right:14px;height:6px;cursor:ns-resize;pointer-events:auto;z-index:15;"></div>
        <div class="resize-handle rh-s"  data-dir="s"  style="position:absolute;bottom:0;left:14px;right:14px;height:6px;cursor:ns-resize;pointer-events:auto;z-index:15;"></div>
        <div class="resize-handle rh-w"  data-dir="w"  style="position:absolute;left:0;top:14px;bottom:14px;width:6px;cursor:ew-resize;pointer-events:auto;z-index:15;"></div>
        <div class="resize-handle rh-e"  data-dir="e"  style="position:absolute;right:0;top:14px;bottom:14px;width:6px;cursor:ew-resize;pointer-events:auto;z-index:15;"></div>

        <!-- Popover Transparencia -->
        <div id="opacityPop" class="pop" hidden>
          <div class="pop-title">Transparencia del cristal</div>
          <div style="display:flex;align-items:center;gap:10px;padding:6px 0;">
            <input id="opacityRange" type="range" min="5" max="95" step="1" value="${currentOpacity}" style="flex:1;cursor:pointer;">
            <span id="opacityValue" style="font-size:12px;color:#fff;min-width:32px;">${currentOpacity}%</span>
          </div>
        </div>

        <!-- Popover Idioma -->
        <div id="langMenu" class="pop" hidden>
          <div class="pop-title">Idioma del texto original</div>
          <div id="langList" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <button class="seg-btn" data-lang="auto">Auto (Detectar)</button>
            <button class="seg-btn" data-lang="en">Inglés</button>
            <button class="seg-btn" data-lang="es">Español</button>
            <button class="seg-btn" data-lang="fr">Francés</button>
            <button class="seg-btn" data-lang="de">Alemán</button>
            <button class="seg-btn" data-lang="pt">Portugués</button>
          </div>
        </div>
      </div>
    `;

    shadowRoot.appendChild(wrapper);
    document.documentElement.appendChild(hostEl);

    setupLensInteractions(wrapper, shadowRoot);

    // Cargar y aplicar configuración guardada de usuario
    browser.storage?.local?.get(['targetLang', 'defaultOpacity']).then((cfg) => {
      if (cfg?.targetLang) {
        targetLang = cfg.targetLang;
        const targetLabel = shadowRoot.getElementById('targetLabel');
        if (targetLabel) targetLabel.textContent = targetLang.toUpperCase();
      }
      if (cfg?.defaultOpacity) {
        currentOpacity = cfg.defaultOpacity;
        const lens = shadowRoot.getElementById('lens');
        const opacityValue = shadowRoot.getElementById('opacityValue');
        const opacityRange = shadowRoot.getElementById('opacityRange');
        if (lens) lens.style.setProperty('--glass', currentOpacity / 100);
        if (opacityValue) opacityValue.textContent = `${currentOpacity}%`;
        if (opacityRange) opacityRange.value = currentOpacity;
      }
    });

    scheduleScan(300);
  }

  // ---- Arquitectura Espacial Tipo Lentes AR/VR (World-Locked Overlay) ----
  const spatialCache = new Map(); // key -> { key, docX, docY, w, h, text, translatedText, fontSize, langKey, el, timestamp }
  const MAX_SPATIAL_ITEMS = 500;

  function getLangKey() {
    return `${sourceLang}->${targetLang}`;
  }

  function getSpatialKey(docX, docY, text) {
    const rx = Math.round(docX / 12) * 12;
    const ry = Math.round(docY / 8) * 8;
    return `${rx}_${ry}::${text.trim()}`;
  }

  function applyBlockStyle(blk, entry) {
    blk.className = 'blk';
    blk.textContent = entry.translatedText;
    blk.style.fontSize = entry.fontSize || '13px';

    const text = entry.translatedText || '';
    const isParagraph = text.length > 70 || text.includes('\n');
    if (isParagraph) {
      blk.style.whiteSpace = 'normal';
      blk.style.wordBreak = 'normal';
      blk.style.overflowWrap = 'break-word';
      blk.style.width = 'auto';
      blk.style.minWidth = '220px';
      blk.style.maxWidth = `${Math.max(260, Math.min(520, Math.round((entry.w || 200) * 1.35)))}px`;
    } else {
      blk.style.whiteSpace = 'nowrap';
      blk.style.wordBreak = 'normal';
      blk.style.overflowWrap = 'normal';
      blk.style.width = 'max-content';
      blk.style.minWidth = 'max-content';
      blk.style.maxWidth = 'none';
    }
  }

  function getScrollOffsets() {
    const docEl = document.documentElement;
    const body = document.body;
    const sx = window.scrollX || window.pageXOffset || docEl?.scrollLeft || body?.scrollLeft || 0;
    const sy = window.scrollY || window.pageYOffset || docEl?.scrollTop || body?.scrollTop || 0;
    return { x: sx, y: sy };
  }

  function updateOverlayPositions() {
    const stage = shadowRoot?.getElementById('stage');
    const overlayLayer = shadowRoot?.getElementById('overlayLayer');
    if (!stage || !overlayLayer) return;

    const stageRect = stage.getBoundingClientRect();
    const { x: scrollX, y: scrollY } = getScrollOffsets();
    const bufferX = 30;
    const bufferY = 15;

    spatialCache.forEach((entry) => {
      if (!entry.el) return;

      let stageX, stageY;
      if (entry.targetEl && entry.targetEl.isConnected) {
        const pRect = entry.targetEl.getBoundingClientRect();
        stageX = (pRect.left + (entry.offsetX || 0)) - stageRect.left;
        stageY = (pRect.top + (entry.offsetY || 0)) - stageRect.top;
      } else {
        stageX = entry.docX - scrollX - stageRect.left;
        stageY = entry.docY - scrollY - stageRect.top;
      }

      const inView = (
        stageX + (entry.w || 60) > -bufferX &&
        stageX < stageRect.width + bufferX &&
        stageY + (entry.h || 20) > -bufferY &&
        stageY < stageRect.height + bufferY
      );

      if (inView) {
        if (!entry.el.parentElement) {
          overlayLayer.appendChild(entry.el);
        }
        entry.el.style.display = 'block';
        entry.el.style.left = `${Math.round(stageX)}px`;
        entry.el.style.top = `${Math.round(stageY)}px`;
      } else {
        entry.el.style.display = 'none';
      }
    });
  }

  function renderSpatialItem(entry) {
    const overlayLayer = shadowRoot?.getElementById('overlayLayer');
    if (!overlayLayer) return;

    if (!entry.el) {
      const blk = document.createElement('div');
      applyBlockStyle(blk, entry);
      entry.el = blk;
    } else {
      applyBlockStyle(entry.el, entry);
    }

    if (!entry.el.parentElement) {
      overlayLayer.appendChild(entry.el);
    }
  }

  function addOrUpdateSpatialItem(item) {
    const overlayLayer = shadowRoot?.getElementById('overlayLayer');
    if (!overlayLayer) return;

    const key = getSpatialKey(item.docX, item.docY, item.text);
    const langKey = getLangKey();

    let entry = spatialCache.get(key);
    if (!entry) {
      if (spatialCache.size >= MAX_SPATIAL_ITEMS) {
        const firstKey = spatialCache.keys().next().value;
        const oldEntry = spatialCache.get(firstKey);
        oldEntry?.el?.remove();
        spatialCache.delete(firstKey);
      }

      entry = {
        key,
        targetEl: item.targetEl || null,
        offsetX: item.offsetX || 0,
        offsetY: item.offsetY || 0,
        docX: item.docX,
        docY: item.docY,
        w: item.w,
        h: item.h,
        text: item.text,
        translatedText: item.translatedText,
        fontSize: item.fontSize,
        langKey,
        el: null,
        timestamp: Date.now()
      };
      spatialCache.set(key, entry);
    } else {
      entry.translatedText = item.translatedText;
      entry.langKey = langKey;
      entry.timestamp = Date.now();
      entry.w = item.w;
      entry.h = item.h;
      if (item.targetEl) {
        entry.targetEl = item.targetEl;
        entry.offsetX = item.offsetX || 0;
        entry.offsetY = item.offsetY || 0;
      }
    }

    renderSpatialItem(entry);
  }

  function clearSpatialCache() {
    spatialCache.forEach((entry) => entry.el?.remove());
    spatialCache.clear();
  }

  function hasSpatialItemsInRect(stageRect) {
    const { x: scrollX, y: scrollY } = getScrollOffsets();
    for (const entry of spatialCache.values()) {
      if (entry.targetEl && entry.targetEl.isConnected) {
        const pRect = entry.targetEl.getBoundingClientRect();
        const curLeft = pRect.left + (entry.offsetX || 0);
        const curTop = pRect.top + (entry.offsetY || 0);
        if (
          curLeft < stageRect.right &&
          curLeft + (entry.w || 60) > stageRect.left &&
          curTop < stageRect.bottom &&
          curTop + (entry.h || 20) > stageRect.top
        ) {
          return true;
        }
      } else {
        const stageX = entry.docX - scrollX - stageRect.left;
        const stageY = entry.docY - scrollY - stageRect.top;
        if (
          stageX + (entry.w || 60) > 0 &&
          stageX < stageRect.width &&
          stageY + (entry.h || 20) > 0 &&
          stageY < stageRect.height
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Mejora 1: Agrupamiento Semántico de Frases (Smart Sentence Grouping)
   * Agrupa nodos de texto contiguos en la misma línea para traducir oraciones completas y fluidas.
   */
  function groupAdjacentItems(rawItems) {
    if (rawItems.length === 0) return [];

    // Ordenar por coordenada Y en el documento y luego por X
    rawItems.sort((a, b) => {
      const lineDiff = a.docY - b.docY;
      if (Math.abs(lineDiff) > 6) return lineDiff;
      return a.docX - b.docX;
    });

    const grouped = [];
    let current = { ...rawItems[0] };

    for (let i = 1; i < rawItems.length; i++) {
      const item = rawItems[i];
      const sameLine = Math.abs(item.docY - current.docY) < Math.min(item.h, current.h) * 0.5 + 4;
      const gapX = item.docX - (current.docX + current.w);
      const nearbyX = gapX >= -6 && gapX < 32;

      if (sameLine && nearbyX) {
        // Unir a la misma frase
        current.text += ' ' + item.text;
        const right = Math.max(current.docX + current.w, item.docX + item.w);
        const bottom = Math.max(current.docY + current.h, item.docY + item.h);
        current.w = right - current.docX;
        current.h = bottom - current.docY;
      } else {
        grouped.push(current);
        current = { ...item };
      }
    }
    grouped.push(current);
    return grouped;
  }

  function findTextUnderLens(stageRect) {
    const rawItems = [];
    const { x: scrollX, y: scrollY } = getScrollOffsets();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest('#lupa-extension-host')) return NodeFilter.FILTER_REJECT;
        const style = window.getComputedStyle(parent);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    while ((node = walker.nextNode())) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();

      if (
        rect.width > 2 && rect.height > 2 &&
        rect.left < stageRect.right && rect.right > stageRect.left &&
        rect.top < stageRect.bottom && rect.bottom > stageRect.top
      ) {
        const text = node.nodeValue.trim();
        if (text.length > 0 && !/^[\s\d.,;:\-_/\\|+*=&%#@!?()\[\]{}'"]+$/.test(text)) {
          const parent = node.parentElement;
          const pRect = parent.getBoundingClientRect();
          const compStyle = window.getComputedStyle(parent);
          rawItems.push({
            text,
            targetEl: parent,
            offsetX: rect.left - pRect.left,
            offsetY: rect.top - pRect.top,
            docX: rect.left + scrollX,
            docY: rect.top + scrollY,
            w: rect.width,
            h: rect.height,
            fontSize: compStyle.fontSize || '13px'
          });
        }
      }
    }

    // Aplicar agrupación inteligente
    return groupAdjacentItems(rawItems);
  }

  /**
   * Mejora 3: OCR Visual de Pantalla cuando no hay texto DOM o a petición
   */
  let isVisualOcrRunning = false;
  let lastVisualOcrSignature = '';

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  /**
   * Genera las variantes para OCR:
   * 1. Imagen a color original limpia (Leptonica de Tesseract realiza umbralización adaptativa en color).
   * 2. Variante invertida de alto contraste (para textos blancos o claros sobre botones de color).
   */
  function buildOcrVariants(canvas) {
    const original = canvas.toDataURL('image/png');
    try {
      const ctx = canvas.getContext('2d');
      const { width, height } = canvas;
      const img = ctx.getImageData(0, 0, width, height);
      const d = img.data;
      const gray = new Uint8ClampedArray(width * height);
      let min = 255, max = 0;
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
        gray[p] = g;
        if (g < min) min = g;
        if (g > max) max = g;
      }
      const range = Math.max(1, max - min);
      const inverted = new ImageData(width, height);
      for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
        const v = ((gray[p] - min) * 255 / range) | 0;
        inverted.data[i] = inverted.data[i + 1] = inverted.data[i + 2] = 255 - v;
        inverted.data[i + 3] = 255;
      }
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      const octx = out.getContext('2d');
      octx.putImageData(inverted, 0, 0);
      return [original, out.toDataURL('image/png')];
    } catch (_) {
      return [original];
    }
  }

  async function performVisualOCR(stageRect, { force = true } = {}) {
    const wrapper = shadowRoot?.getElementById('lupa-wrapper');
    const lens = shadowRoot?.getElementById('lens');
    const statusText = shadowRoot?.getElementById('statusText');

    if (!wrapper || !lens || isVisualOcrRunning) return;

    // Evitar repetir OCR automático sobre la misma zona sin cambios
    const sig = `${Math.round(stageRect.left)},${Math.round(stageRect.top)},${Math.round(stageRect.width)},${Math.round(stageRect.height)},${Math.round(window.scrollX)},${Math.round(window.scrollY)}::${targetLang}::${currentMode}`;
    if (!force && sig === lastVisualOcrSignature) return;
    lastVisualOcrSignature = sig;

    isVisualOcrRunning = true;
    let finalStatus = 'Lista';
    statusText.textContent = 'Capturando OCR...';
    lens.dataset.busy = '1';
    lens.dataset.state = 'busy';

    try {
      // Ocultar el marco y esperar a que el navegador repinte antes de capturar
      wrapper.style.visibility = 'hidden';
      await nextFrame();
      await nextFrame();
      const capRes = await browser.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_TAB' });
      wrapper.style.visibility = 'visible';

      if (!capRes || !capRes.dataUrl) throw new Error(capRes?.error || 'No se pudo capturar la pestaña.');

      statusText.textContent = 'Procesando imagen...';

      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = capRes.dataUrl;
      });

      // Escala real captura/viewport (más fiable que devicePixelRatio con zoom)
      const capScale = img.naturalWidth / window.innerWidth || window.devicePixelRatio || 1;
      // Ampliar texto pequeño: Tesseract rinde mejor con ~2x
      const upscale = Math.max(1, 2 / capScale);
      const srcW = Math.max(1, Math.round(stageRect.width * capScale));
      const srcH = Math.max(1, Math.round(stageRect.height * capScale));
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = Math.round(srcW * upscale);
      cropCanvas.height = Math.round(srcH * upscale);

      const ctx = cropCanvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        img,
        Math.round(stageRect.left * capScale),
        Math.round(stageRect.top * capScale),
        srcW,
        srcH,
        0,
        0,
        cropCanvas.width,
        cropCanvas.height
      );

      statusText.textContent = 'Leyendo OCR...';
      const ocrRes = await browser.runtime.sendMessage({
        action: 'OCR_IMAGE',
        dataUrls: buildOcrVariants(cropCanvas)
      });
      if (!ocrRes?.success) throw new Error(ocrRes?.error || 'Falló el motor OCR.');

      const k = capScale * upscale;
      const lines = ocrRes.lines || [];
      if (lines.length > 0) {
        const { x: scrollX, y: scrollY } = getScrollOffsets();
        const items = lines.map((line) => {
          const h = (line.bbox.y1 - line.bbox.y0) / k;
          const x = line.bbox.x0 / k;
          const y = line.bbox.y0 / k;
          const w = (line.bbox.x1 - line.bbox.x0) / k;
          return {
            text: line.text,
            docX: x + stageRect.left + scrollX,
            docY: y + stageRect.top + scrollY,
            w,
            h,
            fontSize: `${Math.max(11, Math.min(28, Math.round(h * 0.8)))}px`
          };
        });
        await translateAndDisplay(items, stageRect);
        return;
      }

      finalStatus = 'Sin texto en imagen';
      const readerEl = shadowRoot?.getElementById('reader');
      if (currentMode === 'reader' && readerEl) {
        readerEl.innerHTML = '<div style="color:#94a3b8;padding:14px;">No se encontró texto legible bajo la lente.</div>';
      }
    } catch (err) {
      console.warn('[Lupa OCR] Falló captura OCR:', err?.message || err);
      wrapper.style.visibility = 'visible';
      lens.dataset.state = 'error';
      finalStatus = 'Error OCR';
    } finally {
      isVisualOcrRunning = false;
      lens.dataset.busy = '0';
      if (finalStatus !== 'Lista') {
        statusText.textContent = finalStatus;
        setTimeout(() => {
          if (!isPaused && !isScanning && !isVisualOcrRunning) {
            lens.dataset.state = 'idle';
            statusText.textContent = 'Lista';
          }
        }, 2500);
      }
    }
  }

  async function translateAndDisplay(items, stageRect) {
    const lens = shadowRoot.getElementById('lens');
    const statusText = shadowRoot.getElementById('statusText');
    const reader = shadowRoot.getElementById('reader');
    const langLabel = shadowRoot.getElementById('langLabel');

    isScanning = true;
    lens.dataset.busy = '1';
    lens.dataset.state = 'busy';
    statusText.textContent = 'Traduciendo...';

    try {
      const textsToTranslate = items.map((it) => it.text);
      const res = await browser.runtime.sendMessage({
        action: 'TRANSLATE_TEXTS',
        texts: textsToTranslate,
        from: sourceLang,
        to: targetLang
      });

      if (res && res.translations) {
        // Mejora 2: Detección dinámica de idioma origen
        if (res.detectedLang) {
          detectedSourceLang = res.detectedLang;
          if (sourceLang === 'auto' && langLabel) {
            langLabel.textContent = detectedSourceLang.toUpperCase();
            langLabel.title = `Detectado automáticamente: ${detectedSourceLang.toUpperCase()}`;
          }
        }

        res.translations.forEach((translatedText, i) => {
          const it = items[i];
          addOrUpdateSpatialItem({
            ...it,
            translatedText
          });
        });

        updateOverlayPositions();

        if (currentMode === 'reader') {
          const { x: scrollX, y: scrollY } = getScrollOffsets();
          const allVisibleTranslations = Array.from(spatialCache.values())
            .filter((entry) => {
              if (entry.targetEl && entry.targetEl.isConnected) {
                const pRect = entry.targetEl.getBoundingClientRect();
                const curLeft = pRect.left + (entry.offsetX || 0);
                const curTop = pRect.top + (entry.offsetY || 0);
                return curLeft < stageRect.right &&
                       curLeft + (entry.w || 60) > stageRect.left &&
                       curTop < stageRect.bottom &&
                       curTop + (entry.h || 20) > stageRect.top;
              }
              const stageX = entry.docX - scrollX - stageRect.left;
              const stageY = entry.docY - scrollY - stageRect.top;
              return stageX + (entry.w || 60) > 0 &&
                     stageX < stageRect.width &&
                     stageY + (entry.h || 20) > 0 &&
                     stageY < stageRect.height;
            })
            .map((e) => e.translatedText);

          reader.innerHTML = `<div style="padding:16px;color:#f1f5f9;">
            <div style="font-weight:700;margin-bottom:12px;color:#79a6ff;font-size:12px;text-transform:uppercase;">
              Traducción (${(detectedSourceLang || sourceLang).toUpperCase()} → ${targetLang.toUpperCase()})
            </div>
            ${allVisibleTranslations.map((t) => `<p style="margin:0 0 12px 0;line-height:1.55;">${escapeHtml(t)}</p>`).join('')}
          </div>`;
        }
      }
    } catch (err) {
      console.error('[Lupa OCR] Error en traducción:', err);
      lens.dataset.state = 'error';
      statusText.textContent = 'Error';
    } finally {
      isScanning = false;
      lens.dataset.busy = '0';
      if (!isPaused) {
        lens.dataset.state = 'idle';
        statusText.textContent = 'Lista';
      }
    }
  }

  async function performScanAndTranslate() {
    if (!shadowRoot || !isLensActive || isPaused || isScanning || isVisualOcrRunning) return;

    const lens = shadowRoot.getElementById('lens');
    const stage = shadowRoot.getElementById('stage');
    const reader = shadowRoot.getElementById('reader');
    const statusText = shadowRoot.getElementById('statusText');

    if (!stage || !lens) return;

    const stageRect = stage.getBoundingClientRect();
    if (stageRect.width < 50 || stageRect.height < 50) return;

    // Sincronizar transformación del overlay con la vista de la página
    updateOverlayPositions();

    // 1. Extraer texto visible bajo la lente con agrupamiento de oraciones
    const items = findTextUnderLens(stageRect);

    if (items.length === 0) {
      lastScannedSignature = '';
      if (currentMode === 'reader') {
        reader.innerHTML = '<div style="color:#94a3b8;padding:14px;">Buscando texto en la imagen…</div>';
      }

      // Comprobar si ya existen bloques en memoria en esta región geográfica del documento
      const hasCached = hasSpatialItemsInRect(stageRect);

      if (hasCached) {
        // Ya tenemos texto en memoria para esta zona, no relanzar OCR pesado innecesariamente
        if (!isPaused) {
          lens.dataset.state = 'idle';
          statusText.textContent = 'Lista';
        }
        return;
      }

      // Sin texto en el DOM ni en caché: intentar OCR visual de la zona
      performVisualOCR(stageRect, { force: false });
      return;
    }

    // Comprobar cuáles ya están en la memoria espacial
    const currentLangKey = getLangKey();
    const uncachedItems = [];

    items.forEach((it) => {
      const key = getSpatialKey(it.docX, it.docY, it.text);
      const cached = spatialCache.get(key);
      if (cached && cached.langKey === currentLangKey) {
        renderSpatialItem(cached);
      } else {
        uncachedItems.push(it);
      }
    });

    updateOverlayPositions();

    // Si todo el texto bajo la lente ya estaba en memoria, no necesitamos re-traducir
    if (uncachedItems.length === 0) {
      if (!isPaused) {
        lens.dataset.state = 'idle';
        statusText.textContent = 'Lista';
      }
      return;
    }

    const currentSignature = uncachedItems.map((it) => it.text).join('||') + `::${targetLang}::${sourceLang}`;
    if (currentSignature === lastScannedSignature) return;
    lastScannedSignature = currentSignature;

    await translateAndDisplay(uncachedItems, stageRect);
  }

  function scheduleScan(ms = 350) {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(() => {
      performScanAndTranslate();
    }, ms);
  }

  function escapeHtml(str) {
    return str.replace(/[&<>'"]/g, (tag) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
  }

  function setupLensInteractions(wrapper, root) {
    const brand = root.getElementById('brand');
    const spacer = root.getElementById('spacer');
    const closeBtn = root.getElementById('closeBtn');
    const opacityBtn = root.getElementById('opacityBtn');
    const opacityPop = root.getElementById('opacityPop');
    const opacityRange = root.getElementById('opacityRange');
    const opacityValue = root.getElementById('opacityValue');
    const langBtn = root.getElementById('langBtn');
    const langMenu = root.getElementById('langMenu');
    const pauseBtn = root.getElementById('pauseBtn');
    const refreshBtn = root.getElementById('refreshBtn');
    const ocrVisualBtn = root.getElementById('ocrVisualBtn');
    const modeBtn = root.getElementById('modeBtn');
    const statusText = root.getElementById('statusText');
    const lens = root.getElementById('lens');
    const reader = root.getElementById('reader');
    const stage = root.getElementById('stage');

    // 1. Mover la lente (Drag)
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let startLeft = 0, startTop = 0;

    const onMouseDownDrag = (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = wrapper.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    };

    brand.addEventListener('mousedown', onMouseDownDrag);
    spacer.addEventListener('mousedown', onMouseDownDrag);

    // 2. Redimensionar (Resize)
    let isResizing = false;
    let resizeDir = '';
    let rStartX = 0, rStartY = 0;
    let rStartW = 0, rStartH = 0, rStartL = 0, rStartT = 0;

    root.querySelectorAll('.resize-handle').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizeDir = handle.dataset.dir;
        rStartX = e.clientX;
        rStartY = e.clientY;
        const rect = wrapper.getBoundingClientRect();
        rStartW = rect.width;
        rStartH = rect.height;
        rStartL = rect.left;
        rStartT = rect.top;
        e.preventDefault();
        e.stopPropagation();
      });
    });

    window.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        wrapper.style.left = `${Math.max(10, Math.min(window.innerWidth - 100, startLeft + dx))}px`;
        wrapper.style.top = `${Math.max(10, Math.min(window.innerHeight - 60, startTop + dy))}px`;
        updateOverlayPositions();
      } else if (isResizing) {
        const dx = e.clientX - rStartX;
        const dy = e.clientY - rStartY;

        if (resizeDir.includes('e')) wrapper.style.width = `${Math.max(240, rStartW + dx)}px`;
        if (resizeDir.includes('s')) wrapper.style.height = `${Math.max(160, rStartH + dy)}px`;
        if (resizeDir.includes('w')) {
          const newW = Math.max(240, rStartW - dx);
          wrapper.style.width = `${newW}px`;
          wrapper.style.left = `${rStartL + (rStartW - newW)}px`;
        }
        if (resizeDir.includes('n')) {
          const newH = Math.max(160, rStartH - dy);
          wrapper.style.height = `${newH}px`;
          wrapper.style.top = `${rStartT + (rStartH - newH)}px`;
        }
        updateOverlayPositions();
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDragging || isResizing) {
        isDragging = false;
        isResizing = false;
        updateOverlayPositions();
        scheduleScan(120);
      }
    });

    // 3. Cerrar lente
    closeBtn.addEventListener('click', () => {
      hideLens();
    });

    // 4. Slider de Transparencia
    opacityBtn.addEventListener('click', () => {
      opacityPop.hidden = !opacityPop.hidden;
      langMenu.hidden = true;
    });

    opacityRange.addEventListener('input', (e) => {
      currentOpacity = e.target.value;
      lens.style.setProperty('--glass', currentOpacity / 100);
      opacityValue.textContent = `${currentOpacity}%`;
      browser.storage?.local?.set({ defaultOpacity: currentOpacity });
    });

    // 5. Menú de Idiomas
    langBtn.addEventListener('click', () => {
      langMenu.hidden = !langMenu.hidden;
      opacityPop.hidden = true;
    });

    root.querySelectorAll('#langList button').forEach((btn) => {
      btn.addEventListener('click', () => {
        sourceLang = btn.dataset.lang;
        detectedSourceLang = null;
        root.getElementById('langLabel').textContent = sourceLang.toUpperCase();
        langMenu.hidden = true;
        clearSpatialCache();
        lastScannedSignature = '';
        lastVisualOcrSignature = '';
        scheduleScan(100);
      });
    });

    // 6. Botón Pausar / Reanudar
    pauseBtn.addEventListener('click', () => {
      isPaused = !isPaused;
      if (isPaused) {
        pauseBtn.innerHTML = ICONS.play;
        statusText.textContent = 'En pausa';
        lens.dataset.state = 'paused';
      } else {
        pauseBtn.innerHTML = ICONS.pause;
        statusText.textContent = 'Lista';
        lens.dataset.state = 'idle';
        scheduleScan(100);
      }
    });

    // 7. Botón Forzar Traducción
    refreshBtn.addEventListener('click', () => {
      clearSpatialCache();
      lastScannedSignature = '';
      lastVisualOcrSignature = '';
      performScanAndTranslate();
    });

    // 8. Botón OCR Visual (Captura de Imagen)
    ocrVisualBtn?.addEventListener('click', () => {
      performVisualOCR(stage.getBoundingClientRect(), { force: true });
    });

    // 9. Cambiar Modo (Lente / Lector)
    modeBtn.addEventListener('click', () => {
      currentMode = currentMode === 'overlay' ? 'reader' : 'overlay';
      lens.dataset.mode = currentMode;
      modeBtn.innerHTML = currentMode === 'overlay' ? ICONS.lensMode : ICONS.readerMode;
      reader.hidden = currentMode !== 'reader';
      if (currentMode === 'overlay') {
        updateOverlayPositions();
      }
      lastScannedSignature = '';
      scheduleScan(100);
    });

    // 10. Desplazamiento y cambio de tamaño de página web
    const onScroll = () => {
      updateOverlayPositions();
      if (isLensActive && !isPaused) {
        scheduleScan(200);
      }
    };

    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });

    window.addEventListener('resize', () => {
      updateOverlayPositions();
    }, { passive: true });
  }

  function showLens() {
    createLensDOM();
    if (hostEl) {
      hostEl.style.display = 'block';
      isLensActive = true;
      lastScannedSignature = '';
      updateOverlayPositions();
      scheduleScan(150);
    }
  }

  function hideLens() {
    if (hostEl) {
      hostEl.style.display = 'none';
      isLensActive = false;
    }
  }

  function toggleLens() {
    if (isLensActive) {
      hideLens();
    } else {
      showLens();
    }
    return isLensActive;
  }

  // Escuchar mensajes del background o popup
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'GET_STATUS') {
      sendResponse({ active: isLensActive });
      return;
    }

    if (message.action === 'TOGGLE_LENS' || (message.action === 'COMMAND' && message.command === 'toggle-lens')) {
      const active = toggleLens();
      sendResponse({ active });
      return;
    }

    if (message.action === 'COMMAND' && message.command === 'translate-now') {
      lastScannedSignature = '';
      performScanAndTranslate();
      return;
    }

    if (message.action === 'SHOW_LENS') {
      showLens();
      sendResponse({ active: true });
      return;
    }

    if (message.action === 'HIDE_LENS') {
      hideLens();
      sendResponse({ active: false });
      return;
    }
  });
})();
