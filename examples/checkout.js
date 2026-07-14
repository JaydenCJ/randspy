// A tiny "checkout" module with the classic flaky-test entropy sources
// baked in: a random order id, a wall-clock timestamp, an ambient env
// read and a directory listing used in filesystem order.
//
// Trace it:            node dist/cli.js run examples/checkout.js
// (or, once linked:)   randspy run examples/checkout.js
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function createOrder(items) {
  const id = `ord_${Math.random().toString(36).slice(2, 10)}`;
  const createdAt = Date.now();
  const currency = process.env.CURRENCY ?? "USD";
  return { id, createdAt, currency, items };
}

export function loadPlugins() {
  const dir = fileURLToPath(new URL("./plugins", import.meta.url));
  return fs.readdirSync(dir); // order is filesystem-dependent!
}

const order = createOrder(["oolong tea", "notebook"]);
const plugins = loadPlugins();
console.log(`order ${order.id} (${order.currency}) plugins: ${plugins.join(", ")}`);
