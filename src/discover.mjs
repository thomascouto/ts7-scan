// @ts-check
// Monorepo-aware discovery of installed packages: find every relevant
// node_modules (root, workspaces, pnpm virtual store) and enumerate packages.

import fs from 'node:fs';
import path from 'node:path';

const MAX_DEPTH = 6;

/**
 * Parse a JSON file, returning null on any error.
 * @param {string} p
 * @returns {any}
 */
export function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Collect every relevant node_modules dir reachable from `root`:
 *   - the root's node_modules,
 *   - each workspace's own node_modules (tree walk to MAX_DEPTH, skipping
 *     dot-dirs),
 *   - the pnpm virtual store (`node_modules/.pnpm/&#42;/node_modules`).
 * Does NOT descend into node_modules via the normal tree walk — the pnpm store
 * already covers non-hoisted packages.
 * @param {string} root
 * @returns {string[]}
 */
export function collectNmDirs(root) {
  const dirs = new Set();
  (function walk(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'node_modules') {
        const nm = path.join(dir, 'node_modules');
        dirs.add(nm);
        const pnpm = path.join(nm, '.pnpm');
        if (fs.existsSync(pnpm)) {
          let stores;
          try { stores = fs.readdirSync(pnpm, { withFileTypes: true }); } catch { stores = []; }
          for (const p of stores) {
            if (!p.isDirectory()) continue;
            const inner = path.join(pnpm, p.name, 'node_modules');
            if (fs.existsSync(inner)) dirs.add(inner);
          }
        }
        // deliberately do not recurse into node_modules here
      } else if (depth < MAX_DEPTH && !e.name.startsWith('.')) {
        walk(path.join(dir, e.name), depth + 1);
      }
    }
  })(root, 0);
  return [...dirs];
}

/**
 * Enumerate every installed package directory directly under a node_modules
 * dir, including scoped `@org/*` packages.
 * @param {string} nmDir
 * @returns {Generator<string>}
 */
export function* listInstalled(nmDir) {
  let entries;
  try { entries = fs.readdirSync(nmDir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(nmDir, entry.name);
    if (entry.name.startsWith('@')) {
      let subs;
      try { subs = fs.readdirSync(full, { withFileTypes: true }); } catch { continue; }
      for (const sub of subs) if (sub.isDirectory()) yield path.join(full, sub.name);
    } else if (entry.isDirectory()) {
      yield full;
    }
  }
}
