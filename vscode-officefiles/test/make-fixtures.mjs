// Generates small, valid sample Office files into ./fixtures for manual testing in the Extension
// Development Host. Run: `node test/make-fixtures.mjs`. Pure JSZip — no external office libraries.
import JSZip from 'jszip';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'fixtures');
mkdirSync(out, { recursive: true });

const xesc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function write(name, zip) {
  writeFileSync(join(out, name), await zip.generateAsync({ type: 'nodebuffer' }));
}

async function makeXlsx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  const rows = [
    ['Item', 'Qty', 'Price', 'Total'],
    ['Widget', 3, 4.5, '=B2*C2'],
    ['Gadget', 10, 2.25, '=B3*C3'],
    ['Gizmo', 7, 9.99, '=B4*C4'],
  ];
  const data = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = String.fromCharCode(65 + ci) + (ri + 1);
    return typeof v === 'number'
      ? `<c r="${ref}"><v>${v}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xesc(String(v))}</t></is></c>`;
  }).join('')}</row>`).join('');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`);
  await write('budget.xlsx', zip);
}

async function makeDocx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>OfficeFiles Demo Document</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">This is a sample Word document generated for testing.</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Agents can read and edit these paragraphs as blocks.</w:t></w:r></w:p></w:body></w:document>`);
  await write('report.docx', zip);
}

async function makePptx() {
  const zip = new JSZip();
  const slide = (lines) => `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:sp><p:txBody>${lines.map(t => `<a:p><a:r><a:t>${xesc(t)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp></p:cSld></p:sld>`;
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`);
  zip.file('ppt/slides/slide1.xml', slide(['OfficeFiles Deck', 'Agent-editable presentations']));
  zip.file('ppt/slides/slide2.xml', slide(['Second Slide', 'Read-only preview for now']));
  await write('deck.pptx', zip);
}

async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('OEBPS/content.opf', `<package><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/><itemref idref="ch2"/></spine></package>`);
  zip.file('OEBPS/ch1.xhtml', '<html><body><h1>Chapter One</h1><p>The first chapter of the OfficeFiles sample ebook.</p></body></html>');
  zip.file('OEBPS/ch2.xhtml', '<html><body><h1>Chapter Two</h1><p>The second chapter continues the story.</p></body></html>');
  await write('book.epub', zip);
}

async function makeZip() {
  const zip = new JSZip();
  zip.file('readme.txt', 'OfficeFiles sample archive.\n');
  zip.file('data/config.json', '{"hello":"world"}\n');
  zip.file('data/table.csv', 'a,b\n1,2\n');
  await write('site.zip', zip);
}

function makeTextFixtures() {
  writeFileSync(join(out, 'data.tsv'), 'name\tqty\tprice\nWidget\t3\t4.5\nGadget\t10\t2.25\n');
  writeFileSync(join(out, 'data.json'), JSON.stringify([
    { name: 'Widget', qty: 3, price: 4.5 },
    { name: 'Gadget', qty: 10, price: 2.25 },
    { name: 'Gizmo', qty: 7, price: 9.99 },
  ], null, 2) + '\n');
}

async function makePdf() {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([320, 200]);
  page.drawText('OfficeFiles sample PDF', { x: 20, y: 150, size: 16, font });
  page.drawText('Agents can extract this text per page.', { x: 20, y: 120, size: 11, font });
  page.drawText('Second line for search.', { x: 20, y: 100, size: 11, font });
  writeFileSync(join(out, 'sample.pdf'), Buffer.from(await doc.save()));
}

await Promise.all([makeXlsx(), makeDocx(), makePptx(), makeEpub(), makeZip(), makePdf()]);
makeTextFixtures();
console.log('fixtures written to', out);
