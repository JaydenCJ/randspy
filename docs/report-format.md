# The randspy report format (schema 1)

`randspy run --format json`, `randspy run --report <file>` and the
programmatic `spy.report()` all produce the same JSON shape. The schema
number only changes on breaking changes; additive fields keep `schema: 1`.

## Envelope

```json
{
  "tool": "randspy",
  "schema": 1,
  "version": "0.1.0",
  "command": ["examples/checkout.js"],
  "failOn": "any",
  "ok": false,
  "summary": {
    "reads": 4,
    "sites": 4,
    "byCategory": { "time": 1, "random": 1, "env": 1, "order": 1 }
  },
  "records": []
}
```

| Field | Presence | Meaning |
| --- | --- | --- |
| `tool` / `schema` | always | identifies the format; consumers must check both |
| `version` | always | the randspy version that produced the report |
| `command` | `run` only | the traced script and its arguments |
| `failOn` / `ok` | gated renders only | the gate in effect and whether it passed |
| `summary.reads` | always | total traced reads after filtering |
| `summary.sites` | always | distinct (category, api, position) records |
| `records` | always | one entry per site, busiest first |

## Records

```json
{
  "category": "random",
  "api": "Math.random()",
  "file": "/srv/app/examples/checkout.js",
  "line": 11,
  "column": 26,
  "count": 1,
  "internal": false,
  "samples": ["0.8817"]
}
```

- `category` — one of `time`, `random`, `env`, `order`.
- `api` — the human-readable API name; env reads are reported as
  `process.env.NAME` and whole-environment enumeration as
  `process.env (enumerate)`.
- `file`, `line`, `column` — the first stack frame outside randspy and
  outside `node:` internals: the line to blame. Files are absolute in
  JSON; the text renderer relativizes them to the working directory.
- `count` — reads collapsed into this record.
- `internal` — true when the read only happened inside Node's own code
  on the user's behalf (e.g. `console.log` probing `FORCE_COLOR`). Such
  records appear only under `--internals`.
- `samples` — up to 3 stringified return values, present only under
  `--values`. Environment variable *values* are never sampled.

Records sort by `count` descending, then `file`, `line`, `column`, `api`
— so identical runs produce byte-identical reports, including this file's
own ordering guarantees.

## Site resolution rules

1. Frames belonging to randspy's own `dist/` are always skipped.
2. If the nearest remaining frame is user code (project files or
   `node_modules`), that frame is the site and `internal` is false.
3. If the nearest remaining frame is a `node:` internal, the read was
   runtime-mediated: it is dropped by default, or kept with
   `internal: true` (blamed on the nearest user frame, if any) under
   `--internals`.
4. `eval` frames are blamed on the script that called `eval`.

## Traced APIs per category

| Category | APIs |
| --- | --- |
| `time` | `Date.now()`, zero-argument `new Date()`, legacy `Date()`, `performance.now()`, `process.hrtime()`, `process.hrtime.bigint()` |
| `random` | `Math.random()`, `crypto.randomBytes()`, `crypto.randomInt()`, `crypto.randomUUID()`, `crypto.randomFillSync()`, `crypto.getRandomValues()` (node:crypto and Web Crypto) |
| `env` | property reads and `in` checks on `process.env`, plus enumeration (`Object.keys`, spread, `JSON.stringify`) |
| `order` | `fs.readdirSync()`, callback `fs.readdir()`, `fs.promises.readdir()` |

## Known limitations (0.1.0)

- Named ESM imports of built-ins (`import { readdirSync } from "node:fs"`)
  bind before any monkey-patch can land and are **not** traced. `require()`
  and default-object imports (`import fs from "node:fs"`) are traced.
- References captured before the spy is enabled (`const now = Date.now`)
  keep pointing at the originals. Under `randspy run` the spy is installed
  by a preload hook before the first user module evaluates, which closes
  this gap for whole-program tracing.
- Worker threads and child processes spawned by the traced program are
  not instrumented in 0.1.0.
