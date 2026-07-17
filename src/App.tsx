import { useEffect, useState } from 'react';
import { LandingScreen } from '@presentation/views/LandingScreen';
import { LanguageSelectModal } from '@presentation/views/LanguageSelectModal';
import { MeetingRoomScreen } from '@presentation/views/MeetingRoomScreen';
import { RoomWaitingScreen } from '@presentation/views/RoomWaitingScreen';
import type { LanguageCode } from '@shared/types';

type AppScreen = 'landing' | 'waiting' | 'meeting';

const createRoomCode = () =>
  Array.from(
    { length: 6 },
    () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
  ).join('');

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('landing');
  const [roomCode, setRoomCode] = useState('');
  const [isParticipantPresent, setParticipantPresent] = useState(false);
  const [otherLanguage, setOtherLanguage] = useState<LanguageCode | null>(null);
  const [localLanguage, setLocalLanguage] = useState<LanguageCode | null>(null);

  useEffect(() => {
    if (screen !== 'waiting' || !localLanguage || !otherLanguage) return;
    const transitionTimeout = window.setTimeout(() => setScreen('meeting'), 360);
    return () => window.clearTimeout(transitionTimeout);
  }, [localLanguage, otherLanguage, screen]);

  const handleCreateRoom = () => {
    setRoomCode(createRoomCode());
    setScreen('waiting');
  };

  const handleSimulateJoin = () => {
    setParticipantPresent(true);
    setOtherLanguage('en');
  };

  const handleSelectLanguage = (language: LanguageCode) => {
    setLocalLanguage(language);
  };

  const handleEndMeeting = () => {
    setScreen('landing');
    setRoomCode('');
    setParticipantPresent(false);
    setOtherLanguage(null);
    setLocalLanguage(null);
  };

  return (
    <div key={screen} className="animate-screen-enter">
      {screen === 'landing' && <LandingScreen onCreateRoom={handleCreateRoom} />}
      {screen === 'waiting' && (
        <>
          <RoomWaitingScreen
            roomCode={roomCode}
            isParticipantPresent={isParticipantPresent}
            onSimulateJoin={handleSimulateJoin}
          />
          {isParticipantPresent && otherLanguage && (
            <LanguageSelectModal
              otherParticipantLanguage={otherLanguage}
              selectedLanguage={localLanguage}
              onSelectLanguage={handleSelectLanguage}
            />
          )}
        </>
      )}
      {screen === 'meeting' && localLanguage && otherLanguage && (
        <MeetingRoomScreen
          roomCode={roomCode}
          localLanguage={localLanguage}
          otherLanguage={otherLanguage}
          onEndMeeting={handleEndMeeting}
        />
      )}
    </div>
  );
}
