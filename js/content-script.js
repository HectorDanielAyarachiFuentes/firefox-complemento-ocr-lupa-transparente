/**
 * Content Script para Firefox WebExtension
 * Lupa OCR Transparente — Inyección del overlay y click-through
 */

(() => {
  if (window.__LUPA_OCR_INJECTED__) return;
  window.__LUPA_OCR_INJECTED__ = true;

  console.log('[Lupa OCR] Content script cargado en la página.');

  // Escuchar mensajes del background o popup
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'COMMAND') {
      console.log('[Lupa OCR] Comando recibido:', message.command);
      if (message.command === 'toggle-lens') {
        // Toggle lens
      }
    }
  });
})();
