# 06 — Deployment Guide: Packaging & Installing OfficeFiles as a VS Code Extension

This guide covers building, packaging (`.vsix`), and deploying the `vscode-officefiles`
extension for every audience: **local development**, **team distribution**, **marketplace
release**, and **air-gapped / enterprise** environments. All commands are run from the
project root:

```bash
cd vscode-officefiles
```

---

## 0. Prerequisites

| Requirement | Version | Why |
|---|---|---|
| Node.js | ≥ 20 LTS | esbuild/vite toolchain, `out/mcp-standalone.js` runtime |
| npm | ≥ 10 | lockfile v3 |
| VS Code | ≥ 1.94 (`engines.vscode`) | CustomTextEditorProvider + LanguageModelTools API |
| `@vscode/vsce` | latest | Packaging/publishing CLI |

```bash
npm install                # installs devDeps + deps (jszip, pdfjs, etc.)
npm install -g @vscode/vsce
```

### The three build artifacts you will deploy

| Artifact | Built by | Purpose |
|---|---|---|
| `out/extension.js` | `node esbuild.mjs` | Extension host bundle (providers, IPC bridge, agent surface) |
| `out/mcp-standalone.js` | `node esbuild.mjs` | Headless stdio MCP server (no VS Code needed) — deploy to any MCP client |
| `out/mcp-ipc-proxy.js` | `node esbuild.mjs` | Stdio MCP server that forwards into a **live** VS Code window via the IPC socket |
| `dist/webview/` | `npx vite build` | React webview assets (grid editor, markdown editor, viewers) loaded by providers |

Full production build:

```bash
npm run compile            # tsc --noEmit (type gate)
npm test                   # vitest round-trip/codec tests
npm run build              # esbuild host+mcp bundles && vite webview bundle
```

> **Gate rule:** never package unless `compile`, `test`, and `build` all pass. Add them as
> a pre-publish CI job (see §5).

---

## 1. Local Development Install (fastest loop)

### Option A — Extension Development Host (F5)
1. Open `/workspace/vscode-officefiles` in VS Code.
2. Create `.vscode/launch.json` if missing:
   ```jsonc
   {
     "version": "0.2.0",
     "configurations": [
       {
         "name": "Run Extension",
         "type": "extensionHost",
         "request": "launch",
         "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
         "outFiles": ["${workspaceFolder}/out/**/*.js"],
         "preLaunchTask": "npm: build"
       }
     ]
   }
   ```
3. `F5` → new window opens with the extension loaded side-loaded (not installed).
4. Smoke-test: open a `.csv` → right-click → *Open With…* → **OfficeFiles Grid Editor**.

### Option B — Install your own build permanently
```bash
npm run build
npx vsce package --allow-missing-repository        # produces officefiles-0.0.1.vsix
code --install-extension ./officefiles-0.0.1.vsix --force
code --list-extensions | grep officefiles          # verify
```
`--force` overwrites the previous version; restart the window (`Developer: Reload Window`).

---

## 2. Packaging a `.vsix` for Distribution

### 2.1 What goes into the package
`vsce` includes everything **not** matched by `.vsixmanifest` ignores. Ensure:

- ✅ `out/**` (host + mcp bundles), `dist/webview/**`, `package.json`, `README.md`, `LICENSE`, `fixtures/` (optional)
- ❌ `src/**` is fine to include (source maps optional); `node_modules` is bundled into `out/` by esbuild — add an ignore so raw `node_modules` isn't shipped:

Create `.vscodeignore`:
```
src/**
test/**
fixtures/**
node_modules/**
*.map
.eslintrc*
tsconfig.json
vite.config.ts
vitest.config.ts
esbuild.mjs
.vscode/**
```

> ⚠️ If you keep `"dependencies"` (runtime-only libs not bundled by esbuild, e.g. native
> modules), vsce packs them automatically. Our esbuild config marks `vscode` external and
> bundles everything else, so pure-JS deps need no `node_modules` at runtime.

### 2.2 Package
```bash
npx vsce package --out dist-release/
# → dist-release/officefiles-0.0.1.vsix
```

### 2.3 Validate before shipping
```bash
unzip -l dist-release/officefiles-0.0.1.vsix | head -30   # eyeball contents
# Install on a clean machine/VM:
code --install-extension ./dist-release/officefiles-0.0.1.vsix
```

### 2.4 Versioning discipline
- Bump `version` in `package.json` per release (semver). vsce refuses duplicate versions.
- Tag in git after each release: `git tag v0.0.1 && git push --tags`.

---

## 3. Team / Enterprise Distribution (no marketplace)

### 3.1 Shared file drop / internal web server
Distribute the `.vsix` via network share or internal HTTPS server, then team members run:
```bash
code --install-extension "\\\\fileserver\\tools\\officefiles-0.0.1.vsix"
```

Pin updates with a small script (`update-officefiles.sh`):
```bash
#!/usr/bin/env bash
set -euo pipefail
LATEST=$(curl -fsSL https://intranet.example.com/officefiles/latest.txt)  # contains "0.0.2"
code --install-extension "https://intranet.example.com/officefiles/officefiles-${LATEST}.vsix" --force
```

### 3.2 Managed deployment (VS Code for the Web / codespaces / devcontainers)
Add to `.devcontainer/devcontainer.json`:
```jsonc
{
  "customizations": {
    "vscode": {
      "extensions": ["officefiles.officefiles"]   // once published, OR
    }
  },
  "postCreateCommand": "wget -q https://intranet/officefiles.vsix && code --install-extension ./officefiles.vsix"
}
```

### 3.3 Locking agent permissions org-wide
Ship workspace settings so agents can read but not write without review:
```jsonc
// .vscode/settings.json committed to repos
{
  "officefiles.agent.allowWrite": false,   // writes rejected until user flips it
  "officefiles.agent.ipcBridge": false     // disable external live-edit socket
}
```

---

## 4. Marketplace Publication

1. Register publisher once:
   ```bash
   npx vsce publish --publisher-name <YourPublisher> \
     --display-name "Your Name" --description "..."
   # browser opens azure auth → creates PAT automatically
   ```
2. Or reuse an Azure DevOps PAT:
   ```bash
   npx vsce publish -p <PAT>
   ```
3. Requirements checklist (marketplace validation):
   - `publisher` field ≠ placeholder (`officefiles` here → change to your verified publisher)
   - `icon` (128×128 PNG) referenced in `package.json` + present in repo
   - `repository` field set (add `"repository": { "type": "git", "url": "..." }`)
   - No `--allow-missing-repository` for real publishes
4. After publish, users install by ID: `officefiles.officefiles` (or your publisher).
5. Re-publish on every version bump; same pipeline as §2 minus local install.

Open VSX (VSCodium/Cursor users) — bonus reach:
```bash
npx ovsx publish ./dist-release/officefiles-0.0.1.vsix -p <OVSX_TOKEN>
```

---

## 5. CI/CD Release Pipeline (GitHub Actions example)

`.github/workflows/release.yml`:
```yaml
name: release
on:
  push:
    tags: ["v*"]
jobs:
  build-package-publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run compile
      - run: npm test
      - run: npm run build
      - run: npx vsce package --out dist-release/
      - name: Publish to Marketplace
        run: npx vsce publish --pat ${{ secrets.VSCE_PAT }} --packagePath dist-release/*.vsix
      - uses: softprops/action-gh-release@v2
        with:
          files: dist-release/*.vsix   # also attach vsix to GitHub Release for teams
```
Store `VSCE_PAT` (+ optional `OVSX_TOKEN`) as repo secrets. PR CI should run
`compile + test + build` without publishing.

---

## 6. Upgrading & Uninstalling

| Task | Command |
|---|---|
| Upgrade (sideloaded vsix) | `code --install-extension new.vsix --force` + reload window |
| Check installed version | `code --list-extensions --show-versions \| grep officefiles` |
| Disable temporarily | Extensions view → gear → Disable, or `"officefiles.enable": false` style setting |
| Uninstall | `code --uninstall-extension officefiles.officefiles` |
| Clean state | remove `%APPDATA%/Code/User/globalStorage/officefiles.officefiles` (win) / `~/.config/Code/User/globalStorage/...` |

**Migration note:** the IR edit-op schema is versioned in `src/core/ir.ts`; breaking schema
changes require a major version bump and a note in CHANGELOG so external MCP clients pinned
to old tool shapes get clear errors from `office_capabilities`.

---

## 7. Troubleshooting Deployment

| Symptom | Fix |
|---|---|
| “Cannot find module ‘./out/extension.js’” | You packaged without running `node esbuild.mjs` first — build then re-package |
| Webview blank/white | `dist/webview/index.html` missing from vsix → check `.vscodeignore` didn’t exclude `dist/**` |
| Agents can’t connect | Verify `officefiles.agent.ipcBridge=true` and that `out/mcp-ipc-proxy.js` path in client config points at the **installed** extension folder (`~/.vscode/extensions/officefiles.officefiles-*/out/mcp-ipc-proxy.js`) |
| macOS quarantine block | `xattr -d com.apple.quarantine officefiles-*.vsix` (downloaded vsix) |
| Corporate proxy blocks marketplace | Use §3 file-drop flow instead |
| Old version persists | Two installs (user + system VS Code) — check both `code` binaries with `which -a code` |

Next doc: **`07-agent-connection-guide.md`** — how Claude Desktop / Cursor / Zed / in-VS-Code Copilot Chat connect to the deployed extension.
