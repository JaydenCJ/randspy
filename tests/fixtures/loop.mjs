// Fixture: five Math.random reads from two distinct sites (4 + 1) plus
// child-argument echoing on stderr — exercises count aggregation and
// argument pass-through in one program.
function roll() {
  return Math.random();
}

let acc = 0;
for (let i = 0; i < 4; i += 1) acc += roll();
acc += Math.random();
if (acc < 0) throw new Error("unreachable");

process.stderr.write(`args:${process.argv.slice(2).join(",")}\n`);
