// Size guard: dist/index.html must be one self-contained file under 1 MB raw.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const FILE = 'dist/index.html';
const HARD_LIMIT = 1_000_000;
const WARN_LIMIT = 500_000;

const html = readFileSync(FILE);
const text = html.toString('utf8');
const raw = html.length;
const gzip = gzipSync(html, { level: 9 }).length;

// Base64 data URIs for fonts (reported so the font budget stays visible).
let fontBytes = 0;
for (const m of text.matchAll(/data:font\/[\w+.-]+;base64,[A-Za-z0-9+/=]+/g)) fontBytes += m[0].length;

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`${FILE}: ${raw} bytes raw (${kb(raw)}), ${gzip} bytes gzip (${kb(gzip)}), fonts ${kb(fontBytes)}`);

// External references: src=/href= attributes and CSS url() that aren't data: URIs or #fragments.
const refs = [
  ...[...text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/g)].map((m) => m[1]),
  ...[...text.matchAll(/url\(\s*["']?([^"')]*)["']?\s*\)/g)].map((m) => m[1]),
];
const external = refs.filter((v) => {
  const s = v.trim();
  return s !== '' && !s.startsWith('data:') && !s.startsWith('#');
});

let failed = false;
if (external.length > 0) {
  console.error(`FAIL: ${external.length} external reference(s):`);
  for (const v of new Set(external)) console.error(`  ${v.slice(0, 120)}`);
  failed = true;
}
if (raw > HARD_LIMIT) {
  console.error(`FAIL: ${raw} bytes exceeds the ${HARD_LIMIT} byte limit`);
  failed = true;
} else if (raw > WARN_LIMIT) {
  console.warn(`WARN: ${raw} bytes is over the ${WARN_LIMIT} byte soft budget`);
}

if (failed) process.exit(1);
console.log('size: OK');
