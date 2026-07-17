interface SpeakerIndicatorProps {
  label: string;
  isActive: boolean;
}

// Compact speaker status indicator for turn-taking feedback.
export function SpeakerIndicator({ label, isActive }: SpeakerIndicatorProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-meeting-muted">
      <span
        className={`h-2.5 w-2.5 rounded-full ${isActive ? 'bg-meeting-accent' : 'bg-slate-300'}`}
      />
      <span>{label}</span>
    </div>
  );
}
