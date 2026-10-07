<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **firefox-complemento-ocr-lupa-transparente** (830 symbols, 2654 relationships, 71 execution flows).

> Index stale? Run `npx gitnexus analyze` from the project root.

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or CLI; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or CLI fallback. For regression review: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn on HIGH/CRITICAL `risk` pre-edit; never ignore warnings.**
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** Confirm with a text search before treating the symbol as safe to change or delete.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius.** Graph first; text search only for empty/`UNKNOWN`/literals.

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
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
