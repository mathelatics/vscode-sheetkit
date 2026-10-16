import { describe, it, expect } from 'vitest';
import { createMcpServer } from '../src/host/mcp/protocol';
import { officeTools, OFFICE_INSTRUCTIONS } from '../src/host/mcp/officeTools';
import { createHeadlessBackend } from '../src/host/mcp/headlessBackend';
import { mkdtempSync, copyFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fx = (name: string) => join(fixtures, name);

// ---- tiny in-memory transport so we can drive the server synchronously in tests ----
class FakeInput {
  handlers: Array<(c: any) => void> = [];
  on(_event: string, cb: (c: any) => void) { this.handlers.push(cb); }
  push(s: string) { for (const h of this.handlers) h(Buffer.from(s)); }
}

function harness(tools: any[], input: any = { on() { /* no stdin */ } }) {
  let out = '';
  const output = { write(chunk: any) { out += chunk.toString(); return true; } } as any;
  const server = createMcpServer({
    server: { name: 'test', version: '0.0.0', instructions: OFFICE_INSTRUCTIONS },
    tools, input, output,
  });
  const lines = () => out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const last = () => lines()[lines().length - 1];
  return { server, lines, last, reset: () => { out = ''; } };
}

function mkTools() { return officeTools(createHeadlessBackend(), { live: false }); }
function callTool(tools: any[], name: string, args: any) {
  const t = tools.find(x => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t.handler(args);
}

// =====================================================================================
describe('MCP protocol', () => {
  it('initialize returns negotiated protocol, capabilities, serverInfo and instructions', async () => {
    const h = harness([]);
    await h.server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    const r = h.last();
    expect(r.id).toBe(1);
    expect(r.result.protocolVersion).toBe('2024-11-05');
    expect(r.result.capabilities.tools).toBeTruthy();
    expect(r.result.capabilities.logging).toBeTruthy();
    expect(r.result.serverInfo.name).toBe('test');
    expect(r.result.instructions).toContain('office_apply_edits');
  });

  it.each([
    ['2025-06-18', '2025-06-18'],
    ['2025-03-26', '2025-03-26'],
    ['2024-10-07', '2024-10-07'],
    ['1999-01-01', '2025-06-18'],
    [undefined, '2025-06-18'],
  ])('negotiates protocol %s -> %s', async (requested, expected) => {
    const h = harness([]);
    await h.server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: requested } });
    expect(h.last().result.protocolVersion).toBe(expected);
  });

  it('ping replies with empty result', async () => {
    const h = harness([]);
    await h.server.handle({ jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(h.last()).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
  });

  it('logging/setLevel and empty capability probes answer without error', async () => {
    const h = harness([]);
    await h.server.handle({ jsonrpc: '2.0', id: 3, method: 'logging/setLevel', params: { level: 'debug' } });
    expect(h.last().result).toEqual({});
    h.reset();
    await h.server.handle({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
    expect(h.last().result).toEqual({ resources: [] });
    h.reset();
    await h.server.handle({ jsonrpc: '2.0', id: 5, method: 'resources/templates/list' });
    expect(h.last().result).toEqual({ resourceTemplates: [] });
    h.reset();
    await h.server.handle({ jsonrpc: '2.0', id: 6, method: 'prompts/list' });
    expect(h.last().result).toEqual({ prompts: [] });
  });

  it('tools/list advertises schemas and safety annotations', async () => {
    const h = harness(mkTools());
    await h.server.handle({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    const tools = h.last().result.tools;
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('office_capabilities');
    expect(names).toContain('office_apply_edits');
    for (const t of tools) {
      expect(t.title).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeTruthy();
      expect(t.annotations).toBeTruthy();
    }
    expect(tools.find((t: any) => t.name === 'office_apply_edits').annotations.destructiveHint).toBe(true);
    expect(tools.find((t: any) => t.name === 'office_read').annotations.readOnlyHint).toBe(true);
    expect(tools.find((t: any) => t.name === 'office_read').inputSchema.anyOf).toBeTruthy();
  });

  it('tools/call returns content + structuredContent', async () => {
    const h = harness(mkTools());
    await h.server.handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'office_capabilities', arguments: {} } });
    const r = h.last().result;
    expect(r.isError).toBe(false);
    expect(Array.isArray(r.content)).toBe(true);
    expect(r.content[0].type).toBe('text');
    expect(r.structuredContent.mode).toBe('headless');
  });

  it('unknown tool -> JSON-RPC invalid-params error', async () => {
    const h = harness(mkTools());
    await h.server.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope', arguments: {} } });
    expect(h.last().error.code).toBe(-32602);
  });

  it('unknown method -> method-not-found; notification -> no error', async () => {
    const h = harness([]);
    await h.server.handle({ jsonrpc: '2.0', id: 10, method: 'does/not/exist' });
    expect(h.last().error.code).toBe(-32601);
    h.reset();
    await h.server.handle({ jsonrpc: '2.0', method: 'does/not/exist' });
    expect(h.lines().length).toBe(0);
  });

  it('tool throwing -> isError result (not a protocol crash)', async () => {
    const h = harness([{ name: 'boom', title: 'b', description: 'd', inputSchema: { type: 'object' }, handler: () => { throw new Error('kaboom'); } }]);
    await h.server.handle({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'boom', arguments: {} } });
    const r = h.last().result;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('kaboom');
  });

  it('initialized / cancelled notifications produce no response', async () => {
    const h = harness([]);
    await h.server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await h.server.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
    expect(h.lines().length).toBe(0);
  });

  it('JSON-RPC batch -> one response per request', async () => {
    const h = harness(mkTools());
    await h.server.handle([
      { jsonrpc: '2.0', id: 'a', method: 'ping' },
      { jsonrpc: '2.0', id: 'b', method: 'tools/list' },
    ]);
    const ids = h.lines().map(l => l.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('malformed JSON line -> parse error', async () => {
    const input = new FakeInput();
    const h = harness([], input);
    input.push('this is not json\n');
    await new Promise(r => setTimeout(r, 0));
    expect(h.last().error.code).toBe(-32700);
  });

  it('blank lines are ignored', async () => {
    const input = new FakeInput();
    const h = harness([], input);
    input.push('\n\n');
    await new Promise(r => setTimeout(r, 0));
    expect(h.lines().length).toBe(0);
  });
});

// =====================================================================================
describe('headless surface', () => {
  it('exposes the expected tools and not the live-only ones', () => {
    const names = mkTools().map(t => t.name).sort();
    expect(names).toEqual([
      'office_apply_edits', 'office_capabilities', 'office_extract_pdf_text',
      'office_list', 'office_read', 'office_save', 'office_search',
    ]);
    expect(names).not.toContain('office_open');
  });

  it('live-optional tools appear when the backend implements open/extractPdfText', () => {
    const b: any = {
      capabilities: async () => ({}), list: async () => ({}), read: async () => ({}),
      search: async () => ({}), applyEdits: async () => ({}), save: async () => ({}),
      open: async () => ({}), extractPdfText: async () => ({}),
    };
    const names = officeTools(b, { live: true }).map(t => t.name);
    expect(names).toContain('office_open');
    expect(names).toContain('office_extract_pdf_text');
  });

  it('capabilities reports editable + read-only sets and edit ops', async () => {
    const caps = await callTool(mkTools(), 'office_capabilities', {});
    expect(caps.mode).toBe('headless');
    expect(caps.editOps).toContain('setCell');
    expect(caps.editable.some((e: any) => e.extensions.includes('.xlsx'))).toBe(true);
    expect(caps.previewOnly.some((p: any) => p.extensions.includes('.pdf'))).toBe(true);
  });

  it('list scans a directory for supported files', async () => {
    const r = await callTool(mkTools(), 'office_list', { dir: fixtures });
    const names = r.entries.map((e: any) => e.name);
    for (const n of ['data.csv', 'data.tsv', 'data.json', 'notes.md', 'budget.xlsx', 'report.docx', 'deck.pptx', 'book.epub', 'sample.pdf', 'site.zip']) {
      expect(names).toContain(n);
    }
  });

  it('list honors limit', async () => {
    const r = await callTool(mkTools(), 'office_list', { dir: fixtures, limit: 2 });
    expect(r.entries.length).toBe(2);
  });
});

// =====================================================================================
describe('headless read across every format', () => {
  it('csv -> table IR', async () => {
    const ir = await callTool(mkTools(), 'office_read', { path: fx('data.csv') });
    expect(ir.kind).toBe('table');
    expect(ir.sheets[0].rows.length).toBeGreaterThan(0);
  });

  it('tsv -> table IR', async () => {
    const ir = await callTool(mkTools(), 'office_read', { path: fx('data.tsv') });
    expect(ir.kind).toBe('table');
    expect(ir.sheets[0].rows[0]).toEqual(['name', 'qty', 'price']);
  });

  it('json -> table IR (flat array of objects becomes columns)', async () => {
    const ir = await callTool(mkTools(), 'office_read', { path: fx('data.json') });
    expect(ir.kind).toBe('table');
    expect(ir.sheets[0].rows[0]).toEqual(['name', 'qty', 'price']);
  });

  it('markdown -> document IR', async () => {
    const ir = await callTool(mkTools(), 'office_read', { path: fx('notes.md') });
    expect(ir.kind).toBe('document');
    expect(ir.blocks.length).toBeGreaterThan(0);
  });

  it('xlsx -> table IR (no internal side-channels leak)', async () => {
    const ir = await callTool(mkTools(), 'office_read', { path: fx('budget.xlsx') });
    expect(ir.kind).toBe('table');
    expect(ir.sheets[0].rows[0]).toEqual(['Item', 'Qty', 'Price', 'Total']);
    expect(JSON.stringify(ir)).not.toContain('__sheetMeta');
  });

  it('docx -> document IR (no __xml leak)', async () => {
    const ir = await callTool(mkTools(), 'office_read', { path: fx('report.docx') });
    expect(ir.kind).toBe('document');
    expect(ir.blocks.length).toBeGreaterThan(0);
    expect(JSON.stringify(ir)).not.toContain('__xml');
  });

  it('pptx -> document IR', async () => {
    const ir = await callTool(mkTools(), 'office_read', { path: fx('deck.pptx') });
    expect(ir.kind).toBe('document');
    expect(ir.blocks.length).toBeGreaterThan(0);
  });

  it('epub -> document IR', async () => {
    const ir = await callTool(mkTools(), 'office_read', { path: fx('book.epub') });
    expect(ir.kind).toBe('document');
    expect(ir.blocks.length).toBeGreaterThan(0);
  });

  it('pdf -> document IR with page-tagged blocks', async () => {
    const ir = await callTool(mkTools(), 'office_read', { path: fx('sample.pdf') });
    expect(ir.kind).toBe('document');
    expect(ir.blocks[0].page).toBe(1);
    expect(ir.blocks[0].text).toContain('OfficeFiles sample PDF');
  });

  it('zip -> entry listing', async () => {
    const r = await callTool(mkTools(), 'office_read', { path: fx('site.zip') });
    expect(Array.isArray(r.entries)).toBe(true);
    expect(r.entries.length).toBeGreaterThan(0);
  });

  it('range slices table rows', async () => {
    const ir = await callTool(mkTools(), 'office_read', { path: fx('budget.xlsx'), range: { rows: [0, 2] } });
    expect(ir.sheets[0].rows.length).toBe(2);
  });

  it('range slices document blocks', async () => {
    const ir = await callTool(mkTools(), 'office_read', { path: fx('report.docx'), range: { blocks: [0, 1] } });
    expect(ir.blocks.length).toBe(1);
  });

  it('unsupported extension throws', async () => {
    await expect(callTool(mkTools(), 'office_read', { path: fx('data.csv').replace('.csv', '.bin') }))
      .rejects.toThrow(/unsupported/);
  });

  it('missing target throws', async () => {
    await expect(callTool(mkTools(), 'office_read', {})).rejects.toThrow(/missing target/);
  });
});

// =====================================================================================
describe('headless search', () => {
  it('finds text with locations', async () => {
    const r = await callTool(mkTools(), 'office_search', { path: fx('data.csv'), query: 'Engineering' });
    expect(r.total).toBeGreaterThan(0);
    expect(r.hits[0].location).toMatch(/!/);
  });

  it('supports regex and limit', async () => {
    const r = await callTool(mkTools(), 'office_search', { path: fx('data.csv'), query: 'E\\w+', regex: true, limit: 1 });
    expect(r.total).toBe(1);
  });

  it('searches document blocks', async () => {
    const r = await callTool(mkTools(), 'office_search', { path: fx('report.docx'), query: 'sample' });
    expect(r.hits[0].location).toMatch(/^block:/);
  });

  it('zip is not searchable', async () => {
    await expect(callTool(mkTools(), 'office_search', { path: fx('site.zip'), query: 'x' })).rejects.toThrow(/not searchable/);
  });
});

// =====================================================================================
describe('headless apply_edits + save', () => {
  const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'of-mcp-')); return d; };

  it('dryRun previews without writing', async () => {
    const d = tmp(); const p = join(d, 'notes.md');
    copyFileSync(fx('notes.md'), p);
    const before = readFileSync(p, 'utf8');
    const r = await callTool(mkTools(), 'office_apply_edits', { path: p, edits: [{ op: 'appendBlock', block: { type: 'paragraph', text: 'hello' } }], dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.applied).toBe(1);
    expect(readFileSync(p, 'utf8')).toBe(before);
  });

  it('real run writes and is re-readable', async () => {
    const d = tmp(); const p = join(d, 'notes.md');
    copyFileSync(fx('notes.md'), p);
    const r = await callTool(mkTools(), 'office_apply_edits', { path: p, edits: [{ op: 'appendBlock', block: { type: 'paragraph', text: 'UNIQUE_MARKER_XYZ' } }] });
    expect(r.saved).toBe(true);
    expect(readFileSync(p, 'utf8')).toContain('UNIQUE_MARKER_XYZ');
  });

  it('edits a copied xlsx cell and persists (round-trip)', async () => {
    const d = tmp(); const p = join(d, 'budget.xlsx');
    copyFileSync(fx('budget.xlsx'), p);
    await callTool(mkTools(), 'office_apply_edits', { path: p, edits: [{ op: 'setCell', sheet: 'Sheet1', row: 1, col: 0, value: 'Thing' }] });
    const ir = await callTool(mkTools(), 'office_read', { path: p });
    expect(ir.sheets[0].rows[1][0]).toBe('Thing');
  });

  it('replaceText works on csv', async () => {
    const d = tmp(); const p = join(d, 'data.csv');
    copyFileSync(fx('data.csv'), p);
    await callTool(mkTools(), 'office_apply_edits', { path: p, edits: [{ op: 'replaceText', search: 'Alice', replacement: 'Sprocket' }] });
    expect(readFileSync(p, 'utf8')).toContain('Sprocket');
  });

  it('save round-trips unchanged and reports saved', async () => {
    const d = tmp(); const p = join(d, 'notes.md');
    copyFileSync(fx('notes.md'), p);
    const r = await callTool(mkTools(), 'office_save', { path: p });
    expect(r.saved).toBe(true);
  });

  it('read-only formats reject writes', async () => {
    await expect(callTool(mkTools(), 'office_apply_edits', { path: fx('deck.pptx'), edits: [{ op: 'appendBlock', block: { type: 'paragraph', text: 'x' } }] }))
      .rejects.toThrow(/read-only/);
    await expect(callTool(mkTools(), 'office_save', { path: fx('sample.pdf') })).rejects.toThrow(/read-only/);
  });
});

// =====================================================================================
describe('headless pdf extract', () => {
  it('extracts per-page text', async () => {
    const r = await callTool(mkTools(), 'office_extract_pdf_text', { path: fx('sample.pdf') });
    expect(r.pages.length).toBeGreaterThanOrEqual(1);
    expect(r.pages[0].page).toBe(1);
    expect(r.pages[0].text).toContain('OfficeFiles sample PDF');
  });

  it('rejects non-pdf input', async () => {
    await expect(callTool(mkTools(), 'office_extract_pdf_text', { path: fx('data.csv') })).rejects.toThrow(/expects a .pdf/);
  });
});
