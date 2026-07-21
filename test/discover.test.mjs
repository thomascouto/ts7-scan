// @ts-check
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { collectNmDirs, listInstalled } from '../src/discover.mjs';
import { mkTmp, cleanupTmp, writePkg, ensureDir } from './helpers.mjs';

afterEach(cleanupTmp);

describe('collectNmDirs', () => {
  it('finds root, workspace, and pnpm-store node_modules; skips normal nesting', () => {
    const root = mkTmp();

    const rootNm = ensureDir(root, 'node_modules');
    writePkg(rootNm, 'rootpkg');

    const wsNm = ensureDir(root, 'packages', 'app', 'node_modules');
    writePkg(wsNm, 'wspkg');

    const pnpmInner = ensureDir(rootNm, '.pnpm', 'x@1.0.0', 'node_modules');
    writePkg(pnpmInner, 'x');

    // A normally-nested node_modules that must NOT be collected.
    const nestedNm = ensureDir(rootNm, 'rootpkg', 'node_modules');
    writePkg(nestedNm, 'deep');

    const dirs = collectNmDirs(root);

    expect(dirs).toContain(rootNm);
    expect(dirs).toContain(wsNm);
    expect(dirs).toContain(pnpmInner);
    expect(dirs).not.toContain(nestedNm);
  });

  it('returns empty when there is no node_modules', () => {
    const root = mkTmp();
    ensureDir(root, 'src');
    expect(collectNmDirs(root)).toEqual([]);
  });
});

describe('listInstalled', () => {
  it('enumerates plain and scoped packages, skipping dot-dirs', () => {
    const nm = ensureDir(mkTmp(), 'node_modules');
    writePkg(nm, 'plain');
    writePkg(nm, '@org/scoped');
    ensureDir(nm, '.bin'); // dot-dir must be skipped

    const names = [...listInstalled(nm)].map((d) => path.relative(nm, d));
    expect(names).toContain('plain');
    expect(names).toContain(path.join('@org', 'scoped'));
    expect(names).not.toContain('.bin');
  });
});
