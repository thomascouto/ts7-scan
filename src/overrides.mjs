// @ts-check
// Manual / community verdicts that override the heuristic.

import fs from 'node:fs';
import path from 'node:path';
import { readJSON } from './discover.mjs';

/**
 * @typedef {{ compatible?: boolean, note?: string }} Override
 */

/**
 * Load overrides from `--overrides <file>` if given, else `ts7-overrides.json`
 * in cwd. Shape: `{ "<lib>": { "compatible": true|false, "note": "..." } }`.
 * @param {string} cwd
 * @param {string | null} [overridesArg] explicit path from --overrides
 * @returns {{ data: Record<string, Override>, from: string | null }}
 */
export function loadOverrides(cwd, overridesArg = null) {
  const candidates = [];
  if (overridesArg) candidates.push(path.resolve(overridesArg));
  candidates.push(path.join(cwd, 'ts7-overrides.json'));
  for (const p of candidates) {
    if (fs.existsSync(p)) return { data: readJSON(p) || {}, from: p };
  }
  return { data: {}, from: null };
}

/**
 * Apply an override to a row in place. `compatible:true` → OK, `false` →
 * BLOCKER; marks the row and attaches the note.
 * @param {Record<string, any>} row row with a `.name` and `.status`
 * @param {Record<string, Override>} overrides
 * @returns {Record<string, any>} the same row, mutated
 */
export function applyOverride(row, overrides) {
  const ov = overrides[row.name];
  if (ov && typeof ov.compatible === 'boolean') {
    row.status = ov.compatible ? 'OK' : 'BLOCKER';
    row.override = true;
    if (ov.note) row.note = ov.note;
  }
  return row;
}
