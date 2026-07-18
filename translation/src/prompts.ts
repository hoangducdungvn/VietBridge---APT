// Prompt & glossary for the VI<->EN meeting translator.
// Kept separate from translator.ts so prompt tuning never touches logic.

/** Terms that must pass through untranslated in either direction. */
export const GLOSSARY_KEEP_ENGLISH = [
  'API', 'WebSocket', 'deploy', 'merge', 'pull request', 'MOU', 'NDA',
  'milestone', 'deadline', 'KPI', 'OKR', 'budget', 'partnership',
];

export interface TranslationTurn {
  sourceText: string;
  translatedText: string;
}

export function buildTranslationPrompt(
  sourceLang: 'vi' | 'en',
  targetLang: 'vi' | 'en',
  sourceText: string,
  context?: TranslationTurn[],
): string {
  const langName = { vi: 'Vietnamese', en: 'English' } as const;
  
  let prompt = `You are a professional interpreter for a Vietnamese-English business meeting. Translate the following ${langName[sourceLang]} text to ${langName[targetLang]}.
Rules:
- Keep business/technical terms commonly used in English (${GLOSSARY_KEEP_ENGLISH.slice(0, 6).join(', ')}, ...) in English
- Keep proper nouns, numbers, and currency amounts exactly as spoken
- Maintain the speaker's natural tone; do not add or omit content
- Return ONLY the translated text, no explanations\n`;

  if (context && context.length > 0) {
    prompt += `\nPrevious conversation context (for coherence):\n`;
    context.forEach(turn => {
      prompt += `Speaker (${langName[sourceLang]}): ${turn.sourceText}\n`;
      prompt += `Translation: ${turn.translatedText}\n`;
    });
  }

  prompt += `\nText to translate: ${sourceText}`;
  return prompt;
}
