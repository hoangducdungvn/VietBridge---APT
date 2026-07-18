import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { useSessionStore } from '@application/store/useSessionStore';
import { useRoomsStore } from '@application/store/useRoomsStore';
import type { SessionCredentialsInput, SessionState } from '@domain/entities/BackendSession';
import { SessionApiClient, SessionApiError } from '@infrastructure/http/SessionApiClient';
import {
  SessionSocketClient,
  type RealtimeMessageFinal,
  type RealtimeSttResult
} from '@infrastructure/websocket/SessionSocketClient';
import { MeetingRoomScreen } from '@presentation/views/MeetingRoomScreen';
import { RoomsLobbyScreen } from '@presentation/views/RoomsLobbyScreen';
import { RoomWaitingScreen } from '@presentation/views/RoomWaitingScreen';

type AppScreen = 'lobby' | 'waiting' | 'meeting';
type RealtimeStatus = 'connecting' | 'connected' | 'reconnecting' | 'error';

export default function App() {
  const activeSession = useSessionStore((state) => state.activeSession);
  const serverState = useSessionStore((state) => state.serverState);
  const setActiveSession = useSessionStore((state) => state.setActiveSession);
  const setServerState = useSessionStore((state) => state.setServerState);
  const clearSession = useSessionStore((state) => state.clearSession);
  const rooms = useRoomsStore((state) => state.rooms);
  const setRooms = useRoomsStore((state) => state.setRooms);
  const api = useMemo(() => new SessionApiClient(), []);
  const socketClient = useMemo(() => new SessionSocketClient(), []);
  const [screen, setScreen] = useState<AppScreen>(() =>
    activeSession === null ? 'lobby' : serverState?.status === 'active' ? 'meeting' : 'waiting'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [roomSocket, setRoomSocket] = useState<Socket>();
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const [realtimeError, setRealtimeError] = useState<string>();
  const [sttResults, setSttResults] = useState<RealtimeSttResult[]>([]);
  const [messages, setMessages] = useState<RealtimeMessageFinal[]>([]);
  const initialRoomCode =
    new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '';
  const inviteLanguage = readInviteLanguage(
    new URLSearchParams(window.location.search).get('language')
  );

  const refreshLobbyRooms = useCallback(async () => {
    setIsLoadingRooms(true);
    try {
      setRooms(await api.getLobbyRooms());
    } catch (error: unknown) {
      setErrorMessage(formatError(error));
    } finally {
      setIsLoadingRooms(false);
    }
  }, [api, setRooms]);

  useEffect(() => {
    if (screen !== 'lobby' || activeSession !== null) return;
    void refreshLobbyRooms();
    const intervalId = window.setInterval(() => void refreshLobbyRooms(), 3_000);
    return () => window.clearInterval(intervalId);
  }, [activeSession, refreshLobbyRooms, screen]);

  const applyServerState = useCallback(
    (state: SessionState) => {
      setServerState(state);
      if (state.status === 'closed') {
        setSttResults([]);
        setMessages([]);
        clearSession();
        setScreen('lobby');
        return;
      }
      setScreen(
        state.status === 'active' && state.participants.length === 2 ? 'meeting' : 'waiting'
      );
    },
    [clearSession, setServerState]
  );

  useEffect(() => {
    if (activeSession === null) {
      socketClient.disconnect();
      setRoomSocket(undefined);
      setRealtimeError(undefined);
      setRealtimeStatus('connecting');
      return;
    }

    let cancelled = false;
    const refreshSession = async () => {
      try {
        const state = await api.getSession(activeSession.roomCode);
        if (!cancelled) applyServerState(state);
      } catch (error: unknown) {
        if (!cancelled) setErrorMessage(formatError(error));
      }
    };

    void refreshSession();
    setRealtimeError(undefined);
    setRealtimeStatus('connecting');
    socketClient.connect(activeSession, {
      onConnectionChange: (connected, socket) => {
        setRoomSocket(connected ? socket : undefined);
        setRealtimeStatus((current) =>
          connected ? 'connected' : current === 'connected' ? 'reconnecting' : 'connecting'
        );
        if (connected) setRealtimeError(undefined);
      },
      onError: (message) => {
        setRealtimeError(message);
        setRealtimeStatus('error');
      },
      onSessionState: () => void refreshSession(),
      onMessageFinal: (message) => {
        setMessages((current) =>
          [...current.filter((item) => item.turnId !== message.turnId), message]
            .sort((left, right) => left.sequence - right.sequence)
            .slice(-30)
        );
      },
      onSttResult: (result) => {
        setSttResults((current) => {
          const withoutSamePartial = current.filter(
            (item) => !(item.turnId === result.turnId && item.type === 'partial')
          );
          return [...withoutSamePartial, result].slice(-30);
        });
      }
    });

    return () => {
      cancelled = true;
      setRoomSocket(undefined);
      socketClient.disconnect();
    };
  }, [activeSession, api, applyServerState, socketClient]);

  const createRoom = async (input: SessionCredentialsInput, roomCode: string) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const session = await api.createSession(input, roomCode);
      setSttResults([]);
      setMessages([]);
      setActiveSession(session);
      setScreen('waiting');
    } catch (error: unknown) {
      setErrorMessage(formatError(error));
      await refreshLobbyRooms();
    } finally {
      setIsSubmitting(false);
    }
  };

  const joinRoom = async (roomCode: string, input: SessionCredentialsInput) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const session = await api.joinSession(roomCode, input);
      setSttResults([]);
      setMessages([]);
      setActiveSession(session);
      setScreen('meeting');
    } catch (error: unknown) {
      setErrorMessage(formatError(error));
      await refreshLobbyRooms();
    } finally {
      setIsSubmitting(false);
    }
  };

  const leaveLocally = () => {
    setSttResults([]);
    setMessages([]);
    clearSession();
    setErrorMessage(null);
    setScreen('lobby');
  };

  const endMeeting = async () => {
    if (activeSession === null) return;
    setSttResults([]);
    setMessages([]);
    try {
      await api.endSession(activeSession.sessionId);
    } catch (error: unknown) {
      setErrorMessage(formatError(error));
    } finally {
      clearSession();
      setScreen('lobby');
    }
  };

  const localLanguage = activeSession?.sourceLanguage;
  const otherLanguage =
    serverState?.participants.find(
      (participant) => participant.participantId !== activeSession?.participantId
    )?.sourceLanguage ?? activeSession?.targetLanguage;

  return (
    <div key={screen} className="animate-screen-enter">
      {screen === 'lobby' && (
        <RoomsLobbyScreen
          errorMessage={errorMessage}
          initialRoomCode={initialRoomCode}
          initialSourceLanguage={inviteLanguage}
          isLoadingRooms={isLoadingRooms}
          isSubmitting={isSubmitting}
          rooms={rooms}
          onCreateRoom={(input, roomCode) => void createRoom(input, roomCode)}
          onJoinRoom={(roomCode, input) => void joinRoom(roomCode, input)}
          onRefreshRooms={() => void refreshLobbyRooms()}
        />
      )}

      {screen === 'waiting' && activeSession && (
        <RoomWaitingScreen
          guestLanguage={activeSession.targetLanguage}
          roomCode={activeSession.roomCode}
          participants={serverState?.participants ?? []}
          onLeaveRoom={leaveLocally}
        />
      )}

      {screen === 'meeting' && activeSession && localLanguage && otherLanguage && (
        <MeetingRoomScreen
          activeSession={activeSession}
          realtimeError={realtimeError}
          realtimeStatus={realtimeStatus}
          roomSocket={roomSocket}
          roomName={`Room ${activeSession.roomCode}`}
          localLanguage={localLanguage}
          messages={messages}
          otherLanguage={otherLanguage}
          sttResults={sttResults}
          onEndMeeting={() => void endMeeting()}
        />
      )}
    </div>
  );
}

function formatError(error: unknown): string {
  if (error instanceof SessionApiError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : 'Unexpected application error.';
}

function readInviteLanguage(value: string | null): 'vi' | 'en' {
  return value === 'en' ? 'en' : 'vi';
}
