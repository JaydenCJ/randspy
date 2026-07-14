# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- Four entropy patches with exact call-site attribution: **time**
  (`Date.now`, zero-argument `new Date()`, legacy `Date()` calls via a
  semantics-preserving Proxy, `performance.now`, `process.hrtime` and
  `process.hrtime.bigint`), **random** (`Math.random`, node:crypto's
  `randomBytes`/`randomInt`/`randomUUID`/`randomFillSync`, and Web
  Crypto's `getRandomValues`/`randomUUID`), **env** (property reads,
  `in` checks and enumeration of `process.env`, names only — values are
  never recorded) and **order** (`fs.readdirSync`, callback `fs.readdir`
  and `fs.promises.readdir`, whose ordering is filesystem-dependent).
- Stack-based blame: V8 stack parsing with ESM `file://` URLs, eval
  origins and async frames; the first frame outside randspy and outside
  `node:` internals is reported as `file:line:column`. Reads that only
  happen inside Node's own code (e.g. `console.log` probing
  `FORCE_COLOR`) are dropped by default and available via `--internals`.
- `randspy run <script> [args...]`: traces a child Node process through
  a preload hook, streams the program's own output untouched, then
  prints an aggregated per-site report; non-zero child exit codes are
  propagated unchanged.
- Report tooling: `--format json` with a stable documented schema
  (docs/report-format.md), `--report <file>` for saving raw JSON,
  `randspy report` for re-rendering and re-gating saved reports, and
  `randspy explain` for offline category documentation with fixes.
- CI gating: `--fail-on any|none|<categories>` (exit 1 on match),
  `--only` category filtering, repeatable `--allow` suppression by API
  name, path glob, `file:line` or basename, `--top` and `--quiet`;
  usage errors exit 2.
- Deterministic, byte-identical reports for identical runs: counts per
  exact site, stable sort order, and opt-in `--values` samples (capped,
  primitives only, never environment values).
- Programmatic API (`RandSpy`, `withSpy`, `withSpyAsync`, aggregation,
  filtering and both renderers) with type declarations; patches restore
  every original function and descriptor exactly on `disable()`.
- Zero runtime dependencies; `typescript` is the only devDependency.
- Test suite: 91 node:test tests (pure-function units plus CLI
  integration against bundled fixtures) and an end-to-end
  `scripts/smoke.sh` against the example programs.

[0.1.0]: https://github.com/JaydenCJ/randspy/releases/tag/v0.1.0
