// @ts-check
// Shared test helpers: build real package trees in temp dirs (no fs mocking).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @type {string[]} */
const created = [];

/** Make a fresh temp dir; auto-tracked for cleanup via cleanupTmp(). */
export function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts7-scan-'));
  created.push(dir);
  return dir;
}

/** Remove all temp dirs created via mkTmp(). */
export function cleanupTmp() {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Write a package under `nmDir/<name>`: package.json + optional entry file.
 * @param {string} nmDir a node_modules directory
 * @param {string} name package name (may be scoped)
 * @param {object} [opts]
 * @param {Record<string, any>} [opts.pkg] extra package.json fields
 * @param {string} [opts.version]
 * @param {string} [opts.tsRangePeer]
 * @param {string} [opts.tsRangeDep]
 * @param {string} [opts.tsRangeDev]
 * @param {string} [opts.main] entry filename (relative)
 * @param {string} [opts.mainSrc] entry file contents
 * @returns {string} the package directory
 */
export function writePkg(nmDir, name, opts = {}) {
  const dir = path.join(nmDir, ...name.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  const pkg = {
    name,
    version: opts.version ?? '1.0.0',
    ...(opts.tsRangePeer ? { peerDependencies: { typescript: opts.tsRangePeer } } : {}),
    ...(opts.tsRangeDep ? { dependencies: { typescript: opts.tsRangeDep } } : {}),
    ...(opts.tsRangeDev ? { devDependencies: { typescript: opts.tsRangeDev } } : {}),
    ...(opts.main ? { main: opts.main } : {}),
    ...(opts.pkg ?? {}),
  };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  if (opts.main && opts.mainSrc != null) {
    const entry = path.join(dir, opts.main);
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, opts.mainSrc);
  }
  return dir;
}

/** mkdir -p and return the path. */
export function ensureDir(...segments) {
  const dir = path.join(...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
