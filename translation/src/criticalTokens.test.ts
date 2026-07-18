import assert from 'node:assert/strict';
import test from 'node:test';

import { protectCriticalValues, restoreCriticalValues } from './criticalTokens';

test('protects business numbers as complete values', () => {
  const source = 'Q3 2026 revenue is SGD 2.5 million, margin 18.75%, due 18/07/2026.';
  const protectedText = protectCriticalValues(source);

  assert.deepEqual(protectedText.tokens, [
    'Q3 2026',
    'SGD 2.5 million',
    '18.75%',
    '18/07/2026',
  ]);
  assert.equal(
    protectedText.text,
    '[[VB_VALUE_0]] revenue is [[VB_VALUE_1]], margin [[VB_VALUE_2]], due [[VB_VALUE_3]].',
  );
});

test('restores every protected value without changing its formatting', () => {
  const source = 'Ngân sách là 1,250,000 VND và tăng 12.5%.';
  const protectedText = protectCriticalValues(source);
  const modelOutput = 'The budget is [[VB_VALUE_0]] and increases by [[ VB_VALUE_1 ]].';

  assert.equal(
    restoreCriticalValues(modelOutput, protectedText.tokens),
    'The budget is 1,250,000 VND and increases by 12.5%.',
  );
});

test('leaves ordinary business text untouched', () => {
  const source = 'Please review the supply chain and due diligence report.';
  assert.deepEqual(protectCriticalValues(source), { text: source, tokens: [] });
});
