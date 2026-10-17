# OfficeTools — PDF & Markdown viewers

A focused fork of `vscode-officefiles` that keeps **only two formats** and drops the
agent/MCP machinery and every other viewer:

- **PDF** — a fast, read-only viewer (pdf.js) registered as the default editor for `*.pdf`.
- **Markdown** — a feature-rich WYSIWYG/IR Markdown editor and preview (Vditor), for
  `*.md` / `*.markdown`, including Mermaid, KaTeX, code highlighting, wiki links,
  in-editor image paste, and export to PDF / DOCX / HTML.

## What is included

| Area | Details |
| --- | --- |
| PDF viewer | `resource/pdf/**` (pdf.js viewer build), `src/provider/officeViewerProvider.ts` |
| Markdown editor | `resource/markdown/**` (prebuilt Vditor editor), `src/provider/markdownEditorProvider.ts` |
| Markdown services | wiki links, linked-file open, outline, export (PDF/DOCX/HTML), viewer settings, telemetry |
| Configuration | `vscode-office.*` settings for the Markdown editor + Markdown PDF export |

## What was removed (vs `vscode-officefiles`)

Everything that is not PDF or Markdown:

- **Agent surface** — MCP server/standalone/IPC proxy, VS Code Language Model tools, the
  `DocumentOps`/IR layer, and the agent-editable grid editors.
- **Other formats** — CSV/TSV/XLSX, DOCX, PPTX, EPUB, SVG, images, PSD, XMind, Parquet,
  archives (zip/jar/7z/rar), fonts, ICNS, Java class decompiler, HTML preview.
- **Extras** — HTTP client, YAML/XML language support, Git history, icon theme/color theme,
  nginx/kotlin/reg/toml/kusto grammars and snippets.

## Build

```bash
npm install
npm run build          # bundles out/extension.js + out/extension.web.js, copies out/template, out/styles
npm run compile        # type-check only
npm run package        # produces officetools-<version>.vsix
```

Press `F5` (Run Extension) to launch a development host.

## Layout

```
src/extension.ts                 desktop entry (registers PDF + Markdown providers)
src/extension.web.ts             web extension entry
src/provider/officeViewerProvider.ts   PDF viewer
src/provider/markdownEditorProvider.ts Markdown editor/preview (Vditor)
src/service/markdown/**          wiki links, outline, export helpers
src/service/markdownService.ts   Markdown export (pdf/docx/html), clipboard image paste
resource/pdf/**                  pdf.js viewer runtime
resource/markdown/**             prebuilt Vditor editor runtime
resource/lib/vscode.js           shared webview bridge
```

## Credits

The PDF viewer and Markdown editor are vendored/adapted from the MIT-licensed
[cweijan/vscode-office](https://github.com/cweijan/vscode-office). See `THIRD_PARTY_NOTICES.md`.
