// V8 stack parsing and call-site selection: the precision of everything
// randspy reports rests on these pure functions, so the edge shapes of
// real stack traces (async frames, constructors, file:// URLs, eval
// origins, native frames) are each pinned down here.
import test from "node:test";
import assert from "node:assert/strict";
import {
  firstExternalFrame,
  firstUserFrame,
  isNodeInternal,
  normalizeFile,
  parseStack,
} from "../dist/index.js";

const STACK = [
  "Error",
  "    at record (/opt/randspy/dist/spy.js:90:15)",
  "    at Math.random (/opt/randspy/dist/patch/random.js:20:9)",
  "    at rollDice (/srv/app/src/dice.js:4:20)",
  "    at async main (/srv/app/src/index.js:12:3)",
].join("\n");

test("parseStack extracts fn, file, line and column, async frames included", () => {
  const frames = parseStack(STACK);
  assert.equal(frames.length, 4);
  assert.deepEqual(frames[2], { fn: "rollDice", file: "/srv/app/src/dice.js", line: 4, column: 20 });
  assert.deepEqual(frames[3], { fn: "main", file: "/srv/app/src/index.js", line: 12, column: 3 });
});

test("parseStack handles constructor frames and bare top-level frames", () => {
  const ctor = parseStack("Error\n    at new Session (/srv/app/session.js:7:19)");
  assert.deepEqual(ctor[0], { fn: "Session", file: "/srv/app/session.js", line: 7, column: 19 });
  const bare = parseStack("Error\n    at /srv/app/top-level.js:3:1");
  assert.deepEqual(bare[0], { fn: null, file: "/srv/app/top-level.js", line: 3, column: 1 });
});

test("parseStack decodes file:// URLs from ESM frames", () => {
  const frames = parseStack(
    "Error\n    at run (file:///srv/my%20app/mod.mjs:9:5)\n    at file:///srv/app/main.mjs:1:1"
  );
  assert.equal(frames[0].file, "/srv/my app/mod.mjs");
  assert.equal(frames[1].file, "/srv/app/main.mjs");
  // normalizeFile itself: plain paths untouched, bad escapes survive raw.
  assert.equal(normalizeFile("/plain/path.js"), "/plain/path.js");
  assert.equal(normalizeFile("file:///x/%ZZbad.js"), "/x/%ZZbad.js");
});

test("parseStack blames the script that called eval, not the eval text", () => {
  const frames = parseStack(
    "Error\n    at eval (eval at run (/srv/app/plugin.js:3:5), <anonymous>:1:10)"
  );
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], { fn: "eval", file: "/srv/app/plugin.js", line: 3, column: 5 });
});

test("parseStack drops native and positionless frames", () => {
  const frames = parseStack(
    "Error\n    at Array.map (native)\n    at <anonymous>\n    at ok (/srv/app/a.js:1:1)"
  );
  assert.equal(frames.length, 1);
  assert.equal(frames[0].file, "/srv/app/a.js");
});

test("isNodeInternal classifies node:, internal/ and anonymous frames", () => {
  assert.equal(isNodeInternal("node:internal/console/constructor"), true);
  assert.equal(isNodeInternal("internal/modules/cjs/loader.js"), true);
  assert.equal(isNodeInternal("<anonymous>"), true);
  assert.equal(isNodeInternal("/srv/app/node.js"), false);
});

test("firstUserFrame skips tracer files and node internals", () => {
  const frames = parseStack(
    [
      "Error",
      "    at r (/opt/randspy/dist/spy.js:1:1)",
      "    at c (node:internal/console/constructor:300:10)",
      "    at userLog (/srv/app/log.js:22:9)",
    ].join("\n")
  );
  const frame = firstUserFrame(frames, (f) => f.startsWith("/opt/randspy/dist"));
  assert.equal(frame.file, "/srv/app/log.js");
  // And null when nothing but internals remain.
  const internals = parseStack("Error\n    at c (node:internal/bootstrap:1:1)");
  assert.equal(firstUserFrame(internals, () => false), null);
});

test("firstExternalFrame keeps node internals but still skips the tracer", () => {
  const frames = parseStack(
    [
      "Error",
      "    at r (/opt/randspy/dist/spy.js:1:1)",
      "    at c (node:internal/console/constructor:300:10)",
      "    at userLog (/srv/app/log.js:22:9)",
    ].join("\n")
  );
  const frame = firstExternalFrame(frames, (f) => f.startsWith("/opt/randspy/dist"));
  assert.equal(frame.file, "node:internal/console/constructor");
});

test("a real captured stack resolves to this test file", () => {
  const frames = parseStack(new Error("probe").stack);
  const frame = firstUserFrame(frames, () => false);
  assert.ok(frame.file.endsWith("stack.test.mjs"), `unexpected frame: ${frame.file}`);
  assert.ok(frame.line > 0 && frame.column > 0);
});
