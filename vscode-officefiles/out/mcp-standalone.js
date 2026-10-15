"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/host/mcp/standalone.ts
var fs = __toESM(require("fs"));
var import_url = require("url");

// src/core/ir.ts
function isTableDoc(ir) {
  return ir.kind === "table";
}
function applyOps(ir, ops) {
  for (const o of ops) {
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
    case "insertBlock": {
      const at = o.after === void 0 ? doc.blocks.length : Math.max(0, Math.min(o.after + 1, doc.blocks.length));
      doc.blocks.splice(at, 0, o.block);
      break;
    }
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

// src/host/mcp/standalone.ts
function load(uri) {
  const text = fs.readFileSync(uri, "utf8");
  if (/\.(csv|tsv)$/i.test(uri)) return { ir: parseCsv(text), kind: "table" };
  return { ir: parseMarkdown(text), kind: "document" };
}
function store(uri, doc) {
  const out = doc.kind === "table" ? serializeCsv(doc.ir) : serializeMarkdown(doc.ir);
  fs.writeFileSync(uri, out, "utf8");
}
function toPath(uriOrPath) {
  if (/^file:\/\//i.test(uriOrPath)) return (0, import_url.fileURLToPath)(uriOrPath);
  return uriOrPath;
}
function pathFrom(a) {
  const p = toPath(String(a.uri ?? ""));
  if (!p) throw new Error("missing required argument: uri");
  return p;
}
var tools = {
  office_read: {
    desc: "Read a document (csv/tsv/markdown) and return its structured IR (blocks or table rows).",
    fn: (a) => load(pathFrom(a)).ir
  },
  office_search: {
    desc: "Search a document for a query string. Returns matches with block/row/column locations.",
    fn: (a) => {
      const { ir } = load(pathFrom(a));
      const q = String(a.query ?? "").toLowerCase();
      const hits = [];
      if (isTableDoc(ir)) {
        ir.sheets.forEach((s, si) => s.rows.forEach((r, ri) => r.forEach((v, ci) => {
          if (String(v ?? "").toLowerCase().includes(q)) hits.push({ sheet: si, row: ri, col: ci, value: v });
        })));
      } else {
        ir.blocks.forEach((b, bi) => {
          const text = JSON.stringify(b);
          if (text.toLowerCase().includes(q)) hits.push({ block: bi, type: b.type, preview: text.slice(0, 200) });
        });
      }
      return { total: hits.length, hits: hits.slice(0, 100) };
    }
  },
  office_apply_edits: {
    desc: "Apply typed edit operations (insert/update/delete on blocks or cells) to a document and save it.",
    fn: (a) => {
      const p = pathFrom(a);
      const doc = load(p);
      applyOps(doc.ir, a.edits ?? []);
      store(p, doc);
      return { applied: (a.edits ?? []).length };
    }
  },
  office_save: {
    desc: "Re-serialize the document IR back to disk (round-trip check / explicit save).",
    fn: (a) => {
      const p = pathFrom(a);
      const doc = load(p);
      store(p, doc);
      return { saved: true };
    }
  }
};
var buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});
function send(resp) {
  process.stdout.write(JSON.stringify(resp) + "\n");
}
var toolSchemas = {
  office_read: { type: "object", properties: { uri: { type: "string", description: "File path or file:// URI of a .csv/.tsv/.md document" } }, required: ["uri"] },
  office_search: { type: "object", properties: { uri: { type: "string" }, query: { type: "string", description: "Case-insensitive substring to locate" } }, required: ["uri", "query"] },
  office_apply_edits: {
    type: "object",
    properties: {
      uri: { type: "string" },
      edits: {
        type: "array",
        description: 'Typed edit ops. Table docs: {op:"setCell",row,col,value}, {op:"insertRow",row,values?}, {op:"deleteRow",row}, {op:"insertColumn",col,header?}, {op:"replaceText",search,replacement}. Document (markdown) docs: {op:"appendBlock",block:{type,text}}, {op:"insertBlock",after?,block}, {op:"replaceBlock",index,block}, {op:"deleteBlock",index}, {op:"replaceText",search,replacement}.',
        items: { type: "object", properties: { op: { type: "string" } }, required: ["op"] }
      }
    },
    required: ["uri", "edits"]
  },
  office_save: { type: "object", properties: { uri: { type: "string" } }, required: ["uri"] }
};
function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "officefiles", version: "0.0.1" } } });
  if (method === "notifications/initialized") return;
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.desc, inputSchema: toolSchemas[name] })) } });
  if (method === "tools/call") {
    try {
      const t = tools[params?.name];
      if (!t) return send({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool: ${params?.name}` } });
      const result = t.fn(params.arguments ?? {});
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
    } catch (e) {
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(e?.message ?? e) }], isError: true } });
    }
  }
  if (id !== void 0) send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
}
//# sourceMappingURL=mcp-standalone.js.map
