/**
 * Background Service / Event Script para Firefox WebExtension
 * Lupa OCR Transparente en Tiempo Real
 */

browser.runtime.onInstalled.addListener(() => {
  console.log('[Lupa OCR] Extensión instalada con éxito.');
});

// Manejo de atajos de teclado declarados en manifest.json
browser.commands.onCommand.addListener(async (command) => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  browser.tabs.sendMessage(tab.id, { action: 'COMMAND', command }).catch((err) => {
    console.warn('[Lupa OCR] Pestaña no lista para recibir mensajes:', err.message);
  });
});

// Enrutador de mensajes entre content-script, popup y background
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'CAPTURE_VISIBLE_TAB') {
    browser.tabs.captureVisibleTab(null, { format: 'png' })
      .then((dataUrl) => sendResponse({ success: true, dataUrl }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Asíncrono
  }
});
