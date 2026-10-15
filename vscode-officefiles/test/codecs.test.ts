import { describe, it, expect } from 'vitest';
import { parseCsv, serializeCsv } from '../src/core/codecs/csv';
import { parseMarkdown, serializeMarkdown } from '../src/core/codecs/markdown';
import { applyOps } from '../src/core/ir';

describe('csv codec', () => {
  it('round-trips quoted fields with commas/newlines', () => {
    const src = 'name,note\n"Doe, John","line1\nline2"\nplain,3\n';
    const ir = parseCsv(src);
    expect(serializeCsv(ir)).toBe(src);
  });
  it('setCell then serialize keeps structure', () => {
    const ir = parseCsv('a,b\n1,2\n');
    applyOps(ir, [{ op: 'setCell', sheet: 'Sheet1', row: 0, col: 1, value: 'z' }]);
    expect(serializeCsv(ir)).toContain('a,z');
  });
});

describe('markdown codec', () => {
  it('parses headings/paragraph/list/code blocks', () => {
    const src = '# Title\n\nHello **world**\n\n- one\n- two\n\n```ts\nconst x = 1;\n```\n';
    const ir = parseMarkdown(src);
    const types = ir.blocks.map(b => b.type);
    expect(types).toEqual(expect.arrayContaining(['heading', 'paragraph', 'list', 'code']));
    expect(serializeMarkdown(ir).replace(/\n+$/,'\n')).toBe(src.replace(/\n+$/,'\n'));
  });
  it('appendBlock + replaceText ops', () => {
    const ir = parseMarkdown('# A\n\ntext here\n');
    applyOps(ir, [
      { op: 'appendBlock', block: { kind: undefined as any, type: 'paragraph', text: 'new para' } as any },
      { op: 'replaceText', search: 'text here', replacement: 'TEXT THERE' },
    ]);
    const out = serializeMarkdown(ir);
    expect(out).toContain('new para');
    expect(out).toContain('TEXT THERE');
  });
});
