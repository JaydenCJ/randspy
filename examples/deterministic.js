// The same checkout, refactored so every entropy source is injected —
// randspy reports zero nondeterministic reads and exits 0.
//
// Trace it:            node dist/cli.js run examples/deterministic.js

/** Tiny seeded PRNG (mulberry32) — reproducible across runs and machines. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createOrder(items, { now, rng, currency }) {
  const id = `ord_${rng().toString(36).slice(2, 10)}`;
  const createdAt = now();
  return { id, createdAt, currency, items };
}

export function loadPlugins(listDir) {
  return [...listDir()].sort(); // explicit order, whatever the filesystem says
}

const clock = () => 1735689600000; // 2025-01-01T00:00:00Z, frozen
const order = createOrder(["oolong tea", "notebook"], {
  now: clock,
  rng: mulberry32(42),
  currency: "USD",
});
const plugins = loadPlugins(() => ["metrics.js", "audit.js", "webhook.js"]);
console.log(`order ${order.id} (${order.currency}) plugins: ${plugins.join(", ")}`);
