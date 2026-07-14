// The env patch: property reads, `in` checks and enumeration of
// process.env are traced by variable NAME (values are never recorded),
// RANDSPY_* control variables are exempt, writes pass through to the
// real environment, and disable() restores the original env object.
import test from "node:test";
import assert from "node:assert/strict";
import { RandSpy, withSpy } from "../dist/index.js";

test("reading a variable records process.env.<NAME> and returns its value", () => {
  process.env.RSPYT_READ = "hello";
  const { result, report } = withSpy(() => process.env.RSPYT_READ);
  delete process.env.RSPYT_READ;
  assert.equal(result, "hello");
  const rec = report.records.find((r) => r.api === "process.env.RSPYT_READ");
  assert.equal(rec.category, "env");
  assert.ok(rec.file.endsWith("spy-env.test.mjs"));
});

test("reading a missing variable is still traced and returns undefined", () => {
  const { result, report } = withSpy(() => process.env.RSPYT_DOES_NOT_EXIST);
  assert.equal(result, undefined);
  assert.deepEqual(report.records.map((r) => r.api), ["process.env.RSPYT_DOES_NOT_EXIST"]);
});

test("'NAME' in process.env is traced like a read", () => {
  const { result, report } = withSpy(() => "RSPYT_IN_CHECK" in process.env);
  assert.equal(result, false);
  assert.deepEqual(report.records.map((r) => r.api), ["process.env.RSPYT_IN_CHECK"]);
});

test("Object.keys and spread of process.env record enumerate events", () => {
  process.env.RSPYT_ENUM = "1";
  const keys = withSpy(() => Object.keys(process.env));
  assert.ok(keys.result.includes("RSPYT_ENUM"));
  assert.deepEqual(keys.report.records.map((r) => r.api), ["process.env (enumerate)"]);
  assert.equal(keys.report.summary.reads, 1);
  // Spread additionally copies values via per-key gets, all traced.
  const spread = withSpy(() => ({ ...process.env }));
  delete process.env.RSPYT_ENUM;
  assert.equal(spread.result.RSPYT_ENUM, "1");
  assert.ok(spread.report.records.some((r) => r.api === "process.env (enumerate)"));
});

test("RANDSPY_* control variables are never traced", () => {
  process.env.RANDSPY_OPTIONS = "{}";
  const { report } = withSpy(() => {
    const a = process.env.RANDSPY_OPTIONS;
    const b = "RANDSPY_REPORT_FILE" in process.env;
    return [a, b];
  });
  delete process.env.RANDSPY_OPTIONS;
  assert.equal(report.summary.reads, 0);
});

test("environment values never appear in samples, even with captureValues", () => {
  process.env.RSPYT_SECRET = "hunter2";
  const spy = new RandSpy({ captureValues: true });
  spy.enable();
  const value = process.env.RSPYT_SECRET;
  spy.disable();
  delete process.env.RSPYT_SECRET;
  assert.equal(value, "hunter2");
  const rec = spy.report().records[0];
  assert.equal(rec.samples, undefined);
  assert.equal(JSON.stringify(spy.report()).includes("hunter2"), false);
});

test("writes and deletes while traced hit the real environment silently", () => {
  const { report } = withSpy(() => {
    process.env.RSPYT_WRITE = "42";
    delete process.env.RSPYT_TEMP;
  });
  assert.equal(report.summary.reads, 0);
  assert.equal(process.env.RSPYT_WRITE, "42");
  delete process.env.RSPYT_WRITE;
});

test("disable() restores the exact original process.env object", () => {
  const original = process.env;
  const spy = new RandSpy();
  spy.enable();
  assert.notEqual(process.env, original);
  spy.disable();
  assert.equal(process.env, original);
});

test("repeated reads of one variable from one site aggregate with a count", () => {
  process.env.RSPYT_LOOP = "x";
  const { report } = withSpy(() => {
    let acc = "";
    for (let i = 0; i < 4; i += 1) acc += process.env.RSPYT_LOOP;
    return acc;
  });
  delete process.env.RSPYT_LOOP;
  const rec = report.records.find((r) => r.api === "process.env.RSPYT_LOOP");
  assert.equal(rec.count, 4);
});
