import { Translate } from '@phosphor-icons/react';
import { useRoomsStore } from '@application/store/useRoomsStore';
import { RoomCard } from '@presentation/components/RoomCard';

interface RoomsLobbyScreenProps {
  onJoinRoom: (roomId: string) => void;
}

// Main lobby controller for browsing the five fixed meeting rooms.
export function RoomsLobbyScreen({ onJoinRoom }: RoomsLobbyScreenProps) {
  const rooms = useRoomsStore((state) => state.rooms);

  return (
    <main className="min-h-[100dvh] bg-meeting-canvas px-5 py-8 text-meeting-ink sm:px-8 sm:py-10">
      <header className="mx-auto w-full max-w-6xl">
        <div className="flex items-center gap-3" aria-label="VietBridge">
          <span className="grid size-10 place-items-center rounded-xl bg-meeting-accent text-white shadow-[0_8px_20px_rgb(30_58_95/0.14)]">
            <Translate aria-hidden="true" size={22} weight="bold" />
          </span>
          <span className="text-xl font-bold text-meeting-ink">VietBridge</span>
        </div>
        <p className="mt-3 text-sm font-medium text-meeting-muted">Every voice, understood.</p>
      </header>

      <section className="mx-auto mt-12 w-full max-w-6xl sm:mt-16" aria-labelledby="rooms-heading">
        <div className="max-w-xl">
          <h1 id="rooms-heading" className="text-3xl font-semibold text-meeting-ink sm:text-4xl">
            Available rooms
          </h1>
          <p className="mt-3 text-base leading-7 text-meeting-muted">
            Choose an open room to begin your Vietnamese-English meeting.
          </p>
        </div>

        <div
          className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
          aria-live="polite"
        >
          {rooms.map((room) => (
            <RoomCard key={room.roomId} {...room} onJoin={onJoinRoom} />
          ))}
        </div>
      </section>
    </main>
  );
}
