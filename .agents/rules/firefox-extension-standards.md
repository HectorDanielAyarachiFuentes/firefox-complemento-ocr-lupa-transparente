# Estándares para el Complemento Firefox — Lupa OCR Transparente en Tiempo Real

## 1. Arquitectura de la Extensión
- **Manifest:** Manifest V3 / V2 compatible con Firefox (Gecko).
- **Content Scripts (`src/content/`):**
  - Inyección del marco flotante `.lens` con estructura aislada (o Shadow DOM si es necesario para evitar colisión de estilos con las páginas visitadas).
  - Comportamiento de transparencia interactiva: `pointer-events: none` en la ventana visual principal para que los clics y el scroll alcancen la web que está debajo; `pointer-events: auto` en la barra de controles (`.bar`), popovers y tiradores de redimensionamiento.
  - Sincronización de coordenadas de la lupa con el viewport de la página.
- **Background / Service Worker (`src/background/`):**
  - Captura de pantalla del área visible (`browser.tabs.captureVisibleTab`) recortada a las coordenadas relativas de la lupa.
  - Orquestación del pipeline de OCR y traducción en lotes.
  - Almacenamiento de preferencias del usuario (`browser.storage.local`).
- **Motor OCR (`src/ocr/`):**
  - Integración de Tesseract.js compilado en WebAssembly (.wasm) y empaquetado de modelos de idiomas (`tessdata`).
  - Cumplimiento de la Content Security Policy (CSP) de Mozilla Add-ons (sin llamadas `eval()`, sin scripts remotos).
- **Motor de Traducción (`src/translate/`):**
  - Detección y traducción por lotes con caché LRU para evitar peticiones redundantes.
  - Respaldo automático entre proveedores.

## 2. Directiva de Diseño Visual (Frontend Embellecedor)
- Todo el HUD de la lupa, popovers de idiomas, ajustes y vistas previas deben usar los tokens y componentes de `Fronted embellecedor/`:
  - `ui-pro-max`: Paleta Obsidian (`#050508`), bordes cinéticos y glassmorphism.
  - `impecable`: Espaciado 4pt/8pt, estados interactivos de botones y controles.
  - `skill-ul`: Listas de idiomas y ajustes, barras shimmer y micro-estados visuales.
