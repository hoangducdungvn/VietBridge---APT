import { render, screen, waitFor } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParticipantSession } from '@domain/entities/BackendSession';
import type {
  RealtimeMessageFinal,
  RealtimeSttResult
} from '@infrastructure/websocket/SessionSocketClient';
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
const scrollToMock = vi.fn();

describe('MeetingRoomScreen microphone startup', () => {
  beforeEach(() => {
    voiceMocks.start.mockReset().mockResolvedValue(undefined);
    voiceMocks.stop.mockReset().mockResolvedValue(undefined);
    scrollToMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollToMock
    });
  });

  it('starts the microphone automatically after Socket.IO connects', async () => {
    renderMeeting(connectedSocket, 'connected');

    await waitFor(() => expect(voiceMocks.start).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Stop microphone' })).toBeEnabled();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('places the local source transcript on the right and marks it in green', () => {
    renderMeeting(undefined, 'connecting');

    const localPane = screen.getByRole('region', { name: 'Your original transcript' });
    const remotePane = screen.getByRole('region', {
      name: 'Other participant translated transcript'
    });
    expect(localPane).toHaveAttribute('data-local-source', 'true');
    expect(localPane).toHaveClass('ring-meeting-live/55');
    expect(localPane).toHaveTextContent('You');
    expect(localPane).toHaveTextContent('Your original speech');
    expect(remotePane).toHaveAttribute('data-local-source', 'false');
    expect(remotePane).toHaveTextContent('Translated from English');
    expect(remotePane).not.toHaveClass('ring-meeting-live/55');
    expect(remotePane.compareDocumentPosition(localPane)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('gives each transcript an independent scrollbar and follows new final text', () => {
    const firstResult: RealtimeSttResult = {
      backend: 'fpt',
      language: 'vi',
      participantId: activeSession.participantId,
      providerLatencyMs: 100,
      receivedAt: Date.now(),
      text: 'Câu đầu tiên',
      turnId: 'turn-1',
      type: 'final'
    };
    const view = renderMeeting(undefined, 'connecting', [firstResult]);

    const ownHistory = screen.getByLabelText('Your original transcript history');
    const translatedHistory = screen.getByLabelText(
      'Other participant translated transcript history'
    );
    expect(ownHistory).toHaveClass('overflow-y-auto', 'transcript-scrollbar');
    expect(translatedHistory).toHaveClass('overflow-y-auto', 'transcript-scrollbar');
    expect(scrollToMock).toHaveBeenCalledWith({ behavior: 'smooth', top: 0 });

    view.rerender(
      <MeetingRoomScreen
        activeSession={activeSession}
        realtimeStatus="connecting"
        roomName="Room APT001"
        localLanguage="vi"
        messages={[]}
        otherLanguage="en"
        sttResults={[firstResult, { ...firstResult, text: 'Câu mới nhất', turnId: 'turn-2' }]}
        onEndMeeting={vi.fn()}
      />
    );

    expect(screen.getByText('Câu mới nhất')).toBeInTheDocument();
    expect(scrollToMock).toHaveBeenCalledWith({ behavior: 'smooth', top: 0 });
  });

  it('shows only own source text on the right and the other speaker translation on the left', () => {
    const ownResult: RealtimeSttResult = {
      backend: 'fpt',
      language: 'vi',
      participantId: activeSession.participantId,
      providerLatencyMs: 100,
      receivedAt: Date.now(),
      text: 'Tôi đồng ý với kế hoạch.',
      turnId: 'turn-own',
      type: 'final'
    };
    const remoteMessage: RealtimeMessageFinal = {
      createdAt: Date.now(),
      latency: { endToEndMs: 900, sttFinalMs: 500, translationMs: 300 },
      messageId: 'message-remote',
      sequence: 2,
      sourceLanguage: 'en',
      sourceText: 'Let us start tomorrow.',
      speaker: { displayName: 'Alex', participantId: 'participant-guest' },
      targetLanguage: 'vi',
      translatedText: 'Chúng ta hãy bắt đầu vào ngày mai.',
      turnId: 'turn-remote'
    };

    renderMeeting(undefined, 'connecting', [ownResult], [remoteMessage]);

    const ownPane = screen.getByRole('region', { name: 'Your original transcript' });
    const translatedPane = screen.getByRole('region', {
      name: 'Other participant translated transcript'
    });
    expect(ownPane).toHaveTextContent('Tôi đồng ý với kế hoạch.');
    expect(translatedPane).toHaveTextContent('Chúng ta hãy bắt đầu vào ngày mai.');
    expect(screen.queryByText('Let us start tomorrow.')).not.toBeInTheDocument();
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
        messages={[]}
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

function renderMeeting(
  roomSocket: Socket | undefined,
  realtimeStatus: 'connecting' | 'connected',
  sttResults: RealtimeSttResult[] = [],
  messages: RealtimeMessageFinal[] = []
) {
  return render(
    <MeetingRoomScreen
      activeSession={activeSession}
      realtimeStatus={realtimeStatus}
      roomSocket={roomSocket}
      roomName="Room APT001"
      localLanguage="vi"
      messages={messages}
      otherLanguage="en"
      sttResults={sttResults}
      onEndMeeting={vi.fn()}
    />
  );
}
