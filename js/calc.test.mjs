// Run: node js/calc.test.mjs  (brute-force cross-check of the exact math)
import assert from 'node:assert/strict';
import { chance, validate } from './calc.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} !~ ${b}`);

// Known value: 3 copies, 40 cards, 5 drawn -> 1 - C(37,5)/C(40,5)
close(chance(40, 5, [{ copies: 3, min: 1 }]), 1 - 435897 / 658008);

// Brute force over every hand of a small deck, 2 groups with different minimums
function brute(N, n, groups) {
  const owner = [];
  groups.forEach((g, gi) => { for (let i = 0; i < g.copies; i += 1) owner.push(gi); });
  while (owner.length < N) owner.push(-1);
  let hit = 0; let all = 0;
  const walk = (start, picked) => {
    if (picked.length === n) {
      all += 1;
      if (groups.every((g, gi) => picked.filter((c) => owner[c] === gi).length >= g.min)) hit += 1;
      return;
    }
    for (let c = start; c < N; c += 1) walk(c + 1, [...picked, c]);
  };
  walk(0, []);
  return hit / all;
}
for (const [N, n, groups] of [
  [10, 4, [{ copies: 3, min: 1 }, { copies: 2, min: 1 }]],
  [12, 5, [{ copies: 4, min: 2 }, { copies: 3, min: 1 }, { copies: 1, min: 1 }]],
  [9, 3, [{ copies: 9, min: 3 }]]
]) close(chance(N, n, groups), brute(N, n, groups));

// Edge cases
assert.equal(chance(40, 5, [{ copies: 3, min: 3 }, { copies: 3, min: 3 }]), 0); // needs 6 cards, draws 5
assert.equal(chance(40, 40, [{ copies: 3, min: 3 }]), 1);

// Validation
assert.equal(validate(40, 5, [{ copies: 3, min: 1 }]), null);
assert.ok(validate(40, 41, [{ copies: 3, min: 1 }]));
assert.ok(validate(40, 5, [{ copies: 3, min: 4 }]));
assert.ok(validate(5, 3, [{ copies: 4, min: 1 }, { copies: 3, min: 1 }]));
assert.ok(validate(40, 5, []));
assert.ok(validate(NaN, 5, [{ copies: 3, min: 1 }]));
console.log('calc: all checks passed');
