# ts7-scan

Static scan that classifies your **installed** dependencies by risk of breaking
under **TypeScript 7** — the native (Go) `tsc`.

TS 7.0 ships in the standard `typescript` package but **removed the programmatic
Compiler API** (`ts.createProgram()`, `transpileModule()`,
`createLanguageService()`, `createPrinter()`, …). Any library that calls those
throws a `TypeError` under TS 7.0; the API only returns in 7.1, and tools that
need the old API in the meantime use `@typescript/typescript6` (`tsc6`).

`ts7-scan` estimates risk along two axes, **statically — it never executes any
dependency code**:

1. Does the library's declared `typescript` range admit `7.x`?
2. Does the library actually call the Compiler API?

## Usage

```bash
npx ts7-scan                 # scan the current project
npx ts7-scan --check-updates # also ask npm if a fixed version exists
```

Run from a project **after** installing dependencies — it reads `node_modules`.
It is monorepo-aware: it scans the root `node_modules`, each workspace's own
`node_modules`, and the pnpm virtual store (`.pnpm`), deduping by `name@version`.

### Flags

| Flag | Effect |
| --- | --- |
| `--cwd <dir>` | Directory to scan (default: current working dir). |
| `--json` | Emit `{ scanned, overrides, rows }` as JSON (always includes every row). Exit codes unchanged. |
| `--check-updates` | For `BUMP` libs, query `registry.npmjs.org/<name>/latest` and report whether the newest published version already admits 7. Network-failure tolerant. |
| `--all` | Include `OK` rows in the table (hidden by default so the actionable rows stand out). |
| `--overrides <file>` | Use a specific overrides file (default: `./ts7-overrides.json`). |
| `--no-color` | Disable ANSI color (also honored via the `NO_COLOR` env var). |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No `BLOCKER`. |
| `1` | At least one `BLOCKER`. |
| `2` | No `node_modules` found — run your install first. |

## Status meanings

| Status | Meaning | Typical action |
| --- | --- | --- |
| ✖ `BLOCKER` | Calls the Compiler API **and** its range doesn't admit 7. | Keep it on `tsc6` (`@typescript/typescript6`) until TS 7.1. |
| ▲ `BUMP` | A **`peer`/`dep`** `typescript` range excludes 7. | Wait for, or move to, a newer release of the lib; check `--check-updates`. |
| ? `UNKNOWN` | A `peer`/`dep` range is not evaluable (`workspace:*`, a dist-tag like `next`, or exotic). | Inspect manually. |
| ✔ `OK` | Range admits 7, **or** the range is `dev`-only. | Nothing. |

The **`SRC`** column shows *where* the `typescript` range is declared:

- `peer` / `dep` — the range can affect **your** build, so these drive `BUMP` / `UNKNOWN`.
- `dev` — the lib only used `typescript` to build *itself*; this has no bearing on
  whether your project runs under TS 7, so a `dev`-only range is always reported
  `OK` (never `BUMP`), regardless of the range. This is what keeps the report from
  drowning in dev-tooling noise. (A `dev`-declared lib can still be a `BLOCKER` if
  it actually calls the Compiler API at runtime.)

Rows are sorted `BLOCKER → BUMP → UNKNOWN → OK`, alphabetical within a group.
`OK` rows are hidden from the table by default — pass `--all` to see them (they
are always present in `--json`).

## Overrides

The heuristic can be wrong (see limits below). Record a manual or community
verdict in `ts7-overrides.json` (or point at one with `--overrides`):

```json
{
  "some-lib": { "compatible": true, "note": "Fixed upstream in v4.2." }
}
```

`compatible: true` forces `OK`; `false` forces `BLOCKER`. Overridden rows are
marked `(ovr)` and show the note. See `ts7-overrides.example.json`.

## Limits of static analysis

This tool reports **prioritized risk, not a definitive yes/no**:

- The Compiler-API heuristic scans a package's entrypoints for an import of
  `typescript` alongside an API symbol. It can **miss** dynamic requires or
  usage buried in non-entry files (false negative), and it can **flag** a lib
  that merely re-exports or type-references those symbols without calling them
  at runtime (false positive).
- A declared range that admits 7 is the author's claim, not a guarantee.

The only definitive test is running your actual build and test suite under TS 7.
Use this scan to decide **what to check first**.

## Development

Pure JavaScript ESM (`.mjs`), no build step — deliberately, so a tool that
diagnoses TS-toolchain breakage carries no TS toolchain of its own. The only
runtime dependency is `semver`.

```bash
pnpm install
pnpm lint          # eslint
pnpm test          # vitest run
pnpm test:watch
node bin/ts7-scan.mjs --cwd <some-project>
```

## License

MIT
