// Fixture: fully deterministic — pure arithmetic, no entropy reads, no
// output. randspy must report zero reads and exit 0 for this program.
const nums = Array.from({ length: 32 }, (_, i) => (i * 2654435761) % 4096);
nums.sort((a, b) => a - b);
if (nums[0] === undefined) {
  throw new Error("unreachable");
}
