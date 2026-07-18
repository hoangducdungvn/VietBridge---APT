import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomsStore } from '@application/store/useRoomsStore';
import { useSessionStore } from '@application/store/useSessionStore';
import type { ParticipantSession, SessionState } from '@domain/entities/BackendSession';
import type { RealtimeSttResult } from '@infrastructure/websocket/SessionSocketClient';
import App from '../../src/App';

interface TestSocketHandlers {
  onSttResult: (result: RealtimeSttResult) => void;
}

const socketHarness = vi.hoisted(() => ({
  handlers: undefined as TestSocketHandlers | undefined
}));

vi.mock('@infrastructure/websocket/SessionSocketClient', () => ({
  SessionSocketClient: class {
    connect(_session: unknown, handlers: TestSocketHandlers) {
      socketHarness.handlers = handlers;
    }
    disconnect() {}
  }
}));

const hostSession: ParticipantSession = {
  accessToken: 'host-token',
  participantId: 'participant-host',
  role: 'host',
  roomCode: 'APT001',
  sessionId: 'session_12345678',
  sourceLanguage: 'vi',
  targetLanguage: 'en'
};

const waitingState: SessionState = {
  createdAt: 1,
  participants: [
    {
      connectionStatus: 'online',
      displayName: 'Duong',
      participantId: 'participant-host',
      role: 'host',
      sourceLanguage: 'vi',
      targetLanguage: 'en'
    }
  ],
  roomCode: 'APT001',
  sessionId: 'session_12345678',
  status: 'waiting'
};

const emptyLobby = Array.from({ length: 5 }, (_, index) => ({
  occupancy: 0,
  participants: [],
  roomCode: `APT00${index + 1}`,
  roomName: `Room ${index + 1}`,
  status: 'empty'
}));

const waitingLobby = [
  {
    occupancy: 1,
    participants: [
      {
        connectionStatus: 'online',
        participantId: 'participant-host',
        sourceLanguage: 'vi'
      }
    ],
    roomCode: 'APT001',
    roomName: 'Room 1',
    status: 'waiting'
  },
  ...emptyLobby.slice(1)
];

describe('backend-backed five-room lobby', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    sessionStorage.clear();
    useSessionStore.setState({ activeSession: null, serverState: null });
    useRoomsStore.getState().resetRooms();
    socketHarness.handlers = undefined;
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(emptyLobby));
  });

  it('always shows five room cards and opens both Zoom-like actions', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Choose a room' })).toBeInTheDocument();
    expect(screen.getByText('Room 1')).toBeInTheDocument();
    expect(screen.getByText('Room 5')).toBeInTheDocument();
    expect(screen.getAllByText('Available — create room')).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Choose an empty slot');
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));

    fireEvent.click(screen.getByRole('button', { name: 'Join with code' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Enter the shared room code');
  });

  it('opens an invite room and pairs the opposite language from the host', async () => {
    window.history.replaceState({}, '', '/?room=APT001&language=en');
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(waitingLobby));

    render(<App />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Room code')).toHaveValue('APT001');
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Language you will speak')).toBeDisabled()
    );
    expect(within(dialog).getByLabelText('Language you will speak')).toHaveValue('en');
  });

  it('explains that display name is required instead of silently disabling join', () => {
    window.history.replaceState({}, '', '/?room=APT001&language=en');
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(waitingLobby));

    render(<App />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Join room' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Enter your display name to continue.'
    );
    expect(within(dialog).getByPlaceholderText('e.g. Duong')).toHaveFocus();
  });

  it('creates the selected backend room and persists the participant session', async () => {
    const fetchMock = vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/api/sessions') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              accessToken: hostSession.accessToken,
              participantId: hostSession.participantId,
              roomCode: hostSession.roomCode,
              sessionId: hostSession.sessionId,
              status: 'waiting'
            },
            201
          )
        );
      }
      if (url.endsWith('/api/sessions/APT001')) {
        return Promise.resolve(jsonResponse(waitingState));
      }
      return Promise.resolve(jsonResponse(emptyLobby));
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Room 1, Available — create room' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Duong'), {
      target: { value: 'Duong' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create room' }));

    expect(await screen.findByRole('heading', { name: 'APT001' })).toBeInTheDocument();
    expect(await screen.findByText('1 of 2 participants in backend state')).toBeInTheDocument();
    expect(useSessionStore.getState().activeSession).toEqual(hostSession);
    expect(sessionStorage.getItem('vietbridge-active-session')).toContain('host-token');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/sessions$/),
      expect.objectContaining({
        body: expect.stringContaining('"roomCode":"APT001"'),
        method: 'POST'
      })
    );
  });

  it('shows LANGUAGE_PAIR_CONFLICT returned by the backend', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/api/sessions/APT001/join') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              code: 'LANGUAGE_PAIR_CONFLICT',
              message: 'The guest must use the opposite source language from the host.',
              statusCode: 409
            },
            409
          )
        );
      }
      return Promise.resolve(jsonResponse(waitingLobby));
    });

    render(<App />);
    await screen.findByText('Waiting for second participant');
    fireEvent.click(screen.getByRole('button', { name: 'Room 1, Waiting for second participant' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Duong'), {
      target: { value: 'Minh' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Join room' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('LANGUAGE_PAIR_CONFLICT');
    expect(useSessionStore.getState().activeSession).toBeNull();
  });

  it('restores a persisted session and refreshes backend state', async () => {
    const activeState: SessionState = {
      ...waitingState,
      participants: [
        waitingState.participants[0],
        {
          connectionStatus: 'online',
          displayName: 'Alex',
          participantId: 'participant-guest',
          role: 'guest',
          sourceLanguage: 'en',
          targetLanguage: 'vi'
        }
      ],
      startedAt: 2,
      status: 'active'
    };
    useSessionStore.setState({ activeSession: hostSession, serverState: waitingState });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse(activeState));

    render(<App />);

    await waitFor(() => expect(screen.getByText('Vietnamese-English meeting')).toBeInTheDocument());
    expect(useSessionStore.getState().serverState?.status).toBe('active');
  });

  it('clears the visible transcript immediately when the meeting ends', async () => {
    const activeState: SessionState = {
      ...waitingState,
      participants: [
        waitingState.participants[0],
        {
          connectionStatus: 'online',
          displayName: 'Alex',
          participantId: 'participant-guest',
          role: 'guest',
          sourceLanguage: 'en',
          targetLanguage: 'vi'
        }
      ],
      startedAt: 2,
      status: 'active'
    };
    useSessionStore.setState({ activeSession: hostSession, serverState: activeState });
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith(`/api/sessions/${hostSession.sessionId}/end`) && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({ sessionId: hostSession.sessionId, status: 'closed' })
        );
      }
      if (url.endsWith('/api/sessions/APT001')) {
        return Promise.resolve(jsonResponse(activeState));
      }
      return Promise.resolve(jsonResponse(emptyLobby));
    });

    render(<App />);
    await screen.findByText('Vietnamese-English meeting');
    await waitFor(() => expect(socketHarness.handlers).toBeDefined());
    act(() => {
      socketHarness.handlers?.onSttResult({
        backend: 'fpt',
        language: 'vi',
        participantId: hostSession.participantId,
        providerLatencyMs: 120,
        receivedAt: Date.now(),
        text: 'Đây là lịch sử cuộc họp cũ',
        turnId: 'turn-old',
        type: 'final'
      });
    });
    expect(screen.getByText('Đây là lịch sử cuộc họp cũ')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'End Meeting' }));
    fireEvent.click(screen.getByRole('button', { name: 'End now' }));

    expect(await screen.findByRole('heading', { name: 'Choose a room' })).toBeInTheDocument();
    expect(screen.queryByText('Đây là lịch sử cuộc họp cũ')).not.toBeInTheDocument();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status
  });
}
