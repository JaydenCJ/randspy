// The --allow glob matcher: `*` stays inside a path segment, `**` spans
// segments, `?` is one character, everything is anchored and literal
// regex metacharacters are inert. Suppression correctness depends on
// these exact semantics.
import test from "node:test";
import assert from "node:assert/strict";
import { globToRegExp, matchGlob } from "../dist/index.js";

test("a literal pattern matches only itself, case-sensitively", () => {
  assert.equal(matchGlob("src/id.js", "src/id.js"), true);
  assert.equal(matchGlob("src/id.js", "src/id.jsx"), false);
  assert.equal(matchGlob("src/id.js", "a/src/id.js"), false);
  assert.equal(matchGlob("SRC/x", "src/x"), false);
});

test("* matches within one path segment only, including the empty run", () => {
  assert.equal(matchGlob("src/*.js", "src/id.js"), true);
  assert.equal(matchGlob("src/*.js", "src/deep/id.js"), false);
  assert.equal(matchGlob("*.test.js", "cart.test.js"), true);
  assert.equal(matchGlob("id*.js", "id.js"), true);
});

test("? matches exactly one non-slash character", () => {
  assert.equal(matchGlob("v?.js", "v1.js"), true);
  assert.equal(matchGlob("v?.js", "v10.js"), false);
  assert.equal(matchGlob("a?b", "a/b"), false);
});

test("** spans directory separators, at the start, middle or end", () => {
  assert.equal(matchGlob("src/**", "src/a/b/c.js"), true);
  assert.equal(matchGlob("src/**", "lib/a.js"), false);
  assert.equal(matchGlob("**/setup.js", "setup.js"), true);
  assert.equal(matchGlob("**/setup.js", "tests/deep/setup.js"), true);
  assert.equal(matchGlob("**/setup.js", "tests/setup.js.bak"), false);
  assert.equal(matchGlob("src/**/util.js", "src/a/b/util.js"), true);
  assert.equal(matchGlob("src/**/util.js", "src/util.js"), true);
});

test("dots and other regex metacharacters are literal", () => {
  assert.equal(matchGlob("a.b", "aXb"), false);
  assert.equal(matchGlob("f(1)+[2]{3}.js", "f(1)+[2]{3}.js"), true);
  assert.equal(matchGlob("a|b", "a"), false);
});

test("API names glob cleanly: process.env.* covers variable reads", () => {
  assert.equal(matchGlob("process.env.*", "process.env.HOME"), true);
  assert.equal(matchGlob("process.env.*", "process.envXHOME"), false);
  assert.equal(matchGlob("Math.random()", "Math.random()"), true);
});

test("globToRegExp anchors the whole string", () => {
  const re = globToRegExp("b*");
  assert.equal(re.test("abc"), false);
  assert.equal(re.source.startsWith("^"), true);
  assert.equal(re.source.endsWith("$"), true);
});
