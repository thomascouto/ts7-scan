// @ts-check
// Hand-drawn, ANSI-aware framed table. No table/color libraries.
//
// Critical invariant: column widths are measured by VISIBLE width — ANSI color
// escapes are stripped before measuring so color can never misalign the frame.

import path from 'node:path';

const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/** Visible length of a string, ignoring ANSI escape sequences. */
export function vlen(s) {
  return String(s).replace(ANSI_RE, '').length;
}

/** Pad to visible width `w` on the right. */
export function padEndV(s, w) {
  return s + ' '.repeat(Math.max(0, w - vlen(s)));
}

/** Pad to visible width `w` on the left. */
export function padStartV(s, w) {
  return ' '.repeat(Math.max(0, w - vlen(s))) + s;
}

/** Per-status ANSI color codes and glyphs. */
const CLR = { BLOCKER: 31, BUMP: 33, UNKNOWN: 90, OK: 32 };
const ICON = { BLOCKER: '✖', BUMP: '▲', UNKNOWN: '?', OK: '✔' };
const ORDER = { BLOCKER: 0, BUMP: 1, UNKNOWN: 2, OK: 3 };

const HEAD = ['STATUS', 'LIB', 'VER', 'TS RANGE', 'SRC', 'WHY', 'UPDATE'];
const ALIGN = ['l', 'l', 'l', 'l', 'l', 'l', 'l'];

/**
 * One-line reason a row has its status — the "why" a user needs to act (or not).
 * @param {Record<string, any>} r
 * @returns {string}
 */
function whyOf(r) {
  if (r.status === 'BLOCKER') return 'calls Compiler API';
  if (r.status === 'BUMP') return r.src === 'peer' ? 'you supply TS; range excludes 7' : 'bundles TS; range excludes 7';
  if (r.status === 'UNKNOWN') return 'range not evaluable';
  return '';
}

/**
 * Build a colorizer. When `noColor`, returns text unchanged.
 * @param {boolean} noColor
 */
export function makeColorizer(noColor) {
  const c = noColor ? (_code, s) => String(s) : (code, s) => `${ESC}[${code}m${s}${ESC}[0m`;
  return {
    c,
    dim: (s) => c(90, s),
    bold: (s) => c(1, s),
  };
}

/**
 * Sort rows by status precedence then name (in place).
 * @param {Array<Record<string, any>>} rows
 */
export function sortRows(rows) {
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
  return rows;
}

/** Count rows with a given status. */
export function countStatus(rows, status) {
  return rows.filter((r) => r.status === status).length;
}

/**
 * Render the full human-readable report as a string.
 * @param {object} opts
 * @param {Array<Record<string, any>>} opts.rows classified rows
 * @param {string} opts.cwd scanned directory
 * @param {number} opts.nmDirs count of node_modules dirs scanned
 * @param {string | null} opts.overridesFrom overrides file path, if any
 * @param {boolean} opts.noColor
 * @param {boolean} [opts.showAll] include OK rows (hidden by default)
 * @returns {string}
 */
export function renderReport({ rows, cwd, nmDirs, overridesFrom, noColor, showAll = false }) {
  const { c, dim, bold } = makeColorizer(noColor);
  sortRows(rows);

  const okCount = countStatus(rows, 'OK');
  const visible = showAll ? rows : rows.filter((r) => r.status !== 'OK');

  const body = visible.map((r) => {
    const upd = r.latest
      ? (r.latestAdmitsTs7 ? c(32, `↑ ${r.latest}`) : c(31, `↑ ${r.latest}`))
      : dim('—');
    return {
      note: r.note,
      cells: [
        c(CLR[r.status], `${ICON[r.status]} ${r.status}`),
        r.name + (r.override ? dim(' (ovr)') : ''),
        dim(r.installed),
        r.tsRange,
        dim(r.src ?? '—'),
        dim(whyOf(r)),
        upd,
      ],
    };
  });

  const colW = HEAD.map((h, i) => Math.max(vlen(h), ...body.map((b) => vlen(b.cells[i])), 3));
  const inner = colW.reduce((a, w) => a + w + 2, 0) + (colW.length - 1);

  const cell = (txt, i) => {
    const w = colW[i];
    const s = ALIGN[i] === 'c' ? padStartV(padEndV(txt, (w + vlen(txt) + 1) >> 1), w)
      : ALIGN[i] === 'r' ? padStartV(txt, w)
        : padEndV(txt, w);
    return ` ${s} `;
  };
  const line = (l, m, r) => l + colW.map((w) => '─'.repeat(w + 2)).join(m) + r;
  const rowStr = (cells) => '│' + cells.map(cell).join('│') + '│';
  const spanStr = (txt) => '│' + padEndV(' ' + txt, inner) + '│';

  const out = [];
  out.push('');
  out.push(bold('  TS7 scan') + dim(`   ·   ${rows.length} libs declare a dependency on "typescript"`));
  out.push(dim(`  ${cwd}`));
  out.push(dim(`  node_modules scanned: ${nmDirs}${overridesFrom ? `   ·   overrides: ${path.basename(overridesFrom)}` : ''}`));
  out.push('');

  out.push('  ' + line('┌', '┬', '┐'));
  out.push('  ' + rowStr(HEAD.map((h) => bold(h))));
  out.push('  ' + line('├', '┼', '┤'));
  for (const b of body) {
    out.push('  ' + rowStr(b.cells));
    if (b.note) out.push('  ' + spanStr(dim('↳ ' + b.note)));
  }
  out.push('  ' + line('└', '┴', '┘'));

  const chip = (s) => c(CLR[s], `${ICON[s]} ${countStatus(rows, s)} ${s}`);
  out.push('');
  out.push('  ' + [chip('BLOCKER'), chip('BUMP'), chip('UNKNOWN'), chip('OK')].join('    '));
  if (!showAll && okCount > 0) {
    out.push('  ' + dim(`(${okCount} OK hidden — pass --all to show them)`));
  }
  out.push('');
  out.push(dim('  ✖ BLOCKER  calls the removed Compiler API → keep it on tsc6 (@typescript/typescript6) until TS 7.1'));
  out.push(dim('  ▲ BUMP     a peer/dep typescript range excludes 7 → wait for or move to a newer release of the lib'));
  out.push(dim('  ? UNKNOWN  a peer/dep range is not evaluable (workspace:*, a dist-tag like "next", or exotic)'));
  out.push(dim('  ↑ UPDATE   a published version already admits 7 (shown with --check-updates)'));
  out.push(dim('  SRC        where the typescript range is declared — peer/dep can affect you; dev-only ranges are'));
  out.push(dim('             the lib building itself and are reported OK (never BUMP)'));
  out.push(dim('  (ovr)      verdict came from ts7-overrides.json, not the heuristic'));
  out.push('');

  return out.join('\n');
}
