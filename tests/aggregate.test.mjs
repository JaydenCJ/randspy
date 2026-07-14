// Aggregation folds the raw event stream into per-site records with
// deterministic ordering and capped samples; the summary drives both the
// header line and the fail gate, so its arithmetic is pinned exactly.
import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, buildReport, compareRecords, summarize, VERSION } from "../dist/index.js";

function ev(category, api, file, line = 1, column = 1, extra = {}) {
  return { category, api, site: { file, line, column }, internal: false, ...extra };
}

test("events at the same api and position collapse into one counted record", () => {
  const records = aggregate([
    ev("random", "Math.random()", "/a.js", 4, 10),
    ev("random", "Math.random()", "/a.js", 4, 10),
    ev("random", "Math.random()", "/a.js", 4, 10),
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].count, 3);
});

test("different columns on the same line stay distinct sites", () => {
  const records = aggregate([
    ev("time", "Date.now()", "/a.js", 4, 10),
    ev("time", "Date.now()", "/a.js", 4, 22),
  ]);
  assert.equal(records.length, 2);
});

test("the same position with different APIs stays distinct", () => {
  const records = aggregate([
    ev("time", "Date.now()", "/a.js", 4, 10),
    ev("time", "new Date()", "/a.js", 4, 10),
  ]);
  assert.equal(records.length, 2);
});

test("records sort by count descending, then file, line, column, api", () => {
  const records = aggregate([
    ev("env", "process.env.B", "/b.js", 1, 1),
    ev("time", "Date.now()", "/a.js", 9, 1),
    ev("time", "Date.now()", "/a.js", 2, 1),
    ev("time", "Date.now()", "/a.js", 2, 1),
  ]);
  assert.deepEqual(
    records.map((r) => [r.count, r.file, r.line]),
    [
      [2, "/a.js", 2],
      [1, "/a.js", 9],
      [1, "/b.js", 1],
    ]
  );
  // A full tie compares as equal, keeping sorts stable.
  const a = { category: "time", api: "Date.now()", file: "/a.js", line: 1, column: 1, count: 2, internal: false };
  assert.equal(compareRecords(a, { ...a }), 0);
});

test("samples are kept in arrival order and capped at maxSamples", () => {
  const events = [1, 2, 3, 4, 5].map((n) =>
    ev("random", "Math.random()", "/a.js", 4, 10, { sample: `0.${n}` })
  );
  const records = aggregate(events, 3);
  assert.deepEqual(records[0].samples, ["0.1", "0.2", "0.3"]);
  assert.equal(records[0].count, 5);
});

test("maxSamples of zero disables sample storage entirely", () => {
  const records = aggregate([ev("random", "Math.random()", "/a.js", 1, 1, { sample: "0.5" })], 0);
  assert.equal(records[0].samples, undefined);
});

test("summarize totals reads per category and counts distinct sites", () => {
  const records = aggregate([
    ev("time", "Date.now()", "/a.js", 1, 1),
    ev("time", "Date.now()", "/a.js", 1, 1),
    ev("env", "process.env.TZ", "/b.js", 2, 2),
    ev("order", "fs.readdirSync()", "/c.js", 3, 3),
  ]);
  const summary = summarize(records);
  assert.deepEqual(summary, {
    reads: 4,
    sites: 3,
    byCategory: { time: 2, random: 0, env: 1, order: 1 },
  });
});

test("buildReport stamps the envelope and only sets command when given", () => {
  const bare = buildReport([], VERSION);
  assert.equal(bare.tool, "randspy");
  assert.equal(bare.schema, 1);
  assert.equal(bare.version, VERSION);
  assert.equal("command" in bare, false);
  const withCommand = buildReport([], VERSION, ["app.js", "--flag"]);
  assert.deepEqual(withCommand.command, ["app.js", "--flag"]);
});
