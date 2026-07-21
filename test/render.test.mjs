// @ts-check
import { describe, it, expect } from 'vitest';
import { vlen, renderReport } from '../src/render.mjs';

const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

function sampleRows() {
  return [
    { name: 'ts-blocker', installed: '2.0.0', tsRange: '^5.0.0', src: 'dep', admitsTs7: false, usesApi: true, status: 'BLOCKER' },
    { name: 'a-bump-with-a-very-long-package-name', installed: '1.2.3', tsRange: '^6', src: 'peer', admitsTs7: false, usesApi: false, status: 'BUMP', override: true, note: 'community verdict' },
    { name: 'ok-lib', installed: '9.9.9', tsRange: '>=5', src: 'peer', admitsTs7: true, usesApi: false, status: 'OK' },
    { name: 'dev-noise', installed: '3.0.0', tsRange: '^5', src: 'dev', admitsTs7: false, usesApi: false, status: 'OK' },
    { name: 'mystery', installed: '0.0.1', tsRange: 'workspace:*', src: 'peer', admitsTs7: null, usesApi: false, status: 'UNKNOWN' },
  ];
}

describe('vlen', () => {
  it('ignores ANSI escape sequences', () => {
    expect(vlen(`${ESC}[31m✖ BLOCKER${ESC}[0m`)).toBe(vlen('✖ BLOCKER'));
    expect(vlen(`${ESC}[1mSTATUS${ESC}[0m`)).toBe(6);
  });
});

describe('renderReport', () => {
  it('emits no ANSI escapes with noColor', () => {
    const out = renderReport({ rows: sampleRows(), cwd: '/x', nmDirs: 2, overridesFrom: null, noColor: true, showAll: true });
    expect(out).not.toMatch(ANSI_RE);
  });

  it('every framed line has identical visible width (color on)', () => {
    const out = renderReport({ rows: sampleRows(), cwd: '/x', nmDirs: 2, overridesFrom: null, noColor: false, showAll: true });
    const frame = out.split('\n').filter((l) => /[┌│└├]/.test(l));
    expect(frame.length).toBeGreaterThan(5);
    const widths = new Set(frame.map((l) => vlen(l)));
    expect(widths.size).toBe(1);
  });

  it('hides OK rows by default and notes how many were hidden', () => {
    const out = renderReport({ rows: sampleRows(), cwd: '/x', nmDirs: 2, overridesFrom: null, noColor: true });
    expect(out).not.toContain('ok-lib');
    expect(out).not.toContain('dev-noise');
    expect(out).toContain('2 OK hidden');
    // actionable rows still present
    expect(out).toContain('ts-blocker');
    expect(out).toContain('mystery');
  });

  it('--all (showAll) includes OK rows and drops the hidden note', () => {
    const out = renderReport({ rows: sampleRows(), cwd: '/x', nmDirs: 2, overridesFrom: null, noColor: true, showAll: true });
    expect(out).toContain('ok-lib');
    expect(out).toContain('dev-noise');
    expect(out).not.toContain('OK hidden');
  });

  it('renders an override note on its own full-width line', () => {
    const out = renderReport({ rows: sampleRows(), cwd: '/x', nmDirs: 2, overridesFrom: null, noColor: true });
    expect(out).toContain('↳ community verdict');
  });

  it('shows a WHY reason for actionable rows', () => {
    const out = renderReport({ rows: sampleRows(), cwd: '/x', nmDirs: 2, overridesFrom: null, noColor: true });
    expect(out).toContain('calls Compiler API');
    expect(out).toContain('range excludes 7');
    expect(out).toContain('range not evaluable');
  });
});
