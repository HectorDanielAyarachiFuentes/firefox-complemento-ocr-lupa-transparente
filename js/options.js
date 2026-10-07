/**
 * Options Script para Lupa OCR Transparente
 */

const targetLang = document.getElementById('targetLang');
const defaultOpacity = document.getElementById('defaultOpacity');
const clickThrough = document.getElementById('clickThrough');

// Cargar configuración guardada
browser.storage.local.get(['targetLang', 'defaultOpacity', 'clickThrough']).then((cfg) => {
  if (cfg.targetLang && targetLang) targetLang.value = cfg.targetLang;
  if (cfg.defaultOpacity && defaultOpacity) defaultOpacity.value = cfg.defaultOpacity;
  if (cfg.clickThrough !== undefined && clickThrough) clickThrough.checked = cfg.clickThrough;
});

// Guardar al cambiar
targetLang?.addEventListener('change', () => {
  browser.storage.local.set({ targetLang: targetLang.value });
});

defaultOpacity?.addEventListener('input', () => {
  browser.storage.local.set({ defaultOpacity: defaultOpacity.value });
});

clickThrough?.addEventListener('change', () => {
  browser.storage.local.set({ clickThrough: clickThrough.checked });
});
