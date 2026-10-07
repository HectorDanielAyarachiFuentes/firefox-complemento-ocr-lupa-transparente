/**
 * Popup Script para Lupa OCR Transparente
 */

document.getElementById('toggleBtn')?.addEventListener('click', async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    browser.tabs.sendMessage(tab.id, { action: 'COMMAND', command: 'toggle-lens' });
    window.close();
  }
});

document.getElementById('optionsBtn')?.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});
