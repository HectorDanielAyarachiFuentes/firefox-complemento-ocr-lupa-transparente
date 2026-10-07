# Directivas del Agente y Reglas de Operación — Firefox WebExtension (Lupa OCR Transparente)

## 1. Identidad y Misión del Proyecto
Este repositorio alberga la **Extensión para Mozilla Firefox: Lupa OCR Transparente y Traductor en Tiempo Real**.
- **Objetivo:** Una lente flotante transparente inyectada en Firefox que realiza OCR sobre el texto subyacente y lo traduce o presenta en tiempo real con superposición exacta (overlay) o modo lectura.
- **Plataforma objetivo:** Extensión Web (WebExtension) para Mozilla Firefox (`manifest.json` MV3/MV2 compatible con Gecko).
- **Características clave:** Clics y scroll que atraviesan la lente (*click-through* via `pointer-events`), captura de viewport/canvas eficiente, OCR local (Tesseract.js / WASM empaquetado para cumplir CSP de extensiones), traducción en lotes con caché, barra de herramientas glassmorphism y slider de transparencia (5% a 100%).

---

## 2. Límites y Reglas de Seguridad (ECC Core)
- **Archivos protegidos:** Prohibido modificar o exponer `.env*`, `.git/`, tokens, credenciales y claves de firma de extensiones (`.pem`, `.xpi`).
- **Inmutabilidad de APIs:** No alterar contratos de mensajes entre `content_scripts`, `background` (service worker / event page) y `popup/options` sin pre-auditoría.
- **Operaciones terminal:** Prohibido ejecutar comandos destructivos (`rm -rf`, `git reset --hard`, `git push --force`).
- **Edición quirúrgica:** Modificaciones atómicas estrictamente en las líneas necesarias; no reescribir archivos enteros sin justificación.

---

## 3. Arquitectura y Restricciones de Firefox WebExtension
1. **Cumplimiento Estricto de CSP (Content Security Policy):**
   - En Firefox WebExtensions no se permite `eval()` ni scripts remotos no empaquetados.
   - Cualquier worker de OCR (ej. `tesseract.js`) debe cargar sus scripts de worker y archivos `.wasm` localmente desde los assets de la extensión (`web_accessible_resources` o empaquetado interno).
2. **Ciclo de Mensajería:**
   - Usar `browser.runtime.sendMessage` y `browser.tabs.sendMessage` con `async/await` nativo de Firefox (`browser.*` namespace con Promesas).
   - Manejar fallos de conexión cuando una pestaña no tiene inyectado el content script.
3. **Rendimiento en Tiempo Real:**
   - Las capturas continuas de pantalla y procesos OCR deben ser no bloqueantes y utilizar `requestAnimationFrame`, debouncing o throttled workers para evitar congelar el hilo principal del DOM del usuario.
   - Limpieza adecuada de recursos y overlays al cerrar la lente o cambiar de pestaña.

---

## 4. OmniRoute Strategy (Optimización de Modelos y Costos)
- **Modelo Ligero (Fast / Haiku / Flash):** Formateo, documentación JSDoc, linting, manifiestos, mensajes de localización i18n, commits y diffs rápidos.
- **Modelo Avanzado (Deep / Sonnet / Opus):** Algoritmos de superposición OCR/layout de texto, shaders/canvas performance, gestión de ciclo de vida en Firefox WebExtension y auditoría de seguridad.

---

## 5. Protocolo de Auditoría con GitNexus (Obligatorio)
Antes de proponer o aplicar cualquier cambio de código en este repositorio:
1. **Pre-Auditoría:** Invocar `impact({target: "symbolName", direction: "upstream"})` o `context({name: "symbolName"})` para mapear el radio de impacto (*blast radius*) de las funciones a modificar.
2. **Reporte:** Informar al usuario los archivos dependientes y el nivel de riesgo (Bajo / Medio / Alto).
3. **Ejecución:** Aplicar los cambios autorizados mediante edición atómica.
4. **Post-Auditoría:** Ejecutar `detect_changes({scope: "all"})` para certificar que no se introdujeron regresiones.

---

## 6. Directiva Frontend Embellecedor (Excelencia Visual Obligatoria)
Toda interfaz generada para la extensión (Overlay flotante, Barra de herramientas, Popups, Páginas de opciones y Sidebars) debe implementar la suite en `Fronted embellecedor/`:
- **Estructura y Contenedores (ui-pro-max):** Fondos oscuros profundos (Obsidian `#050508`), bordes cinéticos luminosos (`.pro-beam-card`), tarjetas spotlight con seguimiento de cursor (`.pro-spotlight-card`) y headers glassmorphism translúcidos (`.pro-header-glass`).
- **Acabado, Espaciado y Botones (impecable):** Grilla geométrica 4pt/8pt (`--imp-space-*`), tipografía con clamp fluido, contraste WCAG AAA/AA verificado y micro-estados en botones e inputs (`.imp-btn`, `.imp-input`, tooltips).
- **Indicadores y Métricas (skill-ul):** Chips de idioma estilizados, badges interactivos con brillo (`.skill-badge-shine`), puntos de estado con pulso de luz (verde = lista, azul = traduciendo, ámbar = pausa, rojo = error) y barras de progreso con animación shimmer (`.skill-bar-fill`).
- **Prohibido el diseño tosco:** No usar colores planos genéricos, bordes duros sin refinar ni controles sin micro-animaciones.

---

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **firefox-complemento-ocr-lupa-transparente** (830 symbols, 2654 relationships, 71 execution flows).

> Index stale? Run `npx gitnexus analyze` from the project root.

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or CLI; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or CLI fallback. For regression review: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn on HIGH/CRITICAL `risk` pre-edit.** Never proceed without user confirmation on high-risk modifications.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** Confirm with text search before modifying or deleting.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius.** Graph first.

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/firefox-complemento-ocr-lupa-transparente/context` | Codebase overview, check index freshness |
| `gitnexus://repo/firefox-complemento-ocr-lupa-transparente/clusters` | All functional areas |
| `gitnexus://repo/firefox-complemento-ocr-lupa-transparente/processes` | All execution flows |
| `gitnexus://repo/firefox-complemento-ocr-lupa-transparente/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.agents/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.agents/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.agents/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.agents/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.agents/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.agents/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
