import assert from 'node:assert/strict';

import { selectVadProbability } from '../src/vad/vadProbability';

assert.equal(
  selectVadProbability(0.82, null),
  0.82,
  'energy must bridge Silero startup',
);
assert.equal(
  selectVadProbability(0.5, 0.08),
  0.08,
  'Silero silence must not be masked by the energy score',
);
assert.equal(
  selectVadProbability(0.1, 0.91),
  0.91,
  'Silero speech must remain authoritative',
);

console.log('PASS VAD probability selection preserves Silero EOU decisions');
