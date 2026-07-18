// Live smoke test for the translator's critical-value handling.
// Requires FPT_API_KEY in root .env. Usage: npx tsx scripts/translate_smoke.ts

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { translate } from '../../translation/src/translator';

const __dir = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dir, '..', '..', '.env'), 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...rest] = t.split('=');
  if (k && !(k in process.env)) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}

const CASES: Array<{ text: string; lang: 'vi' | 'en'; mustNotContain?: RegExp; mustContain?: string[] }> = [
  // Regression 1: number-free sentence must not grow hallucinated markers
  { text: 'Nhưng mà có lần dưới này phải kì quả', lang: 'vi', mustNotContain: /VB_VALUE/ },
  // Regression 2: counted list must survive in full (was truncated at "8,")
  { text: '1, 2, 3, 4, 5, 6, 7, 8, 9, 10', lang: 'en', mustContain: ['9', '10'], mustNotContain: /VB_VALUE/ },
  // Values must be preserved verbatim
  { text: 'Doanh thu quý 2 đạt 20 tỷ VND, tăng 95% so với năm 2024.', lang: 'vi', mustContain: ['20', '95%', '2024'], mustNotContain: /VB_VALUE/ },
];

let failed = 0;
for (const c of CASES) {
  const res = await translate(c.text, c.lang);
  const out = res.translatedText;
  let verdict = 'OK ';
  if (c.mustNotContain?.test(out)) { verdict = 'FAIL(marker leak)'; failed++; }
  for (const needle of c.mustContain ?? []) {
    if (!out.includes(needle)) { verdict = `FAIL(missing "${needle}")`; failed++; }
  }
  console.log(`${verdict} [${res.latencyMs}ms] "${c.text}"\n  → "${out}"\n`);
}
process.exit(failed === 0 ? 0 : 1);
