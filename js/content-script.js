/**
 * Content Script para Firefox WebExtension
 * Lupa OCR Transparente — Inyección del overlay en Shadow DOM y click-through
 */

(() => {
  if (window.__LUPA_OCR_INJECTED__) return;
  window.__LUPA_OCR_INJECTED__ = true;

  let hostEl = null;
  let shadowRoot = null;
  let isLensActive = false;
  let isPaused = false;
  let currentOpacity = 14;
  let currentMode = 'overlay'; // 'overlay' | 'reader'
  let sourceLang = 'auto';
  let targetLang = 'es';

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
    settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3"/><path d="M14 2v4M8 10v4M16 18v4"/></svg>`
  };

  function createLensDOM() {
    if (hostEl) return;

    hostEl = document.createElement('div');
    hostEl.id = 'lupa-extension-host';
    hostEl.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;';

    shadowRoot = hostEl.attachShadow({ mode: 'open' });

    // Inyectar hoja de estilos principal
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = browser.runtime.getURL('src/renderer/styles.css');
    shadowRoot.appendChild(styleLink);

    // Contenedor principal de la lente flotante
    const wrapper = document.createElement('div');
    wrapper.id = 'lupa-wrapper';
    wrapper.style.cssText = 'position:absolute;left:80px;top:80px;width:520px;height:340px;min-width:240px;min-height:160px;pointer-events:none;';

    wrapper.innerHTML = `
      <div id="lens" class="lens" data-mode="${currentMode}" data-theme="dark" data-state="idle" style="position:relative;width:100%;height:100%;pointer-events:none;--glass:${currentOpacity / 100};">
        <div class="glass" id="glass"></div>
        <div class="frame"></div>

        <!-- Barra superior interactiva -->
        <header id="bar" class="bar" data-interactive style="pointer-events:auto;">
          <div class="brand" id="brand" data-drag data-tip="Arrastra para mover la lente" style="cursor:move;">
            <span class="logo" id="logo">${ICONS.logo}</span>
            <span class="dot" id="dot"></span>
            <span class="status-text" id="statusText">Lista</span>
          </div>

          <button id="langBtn" class="chip" data-tip="Idioma original" type="button">
            <span id="langLabel">${sourceLang.toUpperCase()}</span>
            <span class="arrow">${ICONS.arrow}</span>
            <span id="targetLabel">${targetLang.toUpperCase()}</span>
          </button>

          <div class="spacer" id="spacer" data-drag style="flex:1;cursor:move;"></div>

          <div class="tools">
            <button id="modeBtn" class="tool" type="button" title="Cambiar vista">${ICONS.lensMode}</button>
            <button id="opacityBtn" class="tool" type="button" title="Transparencia">${ICONS.droplet}</button>
            <button id="pauseBtn" class="tool" type="button" title="Pausar / Reanudar">${ICONS.pause}</button>
            <button id="refreshBtn" class="tool" type="button" title="Traducir ahora">${ICONS.refresh}</button>
            <button id="settingsBtn" class="tool" type="button" title="Ajustes">${ICONS.settings}</button>
            <span class="sep"></span>
            <button id="closeBtn" class="tool tool-close" type="button" title="Cerrar Lupa">${ICONS.close}</button>
          </div>
        </header>

        <div class="progress" id="progress"></div>

        <!-- Área transparente con clics a través -->
        <main id="stage" class="stage" style="pointer-events:none;">
          <div id="overlayLayer" class="overlay-layer" style="pointer-events:none;"></div>
          <article id="reader" class="reader" hidden style="pointer-events:auto;"></article>
          <div id="hint" class="hint" hidden></div>
        </main>

        <!-- Tiradores de redimensionado -->
        <div class="resize-handle rh-nw" data-dir="nw" style="position:absolute;top:0;left:0;width:14px;height:14px;cursor:nwse-resize;pointer-events:auto;"></div>
        <div class="resize-handle rh-ne" data-dir="ne" style="position:absolute;top:0;right:0;width:14px;height:14px;cursor:nesw-resize;pointer-events:auto;"></div>
        <div class="resize-handle rh-sw" data-dir="sw" style="position:absolute;bottom:0;left:0;width:14px;height:14px;cursor:nesw-resize;pointer-events:auto;"></div>
        <div class="resize-handle rh-se" data-dir="se" style="position:absolute;bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize;pointer-events:auto;"></div>
        <div class="resize-handle rh-n"  data-dir="n"  style="position:absolute;top:0;left:14px;right:14px;height:6px;cursor:ns-resize;pointer-events:auto;"></div>
        <div class="resize-handle rh-s"  data-dir="s"  style="position:absolute;bottom:0;left:14px;right:14px;height:6px;cursor:ns-resize;pointer-events:auto;"></div>
        <div class="resize-handle rh-w"  data-dir="w"  style="position:absolute;left:0;top:14px;bottom:14px;width:6px;cursor:ew-resize;pointer-events:auto;"></div>
        <div class="resize-handle rh-e"  data-dir="e"  style="position:absolute;right:0;top:14px;bottom:14px;width:6px;cursor:ew-resize;pointer-events:auto;"></div>

        <!-- Popover Transparencia -->
        <div id="opacityPop" class="pop pop-opacity" data-interactive hidden style="pointer-events:auto;">
          <div class="pop-title">Transparencia</div>
          <div class="slider-row" style="display:flex;align-items:center;gap:10px;padding:8px 0;">
            <input id="opacityRange" type="range" min="5" max="100" step="1" value="${currentOpacity}" style="flex:1;">
            <span id="opacityValue" style="font-size:12px;color:#fff;">${currentOpacity}%</span>
          </div>
        </div>

        <!-- Popover Idioma -->
        <div id="langMenu" class="pop pop-lang" data-interactive hidden style="pointer-events:auto;">
          <div class="pop-title">Idioma del texto original</div>
          <div id="langList" class="list" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 0;">
            <button class="seg-btn" data-lang="auto">Automático</button>
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
    const modeBtn = root.getElementById('modeBtn');
    const statusText = root.getElementById('statusText');
    const dot = root.getElementById('dot');
    const lens = root.getElementById('lens');
    const reader = root.getElementById('reader');

    // 1. Mover la lente (Drag)
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let startLeft = 0, startTop = 0;

    const onMouseDownDrag = (e) => {
      if (e.target.closest('button')) return;
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
      } else if (isResizing) {
        const dx = e.clientX - rStartX;
        const dy = e.clientY - rStartY;

        if (resizeDir.includes('e')) {
          wrapper.style.width = `${Math.max(240, rStartW + dx)}px`;
        }
        if (resizeDir.includes('s')) {
          wrapper.style.height = `${Math.max(160, rStartH + dy)}px`;
        }
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
      }
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
      isResizing = false;
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
    });

    // 5. Menú de Idiomas
    langBtn.addEventListener('click', () => {
      langMenu.hidden = !langMenu.hidden;
      opacityPop.hidden = true;
    });

    root.querySelectorAll('#langList button').forEach((btn) => {
      btn.addEventListener('click', () => {
        sourceLang = btn.dataset.lang;
        root.getElementById('langLabel').textContent = sourceLang.toUpperCase();
        langMenu.hidden = true;
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
      }
    });

    // 7. Cambiar Modo (Lente / Lector)
    modeBtn.addEventListener('click', () => {
      currentMode = currentMode === 'overlay' ? 'reader' : 'overlay';
      lens.dataset.mode = currentMode;
      modeBtn.innerHTML = currentMode === 'overlay' ? ICONS.lensMode : ICONS.readerMode;
      reader.hidden = currentMode !== 'reader';
      if (currentMode === 'reader') {
        reader.innerHTML = '<div style="padding:16px;color:#cbd5e1;">Coloca la lente sobre texto para leerlo cómodamente en este panel.</div>';
      }
    });
  }

  function showLens() {
    createLensDOM();
    if (hostEl) {
      hostEl.style.display = 'block';
      isLensActive = true;
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
