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

  let preferredDockPos = 'auto'; // 'auto' | 'right' | 'left' | 'inside-right' | 'inside-left' | 'top' | 'bottom'
  let activeDockPos = 'right';
  let isDockCollapsed = false;

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
    camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
    dragGrip: `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="6" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/></svg>`,
    dockPos: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/></svg>`,
    collapse: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg>`,
    expand: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>`
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
        --r: 16px;
        --accent: #79a6ff;
        --accent-2: #b79bff;
        --accent-cyan: #00f0ff;
        --ok: #10b981;
        --warn: #f59e0b;
        --err: #ef4444;
        --ink: #f8fafc;
        --ink-dim: #94a3b8;
        --line: rgba(255, 255, 255, 0.12);
        --panel: rgba(9, 11, 20, 0.94);
        --panel-hi: rgba(255, 255, 255, 0.08);
        --glass: ${currentOpacity / 100};
        --glass-rgb: 9, 13, 24;
        --ui-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
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
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 16px 48px rgba(0, 0, 0, 0.55);
        transition: background 0.15s ease;
      }
      .frame {
        position: absolute;
        inset: 0;
        border-radius: var(--r);
        pointer-events: none;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7), inset 0 0 0 1.6px rgba(121, 166, 255, 0.85);
        transition: box-shadow 0.2s ease;
      }
      .lens:hover .frame {
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.8), inset 0 0 0 1.8px rgba(121, 166, 255, 1), 0 0 24px -4px rgba(121, 166, 255, 0.35);
      }

      /* Barra de arrastre superior amplia e intuitiva (Full-Width Header Drag Zone) */
      .lens-drag-bezel {
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 28px;
        cursor: grab;
        pointer-events: auto;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--r) var(--r) 0 0;
        transition: background 0.2s ease;
      }
      .lens-drag-bezel:active { cursor: grabbing; }
      .lens-drag-bezel::after {
        content: "";
        width: 56px;
        height: 4px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.25);
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
      }
      .lens:hover .lens-drag-bezel {
        background: linear-gradient(180deg, rgba(121, 166, 255, 0.12) 0%, transparent 100%);
      }
      .lens:hover .lens-drag-bezel::after {
        background: linear-gradient(90deg, var(--accent-cyan), var(--accent));
        box-shadow: 0 0 12px rgba(0, 240, 255, 0.7);
        width: 88px;
      }

      /* Bordes de arrastre perimetrales del marco */
      .frame-drag-zone {
        position: absolute;
        pointer-events: auto;
        cursor: grab;
        z-index: 8;
      }
      .frame-drag-zone:active { cursor: grabbing; }
      .fdz-bottom { bottom: 0; left: 16px; right: 16px; height: 10px; }
      .fdz-left { left: 0; top: 20px; bottom: 20px; width: 10px; }
      .fdz-right { right: 0; top: 20px; bottom: 20px; width: 10px; }

      /* Arrastre Inteligente con Tecla Alt */
      .lens.is-alt-dragging,
      .lens.is-alt-dragging * {
        cursor: grab !important;
      }
      .lens.is-alt-dragging:active,
      .lens.is-alt-dragging:active * {
        cursor: grabbing !important;
      }

      /* Dock Flotante Lateral ("A los costados") */
      .lens-dock {
        position: absolute;
        z-index: 25;
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 6px;
        background: var(--panel);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid var(--line);
        border-radius: 16px;
        box-shadow: 0 12px 36px -6px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05), 0 0 25px -5px rgba(99, 102, 241, 0.25);
        pointer-events: auto;
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease, left 0.2s ease, right 0.2s ease, top 0.2s ease, bottom 0.2s ease;
      }

      /* Posición Costado Derecho Exterior (Por defecto) */
      .lens[data-dock-pos="right"] .lens-dock {
        left: calc(100% + 10px);
        right: auto;
        top: 0;
        bottom: auto;
        flex-direction: column;
        width: 46px;
      }

      /* Posición Costado Izquierdo Exterior */
      .lens[data-dock-pos="left"] .lens-dock {
        right: calc(100% + 10px);
        left: auto;
        top: 0;
        bottom: auto;
        flex-direction: column;
        width: 46px;
      }

      /* Posición Superior Externa (Fuera de la lente) */
      .lens[data-dock-pos="top"] .lens-dock {
        bottom: calc(100% + 10px);
        top: auto;
        left: 0;
        right: auto;
        flex-direction: row;
        height: 44px;
      }

      /* Posición Inferior Externa (Fuera de la lente) */
      .lens[data-dock-pos="bottom"] .lens-dock {
        top: calc(100% + 10px);
        bottom: auto;
        left: 0;
        right: auto;
        flex-direction: row;
        height: 44px;
      }

      /* Posición Inteligente Dentro del Cuadro: Esquina Superior Derecha */
      .lens[data-dock-pos="inside-right"] .lens-dock {
        right: 10px;
        left: auto;
        top: 10px;
        bottom: auto;
        flex-direction: column;
        width: 46px;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.16);
      }

      /* Posición Inteligente Dentro del Cuadro: Esquina Superior Izquierda */
      .lens[data-dock-pos="inside-left"] .lens-dock {
        left: 10px;
        right: auto;
        top: 10px;
        bottom: auto;
        flex-direction: column;
        width: 46px;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.16);
      }

      /* Estado Colapsado / Minimizado */
      .lens[data-dock-collapsed="true"] .dock-collapsible {
        display: none !important;
      }
      .lens[data-dock-collapsed="true"] .dock-sep {
        display: none !important;
      }
      .lens[data-dock-collapsed="true"] .lens-dock {
        padding: 4px;
        gap: 4px;
      }

      .dock-grip {
        width: 32px;
        height: 20px;
        display: grid;
        place-items: center;
        color: var(--ink-dim);
        cursor: grab;
        border-radius: 6px;
        transition: all 0.15s ease;
      }
      .dock-grip:active { cursor: grabbing; }
      .dock-grip:hover { color: #fff; background: var(--panel-hi); }

      .dock-brand {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 2px 0;
        cursor: default;
      }
      .lens[data-dock-pos="top"] .dock-brand,
      .lens[data-dock-pos="bottom"] .dock-brand {
        flex-direction: row;
        padding: 0 4px;
      }
      .logo { width: 22px; height: 22px; display: grid; place-items: center; }

      .dock-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--ok);
        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25);
        transition: background 0.2s, box-shadow 0.2s;
      }
      .lens[data-state="busy"] .dock-dot {
        background: var(--accent-cyan);
        box-shadow: 0 0 0 3px rgba(0, 240, 255, 0.35);
        animation: pulse 1s infinite;
      }
      .lens[data-state="paused"] .dock-dot {
        background: var(--warn);
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.35);
      }
      .lens[data-state="error"] .dock-dot {
        background: var(--err);
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.35);
      }
      @keyframes pulse { 50% { transform: scale(1.35); } }

      .dock-lang-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 4px 6px;
        border-radius: 9px;
        background: var(--panel-hi);
        border: 1px solid var(--line);
        color: var(--ink);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.02em;
        cursor: pointer;
        transition: all 0.15s ease;
        line-height: 1;
        gap: 2px;
      }
      .dock-lang-btn:hover {
        background: rgba(121, 166, 255, 0.22);
        border-color: var(--accent);
        box-shadow: 0 0 10px rgba(121, 166, 255, 0.3);
      }
      .lens[data-dock-pos="top"] .dock-lang-btn,
      .lens[data-dock-pos="bottom"] .dock-lang-btn {
        flex-direction: row;
        padding: 6px 10px;
        font-size: 11px;
        gap: 5px;
      }
      .lang-tag { color: var(--ink-dim); }
      .lang-tag.target { color: var(--accent); }
      .lang-divider { font-size: 9px; opacity: 0.6; }
      .lang-divider::before { content: "↓"; }
      .lens[data-dock-pos="top"] .lang-divider::before,
      .lens[data-dock-pos="bottom"] .lang-divider::before { content: "→"; }

      .dock-sep {
        background: var(--line);
        opacity: 0.8;
      }
      .lens[data-dock-pos="right"] .dock-sep,
      .lens[data-dock-pos="left"] .dock-sep,
      .lens[data-dock-pos="inside-right"] .dock-sep,
      .lens[data-dock-pos="inside-left"] .dock-sep {
        width: 26px; height: 1px; margin: 2px 0;
      }
      .lens[data-dock-pos="top"] .dock-sep,
      .lens[data-dock-pos="bottom"] .dock-sep {
        width: 1px; height: 24px; margin: 0 2px;
      }

      .dock-collapsible {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .lens[data-dock-pos="right"] .dock-collapsible,
      .lens[data-dock-pos="left"] .dock-collapsible,
      .lens[data-dock-pos="inside-right"] .dock-collapsible,
      .lens[data-dock-pos="inside-left"] .dock-collapsible {
        flex-direction: column;
      }
      .lens[data-dock-pos="top"] .dock-collapsible,
      .lens[data-dock-pos="bottom"] .dock-collapsible {
        flex-direction: row;
      }

      .dock-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .lens[data-dock-pos="right"] .dock-actions,
      .lens[data-dock-pos="left"] .dock-actions,
      .lens[data-dock-pos="inside-right"] .dock-actions,
      .lens[data-dock-pos="inside-left"] .dock-actions {
        flex-direction: column;
      }
      .lens[data-dock-pos="top"] .dock-actions,
      .lens[data-dock-pos="bottom"] .dock-actions {
        flex-direction: row;
      }

      .dock-tool {
        width: 32px; height: 32px; border-radius: 9px;
        display: grid; place-items: center;
        color: var(--ink-dim);
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .dock-tool:hover { background: var(--panel-hi); color: #fff; transform: scale(1.06); }
      .dock-tool:active { transform: scale(0.94); }
      .dock-tool.active { background: rgba(121, 166, 255, 0.25); color: var(--accent); }
      .dock-tool-danger:hover { background: rgba(239, 68, 68, 0.25); color: #fca5a5; }

      /* Micro-tooltips automáticos de alta fidelidad */
      [data-tip] { position: relative; }
      [data-tip]::after {
        content: attr(data-tip);
        position: absolute;
        opacity: 0;
        pointer-events: none;
        background: rgba(10, 12, 22, 0.96);
        color: #f8fafc;
        font-size: 11px;
        font-weight: 500;
        padding: 5px 9px;
        border-radius: 7px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.65), 0 0 12px rgba(121, 166, 255, 0.15);
        white-space: nowrap;
        z-index: 100;
        transition: opacity 0.15s ease, transform 0.15s ease;
        line-height: 1.2;
      }
      .lens[data-dock-pos="right"] [data-tip]::after,
      .lens[data-dock-pos="inside-right"] [data-tip]::after {
        right: calc(100% + 9px);
        left: auto;
        top: 50%;
        transform: translateY(-50%) translateX(4px);
      }
      .lens[data-dock-pos="right"] [data-tip]:hover::after,
      .lens[data-dock-pos="inside-right"] [data-tip]:hover::after {
        opacity: 1;
        transform: translateY(-50%) translateX(0);
      }
      .lens[data-dock-pos="left"] [data-tip]::after,
      .lens[data-dock-pos="inside-left"] [data-tip]::after {
        left: calc(100% + 9px);
        right: auto;
        top: 50%;
        transform: translateY(-50%) translateX(-4px);
      }
      .lens[data-dock-pos="left"] [data-tip]:hover::after,
      .lens[data-dock-pos="inside-left"] [data-tip]:hover::after {
        opacity: 1;
        transform: translateY(-50%) translateX(0);
      }
      .lens[data-dock-pos="top"] [data-tip]::after {
        top: calc(100% + 9px);
        bottom: auto;
        left: 50%;
        transform: translateX(-50%) translateY(-4px);
      }
      .lens[data-dock-pos="top"] [data-tip]:hover::after {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      .lens[data-dock-pos="bottom"] [data-tip]::after {
        bottom: calc(100% + 9px);
        top: auto;
        left: 50%;
        transform: translateX(-50%) translateY(4px);
      }
      .lens[data-dock-pos="bottom"] [data-tip]:hover::after {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      /* Barra de progreso de haz de luz neón sobre el borde superior */
      .progress {
        position: absolute; z-index: 12;
        top: 0; left: 0; right: 0; height: 3px;
        border-radius: var(--r) var(--r) 0 0;
        overflow: hidden; opacity: 0; transition: opacity 0.2s;
        background: transparent;
        pointer-events: none;
      }
      .lens[data-busy="1"] .progress { opacity: 1; }
      .progress::after {
        content: ""; position: absolute; inset: 0; width: 50%;
        background: linear-gradient(90deg, transparent, #00f0ff, #8b5cf6, #3b82f6, transparent);
        box-shadow: 0 0 12px rgba(0, 240, 255, 0.7);
        animation: slide-bar 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }
      @keyframes slide-bar { from { transform: translateX(-100%); } to { transform: translateX(250%); } }

      /* Escenario 100% limpio y transparente (sin barra adentro que tape el texto superior) */
      .stage {
        position: absolute;
        inset: 0;
        pointer-events: none;
        overflow: hidden;
        border-radius: var(--r);
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
        border-radius: var(--r);
      }

      .pop {
        position: absolute;
        background: rgba(10, 12, 22, 0.96);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 14px;
        padding: 12px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        z-index: 30;
        width: 230px;
        pointer-events: auto;
        animation: pop-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes pop-in {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
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
      <div id="lens" class="lens" data-mode="${currentMode}" data-dock-pos="${activeDockPos}" data-dock-collapsed="false" data-theme="dark" data-state="idle">
        <div class="glass" id="glass"></div>
        <div class="frame"></div>

        <!-- Bezel de arrastre superior completo (100% transparente para dejar ver el texto) -->
        <div class="lens-drag-bezel" id="topGrip" data-drag title="Arrastra para mover la lente (Doble clic para centrar)"></div>
        <div class="frame-drag-zone fdz-bottom" data-drag title="Arrastra para mover la lente"></div>
        <div class="frame-drag-zone fdz-left" data-drag title="Arrastra para mover la lente"></div>
        <div class="frame-drag-zone fdz-right" data-drag title="Arrastra para mover la lente"></div>

        <!-- Dock Flotante Lateral ("A los costados") -->
        <aside id="bar" class="lens-dock" aria-label="Herramientas de Lupa">
          <!-- Grip de arrastre del dock -->
          <div class="dock-grip" id="brand" data-drag data-tip="Arrastrar Lupa (Doble clic para minimizar)" title="Arrastra para mover la lente">
            ${ICONS.dragGrip}
          </div>

          <!-- Indicador de estado y logo -->
          <div class="dock-brand" id="statusBadge" data-tip="Estado: Lista">
            <span class="logo">${ICONS.logo}</span>
            <span class="dock-dot" id="dot"></span>
            <span class="status-text" id="statusText" style="display:none;">Lista</span>
          </div>

          <!-- Selector de Idioma -->
          <button id="langBtn" class="dock-lang-btn" data-tip="Cambiar idioma" type="button">
            <span id="langLabel" class="lang-tag">${sourceLang === 'auto' && detectedSourceLang ? detectedSourceLang.toUpperCase() : sourceLang.toUpperCase()}</span>
            <span class="lang-divider"></span>
            <span id="targetLabel" class="lang-tag target">${targetLang.toUpperCase()}</span>
          </button>

          <div class="dock-sep"></div>

          <!-- Herramientas principales colapsables -->
          <div class="dock-collapsible" id="dockTools">
            <button id="modeBtn" class="dock-tool" type="button" data-tip="Modo traducción (DOM / Superposición / Lector)">${currentMode === 'native' ? ICONS.domMode : (currentMode === 'overlay' ? ICONS.lensMode : ICONS.readerMode)}</button>
            <button id="ocrVisualBtn" class="dock-tool" type="button" data-tip="Forzar OCR Visual">${ICONS.camera}</button>
            <button id="opacityBtn" class="dock-tool" type="button" data-tip="Transparencia cristal">${ICONS.droplet}</button>
            <button id="pauseBtn" class="dock-tool" type="button" data-tip="Pausar / Reanudar">${ICONS.pause}</button>
            <button id="refreshBtn" class="dock-tool" type="button" data-tip="Traducir ahora">${ICONS.refresh}</button>
          </div>

          <div class="dock-sep"></div>

          <!-- Acciones de Dock y Ventana -->
          <div class="dock-actions">
            <button id="dockPosBtn" class="dock-tool" type="button" data-tip="Posición de barra (Auto Inteligente / Costados / Dentro del cuadro)">${ICONS.dockPos}</button>
            <button id="dockCollapseBtn" class="dock-tool" type="button" data-tip="Minimizar barra">${ICONS.collapse}</button>
            <button id="closeBtn" class="dock-tool dock-tool-danger" type="button" data-tip="Cerrar Lupa">${ICONS.close}</button>
          </div>

          <!-- Spacer invisible para compatibilidad con código existente -->
          <div id="spacer" data-drag style="display:none;"></div>
        </aside>

        <!-- Barra de progreso de haz de luz neón -->
        <div class="progress" id="progress"></div>

        <!-- Escenario de visualización transparente (100% de la lente, SIN BARRA ADENTRO) -->
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
    browser.storage?.local?.get(['targetLang', 'defaultOpacity', 'preferredDockPos', 'dockPosition']).then((cfg) => {
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
      if (cfg?.preferredDockPos) {
        preferredDockPos = cfg.preferredDockPos;
      } else if (cfg?.dockPosition) {
        preferredDockPos = cfg.dockPosition;
      }
      // Ejecutar evaluación inteligente de posición
      const evaluateSmartDockFn = shadowRoot.getElementById('lens')?._evaluateSmartDock;
      if (typeof evaluateSmartDockFn === 'function') {
        evaluateSmartDockFn();
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
    const topGrip = root.getElementById('topGrip');
    const statusBadge = root.getElementById('statusBadge');
    const dockPosBtn = root.getElementById('dockPosBtn');
    const dockCollapseBtn = root.getElementById('dockCollapseBtn');
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

    // Sincronizar texto de estado con el micro-tooltip del badge de la barra lateral
    const statusObserver = new MutationObserver(() => {
      if (statusBadge && statusText) {
        statusBadge.setAttribute('data-tip', `Estado: ${statusText.textContent}`);
      }
    });
    if (statusText) {
      statusObserver.observe(statusText, { childList: true, characterData: true, subtree: true });
    }

    // Helper para anclar los popovers al costado del dock según la posición actual
    function updatePopoversPosition() {
      [opacityPop, langMenu].forEach((pop) => {
        if (!pop || pop.hidden) return;
        const curPos = lens.dataset.dockPos || 'right';
        const wRect = wrapper.getBoundingClientRect();
        if (curPos === 'inside-right') {
          pop.style.top = '10px';
          pop.style.bottom = 'auto';
          pop.style.left = 'auto';
          pop.style.right = '62px';
        } else if (curPos === 'inside-left') {
          pop.style.top = '10px';
          pop.style.bottom = 'auto';
          pop.style.right = 'auto';
          pop.style.left = '62px';
        } else if (curPos === 'right') {
          pop.style.top = '10px';
          pop.style.bottom = 'auto';
          if (wRect.right + 250 > window.innerWidth) {
            pop.style.left = 'auto';
            pop.style.right = '56px';
          } else {
            pop.style.right = 'auto';
            pop.style.left = 'calc(100% + 56px)';
          }
        } else if (curPos === 'left') {
          pop.style.top = '10px';
          pop.style.bottom = 'auto';
          if (wRect.left - 250 < 0) {
            pop.style.right = 'auto';
            pop.style.left = '56px';
          } else {
            pop.style.left = 'auto';
            pop.style.right = 'calc(100% + 56px)';
          }
        } else if (curPos === 'top') {
          pop.style.left = '10px';
          pop.style.right = 'auto';
          pop.style.top = 'auto';
          pop.style.bottom = 'calc(100% + 52px)';
        } else {
          pop.style.left = '10px';
          pop.style.right = 'auto';
          pop.style.top = 'calc(100% + 52px)';
          pop.style.bottom = 'auto';
        }
      });
    }

    // 0. Algoritmo Inteligente de Ubicación del Dock (Smart Dock)
    function evaluateSmartDock() {
      if (!wrapper || !lens) return;
      const wRect = wrapper.getBoundingClientRect();
      const spaceRight = window.innerWidth - wRect.right;
      const spaceLeft = wRect.left;
      const spaceTop = wRect.top;
      const spaceBottom = window.innerHeight - wRect.bottom;
      let chosen = 'right';

      if (preferredDockPos === 'inside-right' || preferredDockPos === 'inside-left') {
        chosen = preferredDockPos;
      } else if (preferredDockPos === 'right') {
        if (spaceRight >= 56) chosen = 'right';
        else if (spaceLeft >= 56) chosen = 'left';
        else chosen = 'inside-right';
      } else if (preferredDockPos === 'left') {
        if (spaceLeft >= 56) chosen = 'left';
        else if (spaceRight >= 56) chosen = 'right';
        else chosen = 'inside-left';
      } else if (preferredDockPos === 'top') {
        if (spaceTop >= 52) chosen = 'top';
        else if (spaceBottom >= 52) chosen = 'bottom';
        else chosen = spaceRight >= 56 ? 'right' : 'inside-right';
      } else if (preferredDockPos === 'bottom') {
        if (spaceBottom >= 52) chosen = 'bottom';
        else if (spaceTop >= 52) chosen = 'top';
        else chosen = spaceRight >= 56 ? 'right' : 'inside-right';
      } else {
        // Modo 'auto': Detecta dinámicamente el área con mayor comodidad visual
        if (spaceRight >= 56) {
          chosen = 'right';
        } else if (spaceLeft >= 56) {
          chosen = 'left';
        } else if (spaceBottom >= 52) {
          chosen = 'bottom';
        } else if (spaceTop >= 52) {
          chosen = 'top';
        } else {
          // Si la ventana está muy ajustada contra los bordes, pasa adentro del marco
          chosen = spaceRight >= spaceLeft ? 'inside-right' : 'inside-left';
        }
      }

      if (activeDockPos !== chosen) {
        activeDockPos = chosen;
        lens.dataset.dockPos = chosen;
        updatePopoversPosition();
      }
    }
    lens._evaluateSmartDock = evaluateSmartDock;

    // 1. Mover la lente (Drag Multi-Zona e Inteligente)
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
      e.stopPropagation();
    };

    // Vincular todos los tiradores de arrastre con [data-drag]
    root.querySelectorAll('[data-drag]').forEach((el) => {
      el.addEventListener('mousedown', onMouseDownDrag);
    });

    // Doble clic en la barra superior: centrar la lente perfectamente en pantalla
    topGrip?.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const curW = wrapper.offsetWidth || 540;
      const curH = wrapper.offsetHeight || 340;
      const centeredLeft = Math.max(10, Math.round((window.innerWidth - curW) / 2));
      const centeredTop = Math.max(10, Math.round((window.innerHeight - curH) / 2));
      wrapper.style.left = `${centeredLeft}px`;
      wrapper.style.top = `${centeredTop}px`;
      evaluateSmartDock();
      updateOverlayPositions();
      scheduleScan(120);
    });

    // Modo Arrastre Global con tecla Alt
    const onKeyDown = (e) => {
      if (e.key === 'Alt') {
        lens.classList.add('is-alt-dragging');
      }
    };
    const onKeyUp = (e) => {
      if (e.key === 'Alt') {
        lens.classList.remove('is-alt-dragging');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Si mantiene Alt presionado, hacer clic en cualquier parte del escenario arrastra la lente
    stage?.addEventListener('mousedown', (e) => {
      if (e.altKey && !e.target.closest('button') && !e.target.closest('input')) {
        onMouseDownDrag(e);
      }
    });

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
        const curW = wrapper.offsetWidth || 540;
        const curH = wrapper.offsetHeight || 340;
        const newLeft = Math.max(8, Math.min(window.innerWidth - curW - 8, startLeft + dx));
        const newTop = Math.max(8, Math.min(window.innerHeight - curH - 8, startTop + dy));
        wrapper.style.left = `${newLeft}px`;
        wrapper.style.top = `${newTop}px`;

        evaluateSmartDock();
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
        evaluateSmartDock();
        updateOverlayPositions();
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDragging || isResizing) {
        isDragging = false;
        isResizing = false;
        evaluateSmartDock();
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
      if (!opacityPop.hidden) updatePopoversPosition();
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
      if (!langMenu.hidden) updatePopoversPosition();
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

    // 5.1. Ciclar Posición de la Barra (Auto -> Costado Derecho -> Costado Izquierdo -> Dentro Cuadro Der -> Dentro Cuadro Izq -> Abajo -> Arriba)
    const DOCK_MODES = [
      { id: 'auto', label: 'Auto Inteligente' },
      { id: 'right', label: 'Costado Derecho' },
      { id: 'left', label: 'Costado Izquierdo' },
      { id: 'inside-right', label: 'Dentro del Cuadro (Der)' },
      { id: 'inside-left', label: 'Dentro del Cuadro (Izq)' },
      { id: 'bottom', label: 'Abajo Exterior' },
      { id: 'top', label: 'Arriba Exterior' }
    ];

    dockPosBtn?.addEventListener('click', () => {
      const curIdx = Math.max(0, DOCK_MODES.findIndex((m) => m.id === preferredDockPos));
      const nextIdx = (curIdx + 1) % DOCK_MODES.length;
      preferredDockPos = DOCK_MODES[nextIdx].id;
      dockPosBtn.setAttribute('data-tip', `Posición: ${DOCK_MODES[nextIdx].label}`);
      browser.storage?.local?.set({ preferredDockPos });
      evaluateSmartDock();
    });

    // 5.2. Minimizar / Expandir Barra Lateral (Click botón o Doble clic en grip)
    const toggleDockCollapse = () => {
      isDockCollapsed = !isDockCollapsed;
      lens.dataset.dockCollapsed = isDockCollapsed ? 'true' : 'false';
      if (dockCollapseBtn) {
        dockCollapseBtn.innerHTML = isDockCollapsed ? ICONS.expand : ICONS.collapse;
        dockCollapseBtn.title = isDockCollapsed ? 'Expandir barra' : 'Minimizar barra';
        dockCollapseBtn.setAttribute('data-tip', isDockCollapsed ? 'Expandir barra' : 'Minimizar barra');
      }
      evaluateSmartDock();
    };

    dockCollapseBtn?.addEventListener('click', toggleDockCollapse);
    brand?.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleDockCollapse();
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
      evaluateSmartDock();
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
