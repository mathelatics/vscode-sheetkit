// Markdown codec: text <-> DocIR (block-level). Deliberately lossless-ish: each block keeps its raw source.
import { BlockIR, DocIR } from '../ir';

export function parseMarkdown(text: string): DocIR {
  const blocks: BlockIR[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      blocks.push({ type: 'code', text: body.join('\n'), lang });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2] }); i++; continue; }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      let ordered = false; let bullet = '-';
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const m = /^\s*(?:([-*+])|(\d+\.))\s+/.exec(lines[i])!;
        if (m[2]) ordered = true; else bullet = m[1];
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', text: '', items, ordered, bullet });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i].replace(/^>\s?/, '')), i++;
      blocks.push({ type: 'quote', text: q.join(' ') });
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    // paragraph: consume until blank/other block start
    const p: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s)/.test(lines[i])) p.push(lines[i++]);
    blocks.push({ type: 'paragraph', text: p.join('\n') });
  }
  return { kind: 'document', blocks };
}

export function serializeMarkdown(doc: DocIR): string {
  return doc.blocks.map(b => renderBlock(b)).join('\n\n') + '\n';
}

function renderBlock(b: BlockIR): string {
  switch (b.type) {
    case 'heading': return '#'.repeat(Math.min(b.level ?? 1, 6)) + ' ' + b.text;
    case 'code': return '```' + (b.lang ?? '') + '\n' + b.text + '\n```';
    case 'list': return (b.items ?? []).map((it, idx) => `${b.ordered ? `${idx + 1}.` : (b.bullet ?? '-')} ${it}`).join('\n') || b.text;
    case 'quote': return '> ' + b.text;
    case 'image': return b.text; // already markdown syntax
    default: return b.text;
  }
}
