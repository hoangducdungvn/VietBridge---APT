# translation — Text-to-text VI↔EN (VietBridge)

Tầng dịch tách riêng, cùng cấp với `voice/`, `stt/`, `backend/`, `frontend/`.
Thuần logic (không dính WS/gateway) để debug độc lập và port sang backend
NestJS (`providers/translation`) sau này.

```
translation/
├── src/translator.ts   # translate(text, sourceLangHint, config?) → {translatedText, ...}
├── src/prompts.ts      # system prompt + glossary — chỉnh prompt ở đây, không đụng logic
└── cli.ts              # test dịch 1 lệnh, không cần mic/VAD/STT
```

## Dùng từ code (gateway đang import trực tiếp)

```ts
import { translate, normalizeLang, TranslationError } from '../../../translation/src/translator';

const res = await translate('Xin chào mọi người', 'vi');
// → { translatedText, sourceLang: 'vi', targetLang: 'en', model, latencyMs }
```

- Chiều dịch tự suy từ hint: `vi` (hoặc bất kỳ gì không phải `en`) → EN, `en` → VI.
- Model mặc định `Llama-3.3-70B-Instruct` trên FPT (`LLM_MODEL`/`LLM_URL` env để đổi).
- Timeout cứng 8s, lỗi ném `TranslationError` có `status`.
- Key đọc từ `FPT_API_KEY` (repo-root `.env`, đã gitignore).

## Debug nhanh bằng CLI

```bash
cd translation
npx --prefix ../voice tsx cli.ts "Chúng tôi đề xuất partnership model" --from vi
npx --prefix ../voice tsx cli.ts "Let's review the budget" --from en
npx --prefix ../voice tsx cli.ts "..." --model gpt-oss-120b   # benchmark model khác
```

(Dùng `--prefix ../voice` vì `tsx` đang cài trong `voice/node_modules`; nếu cài tsx global thì chỉ cần `npx tsx cli.ts ...`.)

## Việc còn mở (tầng Translation theo contract D8)

- Ngữ cảnh xuyên utterance qua `continuation_id` (ghép câu bị cắt bởi max_duration 25s).
- Streaming token để giảm latency final translation (hiện ~0.9s/câu).
- Benchmark các model khác trên FPT (GLM, Qwen, gpt-oss...) bằng flag `--model`.
