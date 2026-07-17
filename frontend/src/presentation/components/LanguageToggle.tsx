import type { TranslationDirection } from '@shared/types';

interface LanguageToggleProps {
  direction: TranslationDirection;
  onChange: (direction: TranslationDirection) => void;
}

// Stateless segmented control for switching bidirectional translation flow.
export function LanguageToggle({ direction, onChange }: LanguageToggleProps) {
  const options: TranslationDirection[] = ['vi-en', 'en-vi'];

  return (
    <div className="inline-flex rounded-full border border-meeting-line bg-white p-1" role="group">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
            direction === option
              ? 'bg-meeting-ink text-white'
              : 'text-meeting-muted hover:text-meeting-ink'
          }`}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
