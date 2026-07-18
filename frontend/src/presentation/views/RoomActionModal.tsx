import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Lock, X } from '@phosphor-icons/react';
import type { LanguageCode, SessionCredentialsInput } from '@domain/entities/BackendSession';
import type { Room } from '@domain/entities/Room';

export type RoomActionMode = 'create' | 'join';

interface RoomActionModalProps {
  errorMessage: string | null;
  initialLanguage: LanguageCode;
  initialRoomCode?: string;
  isSubmitting: boolean;
  mode: RoomActionMode;
  rooms: Room[];
  onClose: () => void;
  onCreate: (input: SessionCredentialsInput, roomCode: string) => void;
  onJoin: (roomCode: string, input: SessionCredentialsInput) => void;
}

export function RoomActionModal({
  errorMessage,
  initialLanguage,
  initialRoomCode,
  isSubmitting,
  mode,
  rooms,
  onClose,
  onCreate,
  onJoin
}: RoomActionModalProps) {
  const emptyRooms = useMemo(
    () => rooms.filter((room) => room.participants.every((participant) => participant === null)),
    [rooms]
  );
  const defaultRoomCode =
    initialRoomCode ?? (mode === 'create' ? emptyRooms[0]?.roomId : undefined) ?? '';
  const [displayName, setDisplayName] = useState('');
  const [roomCode, setRoomCode] = useState(defaultRoomCode);
  const [sourceLanguage, setSourceLanguage] = useState<LanguageCode>(initialLanguage);
  const [formError, setFormError] = useState<string | null>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const selectedRoom = rooms.find((room) => room.roomId === roomCode.trim().toUpperCase());
  const existingParticipant = selectedRoom?.participants.find(
    (participant) => participant !== null
  );

  useEffect(() => {
    displayNameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (mode === 'join' && existingParticipant) {
      setSourceLanguage(existingParticipant.language === 'vi' ? 'en' : 'vi');
    }
  }, [existingParticipant, mode]);

  const submit = () => {
    const normalizedRoomCode = roomCode.trim().toUpperCase();
    const credentials = { displayName: displayName.trim(), sourceLanguage };
    if (credentials.displayName.length === 0) {
      setFormError('Enter your display name to continue.');
      displayNameRef.current?.focus();
      return;
    }
    if (!/^APT00[1-5]$/.test(normalizedRoomCode) || selectedRoom === undefined) {
      setFormError('Choose one of the five lobby rooms (APT001–APT005).');
      return;
    }

    const occupancy = selectedRoom.participants.filter(Boolean).length;
    if (mode === 'create') {
      if (occupancy !== 0) {
        setFormError('That room is occupied. Choose another empty room.');
        return;
      }
      setFormError(null);
      onCreate(credentials, normalizedRoomCode);
      return;
    }

    if (occupancy === 0) {
      setFormError('This room is empty. Use Create room instead.');
      return;
    }
    if (occupancy >= 2) {
      setFormError('This room is full. Choose a waiting room.');
      return;
    }
    setFormError(null);
    onJoin(normalizedRoomCode, credentials);
  };

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-meeting-ink/50 px-4 py-7 backdrop-blur-[3px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-action-title"
        className="relative w-full max-w-lg animate-modal-enter rounded-2xl bg-white p-6 shadow-panel sm:p-8"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute right-4 top-4 grid size-10 place-items-center rounded-xl text-meeting-muted transition hover:bg-meeting-canvas hover:text-meeting-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-meeting-accent"
        >
          <X aria-hidden="true" size={20} />
        </button>

        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-meeting-accent">
          General lobby
        </p>
        <h2 id="room-action-title" className="mt-2 pr-12 text-3xl font-semibold text-meeting-ink">
          {mode === 'create' ? 'Create a room' : 'Join a room'}
        </h2>
        <p className="mt-2 leading-6 text-meeting-muted">
          {mode === 'create'
            ? 'Choose an empty slot, enter your name, then invite the other speaker.'
            : 'Enter the shared room code. Your language is paired with the host automatically.'}
        </p>

        <div className="mt-7 grid gap-5">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-meeting-ink">Display name</span>
            <input
              ref={displayNameRef}
              value={displayName}
              maxLength={80}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setFormError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
              placeholder="e.g. Duong"
              className="min-h-12 w-full rounded-xl border border-meeting-line bg-meeting-canvas px-4 outline-none transition focus:border-meeting-accent focus:ring-2 focus:ring-meeting-accent/15"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-meeting-ink">
              {mode === 'create' ? 'Room slot' : 'Room code'}
            </span>
            {mode === 'create' ? (
              <select
                aria-label="Room slot"
                value={roomCode}
                onChange={(event) => {
                  setRoomCode(event.target.value);
                  setFormError(null);
                }}
                className="min-h-12 w-full rounded-xl border border-meeting-line bg-meeting-canvas px-4 font-mono outline-none focus:border-meeting-accent focus:ring-2 focus:ring-meeting-accent/15"
              >
                {emptyRooms.map((room) => (
                  <option key={room.roomId} value={room.roomId}>
                    {room.roomName} · {room.roomId}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label="Room code"
                value={roomCode}
                maxLength={6}
                onChange={(event) => {
                  setRoomCode(event.target.value.toUpperCase());
                  setFormError(null);
                }}
                placeholder="APT001"
                className="min-h-12 w-full rounded-xl border border-meeting-line bg-meeting-canvas px-4 font-mono uppercase tracking-[0.16em] outline-none focus:border-meeting-accent focus:ring-2 focus:ring-meeting-accent/15"
              />
            )}
          </label>

          <label className="block">
            <span className="mb-2 flex items-center justify-between gap-3 text-sm font-semibold text-meeting-ink">
              Language you will speak
              {mode === 'join' && existingParticipant && (
                <span className="flex items-center gap-1 text-xs font-medium text-meeting-muted">
                  <Lock aria-hidden="true" size={13} /> Paired automatically
                </span>
              )}
            </span>
            <select
              aria-label="Language you will speak"
              value={sourceLanguage}
              onChange={(event) => setSourceLanguage(event.target.value as LanguageCode)}
              disabled={mode === 'join' && existingParticipant !== undefined}
              className="min-h-12 w-full rounded-xl border border-meeting-line bg-meeting-canvas px-4 outline-none focus:border-meeting-accent focus:ring-2 focus:ring-meeting-accent/15 disabled:cursor-not-allowed disabled:text-meeting-muted"
            >
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>

        {(formError ?? errorMessage) && (
          <div
            role="alert"
            className="mt-5 rounded-xl border border-meeting-danger/30 bg-meeting-danger/5 px-4 py-3 text-sm font-medium text-meeting-danger"
          >
            {formError ?? errorMessage}
          </div>
        )}

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl border border-meeting-line px-5 font-semibold text-meeting-ink transition hover:bg-meeting-canvas"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting || (mode === 'create' && emptyRooms.length === 0)}
            onClick={submit}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-meeting-accent px-5 font-semibold text-white transition hover:bg-meeting-accentStrong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Working…' : mode === 'create' ? 'Create room' : 'Join room'}
            <ArrowRight aria-hidden="true" size={18} />
          </button>
        </div>
      </section>
    </div>
  );
}
