// Shared MCP (Model Context Protocol) JSON-RPC 2.0 engine over newline-delimited stdio.
// Used by BOTH the headless server (out/mcp-standalone.js) and the live IPC proxy
// (out/mcp-ipc-proxy.js), so every agent sees ONE tool vocabulary, identical schemas,
// instructions and safety annotations regardless of how it connects.
//
// Implements the handshake an agent needs after connecting:
//   initialize (+ instructions) -> notifications/initialized -> tools/list -> tools/call
// plus ping, logging, empty resources/prompts, cancellation and proper JSON-RPC errors.
import type { Readable, Writable } from 'stream';

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations?: McpToolAnnotations;
  handler: (args: any) => any | Promise<any>;
}

export interface McpServerInfo { name: string; version: string; instructions?: string }

export interface McpServerOptions {
  server: McpServerInfo;
  tools: McpTool[];
  input?: Readable;
  output?: Writable;
}

/** Protocol revisions we understand, newest first. */
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];
const LATEST_PROTOCOL = SUPPORTED_PROTOCOLS[0];

export interface McpServer {
  /** Handle a single decoded JSON-RPC message (used by tests and custom transports). */
  handle(msg: any): Promise<void>;
  /** Send a server-initiated notification (e.g. logging/message). */
  notify(method: string, params?: any): void;
}

export function createMcpServer(opts: McpServerOptions): McpServer {
  const input: Readable = opts.input ?? (process.stdin as unknown as Readable);
  const output: Writable = opts.output ?? (process.stdout as unknown as Writable);
  const cancelled = new Set<string | number | null>();

  const send = (msg: any) => { try { output.write(JSON.stringify(msg) + '\n'); } catch { /* client gone */ } };
  const reply = (id: any, result: any) => send({ jsonrpc: '2.0', id, result });
  const fail = (id: any, code: number, message: string, data?: any) =>
    send({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });

  const serializeTools = () => opts.tools.map(t => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    ...(t.annotations ? { annotations: t.annotations } : {}),
  }));

  async function handleOne(msg: any): Promise<void> {
    if (Array.isArray(msg)) { await Promise.all(msg.map(handleOne)); return; }   // JSON-RPC batch
    if (!msg || typeof msg !== 'object') { fail(null, -32600, 'invalid request'); return; }

    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;

    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL;
        reply(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false }, logging: {} },
          serverInfo: { name: opts.server.name, version: opts.server.version },
          ...(opts.server.instructions ? { instructions: opts.server.instructions } : {}),
        });
        return;
      }
      case 'notifications/initialized':
        return; // notification — no response
      case 'notifications/cancelled':
        if (params?.requestId !== undefined) cancelled.add(params.requestId);
        return;
      case 'ping':
        reply(id, {});
        return;
      case 'logging/setLevel':
        reply(id, {});
        return;
      case 'tools/list':
        reply(id, { tools: serializeTools() });
        return;
      // We expose no MCP resources/prompts yet, but answer probes so clients don't error.
      case 'resources/list':
        reply(id, { resources: [] });
        return;
      case 'resources/templates/list':
        reply(id, { resourceTemplates: [] });
        return;
      case 'prompts/list':
        reply(id, { prompts: [] });
        return;
      case 'tools/call': {
        const tool = opts.tools.find(t => t.name === params?.name);
        if (!tool) { fail(id, -32602, `unknown tool: ${params?.name ?? '(missing)'}`); return; }
        try {
          const result = await tool.handler(params?.arguments ?? {});
          if (cancelled.has(id)) { cancelled.delete(id); return; }   // client cancelled mid-flight
          const text = typeof result === 'string' ? result : JSON.stringify(result ?? null);
          const payload: any = { content: [{ type: 'text', text }], isError: false };
          if (result && typeof result === 'object') payload.structuredContent = result;
          reply(id, payload);
        } catch (e: any) {
          reply(id, { content: [{ type: 'text', text: String(e?.message ?? e) }], isError: true });
        }
        return;
      }
      default:
        if (!isNotification) fail(id, -32601, `method not found: ${method}`);
    }
  }

  let buffer = '';
  input.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); }
      catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); continue; }
      void handleOne(msg);
    }
  });

  return {
    handle: handleOne,
    notify: (method: string, params?: any) => send({ jsonrpc: '2.0', method, params }),
  };
}
