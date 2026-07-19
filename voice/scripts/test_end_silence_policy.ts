// Table-driven test for the tiered end-silence policy.
// Run: npx tsx scripts/test_end_silence_policy.ts

import { classifyTail, createTieredEndSilencePolicy } from '../src/vad/endSilencePolicy';

const cases: Array<[string, 'extended' | 'short' | 'default']> = [
  // Vietnamese trailing connectives → extended
  ['hôm nay chúng ta sẽ bàn về doanh thu và', 'extended'],
  ['tôi nghĩ là', 'extended'],
  ['chúng tôi làm vậy bởi vì', 'extended'],
  ['kế hoạch này dành cho', 'extended'],
  ['mặc dù', 'extended'],
  ['doanh thu quý này tăng nhưng,', 'extended'],   // trailing comma stripped
  // English trailing connectives → extended
  ['we should increase the budget because', 'extended'],
  ['I want to talk about the', 'extended'],
  // Sentence-final punctuation → short
  ['Kết quả quý này rất tốt.', 'short'],
  ['Doanh thu tăng 20%!', 'short'],
  ['Bạn nghĩ sao?', 'short'],
  ['He said "we are done."', 'short'],
  // Enumeration tails → extended (pauses between counted items must not cut)
  ['1, 2, 3,', 'extended'],
  ['1, 2, 3', 'extended'],
  ['một, hai, ba,', 'extended'], // word-numbers rely on the trailing comma;
  // a bare word-number tail ("bốn") is deliberately NOT matched — "năm" is
  // both "five" and "year", far too ambiguous as an enumeration signal.
  ['một, hai, ba, bốn', 'default'],
  ['các mục sau:', 'extended'],
  ['thứ nhất là chi phí -', 'extended'],
  // But a number ending a normal sentence with terminal punct stays short
  ['Doanh thu đạt 20 tỷ.', 'short'],
  // No signal → default
  ['', 'default'],
  ['doanh thu quý này tăng hai mươi phần trăm', 'default'],
  ['the quarterly results look good', 'default'],
  // Words containing a connective as substring must NOT match ("thìa" vs "thì")
  ['tôi mua một cái thìa', 'default'],
  ['we saw a band', 'default'],
];

let failed = 0;
for (const [text, expected] of cases) {
  const got = classifyTail(text);
  if (got !== expected) {
    failed++;
    console.error(`FAIL: "${text}" → ${got}, expected ${expected}`);
  }
}

// Policy end-to-end: closure + ms mapping
let tail = 'chúng ta sẽ bàn về và';
const policy = createTieredEndSilencePolicy(() => tail);
const ctx = { speechDurationMs: 3000, silenceDurationMs: 200, defaultEndSilenceMs: 800 };
if (policy(ctx) !== 1300) { failed++; console.error('FAIL: connective tail should give 1300ms'); }
tail = 'Xong rồi.';
if (policy(ctx) !== 480) { failed++; console.error('FAIL: terminal tail should give 480ms'); }
tail = 'doanh thu quý này';
if (policy(ctx) !== 800) { failed++; console.error('FAIL: neutral tail should give 800ms'); }

if (failed === 0) {
  console.log(`OK — ${cases.length + 3} assertions passed`);
} else {
  console.error(`${failed} assertion(s) FAILED`);
  process.exit(1);
}
