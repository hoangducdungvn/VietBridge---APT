export type RoomLanguage = 'en' | 'vi';

export interface Participant {
  connectionStatus: 'online' | 'offline';
  id: string;
  language: RoomLanguage;
}

export type RoomParticipants = [Participant | null, Participant | null];

export interface Room {
  roomId: string;
  roomName: string;
  participants: RoomParticipants;
}
