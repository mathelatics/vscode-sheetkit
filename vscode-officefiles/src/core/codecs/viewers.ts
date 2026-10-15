// Read-only text extraction for parity viewers: PPTX, EPUB, ZIP archives.
// Deliberately dependency-free (regex over XML / central-directory parsing) so it runs in the
// extension host AND in headless tests. Parity with vscode-office's read-only pptx/epub support,
// but exposed as IR + agent-readable text instead of render-only.
import { DocIR, BlockIR } from '../ir';

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_a, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');

/** Extract slide text from a pptx package (JSZip instance). One heading block per slide + paragraph blocks. */
export async function parsePptxBytes(zip: any): Promise<DocIR> {
  const names: string[] = Object.keys(zip.files ?? {})
    .filter((n: string) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a: string, b: string) => (/(\d+)\.xml$/.exec(a)?.[1] ?? '0') > (/(\d+)\.xml$/.exec(b)?.[1] ?? '0') ? 1 : -1);
  if (!names.length) throw new Error('Not a pptx: no slides found');
  const blocks: BlockIR[] = [];
  for (let i = 0; i < names.length; i++) {
    const xml = await zip.file(names[i]).async('string') as string;
    blocks.push({ type: 'heading', level: 1, text: `Slide ${i + 1}`, page: i + 1 } as any);
    // a:p paragraphs -> join their a:t runs
    for (const pm of xml.matchAll(/<a:p\b[\s\S]*?(?:<\/a:p>|\/>)/g)) {
      const text = [...pm[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(m => unesc(m[1])).join('');
      if (text.trim()) blocks.push({ type: 'paragraph', text, page: i + 1 } as any);
    }
  }
  return { kind: 'document', blocks };
}

/** Extract readable text from an epub: spine-ordered html/xhtml parts, tags stripped. */
export async function parseEpubBytes(zip: any): Promise<DocIR> {
  const opfName = Object.keys(zip.files ?? {}).find((n: string) => /\.opf$/i.test(n));
  let docNames: string[] = [];
  if (opfName) {
    const opf = await zip.file(opfName).async('string') as string;
    const base = opfName.replace(/[^/]*$/, '');
    const manifest: Record<string, string> = {};
    for (const m of opf.matchAll(/<item\b([^>]*)\/?>/g)) {
      const id = /id="([^"]+)"/.exec(m[1])?.[1];
      const href = /href="([^"]+)"/.exec(m[1])?.[1];
      const type = /media-type="([^"]+)"/.exec(m[1])?.[1] ?? '';
      if (id && href && /xhtml|html/.test(type)) manifest[id] = base + decodeURIComponent(href);
    }
    for (const m of opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)) {
      const p = manifest[m[1]];
      if (p && zip.file(p)) docNames.push(p);
    }
  }
  if (!docNames.length) docNames = Object.keys(zip.files ?? {}).filter((n: string) => /\.(x?html?)$/i.test(n)).sort();
  if (!docNames.length) throw new Error('Not an epub: no content documents found');
  const blocks: BlockIR[] = [];
  for (let i = 0; i < docNames.length; i++) {
    const html = (await zip.file(docNames[i]).async('string') as string)
      .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    for (const hm of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
      const t = hm[2].replace(/<[^>]+>/g, '').trim();
      if (t) blocks.push({ type: 'heading', level: Math.min(parseInt(hm[1], 10), 6), text: unesc(t), page: i + 1 } as any);
    }
    for (const pm of html.matchAll(/<(?:p|li|blockquote)\b[^>]*>([\s\S]*?)<\/(?:p|li|blockquote)>/gi)) {
      const t = pm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (t) blocks.push({ type: 'paragraph', text: unesc(t), page: i + 1 } as any);
    }
  }
  return { kind: 'document', blocks };
}

/** List entries of a zip-family archive by parsing the End Of Central Directory + central directory. */
export function listZipEntries(bytes: Uint8Array): { name: string; size: number; compressed: number }[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Find EOCD signature 0x06054b50 within last 64KiB+22
  let eocd = -1;
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip archive (EOCD not found)');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out: { name: string; size: number; compressed: number }[] = [];
  const td = new TextDecoder();
  for (let n = 0; n < count && off + 46 <= bytes.length; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const compressed = dv.getUint32(off + 20, true);
    const size = dv.getUint32(off + 24, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const name = td.decode(bytes.subarray(off + 46, off + 46 + nameLen));
    out.push({ name, size, compressed });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export const ARCHIVE_EXTS = ['.zip', '.docx', '.xlsx', '.pptx', '.epub', '.vsix', '.jar'];
