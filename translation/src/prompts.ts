// Prompt & glossary for the VI<->EN meeting translator.
// Kept separate from translator.ts so prompt tuning never touches logic.

/** Terms that must pass through untranslated in either direction. */
export const GLOSSARY_KEEP_ENGLISH = [
  'API', 'WebSocket', 'SaaS', 'AI', 'MOU', 'NDA', 'KPI', 'OKR', 'ROI',
  'EBITDA', 'B2B', 'B2C', 'CRM', 'ERP', 'PoC', 'roadmap', 'milestone',
];

export interface TranslationTurn {
  sourceText: string;
  translatedText: string;
}

/** Stable business meanings used to disambiguate common meeting vocabulary. */
export const BUSINESS_GLOSSARY = [
  'revenue = doanh thu',
  'profit = lợi nhuận',
  'cash flow = dòng tiền',
  'market share = thị phần',
  'valuation = định giá',
  'equity = vốn chủ sở hữu/cổ phần (choose by context)',
  'stakeholder = bên liên quan',
  'procurement = thu mua',
  'supply chain = chuỗi cung ứng',
  'compliance = tuân thủ',
  'due diligence = thẩm định chuyên sâu',
  'deliverable = sản phẩm bàn giao',
];

export function buildTranslationSystemPrompt(
  sourceLang: 'vi' | 'en',
  targetLang: 'vi' | 'en',
  protectedValueCount = 0,
): string {
  const langName = { vi: 'Vietnamese', en: 'English' } as const;
  // Only mention the markers when they actually exist in the input — an
  // unconditional instruction makes the model HALLUCINATE [[VB_VALUE_n]]
  // tokens into translations of number-free sentences (seen in production).
  const markerRule =
    protectedValueCount > 0
      ? `\nCopy each [[VB_VALUE_n]] token exactly once in position. Preserve all numbers, dates, currencies, units, signs, and precision; never round or convert.`
      : `\nPreserve all numbers, dates, currencies, units, signs, and precision; never round or convert.`;
  return `Translate ${langName[sourceLang]} to ${langName[targetLang]} as a professional business interpreter.
Return only the translation. Preserve meaning, tone, commitments, negation, uncertainty, names, and technical terms; do not summarize or add content.
Keep unchanged: ${GLOSSARY_KEEP_ENGLISH.join(', ')}.
Business glossary: ${BUSINESS_GLOSSARY.join('; ')}.${markerRule}`;
}

export function buildTranslationUserPrompt(
  sourceLang: 'vi' | 'en',
  sourceText: string,
  context?: TranslationTurn[],
): string {
  const langName = { vi: 'Vietnamese', en: 'English' } as const;
  let prompt = '';
  
  if (context && context.length > 0) {
    prompt += `Previous conversation context (for coherence):\n`;
    context.forEach(turn => {
      prompt += `Speaker (${langName[sourceLang]}): ${turn.sourceText}\n`;
      prompt += `Translation: ${turn.translatedText}\n`;
    });
    prompt += `\nText to translate:\n`;
  }
  
  prompt += sourceText;
  return prompt;
}

/** Kept for CLI/users that need a single-string prompt. */
export function buildTranslationPrompt(
  sourceLang: 'vi' | 'en',
  targetLang: 'vi' | 'en',
  sourceText: string,
  context?: TranslationTurn[],
): string {
  const userPrompt = buildTranslationUserPrompt(sourceLang, sourceText, context);
  return `${buildTranslationSystemPrompt(sourceLang, targetLang)}\n\n${userPrompt}`;
}
