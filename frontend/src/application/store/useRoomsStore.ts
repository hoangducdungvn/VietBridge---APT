import { create } from 'zustand';
import type { Room } from '@domain/entities/Room';

const createInitialRooms = (): Room[] => [
  { roomId: 'APT001', roomName: 'Room 1', participants: [null, null] },
  { roomId: 'APT002', roomName: 'Room 2', participants: [null, null] },
  { roomId: 'APT003', roomName: 'Room 3', participants: [null, null] },
  { roomId: 'APT004', roomName: 'Room 4', participants: [null, null] },
  { roomId: 'APT005', roomName: 'Room 5', participants: [null, null] }
];

interface RoomsState {
  rooms: Room[];
  setRooms: (rooms: Room[]) => void;
  resetRooms: () => void;
}

// The five empty slots render immediately; backend snapshots replace their occupancy.
export const useRoomsStore = create<RoomsState>((set) => ({
  rooms: createInitialRooms(),
  setRooms: (rooms) => set({ rooms }),
  resetRooms: () => set({ rooms: createInitialRooms() })
}));
