// @ts-check
// Static analysis of a single installed package: does it admit TS 7, and does
// it call the (removed-in-7.0) Compiler API? Plus final status classification.

import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';

/** TypeScript version we test declared ranges against. */
export const TS7 = '7.0.0';

/**
 * Symbols of the TypeScript Compiler API (Strada). Removed in TS 7.0 — any lib
 * that both imports `typescript` and mentions one of these breaks with a
 * TypeError under the native compiler until the API returns in 7.1.
 */
export const API_SYMBOLS = [
  'createProgram', 'transpileModule', 'createLanguageService', 'createPrinter',
  'createSourceFile', 'getTypeChecker', 'createWatchProgram', 'createCompilerHost',
  'transformNodes', 'createTypeChecker', 'LanguageServiceHost',
];

const API_RE = new RegExp(`\\b(${API_SYMBOLS.join('|')})\\b`);
const IMPORTS_TS_RE = /(require\(['"]typescript['"]\)|from\s+['"]typescript['"])/;

/**
 * @typedef {'peer' | 'dep' | 'dev' | null} RangeSource
 */

/**
 * The `typescript` range a package declares, plus WHERE it's declared. The
 * source matters to a consumer: a `peer`/`dep` range that excludes 7 can affect
 * your build, but a `dev`-only range is just how the lib builds itself and
 * carries no consumer risk. `peerDependencies` wins, then `dependencies`, then
 * `devDependencies`.
 * @param {Record<string, any>} pkg parsed package.json
 * @returns {{ range: string | null, src: RangeSource }}
 */
export function tsRangeOf(pkg) {
  if (pkg.peerDependencies?.typescript != null) return { range: pkg.peerDependencies.typescript, src: 'peer' };
  if (pkg.dependencies?.typescript != null) return { range: pkg.dependencies.typescript, src: 'dep' };
  if (pkg.devDependencies?.typescript != null) return { range: pkg.devDependencies.typescript, src: 'dev' };
  return { range: null, src: null };
}

/**
 * Does the declared range admit TS 7?
 * @param {string | null | undefined} range
 * @returns {boolean | null} true/false, or null when the range is not evaluable
 *   (e.g. `workspace:*`, or otherwise invalid/exotic).
 */
export function admitsTs7(range) {
  if (!range || range === '*' || range === 'latest') return true;
  const opts = { includePrerelease: true };
  if (semver.validRange(range, opts) == null) return null;
  return semver.satisfies(TS7, range, opts);
}

/**
 * Candidate entrypoint files to scan for Compiler API usage: `main`, `module`,
 * any `.js/.mjs/.cjs` referenced in `exports`, and `index.js`.
 * @param {string} dir package directory
 * @param {Record<string, any>} pkg
 * @returns {Set<string>}
 */
function entrypointCandidates(dir, pkg) {
  const candidates = new Set();
  if (typeof pkg.main === 'string') candidates.add(path.join(dir, pkg.main));
  if (typeof pkg.module === 'string') candidates.add(path.join(dir, pkg.module));
  if (pkg.exports && typeof pkg.exports === 'object') {
    const matches = JSON.stringify(pkg.exports).match(/"(\.[^"]+\.(?:js|mjs|cjs))"/g) ?? [];
    for (const m of matches) candidates.add(path.join(dir, m.slice(1, -1)));
  }
  candidates.add(path.join(dir, 'index.js'));
  return candidates;
}

/**
 * Heuristic: does this package actually call the Compiler API? True only if an
 * entrypoint both imports/requires `typescript` and mentions an API symbol.
 * An unreadable entrypoint yields false — never throws.
 * @param {string} dir package directory
 * @param {Record<string, any>} pkg
 * @returns {boolean}
 */
export function usesCompilerApi(dir, pkg) {
  for (const file of entrypointCandidates(dir, pkg)) {
    try {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (IMPORTS_TS_RE.test(src) && API_RE.test(src)) return true;
    } catch { /* unreadable entrypoint — ignore */ }
  }
  return false;
}

/**
 * Final status, in precedence order.
 *   BLOCKER — calls the removed Compiler API and doesn't admit 7 (hard break).
 *   (dev-only ranges carry no consumer risk → OK, unless they hit BLOCKER above)
 *   BUMP    — a peer/dep range excludes 7 (you may need a newer release).
 *   UNKNOWN — a peer/dep range isn't evaluable (workspace:*, dist-tag, exotic).
 *   OK      — admits 7, or the range is dev-only.
 * @param {{ usesApi: boolean, admitsTs7: boolean | null, src: RangeSource }} r
 * @returns {'BLOCKER' | 'BUMP' | 'UNKNOWN' | 'OK'}
 */
export function classify(r) {
  if (r.usesApi && r.admitsTs7 !== true) return 'BLOCKER';
  if (r.src === 'dev') return 'OK'; // dev-only typescript: how the lib builds itself, not your concern
  if (r.admitsTs7 === false) return 'BUMP';
  if (r.admitsTs7 === null) return 'UNKNOWN';
  return 'OK';
}
