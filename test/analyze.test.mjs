// @ts-check
import { describe, it, expect, afterEach } from 'vitest';
import { admitsTs7, tsRangeOf, usesCompilerApi, classify } from '../src/analyze.mjs';
import { applyOverride } from '../src/overrides.mjs';
import { mkTmp, cleanupTmp, writePkg, ensureDir } from './helpers.mjs';

afterEach(cleanupTmp);

describe('admitsTs7', () => {
  const cases = [
    ['^5.0.0', false],
    ['>=5.0.0', true],
    ['>=4.5 <7', false],
    ['*', true],
    ['workspace:*', null],
    ['latest', true],
    ['not-a-range', null],
    ['^6 || ^7', true],
    [null, true],
    [undefined, true],
  ];
  for (const [range, expected] of cases) {
    it(`${JSON.stringify(range)} → ${expected}`, () => {
      expect(admitsTs7(/** @type {any} */(range))).toBe(expected);
    });
  }
});

describe('tsRangeOf', () => {
  it('prefers peer over dep over devDep and reports the source', () => {
    expect(tsRangeOf({
      peerDependencies: { typescript: '^7' },
      dependencies: { typescript: '^6' },
      devDependencies: { typescript: '^5' },
    })).toEqual({ range: '^7', src: 'peer' });
    expect(tsRangeOf({ dependencies: { typescript: '^6' }, devDependencies: { typescript: '^5' } }))
      .toEqual({ range: '^6', src: 'dep' });
    expect(tsRangeOf({ devDependencies: { typescript: '^5' } })).toEqual({ range: '^5', src: 'dev' });
    expect(tsRangeOf({})).toEqual({ range: null, src: null });
  });
});

describe('usesCompilerApi', () => {
  it('true when entry imports typescript AND calls a Compiler API symbol', () => {
    const nm = ensureDir(mkTmp(), 'node_modules');
    const dir = writePkg(nm, 'uses-api', {
      main: 'index.js',
      mainSrc: "const ts = require('typescript'); ts.createProgram([], {});",
    });
    expect(usesCompilerApi(dir, { main: 'index.js' })).toBe(true);
  });

  it('false when it imports typescript but calls no API symbol', () => {
    const nm = ensureDir(mkTmp(), 'node_modules');
    const dir = writePkg(nm, 'peer-only', {
      main: 'index.js',
      mainSrc: "import ts from 'typescript'; export const v = ts.version;",
    });
    expect(usesCompilerApi(dir, { main: 'index.js' })).toBe(false);
  });

  it('false (no throw) when there is no readable entrypoint', () => {
    const nm = ensureDir(mkTmp(), 'node_modules');
    const dir = writePkg(nm, 'no-entry', {});
    expect(usesCompilerApi(dir, { main: 'missing.js' })).toBe(false);
  });

  it('scans files referenced in exports (ESM import form)', () => {
    const nm = ensureDir(mkTmp(), 'node_modules');
    const dir = writePkg(nm, 'via-exports', {
      pkg: { exports: { '.': { import: './dist/lib.mjs' } } },
      main: 'dist/lib.mjs',
      mainSrc: "import ts from 'typescript'; ts.transpileModule('', {});",
    });
    expect(usesCompilerApi(dir, { exports: { '.': { import: './dist/lib.mjs' } } })).toBe(true);
  });
});

describe('classify', () => {
  it('covers the statuses in precedence order', () => {
    expect(classify({ usesApi: true, admitsTs7: false, src: 'dep' })).toBe('BLOCKER');
    expect(classify({ usesApi: true, admitsTs7: null, src: 'peer' })).toBe('BLOCKER');
    expect(classify({ usesApi: true, admitsTs7: true, src: 'dep' })).toBe('OK');
    expect(classify({ usesApi: false, admitsTs7: false, src: 'peer' })).toBe('BUMP');
    expect(classify({ usesApi: false, admitsTs7: false, src: 'dep' })).toBe('BUMP');
    expect(classify({ usesApi: false, admitsTs7: null, src: 'peer' })).toBe('UNKNOWN');
    expect(classify({ usesApi: false, admitsTs7: true, src: 'peer' })).toBe('OK');
  });

  it('treats a dev-only typescript range as OK (no consumer risk), whatever the range', () => {
    expect(classify({ usesApi: false, admitsTs7: false, src: 'dev' })).toBe('OK');
    expect(classify({ usesApi: false, admitsTs7: null, src: 'dev' })).toBe('OK');
    expect(classify({ usesApi: false, admitsTs7: true, src: 'dev' })).toBe('OK');
  });

  it('still flags a dev-declared lib as BLOCKER if it actually calls the API', () => {
    expect(classify({ usesApi: true, admitsTs7: false, src: 'dev' })).toBe('BLOCKER');
  });
});

describe('override precedence', () => {
  it('compatible:true forces OK even for a would-be BLOCKER', () => {
    const row = { name: 'foo', status: classify({ usesApi: true, admitsTs7: false, src: 'dep' }) };
    applyOverride(row, { foo: { compatible: true, note: 'patched upstream' } });
    expect(row.status).toBe('OK');
    expect(row.override).toBe(true);
    expect(row.note).toBe('patched upstream');
  });

  it('compatible:false forces BLOCKER even for a would-be OK', () => {
    const row = { name: 'bar', status: classify({ usesApi: false, admitsTs7: true, src: 'peer' }) };
    applyOverride(row, { bar: { compatible: false } });
    expect(row.status).toBe('BLOCKER');
    expect(row.override).toBe(true);
  });

  it('leaves rows without an override untouched', () => {
    const row = { name: 'baz', status: 'OK' };
    applyOverride(row, { other: { compatible: false } });
    expect(row.status).toBe('OK');
    expect(row.override).toBeUndefined();
  });
});
