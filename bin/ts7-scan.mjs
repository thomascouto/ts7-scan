#!/usr/bin/env node
// @ts-check
// ts7-scan — static scan of installed deps for TypeScript 7 compatibility.
// Thin entry: parse flags, orchestrate, render or emit JSON, set exit code.
//
// Usage:
//   node bin/ts7-scan.mjs [--json] [--check-updates] [--cwd <dir>]
//                         [--overrides <file>] [--all] [--no-color]

import path from 'node:path';
import { scan, checkUpdates } from '../src/index.mjs';
import { renderReport, countStatus } from '../src/render.mjs';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const argVal = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };

const asJson = has('--json');
const wantUpdates = has('--check-updates');
const showAll = has('--all');
const noColor = has('--no-color') || Boolean(process.env.NO_COLOR);
const cwd = argVal('--cwd') ? path.resolve(/** @type {string} */(argVal('--cwd'))) : process.cwd();

const result = scan({ cwd, overridesArg: argVal('--overrides') });

if (result.nmDirs.length === 0) {
  console.error(`Nenhum node_modules encontrado a partir de ${cwd}. Rode o install primeiro (ou passe --cwd).`);
  process.exit(2);
}

const { nmDirs, overridesFrom, rows } = /** @type {import('../src/index.mjs').ScanResult} */ (result);

if (wantUpdates) await checkUpdates(rows);

const exitCode = countStatus(rows, 'BLOCKER') > 0 ? 1 : 0;

if (asJson) {
  console.log(JSON.stringify({
    scanned: { nodeModulesDirs: nmDirs.length, libs: rows.length },
    overrides: overridesFrom ?? null,
    rows,
  }, null, 2));
  process.exit(exitCode);
}

console.log(renderReport({ rows, cwd, nmDirs: nmDirs.length, overridesFrom: overridesFrom ?? null, noColor, showAll }));
process.exit(exitCode);
