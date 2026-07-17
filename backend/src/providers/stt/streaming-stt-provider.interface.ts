import {
  SttEventHandlers,
  SttSendAudioInput,
  SttStartTurnInput,
  SttTurnReference,
} from './stt.types';

export interface StreamingSttProvider {
  cancelTurn(input: SttTurnReference): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  finishTurn(input: SttTurnReference): Promise<void>;
  sendAudio(input: SttSendAudioInput): Promise<void>;
  setEventHandlers(handlers: SttEventHandlers): void;
  startTurn(input: SttStartTurnInput): Promise<void>;
}
