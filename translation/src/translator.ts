// Text-to-text translation module (VI<->EN) via FPT-hosted LLM.
//
// Pure logic: no WebSocket/gateway coupling, so it can be exercised standalone
// (see voice/scripts/translate_cli.ts) and later ported 1:1 into the backend's
// TranslationProvider implementation.

import { buildTranslationPrompt } from './prompts';

export type TranslateLang = 'vi' | 'en';

export interface TranslatorConfig {
  /** OpenAI-compatible chat completions endpoint. */
  url?: string;
  /** Bearer key. Falls back to FPT_API_KEY env var. */
  apiKey?: string;
  model?: string;
  /** Hard timeout for the LLM call (ms). */
  timeoutMs?: number;
}

export interface TranslationResult {
  translatedText: string;
  sourceLang: TranslateLang;
  targetLang: TranslateLang;
  model: string;
  latencyMs: number;
}

export class TranslationError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

const DEFAULTS = {
  url: 'https://mkp-api.fptcloud.com/v1/chat/completions',
  model: 'Llama-3.3-70B-Instruct',
  timeoutMs: 8000,
};

/** Anything that is not explicitly 'en' is treated as Vietnamese (2-mic MVP: hints are static). */
export function normalizeLang(hint: string | undefined | null): TranslateLang {
  return hint?.trim().toLowerCase().split('-')[0] === 'en' ? 'en' : 'vi';
}

export async function translate(
  sourceText: string,
  sourceLangHint: string,
  config: TranslatorConfig = {},
): Promise<TranslationResult> {
  const url = config.url ?? process.env.LLM_URL ?? DEFAULTS.url;
  const apiKey = config.apiKey ?? process.env.FPT_API_KEY ?? '';
  const model = config.model ?? process.env.LLM_MODEL ?? DEFAULTS.model;
  const timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs;

  if (!apiKey) {
    throw new TranslationError('FPT_API_KEY not set — cannot call translation LLM');
  }

  const sourceLang = normalizeLang(sourceLangHint);
  const targetLang: TranslateLang = sourceLang === 'vi' ? 'en' : 'vi';
  const prompt = buildTranslationPrompt(sourceLang, targetLang, sourceText);

  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.1,
      }),
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new TranslationError(
      aborted ? `LLM call exceeded ${timeoutMs}ms` : `LLM call failed: ${err}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new TranslationError(`LLM returned HTTP ${resp.status}`, resp.status);
  }

  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const translatedText = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!translatedText) {
    throw new TranslationError('LLM returned empty translation');
  }

  return {
    translatedText,
    sourceLang,
    targetLang,
    model,
    latencyMs: Date.now() - t0,
  };
}
