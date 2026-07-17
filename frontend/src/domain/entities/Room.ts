export type RoomLanguage = 'en' | 'vi';

export interface Participant {
  id: string;
  language: RoomLanguage;
}

export type RoomParticipants = [Participant | null, Participant | null];

export interface Room {
  roomId: string;
  roomName: string;
  participants: RoomParticipants;
}
