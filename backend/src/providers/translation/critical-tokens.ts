// KEEP IN SYNC with translation/src/criticalTokens.ts (source of truth).
// Duplicated because the Nest build roots at backend/src and cannot import
// across the monorepo without a build-config change.

export interface ProtectedText {
  text: string;
  tokens: readonly string[];
}

// Ordered from the most structured expressions to plain numbers so a date or
// currency amount is protected as one unit instead of several fragments.
const CRITICAL_VALUE_PATTERN = new RegExp(
  [
    String.raw`\b(?:Q[1-4]|FY)\s*[-/]?\s*\d{2,4}\b`,
    String.raw`\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b`,
    String.raw`\b\d{1,2}:\d{2}(?::\d{2})?\b`,
    String.raw`(?:[$€£¥]\s*|\b(?:USD|SGD|VND|EUR|GBP)\s*)\d[\d.,]*(?:\s*(?:million|billion|trillion|thousand|triệu|tỷ|nghìn))?\b`,
    String.raw`\b\d[\d.,]*(?:\s*(?:million|billion|trillion|thousand|triệu|tỷ|nghìn))?\s*(?:USD|SGD|VND|EUR|GBP)\b`,
    String.raw`\b\d[\d.,]*\s*(?:%|percent|phần\s+trăm|bps|basis\s+points?|million|billion|trillion|thousand|triệu|tỷ|nghìn)(?!\w)`,
    String.raw`\b\d[\d.,]*\b`,
  ].join('|'),
  'giu',
);

/** Protect literal business values from being rounded, reformatted, or omitted by the LLM. */
export function protectCriticalValues(sourceText: string): ProtectedText {
  const tokens: string[] = [];
  const text = sourceText.replace(CRITICAL_VALUE_PATTERN, (value) => {
    const index = tokens.push(value) - 1;
    return `[[VB_VALUE_${index}]]`;
  });

  return { text, tokens };
}

/** Restore protected values. Whitespace is tolerated in case a model reformats a marker. */
export function restoreCriticalValues(
  translatedText: string,
  tokens: readonly string[],
): string {
  const restored = tokens.reduce((text, value, index) => {
    const marker = new RegExp(String.raw`\[\[\s*VB_VALUE_${index}\s*\]\]`, 'g');
    return text.replace(marker, value);
  }, translatedText);
  // Any marker still present is either hallucinated by the model or out of
  // range — leaking "[[VB_VALUE_1]]" to the reader is worse than dropping it.
  return restored
    .replace(/\[\[\s*VB_VALUE_\d+\s*\]\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
