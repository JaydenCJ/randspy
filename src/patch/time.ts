/**
 * The `time` patch: wall-clock and monotonic-clock reads.
 *
 * `Date` is replaced with a Proxy so that zero-argument `new Date()`, the
 * legacy `Date()` string call and `Date.now` are all observed while
 * `Date.parse`, `Date.UTC`, `instanceof Date`, subclassing and every
 * instance method keep their exact semantics. `new Date(value)` is *not*
 * recorded — constructing a date from an explicit value is deterministic.
 *
 * Node's own internals hold references to primordials, so patching the
 * global never perturbs the runtime itself.
 */
import type { Patch, RecordFn, Restore } from "./shared.js";
import { runRestores, swap } from "./shared.js";

export function timePatch(): Patch {
  const restores: Restore[] = [];
  return {
    name: "time",
    install(record: RecordFn): void {
      const OriginalDate = globalThis.Date;

      const wrappedNow = function now(): number {
        const value = OriginalDate.now();
        record("Date.now()", "time", value);
        return value;
      };

      const proxy = new Proxy(OriginalDate, {
        apply(target, thisArg, args): unknown {
          // Legacy `Date()` call: returns the current time as a string.
          const value = Reflect.apply(target as unknown as (...a: unknown[]) => unknown, thisArg, args);
          record("Date()", "time", value);
          return value;
        },
        construct(target, args, newTarget): object {
          const instance = Reflect.construct(
            target as unknown as new (...a: unknown[]) => object,
            args,
            newTarget
          );
          if (args.length === 0) {
            record("new Date()", "time", (instance as Date).toISOString());
          }
          return instance;
        },
        get(target, prop, receiver): unknown {
          if (prop === "now") return wrappedNow;
          return Reflect.get(target, prop, receiver);
        },
      });
      globalThis.Date = proxy as DateConstructor;
      restores.push(() => {
        globalThis.Date = OriginalDate;
      });

      const perf = globalThis.performance as unknown as Record<string, unknown> | undefined;
      if (perf && typeof perf["now"] === "function") {
        const originalNow = (perf["now"] as () => number).bind(perf);
        swap(
          perf,
          "now",
          function now(): number {
            const value = originalNow();
            record("performance.now()", "time", value);
            return value;
          },
          restores
        );
      }

      const originalHrtime = process.hrtime;
      const wrappedHrtime = function hrtime(time?: [number, number]): [number, number] {
        const value = time === undefined ? originalHrtime() : originalHrtime(time);
        record("process.hrtime()", "time");
        return value;
      } as typeof process.hrtime;
      wrappedHrtime.bigint = function bigint(): bigint {
        const value = originalHrtime.bigint();
        record("process.hrtime.bigint()", "time");
        return value;
      };
      swap(process as unknown as Record<string, unknown>, "hrtime", wrappedHrtime, restores);
    },
    uninstall(): void {
      runRestores(restores);
    },
  };
}
