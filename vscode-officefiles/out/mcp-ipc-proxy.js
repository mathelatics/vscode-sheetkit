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

// src/host/mcp/ipcProxy.ts
var net = __toESM(require("net"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));
function discoverSocket() {
  const dir = process.platform === "win32" ? "\\\\.\\pipe\\" : os.tmpdir();
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith("officefiles-") || !f.endsWith(".sock.json")) continue;
      const info = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (process.kill(info.pid, 0)) return info.socketPath;
    }
  } catch {
  }
  return null;
}
var sock = null;
var seq = 0;
var pending = /* @__PURE__ */ new Map();
var rxbuf = "";
function ensureConn() {
  if (sock && !sock.destroyed) return Promise.resolve(sock);
  const p = discoverSocket();
  if (!p) return Promise.reject(new Error("no running VS Code with OfficeFiles IPC bridge found (open a window; setting officefiles.agent.ipcBridge=true)"));
  return new Promise((resolve, reject) => {
    const s = net.connect(p);
    s.on("connect", () => {
      sock = s;
      resolve(s);
    });
    s.on("data", (chunk) => {
      rxbuf += chunk.toString();
      let i;
      while ((i = rxbuf.indexOf("\n")) >= 0) {
        const line = rxbuf.slice(0, i).trim();
        rxbuf = rxbuf.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const pr = pending.get(msg.id);
        if (pr) {
          pending.delete(msg.id);
          msg.error ? pr.reject(new Error(msg.error.message)) : pr.resolve(msg.result);
        }
      }
    });
    s.on("close", () => {
      sock = null;
    });
    s.on("error", (e) => {
      sock = null;
      reject(e);
    });
  });
}
function call(method, params) {
  return ensureConn().then((s) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    s.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`ipc timeout: ${method}`));
      }
    }, 15e3);
  }));
}
var tools = {
  live_list_documents: { desc: "List OfficeFiles documents currently open in the user VS Code window.", schema: { type: "object", properties: {} }, run: () => call("documents.list", {}) },
  live_read_document: { desc: "Read an open document as structured IR JSON (live, includes unsaved edits).", schema: { type: "object", properties: { uri: { type: "string" }, docId: { type: "string" } } }, run: (a) => call("documents.read", a) },
  live_search: { desc: "Search all open documents; returns locations you can target with applyEdits.", schema: { type: "object", properties: { query: { type: "string" }, regex: { type: "boolean" } }, required: ["query"] }, run: (a) => call("documents.search", a) },
  live_apply_edits: { desc: "Apply typed edit ops to the LIVE open document (goes through undo stack; user sees it instantly).", schema: { type: "object", properties: { uri: { type: "string" }, docId: { type: "string" }, edits: { type: "array", items: { type: "object" } } }, required: ["edits"] }, run: (a) => call("documents.applyEdits", a) },
  live_save_document: { desc: "Save the open document to disk.", schema: { type: "object", properties: { uri: { type: "string" }, docId: { type: "string" } } }, run: (a) => call("documents.save", a) }
};
var buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
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
function send(r) {
  process.stdout.write(JSON.stringify(r) + "\n");
}
async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "officefiles-live", version: "0.0.1" } } });
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.desc, inputSchema: t.schema })) } });
  if (method === "tools/call") {
    const t = tools[params?.name];
    if (!t) return send({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool: ${params?.name}` } });
    try {
      const result = await t.run(params.arguments ?? {});
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
    } catch (e) {
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(e?.message ?? e) }], isError: true } });
    }
  }
  if (id !== void 0) send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
}
//# sourceMappingURL=mcp-ipc-proxy.js.map
