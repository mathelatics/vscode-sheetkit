"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode6 = __toESM(require("vscode"));

// src/host/providers/csvProvider.ts
var vscode3 = __toESM(require("vscode"));

// src/host/bus.ts
var vscode = __toESM(require("vscode"));
var DocBus = class _DocBus {
  constructor(target) {
    this.target = target;
    this.disposables.push(target.onDidReceiveMessage((m) => this.receive(m)));
  }
  listeners = /* @__PURE__ */ new Map();
  // MULTI-subscriber (deviation: theirs replaces)
  pending = /* @__PURE__ */ new Map();
  seq = 0;
  closed = false;
  disposables = [];
  static attach(panel) {
    const bus = new _DocBus(panel.webview);
    bus.disposables.push(panel.onDidDispose(() => bus.dispose()));
    return bus;
  }
  on(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, /* @__PURE__ */ new Set());
    this.listeners.get(type).add(cb);
    return new vscode.Disposable(() => this.listeners.get(type)?.delete(cb));
  }
  emit(type, payload) {
    if (this.closed) return;
    this.target.postMessage({ v: 1, type, payload });
  }
  /** Fire-and-track errors: host->webview request awaiting 'result:<type>' with same id. */
  request(type, payload, timeoutMs = 5e3) {
    const id = `h${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`bus timeout: ${type}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.emit(type, payload);
      const ok = this.on(`${type}:result`, (p) => {
        if (p?.id === id) {
          clearTimeout(this.pending.get(id)?.timer);
          this.pending.get(id)?.resolve(p.value);
        }
      });
      const err = this.on(`${type}:error`, (p) => {
        if (p?.id === id) {
          clearTimeout(this.pending.get(id)?.timer);
          this.pending.get(id)?.reject(new Error(p.error));
        }
      });
      this.disposables.push(ok, err);
    });
  }
  async receive(msg) {
    if (!msg || msg.v !== 1) return;
    for (const cb of [...this.listeners.get(msg.type) ?? []]) {
      try {
        await cb(msg.payload, msg);
      } catch (e) {
        if (msg.id) this.emit("bus:error", { id: msg.id, error: String(e?.message ?? e) });
        console.error("[officefiles bus]", msg.type, e);
      }
    }
  }
  dispose() {
    this.closed = true;
    this.listeners.clear();
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.disposables.forEach((d) => d.dispose());
  }
};

// src/host/ops/documentOps.ts
var vscode2 = __toESM(require("vscode"));

// src/core/ir.ts
function isTableDoc(ir) {
  return ir.kind === "table";
}
function isTextDoc(ir) {
  return ir.kind === "document";
}
function applyOps(ir, ops2) {
  for (const o of ops2) {
    if (isTableDoc(ir)) applyTableOp(ir, o);
    else applyDocOp(ir, o);
  }
  return ir;
}
function findSheet(doc, o) {
  const name = o.sheet;
  const s = doc.sheets.find((s2) => s2.name === name) ?? doc.sheets[0];
  if (!s) throw new Error("no sheet");
  return s;
}
function applyTableOp(doc, o) {
  switch (o.op) {
    case "setCell": {
      const s = findSheet(doc, o);
      while (s.rows.length <= o.row) s.rows.push([]);
      const row = s.rows[o.row];
      while (row.length <= o.col) row.push(null);
      row[o.col] = o.value;
      break;
    }
    case "insertRow": {
      const s = findSheet(doc, o);
      s.rows.splice(o.row, 0, o.values ? [...o.values] : []);
      break;
    }
    case "deleteRow": {
      const s = findSheet(doc, o);
      if (o.row < 0 || o.row >= s.rows.length) throw new Error(`row ${o.row} out of range`);
      s.rows.splice(o.row, 1);
      break;
    }
    case "insertColumn": {
      const s = findSheet(doc, o);
      s.rows.forEach((r, i) => r.splice(o.col, 0, i === 0 && o.header ? o.header : o.values?.[i] ?? null));
      break;
    }
    case "replaceText": {
      const re = o.regex ? new RegExp(o.search, o.all !== false ? "g" : "") : null;
      doc.sheets.forEach((s) => s.rows.forEach((r) => r.forEach((v, i) => {
        if (typeof v === "string") r[i] = re ? v.replace(re, o.replacement) : v.split(o.search).join(o.replacement);
      })));
      break;
    }
    default:
      break;
  }
}
function applyDocOp(doc, o) {
  switch (o.op) {
    case "appendBlock":
      doc.blocks.push(o.block);
      break;
    case "replaceBlock":
      if (o.index < 0 || o.index >= doc.blocks.length) throw new Error(`block ${o.index} out of range`);
      doc.blocks[o.index] = o.block;
      break;
    case "deleteBlock":
      if (o.index < 0 || o.index >= doc.blocks.length) throw new Error(`block ${o.index} out of range`);
      doc.blocks.splice(o.index, 1);
      break;
    case "replaceText": {
      const re = o.regex ? new RegExp(o.search, o.all !== false ? "g" : "") : null;
      doc.blocks.forEach((b) => {
        b.text = re ? b.text.replace(re, o.replacement) : b.text.split(o.search).join(o.replacement);
        b.items = b.items?.map((it) => re ? it.replace(re, o.replacement) : it.split(o.search).join(o.replacement));
      });
      break;
    }
    default:
      break;
  }
}

// src/core/codecs/csv.ts
function detectDelimiter(text) {
  const line = text.split(/\r?\n/, 5).find((l) => l.length) ?? "";
  const counts = { ",": 0, "	": 0, ";": 0 };
  for (const ch of line) if (ch in counts) counts[ch]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ",";
}
function parseCsv(text, opts = {}) {
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const pushField = () => {
    row.push(coerce(field));
    field = "";
  };
  const pushRow = () => {
    if (row.length || field) {
      pushField();
      rows.push(row);
      row = [];
    } else rows.length && rows.push(row);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) pushField();
    else if (c === "\n") pushRow();
    else if (c === "\r") {
    } else field += c;
  }
  if (field !== "" || row.length) pushRow();
  const sheet = { name: opts.sheetName ?? "Sheet1", rows };
  return { kind: "table", sheets: [sheet], meta: { delimiter, eol: text.includes("\r\n") ? "\r\n" : "\n", trailingNewline: /\r?\n$/.test(text) } };
}
function coerce(f) {
  if (f === "") return null;
  if (/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(f)) return Number(f);
  if (f.toLowerCase() === "true") return true;
  if (f.toLowerCase() === "false") return false;
  return f;
}
function serializeCsv(doc, opts = {}) {
  const delimiter = opts.delimiter ?? doc.meta?.delimiter ?? ",";
  const eol = doc.meta?.eol ?? "\n";
  const sheet = doc.sheets[0];
  if (!sheet) return "";
  const body = sheet.rows.map((r) => r.map((v) => renderField(v, delimiter)).join(delimiter)).join(eol);
  return body + (doc.meta?.trailingNewline ?? true ? eol : "");
}
function renderField(v, delimiter) {
  if (v === null || v === void 0) return "";
  const s = String(v);
  if (s.includes(delimiter) || /["\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// src/core/codecs/markdown.ts
function parseMarkdown(text) {
  const blocks = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", text: body.join("\n"), lang });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: "heading", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items = [];
      let ordered = false;
      let bullet = "-";
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const m = /^\s*(?:([-*+])|(\d+\.))\s+/.exec(lines[i]);
        if (m[2]) ordered = true;
        else bullet = m[1];
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", text: "", items, ordered, bullet });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i].replace(/^>\s?/, "")), i++;
      blocks.push({ type: "quote", text: q.join(" ") });
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const p = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s)/.test(lines[i])) p.push(lines[i++]);
    blocks.push({ type: "paragraph", text: p.join("\n") });
  }
  return { kind: "document", blocks };
}
function serializeMarkdown(doc) {
  return doc.blocks.map((b) => renderBlock(b)).join("\n\n") + "\n";
}
function renderBlock(b) {
  switch (b.type) {
    case "heading":
      return "#".repeat(Math.min(b.level ?? 1, 6)) + " " + b.text;
    case "code":
      return "```" + (b.lang ?? "") + "\n" + b.text + "\n```";
    case "list":
      return (b.items ?? []).map((it, idx) => `${b.ordered ? `${idx + 1}.` : b.bullet ?? "-"} ${it}`).join("\n") || b.text;
    case "quote":
      return "> " + b.text;
    case "image":
      return b.text;
    // already markdown syntax
    default:
      return b.text;
  }
}

// src/host/ops/documentOps.ts
var Registry = class {
  docs = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  add(doc) {
    this.docs.set(doc.id, doc);
    this.fire(doc, "open");
  }
  remove(id) {
    const d = this.docs.get(id);
    if (d) {
      this.docs.delete(id);
      this.fire(d, "close");
    }
  }
  get(idOrUri) {
    if (this.docs.has(idOrUri)) return this.docs.get(idOrUri);
    const u = vscode2.Uri.parse(idOrUri).toString();
    return [...this.docs.values()].find((d) => d.uri.toString() === u);
  }
  list() {
    return [...this.docs.values()];
  }
  fire(doc, reason) {
    this.listeners.forEach((l) => l(doc, reason));
  }
};
var registry = new Registry();
function currentIr(doc) {
  if (doc.kind === "table") return parseCsv(doc.textDocument.getText());
  return parseMarkdown(doc.textDocument.getText());
}
function writeIrBack(doc, ir) {
  const text = doc.kind === "table" ? serializeCsv(ir) : serializeMarkdown(ir);
  const td = doc.textDocument;
  const edit = new vscode2.WorkspaceEdit();
  edit.replace(td.uri, new vscode2.Range(0, 0, td.lineCount, 0), text);
  return vscode2.workspace.applyEdit(edit);
}
var ops = {
  listDocuments() {
    return registry.list().map((d) => ({ id: d.id, uri: d.uri.toString(), kind: d.kind, dirty: d.dirty }));
  },
  read(uriOrId, range) {
    const doc = registry.get(uriOrId);
    if (!doc) throw new Error(`document not found/open: ${uriOrId}`);
    const ir = currentIr(doc);
    if (range && isTableDoc(ir)) {
      const [a, b] = range.rows ?? [0, 1e3];
      return { ...ir, sheets: ir.sheets.map((s) => ({ ...s, rows: s.rows.slice(a, b) })) };
    }
    return ir;
  },
  search(query, regex = false) {
    const out = [];
    for (const d of registry.list()) {
      const re = regex ? new RegExp(query, "g") : null;
      const hit = (loc, text) => {
        if (re ? re.test(text) : text.includes(query)) out.push({ docId: d.id, location: loc, preview: text.slice(0, 200) });
        if (re) re.lastIndex = 0;
      };
      const ir = currentIr(d);
      if (isTableDoc(ir)) ir.sheets.forEach((s) => s.rows.forEach((r, ri) => r.forEach((c, ci) => hit(`${s.name}!${ci}:${ri}`, String(c ?? "")))));
      else if (isTextDoc(ir)) ir.blocks.forEach((b, i) => hit(`block:${i}`, b.text + " " + (b.items ?? []).join(" ")));
    }
    return out;
  },
  async applyEdits(uriOrId, edits, actor = "agent") {
    if (!vscode2.workspace.getConfiguration("officefiles").get("agent.allowWrite", true))
      throw new Error("writing by agents disabled (officefiles.agent.allowWrite=false)");
    const doc = registry.get(uriOrId);
    if (!doc) throw new Error(`document not found/open: ${uriOrId}`);
    const ir = structuredClone(currentIr(doc));
    applyOps(ir, edits);
    const ok = await writeIrBack(doc, ir);
    doc.dirty = !!doc.textDocument?.isDirty;
    registry["fire"](doc, `edit:${actor}`);
    return { applied: ok ? edits.length : 0 };
  },
  async save(uriOrId) {
    const doc = registry.get(uriOrId);
    if (!doc) throw new Error(`document not found/open: ${uriOrId}`);
    const saved = await doc.textDocument?.save();
    doc.dirty = !saved ? doc.dirty : false;
    return { saved: !!saved };
  },
  register(doc) {
    registry.add(doc);
  },
  unregister(id) {
    registry.remove(id);
  },
  onRegistryChange(cb) {
    return registry.onChange(cb);
  }
};
async function openDocument(uri, viewType) {
  const doc = await vscode2.workspace.openTextDocument(uri);
  await vscode2.commands.executeCommand("vscode.openWith", uri, viewType);
  return doc;
}

// src/host/providers/csvProvider.ts
var CsvEditorProvider = class {
  constructor(context) {
    this.context = context;
  }
  static viewType = "officefiles.csvEditor";
  seq = 0;
  async resolveCustomTextEditor(document, panel, token) {
    const docId = `csv-${++this.seq}`;
    const managed = { id: docId, uri: document.uri, kind: "table", textDocument: document, dirty: false };
    ops.register(managed);
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    panel.webview.html = this.html(panel.webview, { route: "grid", fileName: document.uri.fsPath.split(/[\\/]/).pop() });
    const bus = DocBus.attach(panel);
    const sendDoc = (reason) => bus.emit("doc:update", { id: docId, reason, ir: ops.read(docId) });
    bus.on("ready", () => sendDoc("init"));
    bus.on("cell.set", async ({ row, col, value }) => {
      await ops.applyEdits(docId, [{ op: "setCell", sheet: "Sheet1", row, col, value }], "user");
    });
    bus.on("row.insert", async ({ row }) => {
      await ops.applyEdits(docId, [{ op: "insertRow", sheet: "Sheet1", row }], "user");
    });
    bus.on("save", async () => {
      await ops.save(docId);
    });
    const sub = vscode3.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        managed.dirty = e.document.isDirty;
        sendDoc("external");
      }
    });
    panel.onDidDispose(() => {
      sub.dispose();
      bus.dispose();
      ops.unregister(docId);
    });
  }
  html(webview, configs) {
    const uri = webview.asWebviewUri(vscode3.Uri.joinPath(this.context.extensionUri, "out", "webview", "assets", "index.js"));
    return (
      /*html*/
      `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline';">
<link href="${webview.asWebviewUri(vscode3.Uri.joinPath(this.context.extensionUri, "out", "webview", "assets", "index.css"))}" rel="stylesheet">
</head><body><div id="root"></div>
<script>window.__OFFICEFILES__=${JSON.stringify(configs)};</script>
<script type="module" src="${uri}"></script></body></html>`
    );
  }
};

// src/host/providers/markdownProvider.ts
var vscode4 = __toESM(require("vscode"));
var MarkdownEditorProvider = class {
  constructor(context) {
    this.context = context;
  }
  static viewType = "officefiles.markdownEditor";
  seq = 0;
  async resolveCustomTextEditor(document, panel) {
    const docId = `md-${++this.seq}`;
    const managed = { id: docId, uri: document.uri, kind: "document", textDocument: document, dirty: false };
    ops.register(managed);
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    panel.webview.html = this.html(panel.webview, { route: "markdown", fileName: document.uri.fsPath.split(/[\\/]/).pop() });
    const bus = DocBus.attach(panel);
    const send = (reason) => bus.emit("doc:update", { id: docId, reason, ir: ops.read(docId) });
    bus.on("ready", () => send("init"));
    bus.on("block.replace", async ({ index, block }) => {
      await ops.applyEdits(docId, [{ op: "replaceBlock", index, block }], "user");
    });
    bus.on("block.append", async ({ block }) => {
      await ops.applyEdits(docId, [{ op: "appendBlock", block }], "user");
    });
    bus.on("block.delete", async ({ index }) => {
      await ops.applyEdits(docId, [{ op: "deleteBlock", index }], "user");
    });
    bus.on("save", async () => {
      await ops.save(docId);
    });
    const sub = vscode4.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        managed.dirty = e.document.isDirty;
        send("external");
      }
    });
    panel.onDidDispose(() => {
      sub.dispose();
      bus.dispose();
      ops.unregister(docId);
    });
  }
  html(webview, configs) {
    const base = vscode4.Uri.joinPath(this.context.extensionUri, "out", "webview", "assets");
    return (
      /*html*/
      `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:;">
<link href="${webview.asWebviewUri(vscode4.Uri.joinPath(base, "index.css"))}" rel="stylesheet">
</head><body><div id="root"></div>
<script>window.__OFFICEFILES__=${JSON.stringify(configs)};</script>
<script type="module" src="${webview.asWebviewUri(vscode4.Uri.joinPath(base, "index.js"))}"></script></body></html>`
    );
  }
};

// src/host/ops/agentSurface.ts
var vscode5 = __toESM(require("vscode"));
function registerAgentCommands(context) {
  const wrap = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      vscode5.window.showErrorMessage(`OfficeFiles: ${e?.message ?? e}`);
      throw e;
    }
  };
  const wrapAsync = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      vscode5.window.showWarningMessage(`OfficeFiles: ${e?.message ?? e}`);
      throw e;
    }
  };
  context.subscriptions.push(
    vscode5.commands.registerCommand("officefiles.agent.listDocuments", wrap(() => ops.listDocuments())),
    vscode5.commands.registerCommand("officefiles.agent.readDocument", wrap((id, range) => ops.read(id, range))),
    vscode5.commands.registerCommand("officefiles.agent.applyEdits", wrapAsync((id, edits, actor) => ops.applyEdits(id, edits, actor))),
    vscode5.commands.registerCommand("officefiles.agent.saveDocument", wrapAsync((id) => ops.save(id))),
    vscode5.commands.registerCommand("officefiles.openCsvAsGrid", async () => {
      const uris = await vscode5.window.showOpenDialog({ filters: { "CSV/TSV": ["csv", "tsv"] } });
      if (uris?.[0]) await openDocument(uris[0], "officefiles.csvEditor");
    })
  );
}
function registerLanguageModelTools(context) {
  const lm2 = vscode5.lm;
  if (!lm2?.registerTool) return;
  const mk = (name, description, handler, modelDescription) => lm2.registerTool(name, {
    toolReferenceName: name.replace("officefiles.", ""),
    description,
    modelDescription: modelDescription ?? description,
    inputSchema: { type: "object", properties: {}, ...handlerSchemas[name] }
  }, { invoke: async (options) => new lm2.ToolResult(await handler(options) ?? "ok") });
  const handlerSchemas = {
    "officefiles.listDocuments": {},
    "officefiles.readDocument": { docId: { type: "string" }, range: { type: "object" } },
    "officefiles.applyEdits": { docId: { type: "string" }, edits: { type: "array", items: { type: "object" } } },
    "officefiles.saveDocument": { docId: { type: "string" } }
  };
  mk("officefiles.listDocuments", "List OfficeFiles documents currently open in the editor.", async () => ops.listDocuments());
  mk(
    "officefiles.readDocument",
    "Read a document as structured JSON IR (table sheets/rows or markdown blocks).",
    async (o) => ops.read(o.docId, o.range)
  );
  mk(
    "officefiles.applyEdits",
    "Apply typed edit operations (setCell/insertRow/appendBlock/replaceText...) atomically; user can undo.",
    (o) => ops.applyEdits(o.docId, o.edits, "copilot"),
    "Use this to modify spreadsheet cells or document blocks instead of editing files blindly."
  );
  mk("officefiles.saveDocument", "Save the document to disk.", (o) => ops.save(o.docId));
}

// src/extension.ts
function activate(context) {
  const viewOption = { webviewOptions: { retainContextWhenHidden: true } };
  context.subscriptions.push(
    vscode6.window.registerCustomEditorProvider(CsvEditorProvider.viewType, new CsvEditorProvider(context), viewOption),
    vscode6.window.registerCustomEditorProvider(MarkdownEditorProvider.viewType, new MarkdownEditorProvider(context), viewOption)
  );
  registerAgentCommands(context);
  registerLanguageModelTools(context);
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
