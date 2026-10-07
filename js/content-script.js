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
  let currentMode = 'native'; // 'native' (inyección directa DOM) | 'overlay' (pastillas flotantes) | 'reader' (panel limpio)
  let sourceLang = 'auto';
  let targetLang = 'es';
  let detectedSourceLang = null;
  let scanDebounceTimer = null;
  let lastScannedSignature = '';

  // ---- Inyección Directa en el DOM (Traducción Nativa In-Place) ----
  const domOriginalMap = new WeakMap();     // node -> originalText string
  const domTranslationCache = new Map();    // `${langKey}::${text}` -> translatedText string
  const activeDomNodes = new Set();         // text nodes currently showing translated text in page DOM

  function restoreAllNativeDomNodes() {
    for (const node of activeDomNodes) {
      if (node.isConnected && domOriginalMap.has(node)) {
        node.nodeValue = domOriginalMap.get(node);
      }
    }
    activeDomNodes.clear();
  }

  function updateNativeDomNodes(stageRect) {
    for (const node of activeDomNodes) {
      if (!node.isConnected) {
        activeDomNodes.delete(node);
        continue;
      }
      try {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        const isInside = (
          rect.left < stageRect.right &&
          rect.right > stageRect.left &&
          rect.top < stageRect.bottom &&
          rect.bottom > stageRect.top
        );
        if (!isInside) {
          if (domOriginalMap.has(node)) {
            node.nodeValue = domOriginalMap.get(node);
          }
          activeDomNodes.delete(node);
        }
      } catch (_) {
        activeDomNodes.delete(node);
      }
    }
  }

  const ICONS = {
    logo: `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><defs><linearGradient id="lupa-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse"><stop stop-color="#79a6ff"/><stop offset="1" stop-color="#b79bff"/></linearGradient></defs><circle cx="10.5" cy="10.5" r="7" stroke="url(#lupa-grad)" stroke-width="2.2"/><path d="M15.8 15.8 21 21" stroke="url(#lupa-grad)" stroke-width="2.6"/><path d="M7.6 9.3h5.8M7.6 12h4" stroke="#eaf0ff" stroke-width="1.7"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
    play: `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><polygon points="7 4.5 19 12 7 19.5 7 4.5"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6.5" y="4.5" width="3.8" height="15" rx="1"/><rect x="13.7" y="4.5" width="3.8" height="15" rx="1"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`,
    droplet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>`,
    domMode: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
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
        display: inline-block;
        border-radius: 5px;
        padding: 2px 7px;
        line-height: 1.25;
        font-family: var(--ui-font);
        background: rgba(10, 15, 26, 0.92);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        color: #f8fafc;
        border: 1px solid rgba(96, 165, 250, 0.40);
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.06);
        pointer-events: auto;
        font-size: 12px;
        font-weight: 500;
        letter-spacing: -0.01em;
        white-space: nowrap;
        width: max-content;
        min-width: max-content;
        max-width: none;
        box-sizing: border-box;
        z-index: 5;
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
        animation: blk-appear 0.15s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes blk-appear {
        from { opacity: 0; transform: scale(0.98); }
        to { opacity: 1; transform: scale(1); }
      }
      .blk:hover {
        background: rgba(15, 23, 42, 0.98);
        border-color: rgba(121, 166, 255, 0.90);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.70), 0 0 10px rgba(121, 166, 255, 0.40);
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
            <button id="modeBtn" class="tool" type="button" title="Alternar modo de traducción">${currentMode === 'native' ? ICONS.domMode : (currentMode === 'overlay' ? ICONS.lensMode : ICONS.readerMode)}</button>
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
    blk.title = entry.text ? `Original: ${entry.text}` : '';

    // Normalizar tamaño de fuente para que sea proporcionado y nunca colisione verticalmente
    const parsedSize = parseFloat(entry.fontSize) || 12;
    const cleanFontSize = Math.max(11, Math.min(13, parsedSize));
    blk.style.fontSize = `${cleanFontSize}px`;

    const text = entry.translatedText || '';
    // Un bloque solo debe ser multilínea si tiene saltos de línea explícitos o texto extremadamente extenso
    const isVeryLong = text.length > 130;
    const hasExplicitNewline = text.includes('\n');

    if (isVeryLong || hasExplicitNewline) {
      blk.style.whiteSpace = 'normal';
      blk.style.wordBreak = 'normal';
      blk.style.overflowWrap = 'break-word';
      blk.style.width = 'auto';
      blk.style.minWidth = '240px';
      blk.style.maxWidth = `${Math.max(480, Math.min(850, Math.round((entry.w || 400) * 1.15)))}px`;
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
   * Mejora 1: Agrupamiento Semántico Inteligente de Frases y Columnas
   * Unifica oraciones completas y blanks (_____), pero NUNCA fusiona elementos
   * independientes (enlaces <a>, botones, columnas, encabezados o celdas distintas).
   */
  function groupAdjacentItems(rawItems) {
    if (!rawItems || rawItems.length === 0) return [];

    // 1. Filtrar fragmentos vacíos o ruido gráfico
    const cleanItems = rawItems.filter((it) => {
      if (!it || !it.text) return false;
      const t = it.text.trim();
      if (t.length === 0) return false;
      if (t.length === 1 && !/[a-zA-Z0-9¿?¡!.,:;]/.test(t)) return false;
      return true;
    });

    if (cleanItems.length === 0) return [];

    // 2. Ordenar por coordenada Y en el documento y luego por X
    cleanItems.sort((a, b) => {
      const lineDiff = a.docY - b.docY;
      const avgH = ((a.h || 18) + (b.h || 18)) / 2;
      if (Math.abs(lineDiff) > avgH * 0.4) {
        return lineDiff;
      }
      return a.docX - b.docX;
    });

    const isListOrNumberedStart = (str) =>
      /^\s*(?:\d+[\.\)\-]|[a-zA-Z][\.\)]|[•\-–—*]|Q\d+:|Pregunta\s+\d+:?)\s*/i.test(str || '');

    const endsSentence = (str) => {
      const trimmed = (str || '').trim();
      return /[.!?:]\s*$/.test(trimmed) && !/\b(?:etc|vs|mr|mrs|dr|prof|sr|sra)\.$/i.test(trimmed);
    };

    // NUNCA fusionar elementos HTML independientes (ej. enlaces distintos, botones, encabezados, celdas)
    const isDistinctSemanticElement = (a, b) => {
      if (!a.targetEl || !b.targetEl) return false;
      if (a.targetEl === b.targetEl) return false;
      const tagA = a.targetEl.tagName.toUpperCase();
      const tagB = b.targetEl.tagName.toUpperCase();
      const distinctTags = ['A', 'BUTTON', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LABEL', 'NAV'];
      if (distinctTags.includes(tagA) || distinctTags.includes(tagB)) return true;
      if (a.targetEl.closest('p') !== b.targetEl.closest('p')) return true;
      if (a.targetEl.closest('li') !== b.targetEl.closest('li')) return true;
      return false;
    };

    const grouped = [];
    let current = { ...cleanItems[0] };

    for (let i = 1; i < cleanItems.length; i++) {
      const item = cleanItems[i];
      const avgH = ((current.h || 18) + (item.h || 18)) / 2;
      const sameLine = Math.abs(item.docY - current.docY) <= Math.max(7, avgH * 0.65);
      const gapX = item.docX - (current.docX + current.w);
      const isNewItem = isListOrNumberedStart(item.text);
      const isDistinct = isDistinctSemanticElement(current, item);

      // Si es OCR de imagen y hay un subrayado explícito de blank (ej. worksheet)
      const isOcrImage = !current.targetEl && !item.targetEl;
      const hasBlank = /[_\-–—]{2,}/.test(current.text) || /[_\-–—]{2,}/.test(item.text);
      const maxGapAllowed = (isOcrImage && hasBlank) ? 280 : 26;

      // CASO 1: Misma línea horizontal
      if (sameLine && !isNewItem && !isDistinct && gapX >= -14 && gapX <= maxGapAllowed) {
        let joiner = ' ';
        const itemTrim = item.text.trim();
        if (gapX > 24) {
          joiner = hasBlank ? ' ' : ' _____ ';
        }
        current.text = current.text.trim() + joiner + itemTrim;
        const right = Math.max(current.docX + current.w, item.docX + item.w);
        const bottom = Math.max(current.docY + current.h, item.docY + item.h);
        current.w = right - current.docX;
        current.h = bottom - current.docY;
        current.h = Math.min(current.h, 28);
        continue;
      }

      // CASO 2: Continuación en línea siguiente dentro del mismo párrafo o columna
      const lineDiff = item.docY - current.docY;
      const isNextLine = lineDiff > 5 && lineDiff <= Math.max(current.h || 18, item.h || 18) * 2.2;
      const currentEnded = endsSentence(current.text);
      const sameColumnAlignment = Math.abs(item.docX - current.docX) < 45;

      if (isNextLine && !currentEnded && !isNewItem && !isDistinct && sameColumnAlignment) {
        current.text = current.text.trim() + ' ' + item.text.trim();
        const right = Math.max(current.docX + current.w, item.docX + item.w);
        const bottom = Math.max(current.docY + current.h, item.docY + item.h);
        current.w = Math.max(current.w, right - current.docX);
        current.h = bottom - current.docY;
        continue;
      }

      grouped.push(current);
      current = { ...item };
    }
    grouped.push(current);

    // 3. Normalizar texto de oraciones agrupadas
    grouped.forEach((g) => {
      g.text = g.text
        .replace(/[_\-–—]{3,}/g, ' _____ ')
        .replace(/\s+/g, ' ')
        .replace(/\s+([.,:;!?])/g, '$1')
        .trim();
    });

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
        const tag = parent.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'textarea' || tag === 'input' || tag === 'noscript') {
          return NodeFilter.FILTER_REJECT;
        }
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
        // Si el nodo ya fue modificado por Inyección DOM, usamos el texto original guardado
        const originalVal = domOriginalMap.get(node) || node.nodeValue;
        const text = originalVal.trim();
        if (text.length > 0 && !/^[\s\d.,;:\-_/\\|+*=&%#@!?()\[\]{}'"]+$/.test(text)) {
          const parent = node.parentElement;
          const pRect = parent.getBoundingClientRect();
          const compStyle = window.getComputedStyle(parent);
          rawItems.push({
            node,
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

    if (currentMode === 'native') {
      return rawItems;
    }
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

    if (force) {
      clearSpatialCache();
    }

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
        const rawItems = lines.map((line) => {
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
            fontSize: `${Math.max(11, Math.min(13.5, Math.round(h * 0.75)))}px`
          };
        });
        const items = groupAdjacentItems(rawItems);
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
          const cleanTranslated = (translatedText || '')
            .replace(/\s+([.,:;!?])/g, '$1')
            .replace(/\(\s+/g, '(')
            .replace(/\s+\)/g, ')')
            .trim();
          addOrUpdateSpatialItem({
            ...it,
            translatedText: cleanTranslated
          });
        });

        updateOverlayPositions();

        if (currentMode === 'reader') {
          const { x: scrollX, y: scrollY } = getScrollOffsets();
          const allVisibleEntries = Array.from(spatialCache.values())
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
            .sort((a, b) => a.docY - b.docY || a.docX - b.docX);

          reader.innerHTML = `
            <div style="padding:14px;color:#f1f5f9;font-family:var(--ui-font);">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(121, 166, 255, 0.25);">
                <span style="font-weight:700;color:#79a6ff;font-size:11.5px;letter-spacing:0.04em;text-transform:uppercase;">
                  Traducción (${(detectedSourceLang || sourceLang).toUpperCase()} → ${targetLang.toUpperCase()})
                </span>
                <span style="font-size:11px;color:#94a3b8;background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:10px;">
                  ${allVisibleEntries.length} ${allVisibleEntries.length === 1 ? 'oración' : 'oraciones'}
                </span>
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;">
                ${allVisibleEntries.map((e) => `
                  <div style="background:rgba(255,255,255,0.03);border-left:3px solid #79a6ff;padding:8px 12px;border-radius:0 6px 6px 0;line-height:1.45;font-size:13px;color:#f8fafc;">
                    <div>${escapeHtml(e.translatedText)}</div>
                    ${e.text ? `<div style="font-size:11px;color:#64748b;margin-top:3px;font-style:italic;">${escapeHtml(e.text)}</div>` : ''}
                  </div>
                `).join('')}
              </div>
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
    const overlayLayer = shadowRoot.getElementById('overlayLayer');
    const statusText = shadowRoot.getElementById('statusText');
    const langLabel = shadowRoot.getElementById('langLabel');

    if (!stage || !lens) return;

    const stageRect = stage.getBoundingClientRect();
    if (stageRect.width < 50 || stageRect.height < 50) return;

    // 1. Extraer texto visible bajo la lente
    const items = findTextUnderLens(stageRect);

    // ==========================================
    // MODO 1: INYECCIÓN DIRECTA EN EL DOM (NATIVO)
    // ==========================================
    if (currentMode === 'native') {
      if (overlayLayer) overlayLayer.innerHTML = '';
      updateNativeDomNodes(stageRect);

      if (items.length === 0) {
        lastScannedSignature = '';
        performVisualOCR(stageRect, { force: false });
        return;
      }

      const currentLangKey = getLangKey();
      const uncachedItems = [];

      items.forEach((it) => {
        if (!it.node) return;
        if (!domOriginalMap.has(it.node)) {
          domOriginalMap.set(it.node, it.node.nodeValue);
        }
        const origText = it.text;
        const cacheKey = `${currentLangKey}::${origText}`;
        const cachedTrans = domTranslationCache.get(cacheKey);

        if (cachedTrans) {
          if (it.node.nodeValue !== cachedTrans) {
            it.node.nodeValue = cachedTrans;
          }
          activeDomNodes.add(it.node);
        } else {
          uncachedItems.push(it);
        }
      });

      if (uncachedItems.length === 0) {
        if (!isPaused) {
          lens.dataset.state = 'idle';
          statusText.textContent = `Nativo: ${activeDomNodes.size} trad.`;
        }
        return;
      }

      const currentSignature = uncachedItems.map((it) => it.text).join('||') + `::${targetLang}::${sourceLang}`;
      if (currentSignature === lastScannedSignature) return;
      lastScannedSignature = currentSignature;

      isScanning = true;
      lens.dataset.busy = '1';
      lens.dataset.state = 'busy';
      statusText.textContent = 'Traduciendo DOM...';

      try {
        const textsToTranslate = uncachedItems.map((it) => it.text);
        const res = await browser.runtime.sendMessage({
          action: 'TRANSLATE_TEXTS',
          texts: textsToTranslate,
          from: sourceLang,
          to: targetLang
        });

        if (res && res.translations) {
          if (res.detectedLang && sourceLang === 'auto' && langLabel) {
            detectedSourceLang = res.detectedLang;
            langLabel.textContent = detectedSourceLang.toUpperCase();
            langLabel.title = `Detectado automáticamente: ${detectedSourceLang.toUpperCase()}`;
          }

          res.translations.forEach((trans, i) => {
            const it = uncachedItems[i];
            const cleanTrans = (trans || '').trim();
            const cacheKey = `${currentLangKey}::${it.text}`;
            domTranslationCache.set(cacheKey, cleanTrans);
            if (it.node && it.node.isConnected) {
              it.node.nodeValue = cleanTrans;
              activeDomNodes.add(it.node);
            }
          });
        }
      } catch (err) {
        console.error('[Lupa DOM] Error al traducir texto HTML:', err);
        lens.dataset.state = 'error';
        statusText.textContent = 'Error traducción';
      } finally {
        isScanning = false;
        lens.dataset.busy = '0';
        if (!isPaused) {
          lens.dataset.state = 'idle';
          statusText.textContent = `Nativo: ${activeDomNodes.size} trad.`;
        }
      }
      return;
    }

    // ==========================================
    // MODO 2 & 3: SUPERPOSICIÓN (OVERLAY) Y LECTOR
    // ==========================================
    updateOverlayPositions();

    if (items.length === 0) {
      lastScannedSignature = '';
      if (currentMode === 'reader') {
        reader.innerHTML = '<div style="color:#94a3b8;padding:14px;">Buscando texto en la imagen…</div>';
      }

      const hasCached = hasSpatialItemsInRect(stageRect);
      if (hasCached) {
        if (!isPaused) {
          lens.dataset.state = 'idle';
          statusText.textContent = 'Lista';
        }
        return;
      }

      performVisualOCR(stageRect, { force: false });
      return;
    }

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
        restoreAllNativeDomNodes();
        domTranslationCache.clear();
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
        restoreAllNativeDomNodes();
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
      restoreAllNativeDomNodes();
      domTranslationCache.clear();
      lastScannedSignature = '';
      lastVisualOcrSignature = '';
      performScanAndTranslate();
    });

    // 8. Botón OCR Visual (Captura de Imagen)
    ocrVisualBtn?.addEventListener('click', () => {
      performVisualOCR(stage.getBoundingClientRect(), { force: true });
    });

    // 9. Alternar Modo (Nativo DOM / Superposición / Lector)
    const updateModeUI = () => {
      lens.dataset.mode = currentMode;
      reader.hidden = currentMode !== 'reader';

      const overlayLayer = root.getElementById('overlayLayer');
      if (currentMode === 'native') {
        modeBtn.innerHTML = ICONS.domMode;
        modeBtn.title = 'Modo: DOM Nativo (Texto web cambiado directamente sin cajas). Clic para Superposición.';
        if (overlayLayer) overlayLayer.style.display = 'none';
        statusText.textContent = 'Modo: DOM Nativo';
      } else if (currentMode === 'overlay') {
        modeBtn.innerHTML = ICONS.lensMode;
        modeBtn.title = 'Modo: Superposición AR (Pastillas flotantes sobre cristal). Clic para Lector.';
        if (overlayLayer) overlayLayer.style.display = 'block';
        statusText.textContent = 'Modo: Superposición';
        updateOverlayPositions();
      } else {
        modeBtn.innerHTML = ICONS.readerMode;
        modeBtn.title = 'Modo: Lector (Panel limpio). Clic para DOM Nativo.';
        if (overlayLayer) overlayLayer.style.display = 'none';
        statusText.textContent = 'Modo: Lector';
      }
    };

    updateModeUI();

    modeBtn.addEventListener('click', () => {
      if (currentMode === 'native') {
        restoreAllNativeDomNodes();
        currentMode = 'overlay';
      } else if (currentMode === 'overlay') {
        currentMode = 'reader';
      } else {
        currentMode = 'native';
      }
      updateModeUI();
      lastScannedSignature = '';
      lastVisualOcrSignature = '';
      scheduleScan(80);
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
      restoreAllNativeDomNodes();
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
