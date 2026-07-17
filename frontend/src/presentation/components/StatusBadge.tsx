import type { StreamStatus } from '@shared/types';

interface StatusBadgeProps {
  status: StreamStatus;
}

// Small status label for connection, listening, and translation states.
export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className="rounded-full border border-meeting-line bg-white px-3 py-1 text-xs font-semibold uppercase text-meeting-muted">
      {status}
    </span>
  );
}
