// Standalone translation test — iterate on prompts/models without mic/VAD/STT.
//
// Usage (from translation/, dùng tsx của voice vì repo chưa có root node_modules):
//   npx --prefix ../voice tsx cli.ts "Xin chào, chúng ta bắt đầu họp nhé"
//   npx --prefix ../voice tsx cli.ts "Let's review the budget" --from en
//   npx --prefix ../voice tsx cli.ts "..." --model gpt-oss-120b

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { translate, TranslationError } from './src/translator';

// Load repo-root .env (translation/ lives directly under the repo root)
try {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(__dir, '..', '.env');
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key.trim()] = val;
  }
} catch {
  /* rely on shell env */
}

async function main() {
  const args = process.argv.slice(2);
  const from = argValue(args, '--from') ?? 'vi';
  const model = argValue(args, '--model');
  const text = args
    .filter((a) => !a.startsWith('--') && a !== from && a !== model)
    .join(' ');

  if (!text) {
    console.error('Usage: npx tsx cli.ts "text..." [--from vi|en] [--model NAME]');
    process.exit(1);
  }

  console.log(`[IN  ${from}] ${text}`);
  try {
    const res = await translate(text, from, model ? { model } : {});
    console.log(`[OUT ${res.targetLang}] ${res.translatedText}`);
    console.log(`(${res.model} | ${res.latencyMs}ms)`);
  } catch (err) {
    if (err instanceof TranslationError) {
      console.error(`TRANSLATION ERROR${err.status ? ` (HTTP ${err.status})` : ''}: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

main();
