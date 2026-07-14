# Contributing to randspy

Issues, discussions and pull requests are all welcome — this project aims
to stay small, zero-dependency at runtime, and surgical about what it
patches.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/randspy.git
cd randspy
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 91 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (run, report, explain, exit
codes, --fail-on, --only, --allow, JSON output, child exit propagation,
per-site aggregation, determinism) against the bundled examples and must
print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean
   (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (stack parsing, matching, aggregation and rendering take
   values — only the spy's patches and the CLI touch process state).
5. A new traced API needs: a patch that restores the original exactly on
   `disable()`, a category assignment, an `explain` mention, a row in
   `docs/report-format.md` and at least one pass-through test proving
   the wrapped API's semantics are unchanged.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined.
- No network calls, ever — randspy patches globals, reads stacks and
  writes a report file. That is the whole I/O surface.
- Patches must be perfectly reversible: `disable()` restores original
  functions and descriptors byte-for-byte, and enable/disable are
  idempotent. A patch that can crash the traced program is a bug of the
  highest severity, whatever it detects.
- Privacy is non-negotiable: environment variable *values* are never
  recorded, and `--values` samples only primitive returns (never key
  material such as `randomBytes` buffers).
- Report determinism is API: identical runs must render byte-identical
  reports, and `schema` only changes on breaking shape changes.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `randspy --version` output, your Node version, the exact
command line, and a minimal script that reproduces the problem — ideally
with the `--format json` report attached. Misattributed sites are the
most valuable bug class: include the stack you expected to be blamed.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.
