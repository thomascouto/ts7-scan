// @ts-check
// Orchestration: collect installed libs, classify each, apply overrides, and
// optionally check the registry for updates. Pure — no console output.

import path from 'node:path';
import { collectNmDirs, listInstalled, readJSON } from './discover.mjs';
import { tsRangeOf, admitsTs7, usesCompilerApi, classify } from './analyze.mjs';
import { loadOverrides, applyOverride } from './overrides.mjs';
import { latestAdmitsTs7 } from './registry.mjs';

export { collectNmDirs, listInstalled, readJSON } from './discover.mjs';
export { tsRangeOf, admitsTs7, usesCompilerApi, classify } from './analyze.mjs';
export { loadOverrides, applyOverride } from './overrides.mjs';
export { latestAdmitsTs7 } from './registry.mjs';
export { renderReport, vlen } from './render.mjs';

/**
 * @typedef {object} ScanResult
 * @property {string[]} nmDirs node_modules dirs scanned
 * @property {string | null} overridesFrom overrides file used, if any
 * @property {Array<Record<string, any>>} rows classified rows
 */

/**
 * Collect and classify every lib that declares `typescript`, deduped by
 * name@version across all node_modules dirs.
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string | null} [opts.overridesArg]
 * @returns {{ nmDirs: string[] } | ScanResult}
 *   Returns `{ nmDirs: [] }` (rows omitted) when no node_modules is found so
 *   the caller can exit 2.
 */
export function scan({ cwd, overridesArg = null }) {
  const nmDirs = collectNmDirs(cwd);
  if (nmDirs.length === 0) return { nmDirs };

  const { data: overrides, from: overridesFrom } = loadOverrides(cwd, overridesArg);

  /** @type {Map<string, Record<string, any>>} */
  const seen = new Map();
  for (const nmDir of nmDirs) {
    for (const dir of listInstalled(nmDir)) {
      const pkg = readJSON(path.join(dir, 'package.json'));
      if (!pkg?.name) continue;
      const { range, src } = tsRangeOf(pkg);
      if (!range) continue; // doesn't touch TypeScript — irrelevant
      const key = `${pkg.name}@${pkg.version ?? '?'}`;
      const prev = seen.get(key);
      if (prev) {
        // Same name@version seen in another dir: a positive API signal wins.
        if (!prev.usesApi) prev.usesApi = usesCompilerApi(dir, pkg);
        continue;
      }
      seen.set(key, {
        name: pkg.name,
        installed: pkg.version ?? '?',
        tsRange: range,
        src,
        admitsTs7: admitsTs7(range),
        usesApi: usesCompilerApi(dir, pkg),
      });
    }
  }

  const rows = [...seen.values()];
  for (const r of rows) {
    r.status = classify(r);
    applyOverride(r, overrides);
  }

  return { nmDirs, overridesFrom, rows };
}

/**
 * Populate `.latest` / `.latestAdmitsTs7` on BUMP rows (range excludes 7) from
 * the registry.
 * @param {Array<Record<string, any>>} rows
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<void>}
 */
export async function checkUpdates(rows, fetchImpl = fetch) {
  await Promise.all(
    rows.filter((r) => r.admitsTs7 === false).map(async (r) => {
      const u = await latestAdmitsTs7(r.name, fetchImpl);
      r.latest = u.latest;
      r.latestAdmitsTs7 = u.admits;
    }),
  );
}
