import { create } from 'zustand';
import type { Participant, Room } from '@domain/entities/Room';

const createInitialRooms = (): Room[] => [
  { roomId: 'room-1', roomName: 'Room 1', participants: [null, null] },
  {
    roomId: 'room-2',
    roomName: 'Room 2',
    participants: [{ id: 'participant-room-2', language: 'en' }, null]
  },
  {
    roomId: 'room-3',
    roomName: 'Room 3',
    participants: [
      { id: 'participant-room-3-en', language: 'en' },
      { id: 'participant-room-3-vi', language: 'vi' }
    ]
  },
  { roomId: 'room-4', roomName: 'Room 4', participants: [null, null] },
  { roomId: 'room-5', roomName: 'Room 5', participants: [null, null] }
];

interface RoomsState {
  rooms: Room[];
  joinRoom: (roomId: string, participant: Participant) => boolean;
  leaveRoom: (roomId: string, participantId: string) => void;
  updateRoom: (room: Room) => void;
  resetRooms: () => void;
}

// Local room-state adapter. WebSocket room-updated events can call updateRoom later.
export const useRoomsStore = create<RoomsState>((set) => ({
  rooms: createInitialRooms(),
  joinRoom: (roomId, participant) => {
    let didJoin = false;

    set((state) => ({
      rooms: state.rooms.map((room) => {
        if (room.roomId !== roomId) return room;
        if (room.participants.some((seat) => seat?.id === participant.id)) {
          didJoin = true;
          return room;
        }

        const emptySeatIndex = room.participants.findIndex((seat) => seat === null);
        if (emptySeatIndex === -1) return room;

        const participants = [...room.participants] as Room['participants'];
        participants[emptySeatIndex] = participant;
        didJoin = true;

        return { ...room, participants };
      })
    }));

    return didJoin;
  },
  leaveRoom: (roomId, participantId) =>
    set((state) => ({
      rooms: state.rooms.map((room) =>
        room.roomId === roomId
          ? {
              ...room,
              participants: room.participants.map((seat) =>
                seat?.id === participantId ? null : seat
              ) as Room['participants']
            }
          : room
      )
    })),
  updateRoom: (updatedRoom) =>
    set((state) => ({
      rooms: state.rooms.map((room) => (room.roomId === updatedRoom.roomId ? updatedRoom : room))
    })),
  resetRooms: () => set({ rooms: createInitialRooms() })
}));
