import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Translate, UserPlus } from '@phosphor-icons/react';
import type { SessionParticipant } from '@domain/entities/BackendSession';
import type { LanguageCode } from '@domain/entities/BackendSession';
import { env } from '@infrastructure/config/env';
import { copyText } from '@shared/utils/copyText';

interface RoomWaitingScreenProps {
  guestLanguage: LanguageCode;
  onLeaveRoom: () => void;
  participants: SessionParticipant[];
  roomCode: string;
}

export function RoomWaitingScreen({
  guestLanguage,
  onLeaveRoom,
  participants,
  roomCode
}: RoomWaitingScreenProps) {
  const [hasCopied, setHasCopied] = useState(false);
  const [copyError, setCopyError] = useState<string>();
  const roomUrl = `${env.publicAppUrl}?room=${encodeURIComponent(roomCode)}&language=${guestLanguage}`;
  const isParticipantPresent = participants.length === 2;

  useEffect(() => {
    if (!hasCopied) return;
    const timeout = window.setTimeout(() => setHasCopied(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [hasCopied]);

  const copyRoomLink = async () => {
    try {
      await copyText(roomUrl);
      setHasCopied(true);
      setCopyError(undefined);
    } catch {
      setHasCopied(false);
      setCopyError('Copy failed. Select the meeting link and copy it manually.');
    }
  };

  return (
    <main className="min-h-[100dvh] bg-meeting-canvas px-5 py-8 text-meeting-ink sm:px-8">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-meeting-accent text-white">
            <Translate aria-hidden="true" size={22} weight="bold" />
          </span>
          <span className="text-lg font-bold">VietBridge</span>
        </div>
        <button
          type="button"
          onClick={onLeaveRoom}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-meeting-muted hover:bg-white hover:text-meeting-ink"
        >
          <ArrowLeft aria-hidden="true" size={18} /> Leave locally
        </button>
      </header>

      <section className="mx-auto mt-14 w-full max-w-3xl rounded-xl border border-meeting-line bg-white px-6 py-9 shadow-panel sm:px-10 sm:py-12">
        <div className="text-center">
          <p className="text-sm font-semibold text-meeting-muted">
            Your real backend room is ready
          </p>
          <h1 className="mt-3 font-mono text-4xl font-semibold tracking-[0.16em] text-meeting-ink">
            {roomCode}
          </h1>
          <p className="mx-auto mt-4 max-w-md leading-7 text-meeting-muted">
            Share this code or link with one participant using the opposite language.
          </p>
        </div>

        <div className="mt-9 border-y border-meeting-line py-8">
          <label htmlFor="room-link" className="mb-2 block text-sm font-semibold">
            Meeting link
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="room-link"
              readOnly
              value={roomUrl}
              onClick={(event) => event.currentTarget.select()}
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-meeting-line bg-meeting-canvas px-4 text-sm"
            />
            <button
              type="button"
              onClick={copyRoomLink}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-meeting-accent px-5 font-semibold text-white"
            >
              {hasCopied ? (
                <Check aria-hidden="true" size={19} />
              ) : (
                <Copy aria-hidden="true" size={19} />
              )}
              {hasCopied ? 'Copied' : 'Copy Link'}
            </button>
          </div>
          {copyError && (
            <p role="alert" className="mt-3 text-sm font-medium text-meeting-danger">
              {copyError}
            </p>
          )}
        </div>

        <div className="mt-8 flex flex-col items-center text-center">
          <span className="relative mb-4 flex size-11 items-center justify-center rounded-full bg-meeting-accent/10 text-meeting-accent">
            <span className="absolute inset-0 animate-status-ping rounded-full border border-meeting-accent/30" />
            <UserPlus aria-hidden="true" size={22} />
          </span>
          <p className="font-semibold">
            {isParticipantPresent ? 'Participant joined' : 'Waiting for the other participant…'}
          </p>
          <p className="mt-2 text-sm text-meeting-muted">
            {participants.length} of 2 participants in backend state
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {participants.map((participant) => (
              <span
                key={participant.participantId}
                className="rounded-full border border-meeting-line px-3 py-1.5 text-xs font-semibold"
              >
                {participant.displayName} · {participant.sourceLanguage.toUpperCase()} ·{' '}
                {participant.connectionStatus}
              </span>
            ))}
          </div>
        </div>
      </section>

      {hasCopied && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl bg-meeting-ink px-4 py-3 text-sm font-medium text-white shadow-panel"
        >
          Meeting link copied
        </div>
      )}
    </main>
  );
}
