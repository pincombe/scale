// Guards the core contract: src/core and src/lib stay pure (no app/render/audio/ui imports, no
// DOM, no clocks or Math.random), so the game logic runs headless in Node and stays deterministic.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const IMPORT_RE = /(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
const FORBIDDEN_GLOBALS =
  /\b(document|window|globalThis|navigator|localStorage|sessionStorage|requestAnimationFrame|setTimeout|setInterval|queueMicrotask|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|OffscreenCanvas|AudioContext|Image|fetch|performance|crypto)\b|\bnew\s+Date\b|\bDate\s*\.\s*now\b|Math\.random/;

/** Relative imports must resolve inside one of `folders`; bare imports must be in `packages`. */
function check(folder: 'core' | 'lib', folders: string[], packages: string[]): string[] {
  const problems: string[] = [];
  const roots = folders.map((f) => join(SRC, f) + sep);
  for (const file of sources(join(SRC, folder))) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const rel = relative(SRC, file);
    for (const m of code.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3] ?? '';
      const ok = spec.startsWith('.') ? roots.some((r) => (resolve(dirname(file), spec) + sep).startsWith(r)) : packages.includes(spec);
      if (!ok) problems.push(`${rel}: imports '${spec}'`);
    }
    const g = code.match(FORBIDDEN_GLOBALS);
    if (g) problems.push(`${rel}: uses '${g[0]}'`);
  }
  return problems;
}

describe('purity', () => {
  it('src/core imports only core, lib and break_infinity.js, and touches no DOM or clock', () => {
    const problems = check('core', ['core', 'lib'], ['break_infinity.js']);
    expect(problems).toEqual([]);
  });

  it('src/lib imports only lib, and touches no DOM or clock', () => {
    const problems = check('lib', ['lib'], []);
    expect(problems).toEqual([]);
  });

  it('the forbidden-globals pattern catches clocks, timers and host objects', () => {
    for (const bad of ['new Date()', 'Date.now()', 'performance.now()', 'setTimeout(f, 1)', 'setInterval(f, 1)', 'crypto.getRandomValues(a)', 'globalThis.x', 'window.x', 'document.body', 'Math.random()']) {
      expect(FORBIDDEN_GLOBALS.test(bad), bad).toBe(true);
    }
    for (const ok of ['const dateLike = 1', 'state.t += dt', 'nextFloat(rng)', 'updateDocs()']) {
      expect(FORBIDDEN_GLOBALS.test(ok), ok).toBe(false);
    }
  });

  it('the scan actually sees the sources', () => {
    expect(sources(join(SRC, 'core')).length).toBeGreaterThan(5);
    expect(sources(join(SRC, 'lib')).length).toBeGreaterThan(3);
  });
});
