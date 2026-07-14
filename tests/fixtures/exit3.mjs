// Fixture: reads entropy and then exits 3 — used to verify that the CLI
// still writes the report but propagates the child's exit code unchanged.
const roll = Math.random();
if (roll < 0) throw new Error("unreachable");
process.exit(3);
