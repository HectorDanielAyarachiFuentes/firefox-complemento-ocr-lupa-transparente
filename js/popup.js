/**
 * Popup Script para Lupa OCR Transparente
 * Control de estado en vivo de la lente flotante
 */

const statusBadge = document.getElementById('statusBadge');
const statusDot = document.getElementById('statusDot');
const statusLabel = document.getElementById('statusLabel');
const toggleBtn = document.getElementById('toggleBtn');
const noticeMsg = document.getElementById('noticeMsg');
const optionsBtn = document.getElementById('optionsBtn');

function setStatus(active) {
  if (active) {
    statusBadge.className = 'pro-badge glow-emerald';
    statusDot.style.background = '#10b981';
    statusDot.style.boxShadow = '0 0 10px #10b981';
    statusLabel.textContent = 'ACTIVA';
    statusLabel.style.color = '#34d399';
    toggleBtn.textContent = 'Desactivar Lupa en Pestaña Actual';
    toggleBtn.className = 'imp-btn btn-action';
    toggleBtn.style.background = 'rgba(239, 68, 68, 0.2)';
    toggleBtn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    toggleBtn.style.color = '#fca5a5';
  } else {
    statusBadge.className = 'pro-badge glow-cyan';
    statusDot.style.background = '';
    statusDot.style.boxShadow = '';
    statusLabel.textContent = 'INACTIVA';
    statusLabel.style.color = '';
    toggleBtn.textContent = 'Activar Lupa en Pestaña Actual';
    toggleBtn.className = 'imp-btn imp-btn-primary btn-action';
    toggleBtn.style.background = '';
    toggleBtn.style.borderColor = '';
    toggleBtn.style.color = '';
  }
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Consultar estado actual al abrir el popup
async function checkStatus() {
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;

    // Verificar si es una página restringida (about:debugging, about:config, etc.)
    if (tab.url?.startsWith('about:') || tab.url?.startsWith('moz-extension:')) {
      if (noticeMsg) {
        noticeMsg.textContent = 'Nota: Firefox restringe extensiones en páginas del sistema (about:). Abre una web normal (ej. wikipedia.org).';
        noticeMsg.hidden = false;
      }
      return;
    }

    const response = await browser.tabs.sendMessage(tab.id, { action: 'GET_STATUS' }).catch(() => null);
    if (response) {
      setStatus(response.active);
    }
  } catch (err) {
    console.warn('[Lupa Popup] Error consultando estado:', err);
  }
}

// Alternar estado al hacer clic
toggleBtn?.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;

    if (tab.url?.startsWith('about:') || tab.url?.startsWith('moz-extension:')) {
      alert('Las extensiones de Firefox no pueden inyectarse en páginas internas "about:". Por favor abre cualquier página web normal (ej. wikipedia.org o google.com).');
      return;
    }

    // Intentar enviar mensaje al content script
    let res = await browser.tabs.sendMessage(tab.id, { action: 'TOGGLE_LENS' }).catch(() => null);

    // Si la pestaña no tenía el script inyectado aún (abierta antes de instalar la extensión)
    if (!res) {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['js/content-script.js']
      }).catch(console.error);

      // Reintentar tras inyectar
      res = await browser.tabs.sendMessage(tab.id, { action: 'TOGGLE_LENS' }).catch(() => null);
    }

    if (res && res.active !== undefined) {
      setStatus(res.active);
    } else {
      setStatus(true);
    }

    // Cerrar el popup tras activar para que el usuario use la lupa directamente
    setTimeout(() => window.close(), 250);
  } catch (err) {
    console.error('[Lupa Popup] Error alternando lente:', err);
  }
});

optionsBtn?.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

checkStatus();
