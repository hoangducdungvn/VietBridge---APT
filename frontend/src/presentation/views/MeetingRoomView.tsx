import { useMeetingStore } from '@application/store/useMeetingStore';
import { LanguageToggle } from '@presentation/components/LanguageToggle';
import { MicButton } from '@presentation/components/MicButton';
import { SpeakerIndicator } from '@presentation/components/SpeakerIndicator';
import { StatusBadge } from '@presentation/components/StatusBadge';
import { TranscriptBubble } from '@presentation/components/TranscriptBubble';
import { useAudioCapture } from '@presentation/hooks/useAudioCapture';
import { useSpeakerTurns } from '@presentation/hooks/useSpeakerTurns';

// Controller-style view composing meeting state, actions, and stateless UI components.
export function MeetingRoomView() {
  const audioCapture = useAudioCapture();
  const { activeSpeakerLabel, isSpeakerActive } = useSpeakerTurns();
  const direction = useMeetingStore((state) => state.direction);
  const isListening = useMeetingStore((state) => state.isListening);
  const segments = useMeetingStore((state) => state.segments);
  const status = useMeetingStore((state) => state.status);
  const setDirection = useMeetingStore((state) => state.setDirection);
  const setListening = useMeetingStore((state) => state.setListening);
  const setStatus = useMeetingStore((state) => state.setStatus);

  const handleToggleListening = async () => {
    if (isListening) {
      await audioCapture.stop();
      setListening(false);
      setStatus('idle');
      return;
    }

    setStatus('connecting');
    await audioCapture.start();
    setListening(true);
    setStatus('listening');
  };

  const demoSegments =
    segments.length > 0
      ? segments
      : [
          {
            id: 'demo-1',
            speakerId: 'speaker-a',
            sourceText: 'We are waiting for the first Vietnamese or English speaker.',
            translatedText: "Let's start with the goal of today's meeting.",
            sourceLanguage: 'vi',
            targetLanguage: 'en',
            direction,
            isFinal: true,
            startedAt: Date.now()
          }
        ];

  return (
    <main className="min-h-[100dvh] bg-meeting-canvas px-4 py-6 text-meeting-ink sm:px-6 lg:px-8">
      <section className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 rounded-lg border border-meeting-line bg-white p-5 shadow-panel md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-meeting-accent">VietBridge live room</p>
            <h1 className="mt-2 text-2xl font-bold tracking-normal text-meeting-ink md:text-3xl">
              Vietnamese-English meeting translator
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={status} />
            <LanguageToggle direction={direction} onChange={setDirection} />
            <MicButton isListening={isListening} onClick={handleToggleListening} />
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-lg border border-meeting-line bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-meeting-ink">Room signal</h2>
            <div className="mt-4 space-y-3">
              <SpeakerIndicator label={activeSpeakerLabel} isActive={isSpeakerActive || isListening} />
              <p className="text-sm leading-6 text-meeting-muted">
                Capture, VAD, and streaming adapters are scaffolded for low-latency turn-taking.
              </p>
            </div>
          </aside>

          <section className="space-y-3">
            {demoSegments.map((segment) => (
              <TranscriptBubble key={segment.id} segment={segment} />
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}
