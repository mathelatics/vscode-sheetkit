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

import { parseJson, serializeJson } from '../src/core/codecs/json';
import { parseXlsxBytes, serializeXlsxBytes, buildSheetXml, parseSheetXml } from '../src/core/codecs/ooxml';
import JSZip from 'jszip';

describe('json codec', () => {
  it('round-trips flat arrays as real grid', () => {
    const src = JSON.stringify([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
    const ir = parseJson(src) as any;
    expect(ir.sheets[0].rows[0]).toEqual(['a', 'b']);
    expect(serializeJson(ir)).toBe(JSON.stringify([{ a: 1, b: 'x' }, { a: 2, b: 'y' }], null, 2) + '\n');
  });
  it('grid edits rebuild objects', async () => {
    const ir = parseJson(JSON.stringify([{ n: 'a' }])) as any;
    ir.sheets[0].rows[1][0] = 'z';
    expect(JSON.parse(serializeJson(ir))).toEqual([{ n: 'z' }]);
  });
  it('non-tabular docs round-trip losslessly', () => {
    const src = JSON.stringify({ deep: { x: [1, 2, { y: true }] } });
    expect(JSON.parse(serializeJson(parseJson(src) as any))).toEqual(JSON.parse(src));
  });
});

describe('ooxml sheet xml', () => {
  it('build+parse cell round-trip', () => {
    const rows: any[][] = [['Name', 'Qty', 'Ok'], ['Widget & Co', 3, true], ['', 4.5, false]];
    const xml = buildSheetXml(rows);
    const back = parseSheetXml(xml, []);
    expect(back[0]).toEqual(['Name', 'Qty', 'Ok']);
    expect(back[1]).toEqual(['Widget & Co', 3, true]);
    expect(back[2][1]).toBe(4.5);
  });
  it('xlsx package round-trip via jszip', async () => {
    // Build a minimal valid xlsx from scratch
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
    zip.file('xl/worksheets/sheet1.xml', buildSheetXml([['h1', 'h2'], ['a', 1]]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const reparsed = await JSZip.loadAsync(bytes);
    const doc = await parseXlsxBytes(reparsed as any);
    expect(doc.sheets[0].name).toBe('S1');
    expect(doc.sheets[0].rows).toEqual([['h1', 'h2'], ['a', 1]]);
    // edit + reserialize + reparse
    doc.sheets[0].rows.push(['b', 2]);
    const out = await serializeXlsxBytes(reparsed as any, doc);
    const z2 = await JSZip.loadAsync(out);
    const doc2 = await parseXlsxBytes(z2 as any);
    expect(doc2.sheets[0].rows[2]).toEqual(['b', 2]);
  });
});
