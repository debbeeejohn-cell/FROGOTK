// Run: node --no-warnings scripts/selfplay.test.mjs  (a recorded game must replay exactly)
import assert from 'node:assert/strict';
import { server } from './duel-server.mjs';
import { playGame, replayGame } from './selfplay.mjs';

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const seeds = [['11', '22', '33', '44'], ['5', '6', '7', '8'], ['101', '202', '303', '404']];

for (const seed of seeds) {
  const rec = { deck: 'frogOtk', opp: 'blackwing', seed, ...(await playGame(base, { deck: 'frogOtk', opp: 'blackwing', seed })) };
  assert.ok(rec.steps > 0, 'the game made moves');
  const again = await replayGame(base, rec);
  assert.deepEqual(again, { winner: rec.winner, turns: rec.turns, lp: rec.lp, steps: rec.steps }, `seed ${seed} replays exactly`);
}

server.close();
console.log('selfplay: all checks passed');
