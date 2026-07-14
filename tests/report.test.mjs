// Filtering (--only / --allow), the fail gate, and the two renderers.
// Text output is asserted on real content (headers, rows, hints,
// verdicts) and JSON on its stable shape — both must be byte-
// deterministic for identical input.
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFilters,
  buildReport,
  isAllowed,
  parseCategories,
  parseFailGate,
  relativize,
  renderJson,
  renderText,
  shouldFail,
  VERSION,
} from "../dist/index.js";

function rec(category, api, file, line, count = 1, extra = {}) {
  return { category, api, file, line, column: 7, count, internal: false, ...extra };
}

const REPORT = buildReport(
  [
    rec("random", "Math.random()", "/proj/src/id.js", 14, 3),
    rec("time", "Date.now()", "/proj/src/session.js", 44, 2),
    rec("env", "process.env.TZ", "/proj/src/format.js", 8),
    rec("order", "fs.readdirSync()", "/proj/tools/list.js", 21),
  ],
  VERSION
);

test("parseFailGate and parseCategories accept gates and reject junk", () => {
  assert.equal(parseFailGate("any"), "any");
  assert.equal(parseFailGate("none"), "none");
  assert.deepEqual(parseFailGate("time,random"), ["time", "random"]);
  assert.equal(parseFailGate("time,bogus"), null);
  assert.equal(parseFailGate(""), null);
  assert.deepEqual(parseCategories(" env , env ,order"), ["env", "order"]);
  assert.equal(parseCategories("ENV"), null);
});

test("relativize strips the cwd prefix and leaves outside paths alone", () => {
  assert.equal(relativize("/proj/src/id.js", "/proj"), "src/id.js");
  assert.equal(relativize("/elsewhere/x.js", "/proj"), "/elsewhere/x.js");
  assert.equal(relativize("/projX/x.js", "/proj"), "/projX/x.js");
});

test("shouldFail: any trips on reads, none never trips, categories select", () => {
  assert.equal(shouldFail(REPORT, "any"), true);
  assert.equal(shouldFail(REPORT, "none"), false);
  assert.equal(shouldFail(REPORT, ["env"]), true);
  assert.equal(shouldFail(applyFilters(REPORT, { only: ["time"] }), ["env"]), false);
  assert.equal(shouldFail(buildReport([], VERSION), "any"), false);
});

test("applyFilters --only keeps categories and recomputes the summary", () => {
  const filtered = applyFilters(REPORT, { only: ["random", "time"] });
  assert.equal(filtered.records.length, 2);
  assert.deepEqual(filtered.summary.byCategory, { time: 2, random: 3, env: 0, order: 0 });
  assert.equal(filtered.summary.reads, 5);
  // The original report is untouched.
  assert.equal(REPORT.records.length, 4);
});

test("isAllowed matches exact API names and API globs", () => {
  const r = rec("random", "Math.random()", "/proj/src/id.js", 14);
  assert.equal(isAllowed(r, ["Math.random()"], "/proj"), true);
  assert.equal(isAllowed(r, ["Math.*"], "/proj"), true);
  assert.equal(isAllowed(r, ["crypto.*"], "/proj"), false);
});

test("isAllowed matches cwd-relative path globs, file:line and basenames", () => {
  const r = rec("env", "process.env.TZ", "/proj/src/format.js", 8);
  assert.equal(isAllowed(r, ["src/**"], "/proj"), true);
  assert.equal(isAllowed(r, ["src/format.js:8"], "/proj"), true);
  assert.equal(isAllowed(r, ["src/format.js:9"], "/proj"), false);
  assert.equal(isAllowed(r, ["*.js"], "/proj"), true);
  assert.equal(isAllowed(r, ["tools/**"], "/proj"), false);
});

test("applyFilters --allow removes suppressed sites", () => {
  const filtered = applyFilters(REPORT, { allow: ["tools/**", "Math.random()"], cwd: "/proj" });
  assert.deepEqual(
    filtered.records.map((r) => r.api),
    ["Date.now()", "process.env.TZ"]
  );
  assert.equal(filtered.summary.reads, 3);
});

test("renderText header and rows: totals, labels, counts, relative sites", () => {
  const out = renderText(REPORT, { cwd: "/proj" });
  assert.match(out, /^randspy: 7 nondeterministic read\(s\) from 4 site\(s\) — time 2 · random 3 · env 1 · order 1\n/);
  assert.match(out, /RANDOM {2}×3 {2}Math\.random\(\) {5}src\/id\.js:14:7/);
  assert.match(out, /ORDER {3}×1 {2}fs\.readdirSync\(\) {2}tools\/list\.js:21:7/);
});

test("renderText appends one hint per category present", () => {
  const out = renderText(REPORT, { cwd: "/proj" });
  for (const cat of ["time", "random", "env", "order"]) {
    assert.ok(out.includes(`hint(${cat}):`), `missing hint for ${cat}`);
  }
  const only = renderText(applyFilters(REPORT, { only: ["env"] }), { cwd: "/proj" });
  assert.equal(only.includes("hint(random)"), false);
});

test("renderText --top truncates and says how many sites are hidden", () => {
  const out = renderText(REPORT, { cwd: "/proj", top: 2 });
  assert.ok(out.includes("Math.random()"));
  assert.equal(out.includes("process.env.TZ"), false);
  assert.ok(out.includes("... 2 more site(s)"));
});

test("renderText verdicts: FAIL with matched count, OK when gate misses", () => {
  const fail = renderText(REPORT, { cwd: "/proj", failOn: "any" });
  assert.ok(fail.trimEnd().endsWith("randspy: FAIL — 7 read(s) match fail-on=any"));
  const okGate = renderText(REPORT, { cwd: "/proj", failOn: "none" });
  assert.ok(okGate.trimEnd().endsWith("randspy: OK — 7 read(s) traced, none match fail-on=none"));
  const catGate = renderText(REPORT, { cwd: "/proj", failOn: ["env", "order"] });
  assert.ok(catGate.trimEnd().endsWith("randspy: FAIL — 2 read(s) match fail-on=env,order"));
});

test("renderText on a clean report has a calm header and OK verdict", () => {
  const out = renderText(buildReport([], VERSION), { failOn: "any" });
  assert.match(out, /^randspy: no nondeterministic reads detected\n/);
  assert.ok(out.includes("randspy: OK — no nondeterministic reads (fail-on=any)"));
});

test("renderText quiet mode keeps only header and verdict", () => {
  const out = renderText(REPORT, { cwd: "/proj", failOn: "any", quiet: true });
  const lines = out.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "");
});

test("renderText marks internal-mediated reads and prints stored samples", () => {
  const report = buildReport(
    [
      rec("env", "process.env.FORCE_COLOR", "/proj/a.js", 3, 1, { internal: true }),
      rec("random", "Math.random()", "/proj/b.js", 3, 2, { samples: ["0.12", "0.98"] }),
    ],
    VERSION
  );
  const out = renderText(report, { cwd: "/proj" });
  assert.ok(out.includes("(node internals)"));
  assert.ok(out.includes("samples: 0.12, 0.98"));
});

test("renderText is byte-deterministic for the same report", () => {
  const a = renderText(REPORT, { cwd: "/proj", failOn: "any" });
  const b = renderText(REPORT, { cwd: "/proj", failOn: "any" });
  assert.equal(a, b);
});

test("renderJson has the documented stable shape and key order", () => {
  const parsed = JSON.parse(renderJson(REPORT, { failOn: "any" }));
  assert.deepEqual(Object.keys(parsed), ["tool", "schema", "version", "failOn", "ok", "summary", "records"]);
  assert.equal(parsed.tool, "randspy");
  assert.equal(parsed.schema, 1);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.summary.reads, 7);
  assert.equal(parsed.records.length, 4);
  assert.deepEqual(Object.keys(parsed.records[0]), ["category", "api", "file", "line", "column", "count", "internal"]);
  // Without a gate, the gate keys are omitted entirely.
  const ungated = JSON.parse(renderJson(REPORT));
  assert.equal("ok" in ungated, false);
  assert.equal("failOn" in ungated, false);
});
