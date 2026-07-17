interface MicButtonProps {
  isListening: boolean;
  onClick: () => void;
}

// Stateless microphone control used by meeting views.
export function MicButton({ isListening, onClick }: MicButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full bg-meeting-accent px-5 py-3 text-sm font-semibold text-white shadow-panel transition active:translate-y-px hover:bg-meeting-accentStrong"
      aria-pressed={isListening}
    >
      {isListening ? 'Stop listening' : 'Start listening'}
    </button>
  );
}
