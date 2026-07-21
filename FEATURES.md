# Prompt para Claude Code — implementar `ts7-scan` ponta a ponta

> Cole tudo abaixo desta linha no Claude Code, dentro de uma pasta vazia.

---

Implemente ponta a ponta uma CLI npm chamada **`ts7-scan`**: uma varredura **100% estática** de um repositório JS/TS que classifica cada dependência instalada quanto ao risco de incompatibilidade com o **TypeScript 7** (o compilador nativo em Go). Ao final, quero `pnpm lint`, `pnpm test` e `node bin/ts7-scan.mjs` todos passando, e o pacote pronto para `npm publish` (rodável via `npx ts7-scan`).

## Contexto técnico (fatos, não invente além disso)

- TS 7 é GA, distribuído no pacote `typescript` padrão; o binário continua sendo `tsc` (nativo).
- **TS 7.0 não tem API programática** — a antiga Compiler API (Strada) foi removida e a nova só chega no 7.1. Qualquer lib que chama `ts.createProgram()`, `ts.transpileModule()`, `ts.createLanguageService()`, `ts.createPrinter()` etc. quebra com TypeError no 7.0.
- Para essas ferramentas existe o pacote `@typescript/typescript6` (binário `tsc6`, re-exporta a API 6.x).
- Portanto a classificação de risco tem dois eixos: (a) o range de `typescript` declarado pela lib admite 7? (b) a lib chama a Compiler API?

## Decisão de arquitetura (respeite)

- **Fonte em JavaScript ESM puro (`.mjs`), sem build step.** É deliberado: uma ferramenta que diagnostica incompatibilidade com o toolchain TS não deve depender do toolchain TS. Tipagem via JSDoc + `// @ts-check` está ok.
- **Única dependência de runtime: `semver`.** Nada de chalk, cli-table, commander, ora etc. — cores e tabela são desenhadas à mão (spec abaixo).
- Node: **desenvolva no Node 24 (Active LTS)**; `"engines": { "node": ">=22" }`; inclua `"packageManager": "pnpm@<versão-atual>"` e um `.nvmrc` com `24`.
- **Resolva TODAS as versões de dependências consultando o registry npm no momento da instalação (`pnpm add`/`pnpm add -D`), nunca de memória.** Não escreva números de versão de devDependencies à mão no package.json.

## Comportamento funcional (spec)

### Coleta (monorepo-aware)
1. A partir de `--cwd` (default `process.cwd()`), descubra todos os `node_modules` relevantes: o da raiz, o de cada workspace (varredura recursiva até profundidade 6, ignorando dirs que começam com `.`), e o store virtual do pnpm (`node_modules/.pnpm/*/node_modules`). Não descer recursivamente dentro de `node_modules` pela árvore normal.
2. Enumere todo pacote instalado (incluindo escopos `@org/*`). Deduplique por `nome@versão`.
3. Só interessam pacotes que declaram `typescript` em `peerDependencies`, `dependencies` ou `devDependencies` (peer tem prioridade na leitura do range). Os demais são ignorados.

### Sinais e classificação
Para cada lib relevante, derive:
- `range` + `src`: `tsRangeOf(pkg)` retorna `{ range, src }` onde `src ∈ 'peer' | 'dep' | 'dev'` — **onde** o range foi declarado importa para o consumidor (peer/dep afeta o *seu* build; dev-only é só como a lib se constrói). `peerDependencies` tem prioridade, depois `dependencies`, depois `devDependencies`.
- `admitsTs7`: `semver.satisfies('7.0.0', range, { includePrerelease: true })` → `true | false | null` (null = range não avaliável, ex.: `workspace:*`). `*` e `latest` contam como true.
- `usesApi`: heurística estática — leia os entrypoints (`main`, `module`, arquivos `.js/.mjs/.cjs` referenciados em `exports`, e `index.js`) e marque true se o arquivo importa/require `typescript` **e** menciona símbolos da Compiler API (`createProgram`, `transpileModule`, `createLanguageService`, `createPrinter`, `createSourceFile`, `getTypeChecker`, `createWatchProgram`, `createCompilerHost`, `transformNodes`, `createTypeChecker`, `LanguageServiceHost`).

Status (nesta ordem de precedência):
- `BLOCKER` — `usesApi && admitsTs7 !== true`
- `OK` (curto-circuito) — `src === 'dev'`: um range só em `devDependencies` foi usado pela lib para construir a si mesma e não carrega risco para o consumidor, então nunca vira `BUMP`. (Ainda pode ser `BLOCKER` acima se de fato chama a Compiler API.) Esta é a regra-chave de sinal-vs-ruído.
- `BUMP` — `admitsTs7 === false` (range peer/dep exclui 7 → provável só bump de versão da lib)
- `UNKNOWN` — `admitsTs7 === null`
- `OK` — resto

### Overrides
Arquivo `ts7-overrides.json` (procurado no `--cwd`, ou apontado via `--overrides <arquivo>`), formato `{ "<lib>": { "compatible": true|false, "note": "..." } }`. Um override sobrescreve a heurística (`compatible: true` → OK, `false` → BLOCKER), marca a linha com `(ovr)` e exibe a `note`.

### Flags
`--cwd <dir>`, `--json`, `--check-updates` (consulta `https://registry.npmjs.org/<name>/latest` só para as libs BUMP — `admitsTs7 === false` — e informa se a última versão publicada já admite 7), `--all` (inclui as linhas `OK` na tabela, ocultas por padrão), `--overrides <arquivo>`, `--no-color` (também respeitar env `NO_COLOR`).

### Exit codes
`0` sem BLOCKER · `1` com ≥1 BLOCKER · `2` nenhum `node_modules` encontrado.

### Saída padrão: tabela emoldurada no console
- Moldura box-drawing (`┌┬┐ ├┼┤ └┴┘ │ ─`), colunas: STATUS, LIB, VER, TS RANGE, SRC, WHY, UPDATE.
- Coluna `SRC` mostra onde o range foi declarado (`peer`/`dep`/`dev`); coluna `WHY` é a razão de uma linha (ex.: `calls Compiler API`, `you supply TS; range excludes 7`, `range not evaluable`).
- Cores ANSI diretas (sem lib): BLOCKER vermelho `✖`, BUMP amarelo `▲`, UNKNOWN cinza `?`, OK verde `✔`; cabeçalho em bold; VER e colunas auxiliares em cinza.
- **Crítico:** larguras de coluna calculadas pela largura *visível* (strip de escapes ANSI via regex antes de medir) — cor nunca pode desalinhar a moldura.
- Nota de override renderizada numa linha própria que ocupa a largura interna total da tabela (`↳ ...`).
- Rodapé: chips de contagem por status + legenda em cinza; quando há `OK` ocultas, uma dica `(N OK hidden — pass --all to show them)`.
- Por padrão a tabela **oculta as linhas `OK`** (passe `--all` para mostrá-las); `--json` sempre emite todas as linhas.
- Ordenação: BLOCKER → BUMP → UNKNOWN → OK, alfabético dentro do grupo.
- `--json` imprime `{ scanned: { nodeModulesDirs, libs }, overrides, rows }` e mantém os exit codes.

## Estrutura do projeto

```
ts7-scan/
├── bin/ts7-scan.mjs        # entry fino: só parse de flags → chama scan()/render
├── src/
│   ├── index.mjs           # orquestração pura (scan, checkUpdates); é o `exports` do pacote
│   ├── discover.mjs        # collectNmDirs, listInstalled (monorepo/pnpm)
│   ├── analyze.mjs         # tsRangeOf, admitsTs7, usesCompilerApi, classify
│   ├── overrides.mjs       # loadOverrides + applyOverride
│   ├── registry.mjs        # latestAdmitsTs7 (fetch, tolerante a falha de rede)
│   └── render.mjs          # tabela emoldurada + vlen/padEndV + chips/legenda
├── test/                   # vitest
├── eslint.config.mjs
├── vitest.config.mjs
├── package.json            # bin, files, engines, packageManager
├── .nvmrc
├── ts7-overrides.example.json
└── README.md               # uso, flags, semântica dos status, limites da análise estática
```

## Testes (Vitest)

Instale `vitest` como devDependency e cubra no mínimo:

1. **`admitsTs7`** — tabela de casos: `^5.0.0→false`, `>=5.0.0→true`, `>=4.5 <7→false`, `*→true`, `workspace:*→null`, `latest→true`, range inválido→null.
2. **`collectNmDirs`** — fixture em dir temporário (`fs.mkdtemp`) simulando: node_modules raiz, workspace com node_modules próprio, e store `.pnpm/x@1.0.0/node_modules`; afirmar que os três são encontrados e que não desce dentro de node_modules pela árvore normal.
3. **`usesCompilerApi`** — lib que requer `typescript` e chama `createProgram` → true; lib que só requer `typescript` sem símbolos de API → false; lib sem entrypoint legível → false (sem throw).
4. **Classificação** — os 4 status a partir de combinações de `usesApi`/`admitsTs7`/`src`, incluindo o curto-circuito `dev`-only → OK (e que um `dev` que chama a API ainda vira BLOCKER), e precedência do override nos dois sentidos.
5. **Render** — `vlen` ignora escapes ANSI; com `--no-color` a saída não contém `\x1b[`; larguras de moldura consistentes (todas as linhas da tabela com a mesma largura visível); `--all` mostra as linhas `OK`, ocultas por padrão.
6. **E2E da CLI** — spawn do bin contra fixtures: exit 1 com blocker, exit 0 sem, exit 2 sem node_modules, `--json` parseável.

Use fixtures montadas em `beforeEach` com dirs temporários — sem mock de fs. Para `registry.mjs`, mock de `fetch` (não bater na rede em teste).

## Lint (ESLint estrito, flat config)

- `eslint` + `@eslint/js` (config `recommended` como base) elevando para estrito: `eqeqeq`, `no-var`, `prefer-const`, `no-unused-vars` como erro, `curly`, `no-implicit-coercion`, complexidade máxima razoável (ex. 15).
- Como a fonte é JS: adicione checagem de tipos via `tsc --checkJs` **opcional** apenas se não introduzir dependência do TS no runtime — caso contrário, JSDoc + eslint basta.
- **Não** usar typescript-eslint parser preso à Compiler API antiga (ironia a evitar).
- Scripts: `"lint": "eslint ."`, `"test": "vitest run"`, `"test:watch": "vitest"`.

## Implementação de referência

O arquivo abaixo é um protótipo funcional single-file já testado (inclusive contra fixture de monorepo pnpm). **Use-o como fonte da verdade do comportamento** — refatore para a estrutura modular acima, sem regressão de comportamento. Onde a spec acima e o código divergirem, a spec ganha.

```js
#!/usr/bin/env node
// ts7-scan — varredura estática de compatibilidade de dependências com TypeScript 7 (tsc nativo).
//
// O que ele infere (do mais confiável ao mais fraco):
//   1. A lib depende de `typescript`? E ONDE? (peer/dep afeta você; dev-only é só como ela se constrói)
//   2. O range de `typescript` declarado ADMITE 7.x?                    -> compat declarada pelo autor
//   3. A lib CHAMA a Compiler API? (createProgram, transpileModule...)  -> quebra dura no 7.0 (que não tem API)
//   4. (--check-updates) Existe versão publicada que já admite 7?       -> upgrade disponível
//   5. (overrides) Veredicto manual/da comunidade sobrescreve a heurística
//
// Detecta monorepo automaticamente: varre o node_modules raiz, os de cada workspace
// e o store virtual do pnpm (.pnpm), deduplicando por nome@versão.
//
// Não executa nada das libs: é 100% estático. Saída = lista de risco priorizada, não um "sim/não" definitivo.
//
// Uso:
//   node ts7-scan.mjs [--json] [--check-updates] [--cwd <dir>] [--overrides <arquivo>] [--all] [--no-color]
// Como npx (depois de publicar): npx ts7-scan --check-updates
//
// Overrides: um JSON { "<lib>": { "compatible": true|false, "note": "..." } }.
// Por padrão procura ./ts7-overrides.json no --cwd.

import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver'; // única dependência de runtime

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const checkUpdates = argv.includes('--check-updates');
const showAll = argv.includes('--all'); // por padrão as linhas OK ficam ocultas
const argVal = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const cwd = argVal('--cwd') ? path.resolve(argVal('--cwd')) : process.cwd();

const TS7 = '7.0.0';
const API_SYMBOLS = [
  'createProgram', 'transpileModule', 'createLanguageService', 'createPrinter',
  'createSourceFile', 'getTypeChecker', 'createWatchProgram', 'createCompilerHost',
  'transformNodes', 'createTypeChecker', 'LanguageServiceHost',
];
const API_RE = new RegExp(`\\b(${API_SYMBOLS.join('|')})\\b`);
const MAX_DEPTH = 6;

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// Descobre todos os node_modules relevantes: raiz, workspaces e store do pnpm (.pnpm/*/node_modules).
function collectNmDirs(root) {
  const dirs = new Set();
  (function walk(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'node_modules') {
        const nm = path.join(dir, 'node_modules');
        dirs.add(nm);
        const pnpm = path.join(nm, '.pnpm');       // store virtual do pnpm
        if (fs.existsSync(pnpm)) {
          for (const p of fs.readdirSync(pnpm, { withFileTypes: true })) {
            if (!p.isDirectory()) continue;
            const inner = path.join(pnpm, p.name, 'node_modules');
            if (fs.existsSync(inner)) dirs.add(inner);
          }
        }
        // não desce dentro de node_modules pela árvore normal (o .pnpm já cobre o não-içado)
      } else if (depth < MAX_DEPTH && !e.name.startsWith('.')) {
        walk(path.join(dir, e.name), depth + 1);
      }
    }
  })(root, 0);
  return [...dirs];
}

// Enumera todo pacote instalado sob um node_modules (inclui escopos @org/*).
function* listInstalled(nmDir) {
  let entries;
  try { entries = fs.readdirSync(nmDir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(nmDir, entry.name);
    if (entry.name.startsWith('@')) {
      let subs; try { subs = fs.readdirSync(full, { withFileTypes: true }); } catch { continue; }
      for (const sub of subs) if (sub.isDirectory()) yield path.join(full, sub.name);
    } else if (entry.isDirectory()) {
      yield full;
    }
  }
}

// Range de `typescript` que a lib declara + ONDE (peer > dep > dev). O `src`
// importa para o consumidor: peer/dep afeta o seu build, dev-only não.
function tsRangeOf(pkg) {
  if (pkg.peerDependencies?.typescript != null) return { range: pkg.peerDependencies.typescript, src: 'peer' };
  if (pkg.dependencies?.typescript != null) return { range: pkg.dependencies.typescript, src: 'dep' };
  if (pkg.devDependencies?.typescript != null) return { range: pkg.devDependencies.typescript, src: 'dev' };
  return { range: null, src: null };
}

// A lib admite TS 7 no range declarado?  -> true | false | null(desconhecido)
function admitsTs7(range) {
  if (!range || range === '*' || range === 'latest') return true;
  const opts = { includePrerelease: true };
  if (semver.validRange(range, opts) == null) return null; // workspace:*, exótico
  return semver.satisfies(TS7, range, opts);
}

// A lib de fato chama a Compiler API? Heurística: lê o entry principal e faz um scan raso do dir.
function usesCompilerApi(dir, pkg) {
  const candidates = new Set();
  if (typeof pkg.main === 'string') candidates.add(path.join(dir, pkg.main));
  if (typeof pkg.module === 'string') candidates.add(path.join(dir, pkg.module));
  const exp = pkg.exports;
  if (exp && typeof exp === 'object') {
    JSON.stringify(exp).replace(/"(\.[^"]+\.(?:js|mjs|cjs))"/g, (_, f) => (candidates.add(path.join(dir, f)), f));
  }
  candidates.add(path.join(dir, 'index.js'));
  for (const file of candidates) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const src = fs.readFileSync(file, 'utf8');
        if (/(require\(['"]typescript['"]\)|from\s+['"]typescript['"])/.test(src) && API_RE.test(src)) return true;
      }
    } catch { /* ignore */ }
  }
  return false;
}

// ---- overrides (veredicto manual / da comunidade) ----
function loadOverrides() {
  const candidates = [];
  if (argVal('--overrides')) candidates.push(path.resolve(argVal('--overrides')));
  candidates.push(path.join(cwd, 'ts7-overrides.json'));
  for (const p of candidates) if (fs.existsSync(p)) return { data: readJSON(p) || {}, from: p };
  return { data: {}, from: null };
}
const { data: overrides, from: overridesFrom } = loadOverrides();

// ---- coleta (monorepo-aware) ----
const nmDirs = collectNmDirs(cwd);
if (nmDirs.length === 0) {
  console.error(`Nenhum node_modules encontrado a partir de ${cwd}. Rode o install primeiro (ou passe --cwd).`);
  process.exit(2);
}

const seen = new Map(); // name@version -> row
for (const nmDir of nmDirs) {
  for (const dir of listInstalled(nmDir)) {
    const pkg = readJSON(path.join(dir, 'package.json'));
    if (!pkg?.name) continue;
    const { range, src } = tsRangeOf(pkg);
    if (!range) continue; // não toca em TypeScript -> irrelevante para este check
    const key = `${pkg.name}@${pkg.version ?? '?'}`;
    if (seen.has(key)) { if (!seen.get(key).usesApi) seen.get(key).usesApi = usesCompilerApi(dir, pkg); continue; }
    seen.set(key, {
      name: pkg.name,
      installed: pkg.version ?? '?',
      tsRange: range,
      src,
      admitsTs7: admitsTs7(range),
      usesApi: usesCompilerApi(dir, pkg),
    });
  }
}
const rows = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));

// ---- checagem opcional de updates no npm ----
async function latestAdmitsTs7(name) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`);
    if (!res.ok) return { latest: null, admits: null };
    const j = await res.json();
    return { latest: j.version ?? null, admits: admitsTs7(j.peerDependencies?.typescript ?? j.dependencies?.typescript) };
  } catch { return { latest: null, admits: null }; }
}
if (checkUpdates) {
  await Promise.all(rows.filter(r => r.admitsTs7 === false).map(async r => {
    const u = await latestAdmitsTs7(r.name);
    r.latest = u.latest; r.latestAdmitsTs7 = u.admits;
  }));
}

// ---- classificação (heurística → override) ----
// Precedência: BLOCKER → (dev-only curto-circuita p/ OK) → BUMP → UNKNOWN → OK.
const heuristicBucket = r =>
  r.usesApi && r.admitsTs7 !== true ? 'BLOCKER'
  : r.src === 'dev' ? 'OK'          // typescript só em devDependencies: como a lib se constrói, não é seu problema
  : r.admitsTs7 === false ? 'BUMP'
  : r.admitsTs7 === null ? 'UNKNOWN'
  : 'OK';
for (const r of rows) {
  r.status = heuristicBucket(r);
  const ov = overrides[r.name];
  if (ov && typeof ov.compatible === 'boolean') {
    r.status = ov.compatible ? 'OK' : 'BLOCKER';
    r.override = true;
    if (ov.note) r.note = ov.note;
  }
}

const n = s => rows.filter(r => r.status === s).length;

if (asJson) {
  console.log(JSON.stringify({ scanned: { nodeModulesDirs: nmDirs.length, libs: rows.length }, overrides: overridesFrom, rows }, null, 2));
  process.exit(n('BLOCKER') > 0 ? 1 : 0);
}

// ---- saída legível (tabela emoldurada, ciente de ANSI) ----
const ESC = String.fromCharCode(27);
const noColor = argv.includes('--no-color') || process.env.NO_COLOR;
const c = (code, s) => noColor ? String(s) : `${ESC}[${code}m${s}${ESC}[0m`;
const CLR = { BLOCKER: 31, BUMP: 33, UNKNOWN: 90, OK: 32 };
const ICON = { BLOCKER: '✖', BUMP: '▲', UNKNOWN: '?', OK: '✔' };
const dim = s => c(90, s);
const bold = s => c(1, s);

// Razão de uma linha (coluna WHY).
const whyOf = r =>
  r.status === 'BLOCKER' ? 'calls Compiler API'
  : r.status === 'BUMP' ? (r.src === 'peer' ? 'you supply TS; range excludes 7' : 'bundles TS; range excludes 7')
  : r.status === 'UNKNOWN' ? 'range not evaluable'
  : '';

const order = { BLOCKER: 0, BUMP: 1, UNKNOWN: 2, OK: 3 };
rows.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));

const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const vlen = s => String(s).replace(ANSI_RE, '').length;          // largura visível (ignora ANSI)
const padEndV = (s, w) => s + ' '.repeat(Math.max(0, w - vlen(s)));
const padStartV = (s, w) => ' '.repeat(Math.max(0, w - vlen(s))) + s;

const HEAD = ['STATUS', 'LIB', 'VER', 'TS RANGE', 'SRC', 'WHY', 'UPDATE'];
const ALIGN = ['l', 'l', 'l', 'l', 'l', 'l', 'l'];
const okCount = n('OK');
const visible = showAll ? rows : rows.filter(r => r.status !== 'OK'); // OK ocultas por padrão
const body = visible.map(r => {
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

const colW = HEAD.map((h, i) => Math.max(vlen(h), ...body.map(b => vlen(b.cells[i])), 3));
const inner = colW.reduce((a, w) => a + w + 2, 0) + (colW.length - 1);

const cell = (txt, i) => {
  const w = colW[i];
  const s = ALIGN[i] === 'c' ? padStartV(padEndV(txt, (w + vlen(txt) + 1) >> 1), w)
          : ALIGN[i] === 'r' ? padStartV(txt, w)
          : padEndV(txt, w);
  return ` ${s} `;
};
const line = (l, m, r) => l + colW.map(w => '─'.repeat(w + 2)).join(m) + r;
const rowStr = cells => '│' + cells.map(cell).join('│') + '│';
const spanStr = txt => '│' + padEndV(' ' + txt, inner) + '│';

console.log();
console.log(bold('  TS7 scan') + dim(`   ·   ${rows.length} libs dependem de "typescript"`));
console.log(dim(`  ${cwd}`));
console.log(dim(`  node_modules varridos: ${nmDirs.length}${overridesFrom ? `   ·   overrides: ${path.basename(overridesFrom)}` : ''}`));
console.log();

const out = [];
out.push('  ' + line('┌', '┬', '┐'));
out.push('  ' + rowStr(HEAD.map(h => bold(h))));
out.push('  ' + line('├', '┼', '┤'));
for (const b of body) {
  out.push('  ' + rowStr(b.cells));
  if (b.note) out.push('  ' + spanStr(dim('↳ ' + b.note)));
}
out.push('  ' + line('└', '┴', '┘'));
console.log(out.join('\n'));

const chip = (s) => c(CLR[s], `${ICON[s]} ${n(s)} ${s}`);
console.log();
console.log('  ' + [chip('BLOCKER'), chip('BUMP'), chip('UNKNOWN'), chip('OK')].join('    '));
if (!showAll && okCount > 0) console.log('  ' + dim(`(${okCount} OK hidden — pass --all to show them)`));
console.log();
console.log(dim('  ✖ BLOCKER  usa a Compiler API e o range não admite 7 → mantenha em tsc6 (@typescript/typescript6) até o 7.1'));
console.log(dim('  ▲ BUMP     um range peer/dep de typescript exclui 7 → espere ou migre para um release mais novo da lib'));
console.log(dim('  ? UNKNOWN  range peer/dep não avaliável (workspace:*, dist-tag como "next", ou exótico)'));
console.log(dim('  ↑ UPDATE   versão publicada que já admite 7 (com --check-updates)'));
console.log(dim('  SRC        onde o range de typescript foi declarado — peer/dep pode afetar você; dev-only é'));
console.log(dim('             a lib se construindo e é reportado OK (nunca BUMP)'));
console.log(dim('  (ovr)      veredicto veio do ts7-overrides.json, não da heurística'));
console.log();
process.exit(n('BLOCKER') > 0 ? 1 : 0);
```

## Critérios de aceite (verifique antes de encerrar)

1. `pnpm install` limpo no Node 24; `pnpm lint` e `pnpm test` verdes.
2. `node bin/ts7-scan.mjs --cwd <fixture>` imprime a tabela emoldurada alinhada (teste com lib de nome longo e com cor ligada).
3. Exit codes corretos nos três cenários.
4. `pnpm pack` gera tarball contendo só `bin/`, `src/`, README e LICENSE (campo `files`).
5. README documenta: instalação (`npx ts7-scan`), flags, semântica dos 4 status, formato do overrides, e os limites da análise estática (heurística de API não prova quebra; teste definitivo é rodar build/test sob TS 7).
6. Rode a CLI contra o próprio repo do projeto como smoke test final e cole a saída no resumo.

---

> Fim do prompt.
