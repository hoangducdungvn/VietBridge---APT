import { User } from '@phosphor-icons/react';
import type { RoomParticipants } from '@domain/entities/Room';

interface RoomCardProps {
  roomId: string;
  roomName: string;
  participants: RoomParticipants;
  onSelect: (roomId: string) => void;
}

const getRoomStatus = (occupancy: number) => {
  if (occupancy === 0) return 'Available — create room';
  if (occupancy === 1) return 'Waiting for second participant';
  return 'Full';
};

// Compact room summary with two visual seats and semantic disabled behavior.
export function RoomCard({ roomId, roomName, participants, onSelect }: RoomCardProps) {
  const occupancy = participants.filter(Boolean).length;
  const isFull = occupancy === participants.length;
  const status = getRoomStatus(occupancy);

  return (
    <button
      type="button"
      disabled={isFull}
      onClick={() => onSelect(roomId)}
      aria-label={isFull ? `${roomName} is full` : `${roomName}, ${status}`}
      className={`group flex min-h-60 w-full flex-col rounded-xl border bg-white p-6 text-left shadow-[0_10px_30px_rgb(30_58_95/0.06)] transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-meeting-accent sm:p-7 ${
        isFull
          ? 'cursor-not-allowed border-meeting-line opacity-50'
          : 'cursor-pointer border-meeting-line hover:-translate-y-0.5 hover:border-meeting-accent/40 hover:shadow-[0_16px_36px_rgb(30_58_95/0.11)] active:translate-y-0 active:scale-[0.99]'
      }`}
    >
      <span className="flex w-full items-start justify-between gap-4">
        <span className="text-lg font-semibold text-meeting-ink">{roomName}</span>
        <span className="text-sm font-semibold tabular-nums text-meeting-muted">{occupancy}/2</span>
      </span>

      <span className="flex flex-1 items-center justify-center gap-5 py-7" aria-hidden="true">
        {participants.map((participant, index) => (
          <span
            key={`${roomId}-seat-${index + 1}`}
            className={`grid size-16 place-items-center rounded-full transition-colors duration-200 ${
              participant
                ? 'bg-meeting-accent text-white shadow-[0_8px_18px_rgb(30_58_95/0.22)]'
                : 'bg-meeting-canvas text-[#cbd3dd]'
            }`}
          >
            <User size={42} weight="regular" />
          </span>
        ))}
      </span>

      <span className="w-full border-t border-meeting-line pt-4">
        <span
          className={`text-sm font-medium ${
            occupancy === 1 ? 'text-meeting-accent' : 'text-meeting-muted'
          }`}
        >
          {status}
        </span>
      </span>
    </button>
  );
}
