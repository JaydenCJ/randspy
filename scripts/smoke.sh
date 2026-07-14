#!/usr/bin/env bash
# Smoke test for randspy: exercises the real CLI end to end against the
# bundled examples and freshly written temp scripts. No network,
# idempotent, runs from a clean checkout (after `npm install`).
# Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents the surface.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in run report explain --fail-on --allow --only --values "Exit codes"; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Usage errors exit 2 (distinct from the entropy gate's exit 1).
set +e
$CLI frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown command should exit 2"; }
$CLI run >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "run without script should exit 2"; }
$CLI run "$WORKDIR/does-not-exist.mjs" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing script should exit 2"; }
$CLI run --fail-on sometimes x.mjs >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "bad --fail-on should exit 2"; }
$CLI explain chaos >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown explain topic should exit 2"; }
set -e
echo "[smoke] error handling ok (exit 2)"

# 4. The entropy-ridden example fails with all four categories at exact sites.
set +e
CHECKOUT_OUT="$($CLI run examples/checkout.js 2>/dev/null)"; CHECKOUT_CODE=$?
set -e
[ "$CHECKOUT_CODE" -eq 1 ] || fail "examples/checkout.js should exit 1, got $CHECKOUT_CODE"
for needle in "TIME" "RANDOM" "ENV" "ORDER" "Math.random()" "Date.now()" \
  "process.env.CURRENCY" "fs.readdirSync()" "examples/checkout.js:11:26" \
  "hint(order)" "randspy: FAIL — 4 read(s) match fail-on=any"; do
  echo "$CHECKOUT_OUT" | grep -qF -- "$needle" || fail "checkout report missing: $needle"
done
echo "[smoke] checkout example ok (4 categories, exit 1)"

# 5. The injected twin is clean and exits 0.
$CLI run examples/deterministic.js >/dev/null || fail "examples/deterministic.js should exit 0"
CLEAN_OUT="$($CLI run examples/deterministic.js 2>/dev/null)"
echo "$CLEAN_OUT" | grep -q "randspy: no nondeterministic reads detected" || fail "deterministic example not clean"
echo "$CLEAN_OUT" | grep -q "randspy: OK" || fail "deterministic example missing OK verdict"
echo "[smoke] deterministic example ok (exit 0)"

# 6. --fail-on moves the gate; --only narrows; --allow suppresses.
set +e
$CLI run --fail-on none examples/checkout.js >/dev/null 2>&1; [ $? -eq 0 ] || { set -e; fail "--fail-on none should exit 0"; }
$CLI run --fail-on env examples/checkout.js >/dev/null 2>&1; [ $? -eq 1 ] || { set -e; fail "--fail-on env should exit 1"; }
$CLI run --only time examples/checkout.js >/dev/null 2>&1; [ $? -eq 1 ] || { set -e; fail "--only time should exit 1"; }
$CLI run --allow 'examples/**' examples/checkout.js >/dev/null 2>&1; [ $? -eq 0 ] || { set -e; fail "--allow examples/** should exit 0"; }
set -e
ONLY_OUT="$($CLI run --only order --fail-on none examples/checkout.js 2>/dev/null)"
echo "$ONLY_OUT" | grep -q "fs.readdirSync()" || fail "--only order should keep readdir"
echo "$ONLY_OUT" | grep -q "Math.random()" && fail "--only order must drop random"
echo "[smoke] --fail-on / --only / --allow ok"

# 7. JSON output is valid JSON with the stable shape (silent child, so
#    stdout carries only the report; noisy children should use --report).
cat > "$WORKDIR/silent.mjs" <<'EOF'
import fs from "node:fs";
const t = Date.now();
const r = Math.random();
const tz = process.env.TZ ?? "";
const entries = fs.readdirSync(".");
if (t < 0 || r < 0 || tz.length < 0 || entries.length < 0) throw new Error("unreachable");
EOF
set +e
JSON_OUT="$($CLI run --format json "$WORKDIR/silent.mjs" 2>/dev/null)"; JSON_CODE=$?
set -e
[ "$JSON_CODE" -eq 1 ] || fail "json run should still exit 1"
echo "$JSON_OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(j.tool!=='randspy'||j.schema!==1||j.ok!==false||j.summary.reads!==4)throw new Error('bad shape')})" \
  || fail "--format json shape wrong"
echo "[smoke] JSON output ok"

# 8. --report saves raw JSON; the report subcommand re-renders and re-gates it.
$CLI run --report "$WORKDIR/saved.json" --fail-on none examples/checkout.js >/dev/null 2>&1 \
  || fail "--report run should exit 0 with fail-on none"
[ -s "$WORKDIR/saved.json" ] || fail "--report did not write a file"
set +e
$CLI report "$WORKDIR/saved.json" >/dev/null 2>&1; [ $? -eq 1 ] || { set -e; fail "report should gate with default fail-on any"; }
$CLI report --fail-on none "$WORKDIR/saved.json" | grep -q "process.env.CURRENCY"; OK=$?
set -e
[ "$OK" -eq 0 ] || fail "report re-render missing sites"
echo "[smoke] --report / report subcommand ok"

# 9. Child exit codes are propagated unchanged, report still printed.
cat > "$WORKDIR/exit7.mjs" <<'EOF'
const roll = Math.random();
if (roll < 0) throw new Error("unreachable");
process.exit(7);
EOF
set +e
EXIT7_OUT="$($CLI run "$WORKDIR/exit7.mjs" 2>/dev/null)"; EXIT7_CODE=$?
set -e
[ "$EXIT7_CODE" -eq 7 ] || fail "child exit 7 should propagate, got $EXIT7_CODE"
echo "$EXIT7_OUT" | grep -q "Math.random()" || fail "report missing after child exit 7"
echo "[smoke] child exit propagation ok (exit 7)"

# 10. Counts aggregate per site: a loop of 5 reads is one ×5 record.
cat > "$WORKDIR/loop.mjs" <<'EOF'
let acc = 0;
for (let i = 0; i < 5; i += 1) acc += Math.random();
if (acc < 0) throw new Error("unreachable");
EOF
LOOP_OUT="$($CLI run --fail-on none "$WORKDIR/loop.mjs" 2>/dev/null)"
echo "$LOOP_OUT" | grep -q "×5" || fail "loop should aggregate to ×5"
echo "$LOOP_OUT" | grep -q "5 nondeterministic read(s) from 1 site(s)" || fail "loop summary wrong"
echo "[smoke] per-site aggregation ok (×5)"

# 11. explain documents all four categories offline.
for topic in time random env order categories; do
  $CLI explain "$topic" >/dev/null || fail "explain $topic failed"
done
$CLI explain time | grep -q "Date.now()" || fail "explain time missing Date.now()"
$CLI explain order | grep -q "readdir" || fail "explain order missing readdir"
echo "[smoke] explain ok"

# 12. Determinism: two report renders over the same tree are byte-identical.
$CLI run --fail-on none examples/checkout.js > "$WORKDIR/run1.txt" 2>/dev/null
$CLI run --fail-on none examples/checkout.js > "$WORKDIR/run2.txt" 2>/dev/null
# Child stdout (a random order id) is interleaved; compare the report part only.
grep '^randspy\|^  ' "$WORKDIR/run1.txt" > "$WORKDIR/rep1.txt"
grep '^randspy\|^  ' "$WORKDIR/run2.txt" > "$WORKDIR/rep2.txt"
cmp -s "$WORKDIR/rep1.txt" "$WORKDIR/rep2.txt" || fail "repeat report renders differ"
[ -s "$WORKDIR/rep1.txt" ] || fail "report extraction empty"
echo "[smoke] determinism ok"

echo "SMOKE OK"
