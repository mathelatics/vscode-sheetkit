import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import JSZip from 'jszip';
import { parseCsv } from '../src/core/codecs/csv';
import { parseMarkdown } from '../src/core/codecs/markdown';
import { parseXlsxBytes, parseDocxBytes } from '../src/core/codecs/ooxml';
import { parsePptxBytes, parseEpubBytes, listZipEntries } from '../src/core/codecs/viewers';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const read = (name: string) => readFileSync(join(fixtures, name));
const asZip = (name: string) => JSZip.loadAsync(read(name));

describe('fixtures: sample files parse via our codecs', () => {
  it('budget.xlsx -> table IR with expected cells', async () => {
    const doc = await parseXlsxBytes((await asZip('budget.xlsx')) as any);
    expect(doc.kind).toBe('table');
    expect(doc.sheets[0].name).toBe('Sheet1');
    expect(doc.sheets[0].rows[0]).toEqual(['Item', 'Qty', 'Price', 'Total']);
    expect(doc.sheets[0].rows[1][0]).toBe('Widget');
    expect(doc.sheets[0].rows[1][1]).toBe(3);
  });

  it('report.docx -> document IR with paragraphs', async () => {
    const doc = await parseDocxBytes((await asZip('report.docx')) as any);
    expect(doc.kind).toBe('document');
    const texts = doc.blocks.map(b => b.text);
    expect(texts[0]).toBe('OfficeFiles Demo Document');
    expect(texts.join(' ')).toContain('sample Word document');
  });

  it('deck.pptx -> slides with text', async () => {
    const doc = await parsePptxBytes((await asZip('deck.pptx')) as any);
    const texts = doc.blocks.map(b => (b as any).text);
    expect(texts).toContain('OfficeFiles Deck');
    expect(texts).toContain('Second Slide');
  });

  it('book.epub -> spine-ordered chapters', async () => {
    const doc = await parseEpubBytes((await asZip('book.epub')) as any);
    const texts = doc.blocks.map(b => (b as any).text);
    expect(texts.indexOf('Chapter One')).toBeLessThan(texts.indexOf('Chapter Two'));
  });

  it('site.zip -> central directory listing', () => {
    const entries = listZipEntries(read('site.zip')).map(e => e.name);
    expect(entries).toContain('readme.txt');
    expect(entries).toContain('data/config.json');
  });

  it('data.csv + notes.md parse', () => {
    expect((parseCsv(read('data.csv').toString()) as any).sheets[0].rows.length).toBeGreaterThan(0);
    expect(parseMarkdown(read('notes.md').toString()).blocks.length).toBeGreaterThan(0);
  });
});
