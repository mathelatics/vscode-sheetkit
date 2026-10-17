# Third-Party Notices

OfficeTools vendors and adapts assets and code from the projects below. Full license texts
are available in each upstream repository.

## vscode-office (Office Viewer) — MIT

- Upstream: https://github.com/cweijan/vscode-office
- Copyright (c) 2020 Weijan Chen — MIT License
- Used in this project:
  - The pdf.js-based PDF viewer under `resource/pdf/**` and the viewer wiring in
    `src/provider/officeViewerProvider.ts`.
  - The Vditor-based Markdown editor/preview under `resource/markdown/**` and
    `src/provider/markdownEditorProvider.ts`.
  - Markdown helpers under `src/service/markdown/**` and `src/service/markdownService.ts`
    (wiki links, outline, export to PDF/DOCX/HTML, viewer settings).
  - The shared webview bridge `resource/lib/vscode.js`.

## pdf.js — Apache-2.0

- Upstream: https://github.com/mozilla/pdf.js
- The PDF viewer runtime under `resource/pdf/**` is a build of pdf.js (Apache-2.0).

## Vditor — MIT

- Upstream: https://github.com/Vanessa219/vditor
- The Markdown editor runtime under `resource/markdown/dist/**` is a build of Vditor (MIT).

## markdown-it and plugins — MIT

- Upstream: https://github.com/markdown-it/markdown-it
- Plugins: `markdown-it-anchor`, `markdown-it-checkbox`, `markdown-it-front-matter`,
  `markdown-it-mark`, `markdown-it-obsidian-callouts`, `markdown-it-plantuml`,
  `markdown-it-toc-done-right`.
- Used to render Markdown when exporting to PDF/DOCX/HTML.

## Other bundled libraries

- `mermaid` (MIT) — diagram rendering.
- `katex` (MIT) — math rendering.
- `highlight.js` (BSD-3-Clause) — code syntax highlighting.
- `pdf-lib` (MIT) — PDF outline/export post-processing.
- `node-html-parser` (MIT) — HTML parsing for export.
- `mustache` (MIT) — HTML template rendering.
- `puppeteer-core` (Apache-2.0) — headless Chromium PDF export.
- `vscode-html-to-docx` (MIT) — DOCX export.
- `file-type` (MIT), `chrome-finder` (MIT) — helper utilities.

All trademarks are property of their respective owners.
