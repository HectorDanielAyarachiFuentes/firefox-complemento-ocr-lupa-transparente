/**
 * Background Service / Event Script para Firefox WebExtension
 * Lupa OCR Transparente en Tiempo Real
 * Motor de Traducción con Detección Automática, Caché y Orquestador de OCR
 */

const translationCache = new Map();
const MAX_CACHE_SIZE = 3000;

function getCacheKey(text, from, to) {
  return `${from}->${to}::${text.trim()}`;
}

async function translateBatchGoogle(texts, from = 'auto', to = 'es') {
  const uncachedIndices = [];
  const uncachedTexts = [];
  const results = new Array(texts.length);
  let detectedLang = null;

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
    return { translations: results, detectedLang };
  }

  try {
    // 1. Endpoint por lotes (Google Translate dict-chrome-ex)
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
          let transText = uncachedTexts[idx];
          if (Array.isArray(item)) {
            transText = String(item[0] ?? uncachedTexts[idx]);
            if (item[1] && !detectedLang) detectedLang = String(item[1]).toLowerCase();
          } else {
            transText = String(item ?? uncachedTexts[idx]);
          }

          const origIdx = uncachedIndices[idx];
          results[origIdx] = transText;

          // Guardar en caché LRU
          const key = getCacheKey(uncachedTexts[idx], from, to);
          if (translationCache.size >= MAX_CACHE_SIZE) {
            const firstKey = translationCache.keys().next().value;
            translationCache.delete(firstKey);
          }
          translationCache.set(key, transText);
        });

        return { translations: results, detectedLang };
      }
    }
  } catch (err) {
    console.warn('[Lupa Background] Falló google-batch, usando respaldo GTX:', err.message);
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
          if (j[2] && !detectedLang) detectedLang = String(j[2]).toLowerCase();
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

  return { translations: results, detectedLang };
}

browser.runtime.onInstalled.addListener(() => {
  console.log('[Lupa OCR] Extensión inicializada en Mozilla Firefox.');
});

// ---- Motor OCR local (Tesseract.js empaquetado en lib/) ----
let ocrWorkerPromise = null;
let ocrIdleTimer = null;
const OCR_IDLE_MS = 120000; // liberar memoria tras 2 min sin uso

function getOcrWorker() {
  if (!ocrWorkerPromise) {
    const T = globalThis.Tesseract;
    if (!T) return Promise.reject(new Error('Tesseract.js no está cargado desde lib/.'));
    ocrWorkerPromise = T.createWorker(['spa', 'eng'], 1, {
      workerPath: browser.runtime.getURL('lib/worker.min.js'),
      corePath: browser.runtime.getURL('lib/'),
      langPath: browser.runtime.getURL('lib/langdata'),
      workerBlobURL: false,
      gzip: false,
      cacheMethod: 'none'
    }).then(async (worker) => {
      try {
        await worker.setParameters({
          preserve_interword_spaces: '1'
        });
      } catch (e) {
        console.warn('[Lupa Background] Advertencia al configurar parámetros de Tesseract:', e);
      }
      return worker;
    }).catch((err) => {
      console.error('[Lupa Background] Error iniciando Tesseract OCR:', err);
      ocrWorkerPromise = null;
      throw err;
    });
  }
  return ocrWorkerPromise;
}

function scheduleOcrRelease() {
  if (ocrIdleTimer) clearTimeout(ocrIdleTimer);
  ocrIdleTimer = setTimeout(async () => {
    const p = ocrWorkerPromise;
    ocrWorkerPromise = null;
    try { (await p)?.terminate(); } catch (_) { /* ignorar */ }
  }, OCR_IDLE_MS);
}

function extractLines(data) {
  const lines = [];
  (data?.blocks || []).forEach((b) =>
    (b.paragraphs || []).forEach((p) =>
      (p.lines || []).forEach((l) => {
        const text = (l.text || '').replace(/\s+/g, ' ').trim();
        // Contar caracteres alfanuméricos reales
        const alnum = (text.match(/[\p{L}\p{N}]/gu) || []).length;
        // Contar caracteres extraños/ruido gráfico
        const junk = (text.match(/[^\p{L}\p{N}\s.,:;¿?¡!'"\-()]/gu) || []).length;
        // Filtrar ruido de fondos o ropa (exige al menos 2 letras/números y <40% de símbolos raros)
        if (alnum >= 2 && l.confidence > 28 && (junk / Math.max(1, text.length)) < 0.45) {
          lines.push({ text, bbox: l.bbox, confidence: l.confidence });
        }
      })
    )
  );
  return lines;
}

function overlapRatio(a, b) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const areaMin = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0)) || 1;
  return inter / areaMin;
}

/**
 * Reconoce una o varias variantes de la misma imagen (color original + contrastes)
 * y fusiona las líneas: si dos se solapan, gana la de mayor confianza.
 */
async function recognizeImage(dataUrls) {
  const list = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const worker = await getOcrWorker();
  try {
    const merged = [];
    for (const url of list.filter(Boolean)) {
      const { data } = await worker.recognize(url, {}, { blocks: true });
      for (const line of extractLines(data)) {
        const idx = merged.findIndex((m) => overlapRatio(m.bbox, line.bbox) > 0.45);
        if (idx === -1) {
          merged.push(line);
        } else if (line.confidence > merged[idx].confidence + 5) {
          merged[idx] = line;
        }
      }
    }
    merged.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    return merged.map(({ text, bbox }) => ({ text, bbox }));
  } finally {
    scheduleOcrRelease();
  }
}

// Manejo de atajos de teclado globales
browser.commands.onCommand.addListener(async (command) => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  browser.tabs.sendMessage(tab.id, { action: 'COMMAND', command }).catch((err) => {
    console.warn('[Lupa OCR] Error enviando comando a la pestaña:', err.message);
  });
});

// Enrutador de mensajería
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'TRANSLATE_TEXTS') {
    translateBatchGoogle(message.texts, message.from || 'auto', message.to || 'es')
      .then((res) => sendResponse({ success: true, translations: res.translations, detectedLang: res.detectedLang }))
      .catch((err) => sendResponse({ success: false, error: err.message, translations: message.texts, detectedLang: null }));
    return true; // Asíncrono
  }

  if (message.action === 'CAPTURE_VISIBLE_TAB') {
    browser.tabs.captureVisibleTab(null, { format: 'png' })
      .then((dataUrl) => sendResponse({ success: true, dataUrl }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'OCR_IMAGE') {
    recognizeImage(message.dataUrls || message.dataUrl)
      .then((lines) => sendResponse({ success: true, lines }))
      .catch((err) => {
        console.error('[Lupa Background] Error OCR:', err);
        sendResponse({ success: false, error: String(err?.message || err), lines: [] });
      });
    return true;
  }
});
