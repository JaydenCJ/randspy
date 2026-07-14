// The random patch: Math.random, the node:crypto module functions and
// Web Crypto (globalThis.crypto) are traced as pass-throughs — values
// keep their contracts (ranges, UUID shape, filled buffers) and the
// originals come back byte-identical on disable().
import test from "node:test";
import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { RandSpy, withSpy } from "../dist/index.js";

test("Math.random() is traced, blamed on this file, and stays in [0, 1)", () => {
  const { result, report } = withSpy(() => Math.random());
  assert.ok(result >= 0 && result < 1);
  const rec = report.records.find((r) => r.api === "Math.random()");
  assert.equal(rec.category, "random");
  assert.ok(rec.file.endsWith("spy-random.test.mjs"));
});

test("crypto.randomUUID() via the node:crypto default import is traced", () => {
  const { result, report } = withSpy(() => nodeCrypto.randomUUID());
  assert.match(result, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(report.records.map((r) => r.api), ["crypto.randomUUID()"]);
});

test("crypto.randomBytes() is traced and still returns the asked-for bytes", () => {
  const { result, report } = withSpy(() => nodeCrypto.randomBytes(8));
  assert.equal(result.length, 8);
  assert.deepEqual(report.records.map((r) => r.api), ["crypto.randomBytes()"]);
});

test("crypto.randomInt() is traced and respects its range", () => {
  const { result, report } = withSpy(() => nodeCrypto.randomInt(10));
  assert.ok(Number.isInteger(result) && result >= 0 && result < 10);
  assert.deepEqual(report.records.map((r) => r.api), ["crypto.randomInt()"]);
});

test("crypto.randomFillSync() is traced and fills the given view", () => {
  const { result, report } = withSpy(() => nodeCrypto.randomFillSync(new Uint8Array(16)));
  assert.equal(result.length, 16);
  assert.deepEqual(report.records.map((r) => r.api), ["crypto.randomFillSync()"]);
});

test("Web Crypto (globalThis.crypto) getRandomValues and randomUUID are traced", () => {
  const filled = withSpy(() => globalThis.crypto.getRandomValues(new Uint8Array(4)));
  assert.equal(filled.result.length, 4);
  assert.deepEqual(filled.report.records.map((r) => r.api), ["crypto.getRandomValues()"]);
  const uuid = withSpy(() => globalThis.crypto.randomUUID());
  assert.equal(typeof uuid.result, "string");
  assert.deepEqual(uuid.report.records.map((r) => r.api), ["crypto.randomUUID()"]);
});

test("captureValues never stores raw bytes — only primitive returns", () => {
  const spy = new RandSpy({ captureValues: true });
  spy.enable();
  nodeCrypto.randomBytes(32);
  const uuid = nodeCrypto.randomUUID();
  spy.disable();
  const bytesRec = spy.report().records.find((r) => r.api === "crypto.randomBytes()");
  const uuidRec = spy.report().records.find((r) => r.api === "crypto.randomUUID()");
  assert.equal(bytesRec.samples, undefined);
  assert.deepEqual(uuidRec.samples, [uuid]);
});

test("disable() restores Math.random and every crypto function", () => {
  const originalRandom = Math.random;
  const originalBytes = nodeCrypto.randomBytes;
  const originalGet = globalThis.crypto.getRandomValues;
  const spy = new RandSpy();
  spy.enable();
  assert.notEqual(Math.random, originalRandom);
  spy.disable();
  assert.equal(Math.random, originalRandom);
  assert.equal(nodeCrypto.randomBytes, originalBytes);
  assert.equal(globalThis.crypto.getRandomValues, originalGet);
});

test("three rolls from one line aggregate into a single ×3 record", () => {
  const { report } = withSpy(() => [Math.random(), Math.random(), Math.random()]);
  assert.equal(report.records.length, 3);
  assert.ok(report.records.every((r) => r.count === 1));
  const loop = withSpy(() => {
    let acc = 0;
    for (let i = 0; i < 3; i += 1) acc += Math.random();
    return acc;
  });
  assert.equal(loop.report.records.length, 1);
  assert.equal(loop.report.records[0].count, 3);
});
