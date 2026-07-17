import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GearSix,
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  Translate,
  X
} from '@phosphor-icons/react';
import type { LanguageCode } from '@shared/types';

interface MeetingRoomScreenProps {
  roomCode: string;
  localLanguage: LanguageCode;
  otherLanguage: LanguageCode;
  onEndMeeting: () => void;
}

interface MockPhrase {
  speakerLanguage: 'en' | 'vi';
  en: string;
  vi: string;
}

interface TranscriptItem {
  id: string;
  text: string;
  timestamp: string;
  turn: number;
}

const mockPhrases: MockPhrase[] = [
  {
    speakerLanguage: 'en',
    en: 'Good morning. Let us begin with the priorities for this quarter.',
    vi: 'Chào buổi sáng. Hãy bắt đầu với các ưu tiên trong quý này.'
  },
  {
    speakerLanguage: 'vi',
    en: 'We need to align the delivery schedule with the client review.',
    vi: 'Chúng ta cần thống nhất lịch bàn giao với buổi đánh giá của khách hàng.'
  },
  {
    speakerLanguage: 'en',
    en: 'The proposed timeline works, provided the final scope is approved today.',
    vi: 'Tiến độ đề xuất phù hợp, với điều kiện phạm vi cuối cùng được duyệt hôm nay.'
  },
  {
    speakerLanguage: 'vi',
    en: 'Agreed. I will send the updated document after this meeting.',
    vi: 'Đồng ý. Tôi sẽ gửi tài liệu cập nhật sau cuộc họp này.'
  }
];

const languageDetails = {
  en: { name: 'English', nativeName: 'English', flag: '🇬🇧' },
  vi: { name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳' }
} as const;

const getLanguageDetails = (language: LanguageCode) =>
  language === 'vi' ? languageDetails.vi : languageDetails.en;

const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

interface LanguagePaneProps {
  language: LanguageCode;
  isOwnLanguage: boolean;
  isSpeaking: boolean;
  speakerLabel: string;
  liveCaption: string;
  transcript: TranscriptItem[];
}

function LanguagePane({
  language,
  isOwnLanguage,
  isSpeaking,
  speakerLabel,
  liveCaption,
  transcript
}: LanguagePaneProps) {
  const details = getLanguageDetails(language);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const transcriptElement = scrollRef.current;
    if (!transcriptElement) return;

    if (typeof transcriptElement.scrollTo === 'function') {
      transcriptElement.scrollTo({ top: transcriptElement.scrollHeight, behavior: 'smooth' });
    } else {
      transcriptElement.scrollTop = transcriptElement.scrollHeight;
    }
  }, [transcript]);

  return (
    <section
      className={`flex min-h-[540px] min-w-0 flex-col overflow-hidden bg-white lg:min-h-0 ${
        isOwnLanguage ? 'bg-[#f8fbff]' : ''
      }`}
      aria-label={`${details.name} transcript`}
    >
      <header className="flex min-h-[76px] items-center justify-between border-b border-meeting-line px-5 py-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`relative grid size-11 shrink-0 place-items-center rounded-full bg-meeting-accent text-sm font-bold text-white ${
              isSpeaking ? 'ring-4 ring-meeting-live/20' : ''
            }`}
          >
            {speakerLabel.slice(-1)}
            {isSpeaking && (
              <span className="absolute inset-[-5px] animate-speaking-ring rounded-full border-2 border-meeting-live" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="truncate font-semibold text-meeting-ink">{speakerLabel}</h2>
              {isOwnLanguage && (
                <span className="rounded-md bg-meeting-accent/10 px-2 py-0.5 text-xs font-semibold text-meeting-accent">
                  Your language
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-meeting-muted">
              <span aria-hidden="true">{details.flag}</span> {details.nativeName}
            </p>
          </div>
        </div>

        <span
          className={`text-xs font-semibold ${isSpeaking ? 'text-meeting-live' : 'text-meeting-muted'}`}
        >
          {isSpeaking ? 'Speaking' : 'Listening'}
        </span>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7"
        aria-live="polite"
      >
        {transcript.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center text-center">
            <p className="max-w-xs text-sm leading-6 text-meeting-muted">
              Finalized {details.name.toLowerCase()} transcript will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {transcript.map((item) => (
              <article
                key={item.id}
                className={`max-w-[92%] rounded-xl px-4 py-3 ${
                  item.turn % 2 === 0 ? 'bg-meeting-canvas' : 'bg-meeting-accent/[0.07]'
                }`}
              >
                <p className="text-base leading-7 text-meeting-ink">{item.text}</p>
                <time className="mt-2 block text-xs font-medium text-meeting-muted">
                  {item.timestamp}
                </time>
              </article>
            ))}
          </div>
        )}
      </div>

      <div
        className="min-h-[132px] border-t border-meeting-accent/20 bg-meeting-accent/[0.055] px-5 py-4 sm:px-7"
        aria-live="assertive"
        aria-atomic="true"
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-meeting-accent">
          <span
            className={`size-2 rounded-full ${isSpeaking ? 'animate-live-dot bg-meeting-live' : 'bg-meeting-muted/40'}`}
          />
          Live caption
        </div>
        <p
          className={`min-h-14 text-lg font-semibold leading-7 text-meeting-ink sm:text-xl ${liveCaption ? '' : 'text-meeting-muted'}`}
        >
          {liveCaption || 'Waiting for speech...'}
          {liveCaption && (
            <span className="ml-1 inline-block h-5 w-0.5 animate-caption-cursor bg-meeting-accent align-middle" />
          )}
        </p>
      </div>
    </section>
  );
}

// Demonstration meeting workspace with local mocked streaming and speaker turns.
export function MeetingRoomScreen({
  roomCode,
  localLanguage,
  otherLanguage,
  onEndMeeting
}: MeetingRoomScreenProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [isStreaming, setIsStreaming] = useState(true);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [liveCaptions, setLiveCaptions] = useState<Record<'en' | 'vi', string>>({ en: '', vi: '' });
  const [transcripts, setTranscripts] = useState<Record<'en' | 'vi', TranscriptItem[]>>({
    en: [],
    vi: []
  });

  const currentPhrase = mockPhrases[phraseIndex % mockPhrases.length];
  const currentSpeaker = currentPhrase.speakerLanguage;
  const orderedLanguages = useMemo(
    () => [localLanguage, otherLanguage] as const,
    [localLanguage, otherLanguage]
  );

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const sourceLanguage = currentPhrase.speakerLanguage;
    const targetLanguage = sourceLanguage === 'en' ? 'vi' : 'en';
    const sourceWords = currentPhrase[sourceLanguage].split(' ');
    const targetWords = currentPhrase[targetLanguage].split(' ');
    let wordIndex = 0;
    let nextPhraseTimeout: number | undefined;

    setIsStreaming(true);
    setLiveCaptions({ en: '', vi: '' });

    const streamInterval = window.setInterval(() => {
      wordIndex += 1;
      const progress = wordIndex / sourceWords.length;
      const translatedWordCount = Math.max(1, Math.ceil(targetWords.length * progress));
      const nextSourceCaption = sourceWords.slice(0, wordIndex).join(' ');
      const nextTargetCaption = targetWords.slice(0, translatedWordCount).join(' ');

      setLiveCaptions({
        [sourceLanguage]: nextSourceCaption,
        [targetLanguage]: nextTargetCaption
      } as Record<'en' | 'vi', string>);

      if (wordIndex >= sourceWords.length) {
        window.clearInterval(streamInterval);
        setIsStreaming(false);
        const timestamp = new Intl.DateTimeFormat('en', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }).format(new Date());

        setTranscripts((current) => ({
          en: [
            ...current.en,
            { id: `turn-${phraseIndex}-en`, text: currentPhrase.en, timestamp, turn: phraseIndex }
          ].slice(-10),
          vi: [
            ...current.vi,
            { id: `turn-${phraseIndex}-vi`, text: currentPhrase.vi, timestamp, turn: phraseIndex }
          ].slice(-10)
        }));

        nextPhraseTimeout = window.setTimeout(() => setPhraseIndex((index) => index + 1), 1200);
      }
    }, 210);

    return () => {
      window.clearInterval(streamInterval);
      if (nextPhraseTimeout) window.clearTimeout(nextPhraseTimeout);
    };
  }, [currentPhrase, phraseIndex]);

  return (
    <main className="flex min-h-[100dvh] flex-col bg-meeting-canvas text-meeting-ink lg:h-[100dvh] lg:overflow-hidden">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-meeting-line bg-white px-4 py-3 sm:px-6 lg:flex-nowrap lg:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-meeting-accent text-white">
            <Translate aria-hidden="true" size={19} weight="bold" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-meeting-ink">Room #{roomCode}</p>
            <p className="text-xs text-meeting-muted">Vietnamese-English meeting</p>
          </div>
        </div>

        <div className="order-3 flex w-full items-center justify-center gap-5 text-sm sm:order-none sm:w-auto">
          <span className="flex items-center gap-2 font-medium text-meeting-muted">
            <span className="size-2 rounded-full bg-meeting-live" /> Connected
          </span>
          <time className="min-w-12 font-mono font-semibold tabular-nums text-meeting-ink">
            {formatDuration(elapsedSeconds)}
          </time>
        </div>

        <button
          type="button"
          title="Meeting settings"
          aria-label="Meeting settings"
          className="grid size-10 shrink-0 place-items-center rounded-xl text-meeting-muted transition hover:bg-meeting-canvas hover:text-meeting-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meeting-accent active:scale-[0.98]"
        >
          <GearSix aria-hidden="true" size={22} />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-2">
        {orderedLanguages.map((language, index) => (
          <div
            key={language}
            className={`h-full ${index === 0 ? 'border-b border-meeting-accent lg:border-b-0 lg:border-r' : ''}`}
          >
            <LanguagePane
              language={language}
              isOwnLanguage={language === localLanguage}
              isSpeaking={isStreaming && currentSpeaker === language && !isMuted}
              speakerLabel={language === localLanguage ? 'Speaker A' : 'Speaker B'}
              liveCaption={language === 'vi' ? liveCaptions.vi : liveCaptions.en}
              transcript={language === 'vi' ? transcripts.vi : transcripts.en}
            />
          </div>
        ))}
      </div>

      <footer className="relative flex min-h-24 items-center justify-center border-t border-meeting-line bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <div
            className="flex h-12 w-9 items-end justify-center gap-1"
            aria-label={isMuted ? 'Audio level muted' : 'Live audio level'}
          >
            {[0, 1, 2, 3].map((bar) => (
              <span
                key={bar}
                className={`w-1.5 rounded-full bg-meeting-accent ${isMuted ? 'h-1.5 opacity-25' : 'animate-audio-level'}`}
                style={{ animationDelay: `${bar * 110}ms` }}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => setIsMuted((muted) => !muted)}
            aria-pressed={isMuted}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            className={`relative grid size-16 place-items-center rounded-full text-white shadow-panel transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-meeting-accent active:scale-[0.97] ${
              isMuted ? 'bg-[#8793a1]' : 'bg-meeting-accent hover:bg-meeting-accentStrong'
            }`}
          >
            {!isMuted && (
              <span className="absolute inset-[-7px] animate-mic-ring rounded-full border-2 border-meeting-accent/30" />
            )}
            {isMuted ? (
              <MicrophoneSlash aria-hidden="true" size={27} weight="fill" />
            ) : (
              <Microphone aria-hidden="true" size={27} weight="fill" />
            )}
          </button>
        </div>

        <div className="absolute right-4 sm:right-6">
          {isEnding ? (
            <div className="fixed bottom-28 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-meeting-danger/30 bg-white p-1.5 shadow-panel sm:absolute sm:bottom-auto sm:left-auto sm:right-6 sm:translate-x-0">
              <button
                type="button"
                onClick={onEndMeeting}
                className="inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-lg bg-meeting-danger px-3 text-sm font-semibold text-white transition hover:bg-[#ad3434] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meeting-danger active:scale-[0.98]"
              >
                <PhoneDisconnect aria-hidden="true" size={18} weight="bold" /> End now
              </button>
              <button
                type="button"
                onClick={() => setIsEnding(false)}
                aria-label="Cancel ending meeting"
                className="grid size-10 place-items-center rounded-lg text-meeting-muted transition hover:bg-meeting-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meeting-accent"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEnding(true)}
              className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl border border-meeting-danger px-4 text-sm font-semibold text-meeting-danger transition hover:bg-meeting-danger/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meeting-danger active:scale-[0.98]"
            >
              <PhoneDisconnect aria-hidden="true" size={18} />
              <span className="hidden sm:inline">End Meeting</span>
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}
