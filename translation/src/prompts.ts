// Prompt & glossary for the VI<->EN meeting translator.
// Kept separate from translator.ts so prompt tuning never touches logic.

/** Terms that must pass through untranslated in either direction. */
export const GLOSSARY_KEEP_ENGLISH = [
  'API', 'WebSocket', 'SaaS', 'AI', 'MOU', 'NDA', 'KPI', 'OKR', 'ROI',
  'EBITDA', 'B2B', 'B2C', 'CRM', 'ERP', 'PoC', 'roadmap', 'milestone',
];

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
): string {
  const langName = { vi: 'Vietnamese', en: 'English' } as const;
  return `Translate ${langName[sourceLang]} to ${langName[targetLang]} as a professional business interpreter.
Return only the translation. Preserve meaning, tone, commitments, negation, uncertainty, names, and technical terms; do not summarize or add content.
Keep unchanged: ${GLOSSARY_KEEP_ENGLISH.join(', ')}.
Business glossary: ${BUSINESS_GLOSSARY.join('; ')}.
Copy each [[VB_VALUE_n]] token exactly once in position. Preserve all numbers, dates, currencies, units, signs, and precision; never round or convert.`;
}

/** Kept for CLI/users that need a single-string prompt. */
export function buildTranslationPrompt(
  sourceLang: 'vi' | 'en',
  targetLang: 'vi' | 'en',
  sourceText: string,
): string {
  return `${buildTranslationSystemPrompt(sourceLang, targetLang)}\n\n${sourceText}`;
}
