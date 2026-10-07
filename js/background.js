/**
 * Background Service / Event Script para Firefox WebExtension
 * Lupa OCR Transparente en Tiempo Real
 */

const translationCache = new Map();
const MAX_CACHE_SIZE = 2000;

function getCacheKey(text, from, to) {
  return `${from}->${to}::${text.trim()}`;
}

async function translateBatchGoogle(texts, from = 'auto', to = 'es') {
  const uncachedIndices = [];
  const uncachedTexts = [];
  const results = new Array(texts.length);

  for (let i = 0; i < texts.length; i++) {
    const key = getCacheKey(texts[i], from, to);
    if (translationCache.has(key)) {
      results[i] = translationCache.get(key);
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i]);
    }
  }

  if (uncachedTexts.length === 0) {
    return results;
  }

  try {
    // 1. Intento por lotes (Google Translate público)
    const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&ie=UTF-8&oe=UTF-8`;
    const body = uncachedTexts.map((t) => 'q=' + encodeURIComponent(t)).join('&');

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        data.forEach((item, idx) => {
          const transText = Array.isArray(item) ? String(item[0] ?? uncachedTexts[idx]) : String(item ?? uncachedTexts[idx]);
          const origIdx = uncachedIndices[idx];
          results[origIdx] = transText;

          // Guardar en caché
          const key = getCacheKey(uncachedTexts[idx], from, to);
          if (translationCache.size >= MAX_CACHE_SIZE) {
            const firstKey = translationCache.keys().next().value;
            translationCache.delete(firstKey);
          }
          translationCache.set(key, transText);
        });
        return results;
      }
    }
  } catch (err) {
    console.warn('[Lupa Background] Falló google-batch, reintentando con endpoint GTX:', err.message);
  }

  // 2. Respaldo individual GTX
  try {
    await Promise.all(
      uncachedTexts.map(async (text, idx) => {
        const origIdx = uncachedIndices[idx];
        const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
        const r = await fetch(gtxUrl);
        if (r.ok) {
          const j = await r.json();
          const translated = (j[0] || []).map((part) => part[0]).join('') || text;
          results[origIdx] = translated;
          translationCache.set(getCacheKey(text, from, to), translated);
        } else {
          results[origIdx] = text;
        }
      })
    );
  } catch (err2) {
    console.error('[Lupa Background] Error en traducción GTX:', err2.message);
    uncachedIndices.forEach((origIdx, idx) => {
      if (!results[origIdx]) results[origIdx] = uncachedTexts[idx];
    });
  }

  return results;
}

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

// Enrutador de mensajes
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'TRANSLATE_TEXTS') {
    translateBatchGoogle(message.texts, message.from || 'auto', message.to || 'es')
      .then((translations) => sendResponse({ success: true, translations }))
      .catch((err) => sendResponse({ success: false, error: err.message, translations: message.texts }));
    return true; // Asíncrono
  }

  if (message.action === 'CAPTURE_VISIBLE_TAB') {
    browser.tabs.captureVisibleTab(null, { format: 'png' })
      .then((dataUrl) => sendResponse({ success: true, dataUrl }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
