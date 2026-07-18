import { useEffect, useState } from 'react';
import { ArrowClockwise, Plus, SignIn, Translate } from '@phosphor-icons/react';
import type { LanguageCode, SessionCredentialsInput } from '@domain/entities/BackendSession';
import type { Room } from '@domain/entities/Room';
import { RoomCard } from '@presentation/components/RoomCard';
import { RoomActionModal, type RoomActionMode } from './RoomActionModal';

interface RoomsLobbyScreenProps {
  errorMessage: string | null;
  initialRoomCode: string;
  initialSourceLanguage: LanguageCode;
  isLoadingRooms: boolean;
  isSubmitting: boolean;
  rooms: Room[];
  onCreateRoom: (input: SessionCredentialsInput, roomCode: string) => void;
  onJoinRoom: (roomCode: string, input: SessionCredentialsInput) => void;
  onRefreshRooms: () => void;
}

interface ModalState {
  mode: RoomActionMode;
  roomCode?: string;
}

export function RoomsLobbyScreen({
  errorMessage,
  initialRoomCode,
  initialSourceLanguage,
  isLoadingRooms,
  isSubmitting,
  rooms,
  onCreateRoom,
  onJoinRoom,
  onRefreshRooms
}: RoomsLobbyScreenProps) {
  const [modal, setModal] = useState<ModalState | null>(() =>
    initialRoomCode ? { mode: 'join', roomCode: initialRoomCode } : null
  );

  useEffect(() => {
    if (initialRoomCode) setModal({ mode: 'join', roomCode: initialRoomCode });
  }, [initialRoomCode]);

  const selectRoom = (roomId: string) => {
    const room = rooms.find((candidate) => candidate.roomId === roomId);
    const occupancy = room?.participants.filter(Boolean).length ?? 0;
    setModal({ mode: occupancy === 0 ? 'create' : 'join', roomCode: roomId });
  };

  const occupiedRooms = rooms.filter((room) => room.participants.some(Boolean)).length;

  return (
    <main className="min-h-[100dvh] bg-meeting-canvas px-5 py-8 text-meeting-ink sm:px-8 sm:py-10">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-5">
        <div className="flex items-center gap-3" aria-label="VietBridge">
          <span className="grid size-10 place-items-center rounded-xl bg-meeting-accent text-white shadow-[0_8px_20px_rgb(30_58_95/0.14)]">
            <Translate aria-hidden="true" size={22} weight="bold" />
          </span>
          <span className="text-xl font-bold">VietBridge</span>
        </div>
        <span className="hidden rounded-full border border-meeting-line bg-white px-4 py-2 text-sm font-medium text-meeting-muted sm:block">
          Vietnamese ↔ English
        </span>
      </header>

      <section className="mx-auto mt-12 w-full max-w-6xl sm:mt-16" aria-labelledby="lobby-title">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-meeting-accent">
              General lobby
            </p>
            <h1 id="lobby-title" className="mt-2 text-4xl font-semibold sm:text-5xl">
              Choose a room
            </h1>
            <p className="mt-3 max-w-xl leading-7 text-meeting-muted">
              Five shared rooms, two speakers each. Dark seats are occupied; pale seats are
              available.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setModal({ mode: 'join' })}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-meeting-line bg-white px-4 font-semibold transition hover:border-meeting-accent/40 hover:bg-meeting-canvas"
            >
              <SignIn aria-hidden="true" size={19} /> Join with code
            </button>
            <button
              type="button"
              onClick={() => setModal({ mode: 'create' })}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-meeting-accent px-4 font-semibold text-white transition hover:bg-meeting-accentStrong"
            >
              <Plus aria-hidden="true" size={19} weight="bold" /> Create room
            </button>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between border-b border-meeting-line pb-4 text-sm text-meeting-muted">
          <span>{occupiedRooms} of 5 rooms occupied</span>
          <button
            type="button"
            onClick={onRefreshRooms}
            disabled={isLoadingRooms}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 font-semibold transition hover:bg-white hover:text-meeting-ink disabled:opacity-50"
          >
            <ArrowClockwise
              aria-hidden="true"
              size={16}
              className={isLoadingRooms ? 'animate-spin' : undefined}
            />
            Refresh
          </button>
        </div>

        {errorMessage && modal === null && (
          <div
            role="alert"
            className="mt-5 rounded-xl border border-meeting-danger/30 bg-meeting-danger/5 px-4 py-3 text-sm font-medium text-meeting-danger"
          >
            {errorMessage}
          </div>
        )}

        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room) => (
            <RoomCard
              key={room.roomId}
              roomId={room.roomId}
              roomName={room.roomName}
              participants={room.participants}
              onSelect={selectRoom}
            />
          ))}
        </div>
      </section>

      {modal && (
        <RoomActionModal
          key={`${modal.mode}-${modal.roomCode ?? 'manual'}`}
          errorMessage={errorMessage}
          initialLanguage={initialSourceLanguage}
          initialRoomCode={modal.roomCode}
          isSubmitting={isSubmitting}
          mode={modal.mode}
          rooms={rooms}
          onClose={() => setModal(null)}
          onCreate={onCreateRoom}
          onJoin={onJoinRoom}
        />
      )}
    </main>
  );
}
