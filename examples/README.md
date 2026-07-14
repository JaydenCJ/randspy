# randspy examples

Two versions of the same tiny "checkout" program, one entropy-ridden and
one fully injected — run both under the tracer to see the difference.

```bash
npm run build   # once, from the repository root

node dist/cli.js run examples/checkout.js        # FAIL: 4 hidden entropy sources
node dist/cli.js run examples/deterministic.js   # OK: zero nondeterministic reads
```

## checkout.js — the "before"

`createOrder()` builds an id from `Math.random()`, stamps `Date.now()`
into the order object and falls back to `process.env.CURRENCY`;
`loadPlugins()` returns `fs.readdirSync()` in raw filesystem order. Every
one of those four reads is a future flaky assertion: the id and timestamp
break snapshots, the currency changes with the shell, and the plugin
order changes with the filesystem. randspy points at each exact
file:line:column and exits 1.

Useful variations to try:

```bash
node dist/cli.js run --format json examples/checkout.js     # machine-readable
node dist/cli.js run --only order examples/checkout.js      # just the readdir
node dist/cli.js run --fail-on none examples/checkout.js    # report, don't gate
node dist/cli.js run --allow 'examples/**' examples/checkout.js  # suppress all
```

## deterministic.js — the "after"

The same behavior with every entropy source injected: a frozen `now()`,
a seeded mulberry32 PRNG, an explicit currency and a sorted, injected
directory lister. Its output is byte-identical on every run and on every
machine, and randspy reports a clean bill:

```text
randspy: no nondeterministic reads detected

randspy: OK — no nondeterministic reads (fail-on=any)
```

## plugins/

Three trivial modules whose only job is to give `fs.readdirSync()` in
`checkout.js` something to list.
