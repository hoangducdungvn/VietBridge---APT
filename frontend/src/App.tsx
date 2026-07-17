import { useEffect, useMemo, useState } from 'react';
import { useRoomsStore } from '@application/store/useRoomsStore';
import type { RoomLanguage } from '@domain/entities/Room';
import { LanguageSelectModal } from '@presentation/views/LanguageSelectModal';
import { MeetingRoomScreen } from '@presentation/views/MeetingRoomScreen';
import { RoomsLobbyScreen } from '@presentation/views/RoomsLobbyScreen';
import { RoomWaitingScreen } from '@presentation/views/RoomWaitingScreen';

type AppScreen = 'lobby' | 'language' | 'waiting' | 'meeting';

const LOCAL_PARTICIPANT_ID = 'local-participant';

export default function App() {
  const rooms = useRoomsStore((state) => state.rooms);
  const joinRoom = useRoomsStore((state) => state.joinRoom);
  const leaveRoom = useRoomsStore((state) => state.leaveRoom);
  const [screen, setScreen] = useState<AppScreen>('lobby');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [otherLanguage, setOtherLanguage] = useState<RoomLanguage | null>(null);
  const [localLanguage, setLocalLanguage] = useState<RoomLanguage | null>(null);

  const activeRoom = useMemo(
    () => rooms.find((room) => room.roomId === activeRoomId) ?? null,
    [activeRoomId, rooms]
  );

  useEffect(() => {
    const canEnterMeeting =
      (screen === 'language' || screen === 'waiting') && localLanguage && otherLanguage;
    if (!canEnterMeeting) return;

    const transitionTimeout = window.setTimeout(() => setScreen('meeting'), 360);
    return () => window.clearTimeout(transitionTimeout);
  }, [localLanguage, otherLanguage, screen]);

  const resetActiveRoom = () => {
    setActiveRoomId(null);
    setOtherLanguage(null);
    setLocalLanguage(null);
  };

  const handleOpenRoom = (roomId: string) => {
    const room = rooms.find((candidate) => candidate.roomId === roomId);
    if (!room || room.participants.every(Boolean)) return;

    const existingParticipant = room.participants.find((participant) => participant !== null);
    setActiveRoomId(roomId);
    setOtherLanguage(existingParticipant?.language ?? null);
    setLocalLanguage(null);
    setScreen('language');
  };

  const handleSelectLanguage = (language: RoomLanguage) => {
    if (!activeRoomId || language === otherLanguage) return;

    const didJoin = joinRoom(activeRoomId, {
      id: LOCAL_PARTICIPANT_ID,
      language
    });

    if (!didJoin) {
      resetActiveRoom();
      setScreen('lobby');
      return;
    }

    setLocalLanguage(language);
    if (!otherLanguage) setScreen('waiting');
  };

  const handleSimulateJoin = () => {
    if (!activeRoomId || !localLanguage) return;

    const simulatedLanguage: RoomLanguage = localLanguage === 'en' ? 'vi' : 'en';
    const didJoin = joinRoom(activeRoomId, {
      id: `simulated-participant-${activeRoomId}`,
      language: simulatedLanguage
    });

    if (didJoin) setOtherLanguage(simulatedLanguage);
  };

  const handleCloseLanguageSelect = () => {
    resetActiveRoom();
    setScreen('lobby');
  };

  const handleLeaveWaitingRoom = () => {
    if (activeRoomId) leaveRoom(activeRoomId, LOCAL_PARTICIPANT_ID);
    resetActiveRoom();
    setScreen('lobby');
  };

  const handleEndMeeting = () => {
    if (activeRoomId) leaveRoom(activeRoomId, LOCAL_PARTICIPANT_ID);
    resetActiveRoom();
    setScreen('lobby');
  };

  return (
    <div key={screen} className="animate-screen-enter">
      {screen === 'lobby' && <RoomsLobbyScreen onJoinRoom={handleOpenRoom} />}

      {screen === 'language' && activeRoom && (
        <main className="min-h-[100dvh] bg-meeting-canvas">
          <LanguageSelectModal
            roomName={activeRoom.roomName}
            otherParticipantLanguage={otherLanguage}
            selectedLanguage={localLanguage}
            onSelectLanguage={handleSelectLanguage}
            onClose={handleCloseLanguageSelect}
          />
        </main>
      )}

      {screen === 'waiting' && activeRoom && localLanguage && (
        <RoomWaitingScreen
          roomId={activeRoom.roomId}
          roomName={activeRoom.roomName}
          isParticipantPresent={otherLanguage !== null}
          onSimulateJoin={handleSimulateJoin}
          onLeaveRoom={handleLeaveWaitingRoom}
        />
      )}

      {screen === 'meeting' && activeRoom && localLanguage && otherLanguage && (
        <MeetingRoomScreen
          roomName={activeRoom.roomName}
          localLanguage={localLanguage}
          otherLanguage={otherLanguage}
          onEndMeeting={handleEndMeeting}
        />
      )}
    </div>
  );
}
