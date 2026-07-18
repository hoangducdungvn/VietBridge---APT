// Tiered end-of-turn silence policy.
//
// A flat endSilenceMs is a bad trade: short enough for snappy captions cuts
// mid-sentence pauses; long enough to survive pauses adds its full duration to
// EVERY utterance's time-to-translation. Instead, the hangover adapts to what
// the speaker was last heard saying (latest STT partial):
//
//   - tail ends in a connective ("và", "nhưng", "and", …) → the sentence is
//     clearly unfinished → wait longer (extendedMs)
//   - tail ends in sentence-final punctuation → likely done → cut sooner (shortMs)
//   - otherwise → defaultMs (contract §13 value)
//
// Partial text lags the audio by cadence + STT latency (~1.5-3s), so this only
// helps utterances long enough to have produced a partial — by design. Short
// utterances just get defaultMs, same as before this policy existed.

export interface EndSilencePolicyContext {
  speechDurationMs: number;
  silenceDurationMs: number;
  defaultEndSilenceMs: number;
}

export type EndSilencePolicy = (ctx: EndSilencePolicyContext) => number;

export interface TieredEndSilenceConfig {
  /** No signal from the transcript tail. Contract §13: 600ms. */
  defaultMs: number;
  /** Tail looks unfinished (trailing connective). */
  extendedMs: number;
  /** Tail looks complete (sentence-final punctuation). */
  shortMs: number;
}

export const DEFAULT_TIERED_CONFIG: TieredEndSilenceConfig = {
  defaultMs: 600,
  extendedMs: 1100,
  shortMs: 480,
};

/** Vietnamese + English words that virtually never end a finished sentence. */
const CONNECTIVE_TAILS = [
  // Vietnamese connectives / prepositions / classifiers
  'và', 'là', 'để', 'vì', 'nhưng', 'với', 'của', 'mà', 'thì', 'cho',
  'khi', 'nếu', 'còn', 'hay', 'hoặc', 'rằng', 'nên', 'tại', 'do', 'bởi',
  'từ', 'đến', 'về', 'theo', 'cùng', 'như', 'tuy', 'dù', 'mặc dù', 'bởi vì',
  'trong', 'ngoài', 'trên', 'dưới', 'giữa', 'sau', 'trước', 'những', 'các', 'một',
  // English connectives / prepositions / articles
  'and', 'but', 'or', 'so', 'because', 'with', 'to', 'of', 'the', 'a', 'an',
  'that', 'if', 'when', 'which', 'for', 'in', 'on', 'at', 'by', 'from', 'about',
];

const TERMINAL_PUNCTUATION = /[.!?…]["'”’)]*\s*$/u;

/** Strip trailing non-letter noise so "…nhưng," still matches "nhưng". */
function lastWords(text: string, maxWords: number): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[.,;:!?…"'“”‘’()\-]+\s*$/gu, '')
    .trim();
  if (!cleaned) return '';
  return cleaned.split(/\s+/).slice(-maxWords).join(' ');
}

/** Tail ends mid-enumeration: a comma/colon/dash, or a bare number ("1, 2, 3"). */
const ENUMERATION_TAIL = /(?:[,;:\-–]|\b\d+[.,]?)\s*$/u;

/** Pure tier decision from a transcript tail — unit-testable without audio. */
export function classifyTail(tailText: string): 'extended' | 'short' | 'default' {
  const text = tailText.trim();
  if (!text) return 'default';

  const tail2 = lastWords(text, 2);
  const tail1 = lastWords(text, 1);
  if (CONNECTIVE_TAILS.includes(tail2) || CONNECTIVE_TAILS.includes(tail1)) {
    return 'extended';
  }
  // Enumerations ("1, 2, 3, …" / "thứ nhất,") pause between items — keep the
  // turn open. Checked before terminal punctuation: "3." mid-count is not an
  // end of sentence.
  if (ENUMERATION_TAIL.test(text)) return 'extended';
  if (TERMINAL_PUNCTUATION.test(text)) return 'short';
  return 'default';
}

/**
 * Build a {@link EndSilencePolicy} that reads the latest partial transcript at
 * decision time via `getTailText` (a closure — the policy is consulted on
 * every frame while in POSSIBLE_END, and the partial may arrive mid-hangover).
 */
export function createTieredEndSilencePolicy(
  getTailText: () => string,
  config: TieredEndSilenceConfig = DEFAULT_TIERED_CONFIG,
): EndSilencePolicy {
  return (ctx) => {
    switch (classifyTail(getTailText())) {
      case 'extended':
        return config.extendedMs;
      case 'short':
        return config.shortMs;
      default:
        return ctx.defaultEndSilenceMs || config.defaultMs;
    }
  };
}
