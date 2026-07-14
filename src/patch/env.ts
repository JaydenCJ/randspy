/**
 * The `env` patch: ambient environment reads.
 *
 * `process.env` is replaced with a Proxy over the real env object.
 * Property reads and `in` checks record `process.env.NAME`; whole-object
 * enumeration (`Object.keys`, spread, `JSON.stringify`) records a single
 * `process.env (enumerate)` event via the ownKeys trap. Writes and
 * deletes pass through silently — mutating the environment is an explicit
 * act, not hidden entropy.
 *
 * Privacy: only variable *names* are ever recorded, never values.
 * The tracer's own control variables (`RANDSPY_*`) are always ignored.
 */
import type { Patch, RecordFn, Restore } from "./shared.js";
import { runRestores } from "./shared.js";

function isTraced(prop: PropertyKey): prop is string {
  return typeof prop === "string" && !prop.startsWith("RANDSPY_");
}

export function envPatch(): Patch {
  const restores: Restore[] = [];
  return {
    name: "env",
    install(record: RecordFn): void {
      const realEnv = process.env;
      const desc = Object.getOwnPropertyDescriptor(process, "env");
      const proxy = new Proxy(realEnv, {
        get(target, prop, receiver): unknown {
          if (isTraced(prop)) record(`process.env.${prop}`, "env");
          return Reflect.get(target, prop, receiver);
        },
        has(target, prop): boolean {
          if (isTraced(prop)) record(`process.env.${prop}`, "env");
          return Reflect.has(target, prop);
        },
        ownKeys(target): (string | symbol)[] {
          record("process.env (enumerate)", "env");
          return Reflect.ownKeys(target);
        },
      });
      Object.defineProperty(process, "env", {
        value: proxy,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      restores.push(() => {
        if (desc) {
          Object.defineProperty(process, "env", { ...desc, value: realEnv });
        } else {
          Object.defineProperty(process, "env", {
            value: realEnv,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        }
      });
    },
    uninstall(): void {
      runRestores(restores);
    },
  };
}
