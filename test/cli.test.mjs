// @ts-check
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp, cleanupTmp, writePkg, ensureDir } from './helpers.mjs';

const BIN = fileURLToPath(new URL('../bin/ts7-scan.mjs', import.meta.url));

afterEach(cleanupTmp);

/** @param {string[]} args */
function run(args) {
  const res = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** A repo whose one relevant lib calls the Compiler API on an old range. */
function repoWithBlocker() {
  const root = mkTmp();
  const nm = ensureDir(root, 'node_modules');
  writePkg(nm, 'ts-transformer', {
    tsRangePeer: '^5.0.0',
    main: 'index.js',
    mainSrc: "const ts = require('typescript'); module.exports = () => ts.createProgram([], {});",
  });
  return root;
}

/** A repo whose one relevant lib is fine under TS 7. */
function repoClean() {
  const root = mkTmp();
  const nm = ensureDir(root, 'node_modules');
  writePkg(nm, 'ts-friendly', { tsRangePeer: '>=5.0.0' });
  return root;
}

/** A peer/dep range excluding 7 (BUMP) alongside a dev-only range (OK noise). */
function repoBumpAndDevNoise() {
  const root = mkTmp();
  const nm = ensureDir(root, 'node_modules');
  writePkg(nm, 'peer-old', { tsRangePeer: '^5.0.0' });      // BUMP
  writePkg(nm, 'built-with-old-ts', { tsRangeDev: '^5.0.0' }); // OK — dev-only, no consumer risk
  return root;
}

describe('CLI end-to-end', () => {
  it('exits 1 when a BLOCKER is present', () => {
    const r = run(['--cwd', repoWithBlocker(), '--no-color']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('BLOCKER');
    expect(r.stdout).toContain('ts-transformer');
  });

  it('exits 0 when there is no BLOCKER', () => {
    const r = run(['--cwd', repoClean(), '--no-color']);
    expect(r.code).toBe(0);
  });

  it('classifies a peer/dep old range as BUMP but a dev-only old range as OK', () => {
    const r = run(['--cwd', repoBumpAndDevNoise(), '--json']);
    expect(r.code).toBe(0);
    const byName = Object.fromEntries(JSON.parse(r.stdout).rows.map((row) => [row.name, row]));
    expect(byName['peer-old'].status).toBe('BUMP');
    expect(byName['peer-old'].src).toBe('peer');
    expect(byName['built-with-old-ts'].status).toBe('OK');
    expect(byName['built-with-old-ts'].src).toBe('dev');
  });

  it('hides OK rows by default in the table; --all reveals them', () => {
    const root = repoBumpAndDevNoise();
    const def = run(['--cwd', root, '--no-color']);
    expect(def.stdout).toContain('peer-old');
    expect(def.stdout).not.toContain('built-with-old-ts');
    expect(def.stdout).toMatch(/OK hidden/);

    const all = run(['--cwd', root, '--no-color', '--all']);
    expect(all.stdout).toContain('built-with-old-ts');
  });

  it('exits 2 when no node_modules is found', () => {
    const empty = mkTmp();
    ensureDir(empty, 'src');
    const r = run(['--cwd', empty]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/node_modules/);
  });

  it('--json emits parseable output and keeps exit codes', () => {
    const r = run(['--cwd', repoWithBlocker(), '--json']);
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.scanned.libs).toBe(1);
    expect(parsed.rows[0].name).toBe('ts-transformer');
    expect(parsed.rows[0].status).toBe('BLOCKER');
  });

  it('respects overrides (compatible:true downgrades a blocker to OK, exit 0)', () => {
    const root = repoWithBlocker();
    fs.writeFileSync(
      path.join(root, 'ts7-overrides.json'),
      JSON.stringify({ 'ts-transformer': { compatible: true, note: 'fine' } }),
    );
    const r = run(['--cwd', root, '--json']);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.rows[0].status).toBe('OK');
    expect(parsed.rows[0].override).toBe(true);
  });
});
