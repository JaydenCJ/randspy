// The time patch: Date.now, zero-argument new Date(), legacy Date()
// calls, performance.now and process.hrtime are traced with this file as
// the blamed site, while Date's full semantics (parsing, UTC, instanceof,
// subclassing, explicit-value construction) survive untouched — and
// disable() restores the pristine globals.
import test from "node:test";
import assert from "node:assert/strict";
import { RandSpy, withSpy } from "../dist/index.js";

function recordsOf(spy) {
  return spy.report().records;
}

test("Date.now() is traced and still returns milliseconds", () => {
  const spy = new RandSpy();
  spy.enable();
  const value = Date.now();
  spy.disable();
  assert.equal(typeof value, "number");
  const recs = recordsOf(spy).filter((r) => r.api === "Date.now()");
  assert.equal(recs.length, 1);
  assert.equal(recs[0].count, 1);
  assert.ok(recs[0].file.endsWith("spy-time.test.mjs"));
});

test("new Date() with no arguments is traced; explicit values are not", () => {
  const { result, report } = withSpy(() => [new Date(), new Date(0), new Date(2020, 0, 2)]);
  assert.ok(result[0] instanceof Date);
  assert.equal(result[1].getTime(), 0);
  const apis = report.records.map((r) => r.api);
  assert.deepEqual(apis, ["new Date()"]);
  assert.equal(report.summary.byCategory.time, 1);
});

test("the legacy Date() string call is traced separately", () => {
  const { result, report } = withSpy(() => Date());
  assert.equal(typeof result, "string");
  assert.deepEqual(report.records.map((r) => r.api), ["Date()"]);
});

test("Date semantics survive patching: statics, instances, subclassing", () => {
  const { result, report } = withSpy(() => {
    const parsed = Date.parse("2020-01-02T03:04:05.000Z");
    const utc = Date.UTC(2020, 0, 2);
    const d = new Date(parsed);
    class Stamp extends Date {}
    const s = new Stamp(); // zero-arg super() is itself traced
    return {
      parsed,
      utc,
      iso: d.toISOString(),
      isDate: d instanceof Date,
      subclass: s instanceof Stamp && s instanceof Date,
    };
  });
  assert.equal(result.parsed, 1577934245000);
  assert.equal(result.utc, 1577923200000);
  assert.equal(result.iso, "2020-01-02T03:04:05.000Z");
  assert.equal(result.isDate, true);
  assert.equal(result.subclass, true);
  assert.deepEqual(report.records.map((r) => r.api), ["new Date()"]);
});

test("performance.now() is traced and monotonic values still come back", () => {
  const { result, report } = withSpy(() => performance.now());
  assert.equal(typeof result, "number");
  assert.deepEqual(report.records.map((r) => r.api), ["performance.now()"]);
});

test("process.hrtime() and process.hrtime.bigint() are traced", () => {
  const { result, report } = withSpy(() => ({
    tuple: process.hrtime(),
    big: process.hrtime.bigint(),
  }));
  assert.equal(result.tuple.length, 2);
  assert.equal(typeof result.big, "bigint");
  assert.deepEqual(
    report.records.map((r) => r.api).sort(),
    ["process.hrtime()", "process.hrtime.bigint()"]
  );
});

test("disable() restores the original Date, performance.now and hrtime", () => {
  const originalDate = Date;
  const originalHrtime = process.hrtime;
  const originalPerfNow = performance.now;
  const spy = new RandSpy();
  spy.enable();
  assert.notEqual(Date, originalDate);
  assert.notEqual(performance.now, originalPerfNow);
  spy.disable();
  assert.equal(Date, originalDate);
  assert.equal(process.hrtime, originalHrtime);
  assert.equal(performance.now, originalPerfNow);
});

test("nothing is recorded before enable() or after disable(); both idempotent", () => {
  const originalDate = Date;
  const spy = new RandSpy();
  Date.now();
  spy.enable();
  spy.enable();
  spy.disable();
  spy.disable();
  Date.now();
  assert.equal(spy.size, 0);
  assert.equal(Date, originalDate);
});

test("clear() drops buffered events; counts aggregate per call site", () => {
  const spy = new RandSpy();
  spy.enable();
  Date.now();
  spy.clear();
  for (let i = 0; i < 3; i += 1) Date.now();
  spy.disable();
  const recs = recordsOf(spy);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].count, 3);
});

test("captureValues stores stringified clock samples, capped by maxSamples", () => {
  const spy = new RandSpy({ captureValues: true, maxSamples: 2 });
  spy.enable();
  for (let i = 0; i < 4; i += 1) Date.now();
  spy.disable();
  const rec = recordsOf(spy)[0];
  assert.equal(rec.count, 4);
  assert.equal(rec.samples.length, 2);
  assert.match(rec.samples[0], /^\d+$/);
});
