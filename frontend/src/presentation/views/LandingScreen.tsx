import { ArrowRight, Translate } from '@phosphor-icons/react';

interface LandingScreenProps {
  onCreateRoom: () => void;
}

// Focused room-creation entry point for starting a bilingual meeting.
export function LandingScreen({ onCreateRoom }: LandingScreenProps) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-white px-5 py-12 text-meeting-ink">
      <section className="flex w-full max-w-xl flex-col items-center text-center">
        <div className="mb-12 flex items-center gap-3" aria-label="VietBridge">
          <span className="grid size-11 place-items-center rounded-xl bg-meeting-accent text-white shadow-panel">
            <Translate aria-hidden="true" size={24} weight="bold" />
          </span>
          <span className="text-xl font-bold text-meeting-ink">VietBridge</span>
        </div>

        <h1 className="max-w-lg text-4xl font-semibold leading-tight text-meeting-ink sm:text-5xl">
          Every voice, understood.
        </h1>
        <p className="mt-5 max-w-md text-base leading-7 text-meeting-muted sm:text-lg">
          Real-time Vietnamese-English translation for focused business meetings.
        </p>

        <button
          type="button"
          onClick={onCreateRoom}
          className="mt-10 inline-flex min-h-14 items-center justify-center gap-3 whitespace-nowrap rounded-xl bg-meeting-accent px-8 text-base font-semibold text-white shadow-panel transition duration-200 hover:bg-meeting-accentStrong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-meeting-accent active:scale-[0.98]"
        >
          Create Room
          <ArrowRight aria-hidden="true" size={20} weight="bold" />
        </button>
      </section>
    </main>
  );
}
