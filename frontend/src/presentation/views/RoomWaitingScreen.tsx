import { useEffect, useState } from 'react';
import { Check, Copy, Translate, UserPlus } from '@phosphor-icons/react';

interface RoomWaitingScreenProps {
  roomCode: string;
  isParticipantPresent: boolean;
  onSimulateJoin: () => void;
}

// Room lobby for sharing join details and waiting for the second participant.
export function RoomWaitingScreen({
  roomCode,
  isParticipantPresent,
  onSimulateJoin
}: RoomWaitingScreenProps) {
  const [hasCopied, setHasCopied] = useState(false);
  const roomUrl = `${window.location.origin}?room=${roomCode}`;

  useEffect(() => {
    if (!hasCopied) return;
    const timeout = window.setTimeout(() => setHasCopied(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [hasCopied]);

  const copyRoomLink = async () => {
    try {
      await navigator.clipboard.writeText(roomUrl);
      setHasCopied(true);
    } catch {
      setHasCopied(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-meeting-canvas px-5 py-8 text-meeting-ink sm:px-8">
      <header className="mx-auto flex max-w-6xl items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-meeting-accent text-white">
          <Translate aria-hidden="true" size={22} weight="bold" />
        </span>
        <span className="text-lg font-bold">VietBridge</span>
      </header>

      <section className="mx-auto mt-14 w-full max-w-3xl rounded-xl border border-meeting-line bg-white px-6 py-9 shadow-panel sm:px-10 sm:py-12">
        <div className="text-center">
          <p className="text-sm font-semibold text-meeting-muted">Your meeting room is ready</p>
          <h1 className="mt-3 text-3xl font-semibold text-meeting-ink sm:text-4xl">
            Room #{roomCode}
          </h1>
          <p className="mx-auto mt-4 max-w-md leading-7 text-meeting-muted">
            Share this private link with one participant. The room closes after two people join.
          </p>
        </div>

        <div className="mt-9 border-y border-meeting-line py-8">
          <div className="min-w-0">
            <label
              htmlFor="room-link"
              className="mb-2 block text-sm font-semibold text-meeting-ink"
            >
              Meeting link
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="room-link"
                readOnly
                value={roomUrl}
                className="min-h-12 min-w-0 flex-1 rounded-xl border border-meeting-line bg-meeting-canvas px-4 text-sm text-meeting-ink outline-none focus:border-meeting-accent focus:ring-2 focus:ring-meeting-accent/15"
              />
              <button
                type="button"
                onClick={copyRoomLink}
                className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-meeting-accent px-5 font-semibold text-white transition hover:bg-meeting-accentStrong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meeting-accent active:scale-[0.98]"
              >
                {hasCopied ? (
                  <Check aria-hidden="true" size={19} weight="bold" />
                ) : (
                  <Copy aria-hidden="true" size={19} />
                )}
                {hasCopied ? 'Copied' : 'Copy Link'}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center text-center">
          <span className="relative mb-4 flex size-11 items-center justify-center rounded-full bg-meeting-accent/10 text-meeting-accent">
            <span className="absolute inset-0 animate-status-ping rounded-full border border-meeting-accent/30" />
            <UserPlus aria-hidden="true" size={22} />
          </span>
          <p className="font-semibold text-meeting-ink">
            {isParticipantPresent
              ? 'Participant joined'
              : 'Waiting for the other participant to join...'}
          </p>
          <p className="mt-2 text-sm text-meeting-muted">1 of 2 participants connected</p>

          {!isParticipantPresent && (
            <button
              type="button"
              onClick={onSimulateJoin}
              className="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl border border-meeting-line bg-white px-4 text-sm font-semibold text-meeting-accent transition hover:border-meeting-accent hover:bg-meeting-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meeting-accent active:scale-[0.98]"
            >
              Simulate participant join
            </button>
          )}
        </div>
      </section>

      {hasCopied && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl bg-meeting-ink px-4 py-3 text-sm font-medium text-white shadow-panel"
        >
          Meeting link copied to clipboard
        </div>
      )}
    </main>
  );
}
