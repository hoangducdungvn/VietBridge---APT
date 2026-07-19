import assert from 'node:assert/strict';

import {
  VadStateMachine,
  type VadDecisionConfig,
  type VadEvent,
  type VadProbabilities,
} from '../src/vad/vadStateMachine';

const DEFAULT_CONFIG: VadDecisionConfig = {
  frameDurationMs: 20,
  minSpeechMs: 150,
  preRollMs: 400,
  endSilenceMs: 1500,
  maxUtteranceMs: 25_000,
  energyStartThreshold: 0.7,
  energyEndThreshold: 0.22,
  sileroStartThreshold: 0.5,
  sileroEndThreshold: 0.35,
};

interface Sequence {
  events: VadEvent[];
  nextTimestampMs: number;
}

function runFrames(
  machine: VadStateMachine,
  count: number,
  energy: number,
  silero: number | null,
  startTimestampMs = 0,
): Sequence {
  const events: VadEvent[] = [];
  let timestampMs = startTimestampMs;
  const probabilities: VadProbabilities = {
    energyAverage: energy,
    energyInstant: energy,
    sileroAverage: silero,
    sileroInstant: silero,
  };

  for (let index = 0; index < count; index += 1) {
    const event = machine.process(probabilities, timestampMs, 400);
    if (event) events.push(event);
    timestampMs += DEFAULT_CONFIG.frameDurationMs;
  }
  return { events, nextTimestampMs: timestampMs };
}

function findEvent(
  events: VadEvent[],
  type: VadEvent['type'],
): VadEvent | undefined {
  return events.find((event) => event.type === type);
}

// A conservative Silero result must not prevent Energy from opening a turn.
const hybridMachine = new VadStateMachine(DEFAULT_CONFIG);
const start = runFrames(hybridMachine, 10, 0.9, 0.1);
assert.equal(findEvent(start.events, 'speech_start')?.type, 'speech_start');
assert.equal(hybridMachine.getState(), 'SPEAKING');

// Strong Energy speech must keep the same turn alive even when Silero is low.
const sustained = runFrames(
  hybridMachine,
  100,
  0.9,
  0.1,
  start.nextTimestampMs,
);
assert.equal(findEvent(sustained.events, 'speech_end'), undefined);
assert.equal(hybridMachine.getState(), 'SPEAKING');

// Energy may also resume a short pause before the EOU timer expires.
const possibleEnd = runFrames(
  hybridMachine,
  5,
  0.5,
  0.08,
  sustained.nextTimestampMs,
);
assert.equal(hybridMachine.getState(), 'POSSIBLE_END');
const resumed = runFrames(
  hybridMachine,
  1,
  0.9,
  0.1,
  possibleEnd.nextTimestampMs,
);
assert.equal(
  findEvent(resumed.events, 'speech_continue')?.type,
  'speech_continue',
);
assert.equal(hybridMachine.getState(), 'SPEAKING');

// Silero silence plus Energy's normal ~0.5 baseline must close after 1.5s.
const silence = runFrames(
  hybridMachine,
  90,
  0.5,
  0.08,
  resumed.nextTimestampMs,
);
const silenceEnd = findEvent(silence.events, 'speech_end');
assert.equal(silenceEnd?.reason, 'vad_silence');
assert.equal(silenceEnd?.silenceDurationMs, 1500);

// Silero may also open a turn when Energy is weak.
const sileroMachine = new VadStateMachine(DEFAULT_CONFIG);
const sileroStart = runFrames(sileroMachine, 10, 0.3, 0.9);
assert.equal(
  findEvent(sileroStart.events, 'speech_start')?.type,
  'speech_start',
);

// Before Silero is ready (or after fallback), retain Energy-only hysteresis.
const energyMachine = new VadStateMachine(DEFAULT_CONFIG);
const energyStart = runFrames(energyMachine, 10, 0.9, null);
assert.equal(
  findEvent(energyStart.events, 'speech_start')?.type,
  'speech_start',
);
const energyEnd = runFrames(
  energyMachine,
  90,
  0.1,
  null,
  energyStart.nextTimestampMs,
);
assert.equal(findEvent(energyEnd.events, 'speech_end')?.reason, 'vad_silence');

// The Whisper safety guard must still split a continuously spoken long turn.
const maxDurationMachine = new VadStateMachine({
  ...DEFAULT_CONFIG,
  maxUtteranceMs: 400,
});
const maxDuration = runFrames(maxDurationMachine, 30, 0.9, 0.9);
assert.equal(
  findEvent(maxDuration.events, 'speech_end')?.reason,
  'max_duration',
);

console.log(
  'PASS hybrid VAD preserves speech start, sustained speech, EOU, and max duration',
);
