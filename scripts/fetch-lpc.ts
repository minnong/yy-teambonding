// Downloads the Universal LPC walk sheets listed in assets/lpc-manifest.json at the pinned
// commit, recolours where required, writes public/assets/lpc/**, fills in credits in the
// manifest and generates CREDITS.md (+ public/CREDITS.md). Run: npx tsx scripts/fetch-lpc.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, 'assets/lpc-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const raw = (p: string) => `https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/${manifest.sha}/${p}`;

async function get(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// ---- credits (CREDITS.csv at the pinned sha) ----
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

async function main() {
  const csv = parseCsv((await get(raw('CREDITS.csv'))).toString('utf8'));
  const credit = new Map(csv.slice(1).map((r) => [r[0]!, { notes: r[1]!.trim(), authors: split(r[2]!), licenses: split(r[3]!), urls: split(r[4]!) }]));
  const lookup = (path: string) => credit.get(path) ?? credit.get(path.replace(/\/walk\/[^/]+\.png$/, '/walk.png'));

  const palettes = JSON.parse((await get(raw('palette_definitions/body/body_ulpc.json'))).toString('utf8')) as Record<string, string[]>;

  const cache = new Map<string, PNG>();
  const load = async (p: string) => {
    if (!cache.has(p)) cache.set(p, PNG.sync.read(await get(raw(`spritesheets/${p}`))));
    return cache.get(p)!;
  };

  for (const f of manifest.files) {
    let out: PNG | null = null;
    f.sources = f.sources.map((s: { path: string; skin?: boolean }) => s);
    for (const s of f.sources) {
      const src = await load(s.path);
      if (src.width !== 576 || src.height !== 256) throw new Error(`${s.path}: expected 576x256 walk sheet, got ${src.width}x${src.height}`);
      const img = new PNG({ width: 576, height: 256 });
      src.data.copy(img.data);
      if (s.skin && f.skinPalette) {
        const from = palettes.light!.map(hex), to = palettes[f.skinPalette]!.map(hex);
        for (let i = 0; i < img.data.length; i += 4) {
          if (!img.data[i + 3]) continue;
          let best = 0, bd = Infinity;
          from.forEach((c, k) => { const d = (c[0]! - img.data[i]!) ** 2 + (c[1]! - img.data[i + 1]!) ** 2 + (c[2]! - img.data[i + 2]!) ** 2; if (d < bd) { bd = d; best = k; } });
          if (bd < 40 * 40) for (let c = 0; c < 3; c++) img.data[i + c] = to[best]![c]!;
        }
      }
      if (f.recolor === 'grey') {
        // Neutral grey ramp (lightest = white) so Phaser multiply-tint gives true colours.
        let max = 1;
        const lum = (i: number) => 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
        for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3]) max = Math.max(max, lum(i));
        for (let i = 0; i < img.data.length; i += 4) {
          if (!img.data[i + 3]) continue;
          const v = Math.min(255, Math.round((lum(i) / max) * 255));
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        }
      }
      if (!out) out = img;
      else for (let i = 0; i < img.data.length; i += 4) { // alpha-over composite
        const a = img.data[i + 3]! / 255; if (!a) continue;
        const oa = out.data[i + 3]! / 255, ra = a + oa * (1 - a);
        for (let c = 0; c < 3; c++) out.data[i + c] = Math.round((img.data[i + c]! * a + out.data[i + c]! * oa * (1 - a)) / ra);
        out.data[i + 3] = Math.round(ra * 255);
      }
      const c = lookup(`${s.path}`);
      if (!c || !c.licenses.length || !c.authors.length) throw new Error(`missing licence info for ${s.path}`);
      s.credit = c;
      s.url = `https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/${manifest.sha}/spritesheets/${s.path}`;
    }
    const dest = resolve(root, 'public/assets/lpc', f.file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, PNG.sync.write(out!));
    console.log('wrote', f.file);
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const LICENCE_URLS: [RegExp, string][] = [
    [/^CC0/, 'https://creativecommons.org/publicdomain/zero/1.0/'],
    [/^CC-BY-SA 3/, 'https://creativecommons.org/licenses/by-sa/3.0/'],
    [/^CC-BY-SA 4/, 'https://creativecommons.org/licenses/by-sa/4.0/'],
    [/^CC-BY 3/, 'https://creativecommons.org/licenses/by/3.0/'],
    [/^CC-BY 4/, 'https://creativecommons.org/licenses/by/4.0/'],
    [/^GPL 3/, 'https://www.gnu.org/licenses/gpl-3.0.html'],
    [/^OGA-BY 3/, 'https://opengameart.org/content/oga-by-30-faq'],
  ];
  const present = new Set<string>();
  for (const f of manifest.files) for (const s of f.sources) for (const l of s.credit.licenses as string[]) present.add(l);
  const licenceLinks = [...present].sort().map((l) => {
    const hit = LICENCE_URLS.find(([re]) => re.test(l));
    if (!hit) throw new Error(`no licence text URL known for "${l}"`);
    return `[${l}](${hit[1]})`;
  });

  const how = (f: any) => {
    const m: string[] = [];
    if (f.sources.length > 1) m.push('merged from ' + f.sources.length + ' sheets (' + f.sources.map((x: any) => x.path.split('/').slice(0, -1).join('/')).join(' + ') + ')');
    if (f.skinPalette) m.push(`skin recoloured to the "${f.skinPalette}" palette`);
    if (f.recolor === 'grey') m.push('recoloured to a neutral grey ramp for runtime tinting');
    return m.length ? 'MODIFIED: ' + m.join('; ') : 'unmodified';
  };

  const seen = new Map<string, { authors: string[]; licenses: string[]; urls: string[]; files: string[] }>();
  for (const f of manifest.files) for (const s of f.sources) {
    const key = s.path.replace(/\/walk(\/[^/]+)?\.png$/, '');
    const e = seen.get(key) ?? { authors: s.credit.authors, licenses: s.credit.licenses, urls: s.credit.urls, files: [] as string[] };
    e.files.push(`\`${f.file}\` (${how(f)})`); seen.set(key, e);
  }
  let md = `# Credits\n\nCharacter art comes from the [Universal LPC Spritesheet Character Generator](${manifest.repo}) (commit \`${manifest.sha}\`), which bundles Liberated Pixel Cup assets by many artists. Only the walk animation is used. Some sheets are modified (recoloured, or merged into one sheet); each section below says which shipped files derive from it and how. Derivatives stay under the original licences listed per asset.\n\nLicence texts: ${licenceLinks.join(', ')}.\n\n`;
  for (const [path, e] of [...seen].sort()) {
    md += `## ${path}\n\n- Authors: ${e.authors.join(', ')}\n- Licence: ${e.licenses.join(', ')}\n- Sources: ${e.urls.map((u) => `<${u}>`).join(', ')}\n- Repo path: \`spritesheets/${path}\`\n- Used in: ${e.files.join('; ')}\n\n`;
  }
  writeFileSync(resolve(root, 'CREDITS.md'), md);
  mkdirSync(resolve(root, 'public'), { recursive: true });
  writeFileSync(resolve(root, 'public/CREDITS.md'), md);
  console.log('CREDITS.md written');
}
main().catch((e) => { console.error(e); process.exit(1); });
