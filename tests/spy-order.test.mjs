// The order patch: fs.readdirSync, callback fs.readdir and
// fs.promises.readdir are traced as pure pass-throughs — same entries,
// same options handling (withFileTypes), same callback and promise
// contracts — and the original functions return on disable().
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RandSpy, withSpy } from "../dist/index.js";

function makeDir() {
  const dir = fs.mkdtempSync(join(tmpdir(), "randspy-test-"));
  for (const name of ["b.txt", "a.txt", "c.txt"]) {
    fs.writeFileSync(join(dir, name), name);
  }
  return dir;
}

test("fs.readdirSync is traced and returns the same entries as unpatched", () => {
  const dir = makeDir();
  try {
    const before = fs.readdirSync(dir);
    const { result, report } = withSpy(() => fs.readdirSync(dir));
    assert.deepEqual([...result].sort(), [...before].sort());
    const rec = report.records.find((r) => r.api === "fs.readdirSync()");
    assert.equal(rec.category, "order");
    assert.ok(rec.file.endsWith("spy-order.test.mjs"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readdirSync options like withFileTypes pass through unchanged", () => {
  const dir = makeDir();
  try {
    const { result } = withSpy(() => fs.readdirSync(dir, { withFileTypes: true }));
    assert.equal(result.length, 3);
    assert.ok(result.every((d) => typeof d.name === "string" && d.isFile()));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("callback fs.readdir is traced at call time and the callback fires", async () => {
  const dir = makeDir();
  const spy = new RandSpy();
  try {
    spy.enable();
    const pending = new Promise((resolvePromise, rejectPromise) => {
      fs.readdir(dir, (err, entries) => (err ? rejectPromise(err) : resolvePromise(entries)));
    });
    // The read is recorded synchronously at the call, so the spy can be
    // disabled before the event loop turns — no other activity is traced.
    spy.disable();
    const entries = await pending;
    assert.equal(entries.length, 3);
    assert.deepEqual(spy.report().records.map((r) => r.api), ["fs.readdir()"]);
  } finally {
    spy.disable();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fs.promises.readdir is traced and resolves with the entries", async () => {
  const dir = makeDir();
  const spy = new RandSpy();
  try {
    spy.enable();
    const pending = fs.promises.readdir(dir);
    spy.disable();
    const entries = await pending;
    assert.equal(entries.length, 3);
    assert.deepEqual(spy.report().records.map((r) => r.api), ["fs.promises.readdir()"]);
  } finally {
    spy.disable();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("disable() restores the original fs functions exactly", () => {
  const originalSync = fs.readdirSync;
  const originalCb = fs.readdir;
  const originalPromise = fs.promises.readdir;
  const spy = new RandSpy();
  spy.enable();
  assert.notEqual(fs.readdirSync, originalSync);
  spy.disable();
  assert.equal(fs.readdirSync, originalSync);
  assert.equal(fs.readdir, originalCb);
  assert.equal(fs.promises.readdir, originalPromise);
});

test("other fs calls (writeFileSync, mkdtempSync) are never traced", () => {
  const { report } = withSpy(() => {
    const dir = fs.mkdtempSync(join(tmpdir(), "randspy-quiet-"));
    fs.writeFileSync(join(dir, "x.txt"), "x");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(report.summary.reads, 0);
});
