import { Check, Lock, X } from '@phosphor-icons/react';
import type { RoomLanguage } from '@domain/entities/Room';

interface LanguageSelectModalProps {
  roomName: string;
  otherParticipantLanguage: RoomLanguage | null;
  selectedLanguage: RoomLanguage | null;
  onSelectLanguage: (language: RoomLanguage) => void;
  onClose: () => void;
}

const languageOptions: Array<{
  code: RoomLanguage;
  flag: string;
  label: string;
  detail: string;
}> = [
  { code: 'en', flag: '🇬🇧', label: 'English', detail: 'I will speak English' },
  { code: 'vi', flag: '🇻🇳', label: 'Tiếng Việt', detail: 'Tôi sẽ nói tiếng Việt' }
];

// Participant-specific language choice that enforces one speaker per language.
export function LanguageSelectModal({
  roomName,
  otherParticipantLanguage,
  selectedLanguage,
  onSelectLanguage,
  onClose
}: LanguageSelectModalProps) {
  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-meeting-ink/45 px-5 py-8 backdrop-blur-[2px]"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="language-title"
        aria-describedby="language-description"
        className="relative w-full max-w-2xl animate-modal-enter rounded-xl bg-white p-6 shadow-panel sm:p-9"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close language selection"
          title="Close"
          className="absolute right-4 top-4 grid size-10 place-items-center rounded-xl text-meeting-muted transition hover:bg-meeting-canvas hover:text-meeting-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meeting-accent active:scale-[0.98]"
        >
          <X aria-hidden="true" size={20} />
        </button>

        <div className="px-8 text-center">
          <p className="mb-3 text-sm font-semibold text-meeting-accent">{roomName}</p>
          <h2 id="language-title" className="text-2xl font-semibold text-meeting-ink sm:text-3xl">
            Choose your language
          </h2>
          <p
            id="language-description"
            className="mx-auto mt-3 max-w-md leading-7 text-meeting-muted"
          >
            {otherParticipantLanguage
              ? 'Choose the remaining language so both sides stay clear.'
              : 'Select the language you will speak in this room.'}
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {languageOptions.map((language) => {
            const isUnavailable = language.code === otherParticipantLanguage;
            const isSelected = language.code === selectedLanguage;

            return (
              <button
                key={language.code}
                type="button"
                disabled={isUnavailable || selectedLanguage !== null}
                aria-pressed={isSelected}
                title={isUnavailable ? 'Already selected by the other participant' : undefined}
                onClick={() => onSelectLanguage(language.code)}
                className={`relative min-h-40 rounded-xl border p-6 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-meeting-accent active:scale-[0.98] ${
                  isSelected
                    ? 'border-meeting-accent bg-meeting-accent/5 ring-2 ring-meeting-accent/15'
                    : isUnavailable
                      ? 'cursor-not-allowed border-meeting-line bg-meeting-canvas text-meeting-muted opacity-65'
                      : 'border-meeting-line bg-white hover:border-meeting-accent hover:bg-meeting-canvas'
                }`}
              >
                <span className="text-3xl" aria-hidden="true">
                  {language.flag}
                </span>
                <span className="mt-5 block text-xl font-semibold text-meeting-ink">
                  {language.label}
                </span>
                <span className="mt-1 block text-sm text-meeting-muted">{language.detail}</span>
                {isUnavailable && (
                  <span className="mt-4 flex items-center gap-2 text-xs font-semibold text-meeting-muted">
                    <Lock aria-hidden="true" size={14} /> Already selected
                  </span>
                )}
                {isSelected && (
                  <span className="absolute right-4 top-4 grid size-7 place-items-center rounded-full bg-meeting-accent text-white">
                    <Check aria-hidden="true" size={16} weight="bold" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <p className="mt-6 text-center text-sm text-meeting-muted">
          {otherParticipantLanguage
            ? `The other participant selected ${
                otherParticipantLanguage === 'en' ? 'English' : 'Tiếng Việt'
              }.`
            : 'You are the first participant in this room.'}
        </p>
      </section>
    </div>
  );
}
