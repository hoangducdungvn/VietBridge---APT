export const LOBBY_ROOMS = [
  { roomCode: 'APT001', roomName: 'Room 1' },
  { roomCode: 'APT002', roomName: 'Room 2' },
  { roomCode: 'APT003', roomName: 'Room 3' },
  { roomCode: 'APT004', roomName: 'Room 4' },
  { roomCode: 'APT005', roomName: 'Room 5' },
] as const;

export function isLobbyRoomCode(roomCode: string): boolean {
  return LOBBY_ROOMS.some((room) => room.roomCode === roomCode);
}
