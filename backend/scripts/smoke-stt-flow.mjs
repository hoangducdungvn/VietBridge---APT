import { readFile } from 'node:fs/promises';
import { io } from 'socket.io-client';

const backendUrl = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';

await waitForHealth();
const host = await post('/api/sessions', {
  displayName: 'STT Smoke Host',
  sourceLanguage: 'vi',
});
const guest = await post(`/api/sessions/${host.roomCode}/join`, {
  displayName: 'STT Smoke Guest',
  sourceLanguage: 'en',
});

const hostSocket = createSocket(host.accessToken);
const guestSocket = createSocket(guest.accessToken);

try {
  await Promise.all([once(hostSocket, 'connect'), once(guestSocket, 'connect')]);
  const acceptedPromise = once(guestSocket, 'turn.accepted');
  guestSocket.emit('turn.start', {
    eventId: `smoke-start-${Date.now()}`,
    participantId: guest.participantId,
    payload: {
      audioConfig: {
        channels: 1,
        codec: 'pcm_s16le',
        sampleRate: 16_000,
      },
    },
    sessionId: guest.sessionId,
    type: 'turn.start',
  });
  const accepted = await acceptedPromise;
  const turnId = requireString(accepted, 'turnId');
  const wav = await readFile(new URL('../../stt/tests/sample_en.wav', import.meta.url));
  const pcm = readWavData(wav);

  let sequence = 0;
  for (let offset = 0; offset < pcm.length; offset += 32_000) {
    guestSocket.emit('audio.chunk', {
      audio: pcm.subarray(offset, Math.min(offset + 32_000, pcm.length)),
      participantId: guest.participantId,
      sequence,
      sessionId: guest.sessionId,
      turnId,
    });
    sequence += 1;
  }

  const hostFinalPromise = once(hostSocket, 'stt.final', 20_000);
  const guestFinalPromise = once(guestSocket, 'stt.final', 20_000);
  guestSocket.emit('turn.end', {
    eventId: `smoke-end-${Date.now()}`,
    participantId: guest.participantId,
    payload: {},
    sessionId: guest.sessionId,
    turnId,
    type: 'turn.end',
  });
  const [hostFinal, guestFinal] = await Promise.all([
    hostFinalPromise,
    guestFinalPromise,
  ]);
  const hostPayload = requireRecord(hostFinal, 'payload');
  const guestPayload = requireRecord(guestFinal, 'payload');
  if (
    hostPayload.text !== guestPayload.text ||
    typeof hostPayload.text !== 'string' ||
    hostPayload.text.length === 0
  ) {
    throw new Error('Clients did not receive the same non-empty final transcript.');
  }
  console.log(
    JSON.stringify(
      {
        backend: hostPayload.backend,
        broadcastToBothClients: true,
        language: hostPayload.language,
        providerLatencyMs: hostPayload.providerLatencyMs,
        text: hostPayload.text,
      },
      null,
      2,
    ),
  );
} finally {
  hostSocket.disconnect();
  guestSocket.disconnect();
  await fetch(`${backendUrl}/api/sessions/${host.sessionId}/end`, {
    method: 'POST',
  });
}

function createSocket(accessToken) {
  return io(backendUrl, {
    auth: { accessToken },
    forceNew: true,
    transports: ['websocket'],
  });
}

async function post(path, body) {
  const response = await fetch(`${backendUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(result)}`);
  }
  return result;
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`${backendUrl}/health`);
      if (response.ok) return;
    } catch {
      // Retry while the local backend starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Backend is not healthy at ${backendUrl}.`);
}

function once(socket, event, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}.`)),
      timeoutMs,
    );
    const onPipelineError = (value) => {
      clearTimeout(timeout);
      reject(new Error(`pipeline.error: ${JSON.stringify(value)}`));
    };
    socket.once('pipeline.error', onPipelineError);
    socket.once(event, (value) => {
      clearTimeout(timeout);
      socket.off('pipeline.error', onPipelineError);
      resolve(value);
    });
  });
}

function readWavData(wav) {
  const marker = Buffer.from('data');
  const dataOffset = wav.indexOf(marker);
  if (dataOffset < 0 || dataOffset + 8 > wav.length) {
    throw new Error('WAV data chunk was not found.');
  }
  const dataLength = wav.readUInt32LE(dataOffset + 4);
  return wav.subarray(dataOffset + 8, dataOffset + 8 + dataLength);
}

function requireRecord(value, key) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected an event object for ${key}.`);
  }
  const child = value[key];
  if (typeof child !== 'object' || child === null || Array.isArray(child)) {
    throw new Error(`Expected ${key} object.`);
  }
  return child;
}

function requireString(value, key) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected event object with ${key}.`);
  }
  const field = value[key];
  if (typeof field !== 'string') throw new Error(`Expected ${key} string.`);
  return field;
}
