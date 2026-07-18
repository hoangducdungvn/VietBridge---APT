import { render, screen, waitFor } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParticipantSession } from '@domain/entities/BackendSession';
import { MeetingRoomScreen } from '@presentation/views/MeetingRoomScreen';

const voiceMocks = vi.hoisted(() => ({
  start: vi.fn<() => Promise<void>>(),
  stop: vi.fn<() => Promise<void>>()
}));

vi.mock('vietbridge-voice', () => ({
  SocketIoVoiceTransport: class {},
  VoicePipeline: class {
    start() {
      return voiceMocks.start();
    }

    stop() {
      return voiceMocks.stop();
    }
  }
}));

const activeSession: ParticipantSession = {
  accessToken: 'not-rendered',
  participantId: 'participant-host',
  role: 'host',
  roomCode: 'APT001',
  sessionId: 'session_12345678',
  sourceLanguage: 'vi',
  targetLanguage: 'en'
};

const connectedSocket = { connected: true } as Socket;

describe('MeetingRoomScreen microphone startup', () => {
  beforeEach(() => {
    voiceMocks.start.mockReset().mockResolvedValue(undefined);
    voiceMocks.stop.mockReset().mockResolvedValue(undefined);
  });

  it('starts the microphone automatically after Socket.IO connects', async () => {
    renderMeeting(connectedSocket, 'connected');

    await waitFor(() => expect(voiceMocks.start).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Stop microphone' })).toBeEnabled();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('waits for Socket.IO instead of failing microphone startup', async () => {
    const view = renderMeeting(undefined, 'connecting');
    expect(voiceMocks.start).not.toHaveBeenCalled();
    expect(screen.getByText('Connecting')).toBeInTheDocument();

    view.rerender(
      <MeetingRoomScreen
        activeSession={activeSession}
        realtimeStatus="connected"
        roomSocket={connectedSocket}
        roomName="Room APT001"
        localLanguage="vi"
        otherLanguage="en"
        sttResults={[]}
        onEndMeeting={vi.fn()}
      />
    );

    await waitFor(() => expect(voiceMocks.start).toHaveBeenCalledTimes(1));
  });

  it('shows an actionable error when automatic microphone activation fails', async () => {
    voiceMocks.start.mockRejectedValueOnce(new Error('Microphone permission denied.'));
    renderMeeting(connectedSocket, 'connected');

    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone permission denied.');
    expect(screen.getByRole('button', { name: 'Start microphone' })).toBeEnabled();
  });
});

function renderMeeting(roomSocket: Socket | undefined, realtimeStatus: 'connecting' | 'connected') {
  return render(
    <MeetingRoomScreen
      activeSession={activeSession}
      realtimeStatus={realtimeStatus}
      roomSocket={roomSocket}
      roomName="Room APT001"
      localLanguage="vi"
      otherLanguage="en"
      sttResults={[]}
      onEndMeeting={vi.fn()}
    />
  );
}
