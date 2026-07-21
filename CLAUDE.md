# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Implemented and green (`pnpm lint`, `pnpm test`, `node bin/ts7-scan.mjs` all pass). `FEATURES.md` is the original spec (in Portuguese) and remains the **source of truth** for behavior — it includes a single-file reference implementation. Where the prose spec and that reference code diverge, the prose spec wins. The modular `src/` build is a faithful refactor of that reference.

## What `ts7-scan` is

A published npm CLI (`npx ts7-scan`) that does a **100% static** scan of a JS/TS repo's *installed* dependencies and classifies each one's risk of breaking under **TypeScript 7** (the native Go `tsc`). It executes nothing from the scanned libs.

The core domain facts that drive the whole design:
- TS 7.0 ships in the standard `typescript` package but **removed the programmatic Compiler API** (`ts.createProgram()`, `transpileModule()`, `createLanguageService()`, `createPrinter()`, …). Any lib that calls these throws `TypeError` on 7.0. The API only returns in 7.1. Libs needing the old API use `@typescript/typescript6` (`tsc6`).
- Risk therefore has **two axes**: (a) does the lib's declared `typescript` range admit 7? (b) does the lib call the Compiler API?

## Commands

```bash
pnpm install              # clean install on Node 24
pnpm lint                 # eslint .
pnpm test                 # vitest run
pnpm test:watch           # vitest (watch)
node bin/ts7-scan.mjs     # run the CLI against cwd
pnpm pack                 # tarball must contain only bin/, src/, README, LICENSE (via `files`)
```

Run a single test: `pnpm vitest run test/<file>.test.mjs -t "<name>"`.

CLI flags: `--cwd <dir>`, `--json`, `--check-updates`, `--all` (show `OK` rows, hidden by default), `--overrides <file>`, `--no-color` (also honors `NO_COLOR` env).

Exit codes: `0` no BLOCKER · `1` ≥1 BLOCKER · `2` no `node_modules` found.

## Hard architectural constraints (do not violate)

- **Pure JavaScript ESM (`.mjs`), no build step.** Deliberate: a tool that diagnoses TS-toolchain incompatibility must not depend on the TS toolchain. Types via JSDoc + `// @ts-check` only. Do **not** add typescript-eslint bound to the old Compiler API.
- **Exactly one runtime dependency: `semver`.** No chalk / commander / cli-table / ora — colors and the framed table are hand-drawn with ANSI + box-drawing chars.
- Node: develop on Node 24; `engines.node >= 22`; pin `packageManager: pnpm@<current>`; `.nvmrc` = `24`.
- **Resolve every dependency version by querying the npm registry at `pnpm add` time — never write version numbers from memory into package.json.**

## Module layout (target)

- `bin/ts7-scan.mjs` — thin entry: flag parsing, calls `scan()`/`renderReport`, sets exit code. No orchestration logic of its own.
- `src/index.mjs` — pure orchestration (`scan`, `checkUpdates`) and the package `exports` entry; re-exports the module API. No console output.
- `src/discover.mjs` — `collectNmDirs`, `listInstalled`. Monorepo-aware discovery.
- `src/analyze.mjs` — `tsRangeOf`, `admitsTs7`, `usesCompilerApi`, `classify`.
- `src/overrides.mjs` — `loadOverrides` + merge.
- `src/registry.mjs` — `latestAdmitsTs7` (fetch, network-failure tolerant).
- `src/render.mjs` — framed table, `vlen`/`padEndV`, chips + legend.

## Behavior that's easy to get wrong

- **Discovery (`collectNmDirs`)**: collect root `node_modules`, each workspace's own `node_modules` (recursive to depth 6, skipping dot-dirs), **and** the pnpm virtual store `node_modules/.pnpm/*/node_modules`. Do **not** descend into `node_modules` via the normal tree walk — `.pnpm` already covers non-hoisted packages. Dedup by `name@version`.
- **Relevance filter**: only packages declaring `typescript` in `peerDependencies` / `dependencies` / `devDependencies` matter (peer range read first). Everything else is ignored.
- **`admitsTs7(range)`** → `true | false | null`: `semver.satisfies('7.0.0', range, { includePrerelease: true })`; `*` and `latest` → true; `workspace:*` / invalid range → null.
- **`usesCompilerApi`**: read entrypoints (`main`, `module`, `.js/.mjs/.cjs` referenced in `exports`, and `index.js`); true only if the file imports/requires `typescript` **and** mentions a Compiler-API symbol. Unreadable entrypoint → false, never throw.
- **Status precedence** (`classify` in `analyze.mjs`): `BLOCKER` (`usesApi && admitsTs7 !== true`) → *`dev`-only range short-circuits to `OK`* → `BUMP` (`admitsTs7 === false`) → `UNKNOWN` (`admitsTs7 === null`) → `OK`. The `dev`-only short-circuit is the key signal-vs-noise rule: a lib that declares `typescript` only in `devDependencies` used it to build itself and carries no consumer risk, so it never becomes `BUMP`. `tsRangeOf` returns `{ range, src }` where `src ∈ 'peer'|'dep'|'dev'`. Overrides still win over the heuristic (`compatible:true`→OK, `false`→BLOCKER), mark the row `(ovr)`, show the note.
- **Table hides `OK` by default** (`renderReport`'s `showAll`, wired to `--all`); `--json` always emits every row. Columns: `STATUS, LIB, VER, TS RANGE, SRC, WHY, UPDATE`.
- **Rendering is ANSI-aware**: column widths are measured by *visible* width — strip ANSI escapes with a regex before measuring. Color must never misalign the frame. This is the single most bug-prone area; the render tests exist to lock it down.

## Tooling notes

- Tests use Vitest with real temp-dir fixtures built in `beforeEach` (`fs.mkdtemp`) — **no fs mocking**. Only `registry.mjs` mocks `fetch` (never hit the network in tests).
- ESLint flat config, `@eslint/js` recommended raised to strict: `eqeqeq`, `no-var`, `prefer-const`, `no-unused-vars` as error, `curly`, `no-implicit-coercion`, max complexity ~15.
