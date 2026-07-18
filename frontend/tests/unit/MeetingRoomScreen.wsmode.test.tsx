import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParticipantSession } from '@domain/entities/BackendSession';
import { MeetingRoomScreen } from '@presentation/views/MeetingRoomScreen';

// ws transport mode: pipeline talks straight to the mock gateway; no room
// socket involved. Results/translations arrive via VoicePipeline callbacks.
vi.mock('@infrastructure/config/env', () => ({
  env: {
    backendApiUrl: 'http://localhost:3000',
    backendWsUrl: 'http://localhost:3000',
    transport: 'ws',
    mockGatewayUrl: 'ws://localhost:8081',
    publicAppUrl: 'http://localhost:5173',
    supportedLanguages: ['vi', 'en']
  }
}));

interface CapturedPipeline {
  config: Record<string, unknown>;
  events: Record<string, (payload: never) => void>;
}

const voiceMocks = vi.hoisted(() => ({
  start: vi.fn<() => Promise<void>>(),
  stop: vi.fn<() => Promise<void>>(),
  captured: { current: undefined as CapturedPipeline | undefined }
}));

vi.mock('vietbridge-voice', () => ({
  SocketIoVoiceTransport: class {},
  VoicePipeline: class {
    constructor(config: Record<string, unknown>, events: Record<string, (payload: never) => void>) {
      voiceMocks.captured.current = { config, events };
    }

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

describe('MeetingRoomScreen in ws transport mode', () => {
  beforeEach(() => {
    voiceMocks.start.mockReset().mockResolvedValue(undefined);
    voiceMocks.stop.mockReset().mockResolvedValue(undefined);
    voiceMocks.captured.current = undefined;
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn()
    });
  });

  it('starts the microphone without waiting for a room socket', async () => {
    renderMeeting();

    await waitFor(() => expect(voiceMocks.start).toHaveBeenCalledTimes(1));
    const config = voiceMocks.captured.current?.config;
    expect(config?.gatewayUrl).toBe('ws://localhost:8081');
    expect(config?.transportFactory).toBeUndefined();
    expect(config?.sessionId).toBe(activeSession.sessionId);
  });

  it('renders finals in the source pane and translations in the target pane', async () => {
    renderMeeting();
    await waitFor(() => expect(voiceMocks.start).toHaveBeenCalledTimes(1));
    const events = voiceMocks.captured.current?.events as {
      onSttResult: (res: unknown) => void;
      onTranslationResult: (res: unknown) => void;
    };

    act(() => {
      events.onSttResult({
        type: 'final',
        text: 'Xin chào mọi người',
        language: 'vi',
        backend: 'fpt_final',
        latencyMs: 250,
        utteranceId: 'utt-1',
        speakerId: 'participant-host'
      });
      events.onTranslationResult({
        utteranceId: 'utt-1',
        sourceText: 'Xin chào mọi người',
        translatedText: 'Hello everyone',
        sourceLang: 'vi',
        targetLang: 'en',
        model: 'Llama-3.3-70B-Instruct',
        latencyMs: 900,
        speakerId: 'participant-host'
      });
    });

    const viPane = screen.getByRole('region', { name: 'Vietnamese transcript' });
    const enPane = screen.getByRole('region', { name: 'English transcript' });
    expect(viPane).toHaveTextContent('Xin chào mọi người');
    expect(enPane).toHaveTextContent('Hello everyone');
    expect(enPane).toHaveTextContent('Translated');
    expect(viPane).not.toHaveTextContent('Hello everyone');
  });

  it('clears the stuck live partial when the STT backend errors mid-utterance', async () => {
    renderMeeting();
    await waitFor(() => expect(voiceMocks.start).toHaveBeenCalledTimes(1));
    const events = voiceMocks.captured.current?.events as {
      onSttResult: (res: unknown) => void;
      onSttError: (evt: unknown) => void;
    };

    act(() => {
      events.onSttResult({
        type: 'partial',
        text: 'đang nói dở câu',
        language: 'vi',
        backend: 'fpt',
        latencyMs: 200,
        utteranceId: 'utt-2',
        speakerId: 'participant-host'
      });
    });
    expect(screen.getByText('đang nói dở câu')).toBeInTheDocument();

    act(() => {
      events.onSttError({ utteranceId: 'utt-2', message: 'stt down' });
    });
    expect(screen.queryByText('đang nói dở câu')).not.toBeInTheDocument();
  });
});

function renderMeeting() {
  return render(
    <MeetingRoomScreen
      activeSession={activeSession}
      realtimeStatus="connecting"
      roomName="Room APT001"
      localLanguage="vi"
      otherLanguage="en"
      sttResults={[]}
      onEndMeeting={vi.fn()}
    />
  );
}
