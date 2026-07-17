import type { TranscriptSegment } from '@domain/entities/TranscriptSegment';

interface TranscriptBubbleProps {
  segment: TranscriptSegment;
}

// Pure display component for one transcript and translation pair.
export function TranscriptBubble({ segment }: TranscriptBubbleProps) {
  return (
    <article className="rounded-lg border border-meeting-line bg-meeting-surface p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-meeting-muted">
        <span>{segment.direction.toUpperCase()}</span>
        <span>{segment.isFinal ? 'Final' : 'Partial'}</span>
      </div>
      <p className="text-base font-semibold text-meeting-ink">{segment.sourceText}</p>
      {segment.translatedText ? (
        <p className="mt-2 text-base leading-7 text-meeting-muted">{segment.translatedText}</p>
      ) : null}
    </article>
  );
}
