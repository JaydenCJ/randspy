// End-to-end CLI tests: spawn the real `randspy` binary against the
// bundled fixtures and assert on exit codes, report content, filters,
// child exit-code propagation and the report/explain subcommands.
// Everything runs offline against local files.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "cli.js");
const FIXTURES = join(ROOT, "tests", "fixtures");

function run(...args) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("--version matches package.json; --help documents the surface", () => {
  const version = run("--version");
  assert.equal(version.code, 0);
  const pkg = JSON.parse(fs.readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(version.stdout.trim(), pkg.version);
  const help = run("--help");
  assert.equal(help.code, 0);
  for (const word of ["run", "report", "explain", "--fail-on", "--allow", "--only", "Exit codes"]) {
    assert.ok(help.stdout.includes(word), `help missing ${word}`);
  }
});

test("usage errors exit 2: unknown command/flag, missing script, bad values", () => {
  const unknownCommand = run("frobnicate");
  assert.equal(unknownCommand.code, 2);
  assert.match(unknownCommand.stderr, /unknown command/);
  const unknownFlag = run("run", "--frobnicate", "x.js");
  assert.equal(unknownFlag.code, 2);
  assert.match(unknownFlag.stderr, /randspy --help/);
  assert.equal(run("run").code, 2);
  const missing = run("run", "does-not-exist.mjs");
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /script not found/);
  assert.equal(run("run", "--fail-on", "sometimes", "x.mjs").code, 2);
  assert.equal(run("run", "--only", "chaos", "x.mjs").code, 2);
  assert.equal(run("run", "--format", "xml", "x.mjs").code, 2);
  assert.equal(run("run", "--top", "-1", "x.mjs").code, 2);
});

test("run on an entropy-reading script fails with all four categories", () => {
  const { code, stdout } = run("run", join(FIXTURES, "entropy.mjs"));
  assert.equal(code, 1);
  for (const label of ["TIME", "RANDOM", "ENV", "ORDER"]) {
    assert.ok(stdout.includes(label), `report missing ${label}`);
  }
  assert.ok(stdout.includes("Date.now()"));
  assert.ok(stdout.includes("process.env.SHELL"));
  assert.ok(stdout.includes("fs.readdirSync()"));
  assert.match(stdout, /entropy\.mjs:\d+:\d+/);
  assert.match(stdout, /randspy: FAIL — 4 read\(s\) match fail-on=any/);
});

test("run on a deterministic script is clean and exits 0", () => {
  const { code, stdout } = run("run", join(FIXTURES, "clean.mjs"));
  assert.equal(code, 0);
  assert.ok(stdout.includes("randspy: no nondeterministic reads detected"));
  assert.ok(stdout.includes("randspy: OK"));
});

test("--fail-on none reports but exits 0; --fail-on category selects", () => {
  const none = run("run", "--fail-on", "none", join(FIXTURES, "entropy.mjs"));
  assert.equal(none.code, 0);
  assert.match(none.stdout, /randspy: OK — 4 read\(s\) traced, none match fail-on=none/);
  const timeOnly = run("run", "--fail-on", "time", join(FIXTURES, "entropy.mjs"));
  assert.equal(timeOnly.code, 1);
  assert.match(timeOnly.stdout, /randspy: FAIL — 1 read\(s\) match fail-on=time/);
});

test("--only narrows both the rows and the fail gate", () => {
  const { code, stdout } = run("run", "--only", "random", join(FIXTURES, "entropy.mjs"));
  assert.equal(code, 1);
  assert.ok(stdout.includes("Math.random()"));
  assert.equal(stdout.includes("Date.now()"), false);
  assert.match(stdout, /1 nondeterministic read\(s\) from 1 site\(s\)/);
});

test("--allow suppresses by path glob and can bring the run to green", () => {
  const { code, stdout } = run(
    "run",
    "--allow",
    "tests/**",
    join(FIXTURES, "entropy.mjs")
  );
  assert.equal(code, 0);
  assert.ok(stdout.includes("randspy: OK"));
});

test("--format json emits the stable machine shape", () => {
  const { code, stdout } = run("run", "--format", "json", join(FIXTURES, "entropy.mjs"));
  assert.equal(code, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.tool, "randspy");
  assert.equal(parsed.schema, 1);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.summary.reads, 4);
  assert.deepEqual(
    { time: 1, random: 1, env: 1, order: 1 },
    parsed.summary.byCategory
  );
  assert.ok(parsed.command[0].endsWith("entropy.mjs"));
});

test("reads aggregate per site (4+1 rolls) and child args pass verbatim", () => {
  const { stdout, stderr } = run(
    "run", "--format", "json", "--fail-on", "none",
    join(FIXTURES, "loop.mjs"), "--fail-on", "alpha"
  );
  const parsed = JSON.parse(stdout);
  const counts = parsed.records.map((r) => r.count).sort();
  assert.deepEqual(counts, [1, 4]);
  assert.equal(parsed.summary.reads, 5);
  // Flag-lookalikes after the script reach the child untouched.
  assert.ok(stderr.includes("args:--fail-on,alpha"), `stderr was: ${stderr}`);
});

test("a failing child propagates its exit code, report still printed", () => {
  const { code, stdout } = run("run", join(FIXTURES, "exit3.mjs"));
  assert.equal(code, 3);
  assert.ok(stdout.includes("Math.random()"));
});

test("--report saves raw JSON that the report subcommand re-renders", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "randspy-cli-"));
  const saved = join(dir, "report.json");
  try {
    const first = run("run", "--report", saved, "--fail-on", "none", join(FIXTURES, "entropy.mjs"));
    assert.equal(first.code, 0);
    const parsed = JSON.parse(fs.readFileSync(saved, "utf8"));
    assert.equal(parsed.summary.reads, 4);
    const rendered = run("report", saved);
    assert.equal(rendered.code, 1);
    assert.ok(rendered.stdout.includes("Math.random()"));
    const gated = run("report", "--fail-on", "order", "--only", "time", saved);
    assert.equal(gated.code, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--report into a missing directory is a usage error, not a stack trace", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "randspy-cli-"));
  try {
    const target = join(dir, "no-such-subdir", "report.json");
    const res = run("run", "--report", target, "--fail-on", "none", join(FIXTURES, "clean.mjs"));
    assert.equal(res.code, 2);
    assert.match(res.stderr, /cannot write report file/);
    assert.ok(!res.stderr.includes("    at "), "must not print a raw stack trace");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("report rejects missing files and non-report JSON with exit 2", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "randspy-cli-"));
  try {
    assert.equal(run("report", join(dir, "nope.json")).code, 2);
    const bogus = join(dir, "bogus.json");
    fs.writeFileSync(bogus, '{"hello": "world"}');
    const res = run("report", bogus);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /not a randspy report/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("explain documents every category and the index, offline", () => {
  for (const topic of ["time", "random", "env", "order", "categories"]) {
    const { code, stdout } = run("explain", topic);
    assert.equal(code, 0, `explain ${topic} failed`);
    assert.ok(stdout.length > 100, `explain ${topic} too short`);
  }
  assert.ok(run("explain", "time").stdout.includes("Date.now()"));
  assert.equal(run("explain", "chaos").code, 2);
});

test("two runs over the same fixture produce byte-identical text reports", () => {
  const a = run("run", "--fail-on", "none", join(FIXTURES, "entropy.mjs"));
  const b = run("run", "--fail-on", "none", join(FIXTURES, "entropy.mjs"));
  assert.equal(a.stdout, b.stdout);
});

test("--values records samples in the report; env values stay out", () => {
  const { stdout } = run("run", "--values", "--format", "json", "--fail-on", "none", join(FIXTURES, "entropy.mjs"));
  const parsed = JSON.parse(stdout);
  const time = parsed.records.find((r) => r.api === "Date.now()");
  assert.match(time.samples[0], /^\d+$/);
  const env = parsed.records.find((r) => r.api === "process.env.SHELL");
  assert.equal(env.samples, undefined);
});

test("a downstream pipe closing early (| head) does not crash with EPIPE", () => {
  // `randspy run … | head -1` used to die with an unhandled EPIPE once the
  // consumer went away; the CLI must keep its decided exit code instead.
  const res = spawnSync(
    "bash",
    [
      "-c",
      `"${process.execPath}" "${CLI}" run --fail-on none "${join(FIXTURES, "entropy.mjs")}" | true; exit \${PIPESTATUS[0]}`,
    ],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }
  );
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
  assert.ok(!res.stderr.includes("EPIPE"), `stderr leaked EPIPE: ${res.stderr}`);
});
