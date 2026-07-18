import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { SocketIoVoiceTransport, VoicePipeline } from 'vietbridge-voice';
import {
  GearSix,
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  Translate,
  X
} from '@phosphor-icons/react';
import type { LanguageCode } from '@shared/types';
import type { ParticipantSession } from '@domain/entities/BackendSession';
import { env } from '@infrastructure/config/env';
import type { RealtimeSttResult } from '@infrastructure/websocket/SessionSocketClient';

interface MeetingRoomScreenProps {
  activeSession: ParticipantSession;
  realtimeError?: string;
  realtimeStatus: 'connecting' | 'connected' | 'reconnecting' | 'error';
  roomSocket?: Socket;
  roomName: string;
  localLanguage: LanguageCode;
  otherLanguage: LanguageCode;
  sttResults: RealtimeSttResult[];
  onEndMeeting: () => void;
}

interface TranscriptItem {
  id: string;
  text: string;
  timestamp: string;
  turn: number;
}

const languageDetails = {
  en: { name: 'English', nativeName: 'English', flag: '🇬🇧' },
  vi: { name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳' }
} as const;

const getLanguageDetails = (language: LanguageCode) =>
  language === 'vi' ? languageDetails.vi : languageDetails.en;

const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

interface LanguagePaneProps {
  language: LanguageCode;
  isOwnLanguage: boolean;
  isSpeaking: boolean;
  speakerLabel: string;
  liveCaption: string;
  transcript: TranscriptItem[];
}

function LanguagePane({
  language,
  isOwnLanguage,
  isSpeaking,
  speakerLabel,
  liveCaption,
  transcript
}: LanguagePaneProps) {
  const details = getLanguageDetails(language);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const transcriptElement = scrollRef.current;
    if (!transcriptElement) return;

    if (typeof transcriptElement.scrollTo === 'function') {
      transcriptElement.scrollTo({ top: transcriptElement.scrollHeight, behavior: 'smooth' });
    } else {
      transcriptElement.scrollTop = transcriptElement.scrollHeight;
    }
  }, [transcript]);

  return (
    <section
      className={`flex min-h-[540px] min-w-0 flex-col overflow-hidden bg-white lg:min-h-0 ${
        isOwnLanguage ? 'bg-[#f8fbff]' : ''
      }`}
      aria-label={`${details.name} transcript`}
    >
      <header className="flex min-h-[76px] items-center justify-between border-b border-meeting-line px-5 py-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`relative grid size-11 shrink-0 place-items-center rounded-full bg-meeting-accent text-sm font-bold text-white ${
              isSpeaking ? 'ring-4 ring-meeting-live/20' : ''
            }`}
          >
            {speakerLabel.slice(-1)}
            {isSpeaking && (
              <span className="absolute inset-[-5px] animate-speaking-ring rounded-full border-2 border-meeting-live" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="truncate font-semibold text-meeting-ink">{speakerLabel}</h2>
              {isOwnLanguage && (
                <span className="rounded-md bg-meeting-accent/10 px-2 py-0.5 text-xs font-semibold text-meeting-accent">
                  Your language
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-meeting-muted">
              <span aria-hidden="true">{details.flag}</span> {details.nativeName}
            </p>
          </div>
        </div>

        <span
          className={`text-xs font-semibold ${isSpeaking ? 'text-meeting-live' : 'text-meeting-muted'}`}
        >
          {isSpeaking ? 'Speaking' : 'Listening'}
        </span>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7"
        aria-live="polite"
      >
        {transcript.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center text-center">
            <p className="max-w-xs text-sm leading-6 text-meeting-muted">
              Finalized {details.name.toLowerCase()} transcript will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {transcript.map((item) => (
              <article
                key={item.id}
                className={`max-w-[92%] rounded-xl px-4 py-3 ${
                  item.turn % 2 === 0 ? 'bg-meeting-canvas' : 'bg-meeting-accent/[0.07]'
                }`}
              >
                <p className="text-base leading-7 text-meeting-ink">{item.text}</p>
                <time className="mt-2 block text-xs font-medium text-meeting-muted">
                  {item.timestamp}
                </time>
              </article>
            ))}
          </div>
        )}
      </div>

      <div
        className="min-h-[132px] border-t border-meeting-accent/20 bg-meeting-accent/[0.055] px-5 py-4 sm:px-7"
        aria-live="assertive"
        aria-atomic="true"
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-meeting-accent">
          <span
            className={`size-2 rounded-full ${isSpeaking ? 'animate-live-dot bg-meeting-live' : 'bg-meeting-muted/40'}`}
          />
          Live caption
        </div>
        <p
          className={`min-h-14 text-lg font-semibold leading-7 text-meeting-ink sm:text-xl ${liveCaption ? '' : 'text-meeting-muted'}`}
        >
          {liveCaption || 'Waiting for speech...'}
          {liveCaption && (
            <span className="ml-1 inline-block h-5 w-0.5 animate-caption-cursor bg-meeting-accent align-middle" />
          )}
        </p>
      </div>
    </section>
  );
}

export function MeetingRoomScreen({
  activeSession,
  realtimeError,
  realtimeStatus,
  roomSocket,
  roomName,
  localLanguage,
  otherLanguage,
  sttResults,
  onEndMeeting
}: MeetingRoomScreenProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isMicActive, setIsMicActive] = useState(false);
  const [isVadSpeaking, setIsVadSpeaking] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [isMicStarting, setIsMicStarting] = useState(false);
  const [voiceError, setVoiceError] = useState<string>();
  const pipelineRef = useRef<VoicePipeline>();
  const startRequestRef = useRef(0);
  const autoStartEnabledRef = useRef(true);

  const orderedLanguages = useMemo(
    () => [localLanguage, otherLanguage] as const,
    [localLanguage, otherLanguage]
  );
  const liveCaptions = useMemo(() => {
    const captions: Record<'en' | 'vi', string> = { en: '', vi: '' };
    for (const result of sttResults) {
      if (result.type === 'partial') captions[result.language] = result.text;
    }
    return captions;
  }, [sttResults]);
  const transcripts = useMemo(() => {
    const grouped: Record<'en' | 'vi', TranscriptItem[]> = { en: [], vi: [] };
    sttResults
      .filter((result) => result.type === 'final' && result.text.trim() !== '')
      .forEach((result, turn) => {
        grouped[result.language].push({
          id: result.turnId,
          text: result.text,
          timestamp: new Intl.DateTimeFormat('en', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }).format(new Date(result.receivedAt)),
          turn
        });
      });
    return grouped;
  }, [sttResults]);
  const remotePartial = [...sttResults]
    .reverse()
    .find(
      (result) => result.type === 'partial' && result.participantId !== activeSession.participantId
    );
  const speakingLanguage = isVadSpeaking ? localLanguage : remotePartial?.language;

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stopMicrophone = useCallback(async (manual: boolean) => {
    if (manual) autoStartEnabledRef.current = false;
    startRequestRef.current += 1;
    const pipeline = pipelineRef.current;
    pipelineRef.current = undefined;
    setIsMicStarting(false);
    setIsMicActive(false);
    setIsVadSpeaking(false);
    await pipeline?.stop();
  }, []);

  const startMicrophone = useCallback(async () => {
    if (pipelineRef.current) return;
    if (!roomSocket?.connected) {
      setVoiceError('Waiting for the realtime connection before starting the microphone.');
      return;
    }

    autoStartEnabledRef.current = true;
    const requestId = startRequestRef.current + 1;
    startRequestRef.current = requestId;
    setVoiceError(undefined);
    setIsMicStarting(true);
    const pipeline = new VoicePipeline(
      {
        enableSileroVad: false,
        gatewayUrl: env.backendWsUrl,
        languageHint: activeSession.sourceLanguage,
        participantId: activeSession.participantId,
        sessionId: activeSession.sessionId,
        speakerId: activeSession.participantId,
        transportFactory: (config, events) => new SocketIoVoiceTransport(roomSocket, config, events)
      },
      {
        onError: (code, message) => {
          if (startRequestRef.current === requestId) {
            setVoiceError(`${code}: ${message}`);
          }
        },
        onVadStateChange: (state) =>
          setIsVadSpeaking(state === 'SPEAKING' || state === 'POSSIBLE_END')
      }
    );
    pipelineRef.current = pipeline;
    try {
      await pipeline.start();
      if (startRequestRef.current !== requestId || pipelineRef.current !== pipeline) {
        await pipeline.stop();
        return;
      }
      setIsMicStarting(false);
      setIsMicActive(true);
    } catch (error: unknown) {
      if (pipelineRef.current === pipeline) pipelineRef.current = undefined;
      if (startRequestRef.current !== requestId) return;
      setIsMicStarting(false);
      setIsMicActive(false);
      setVoiceError(error instanceof Error ? error.message : 'Unable to start microphone.');
    }
  }, [activeSession, roomSocket]);

  useEffect(() => {
    if (!roomSocket?.connected) {
      if (pipelineRef.current) void stopMicrophone(false);
      return;
    }
    if (autoStartEnabledRef.current) void startMicrophone();
  }, [roomSocket, startMicrophone, stopMicrophone]);

  useEffect(() => {
    return () => {
      startRequestRef.current += 1;
      const pipeline = pipelineRef.current;
      pipelineRef.current = undefined;
      void pipeline?.stop();
    };
  }, []);

  const toggleMicrophone = async () => {
    if (pipelineRef.current) {
      await stopMicrophone(true);
      return;
    }
    await startMicrophone();
  };

  const connectionLabel =
    realtimeStatus === 'connected'
      ? 'Connected'
      : realtimeStatus === 'reconnecting'
        ? 'Reconnecting'
        : realtimeStatus === 'error'
          ? 'Connection failed'
          : 'Connecting';
  const visibleError = voiceError ?? realtimeError;

  return (
    <main className="flex min-h-[100dvh] flex-col bg-meeting-canvas text-meeting-ink lg:h-[100dvh] lg:overflow-hidden">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-meeting-line bg-white px-4 py-3 sm:px-6 lg:flex-nowrap lg:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-meeting-accent text-white">
            <Translate aria-hidden="true" size={19} weight="bold" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-meeting-ink">{roomName}</p>
            <p className="text-xs text-meeting-muted">Vietnamese-English meeting</p>
          </div>
        </div>

        <div className="order-3 flex w-full items-center justify-center gap-5 text-sm sm:order-none sm:w-auto">
          <span className="flex items-center gap-2 font-medium text-meeting-muted">
            <span
              className={`size-2 rounded-full ${
                realtimeStatus === 'connected'
                  ? 'bg-meeting-live'
                  : realtimeStatus === 'error'
                    ? 'bg-meeting-danger'
                    : 'bg-meeting-warning'
              }`}
            />
            {connectionLabel}
          </span>
          <time className="min-w-12 font-mono font-semibold tabular-nums text-meeting-ink">
            {formatDuration(elapsedSeconds)}
          </time>
        </div>

        <button
          type="button"
          title="Meeting settings"
          aria-label="Meeting settings"
          className="grid size-10 shrink-0 place-items-center rounded-xl text-meeting-muted transition hover:bg-meeting-canvas hover:text-meeting-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meeting-accent active:scale-[0.98]"
        >
          <GearSix aria-hidden="true" size={22} />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-2">
        {orderedLanguages.map((language, index) => (
          <div
            key={language}
            className={`h-full ${index === 0 ? 'border-b border-meeting-accent lg:border-b-0 lg:border-r' : ''}`}
          >
            <LanguagePane
              language={language}
              isOwnLanguage={language === localLanguage}
              isSpeaking={speakingLanguage === language}
              speakerLabel={language === localLanguage ? 'Speaker A' : 'Speaker B'}
              liveCaption={language === 'vi' ? liveCaptions.vi : liveCaptions.en}
              transcript={language === 'vi' ? transcripts.vi : transcripts.en}
            />
          </div>
        ))}
      </div>

      <footer className="relative flex min-h-24 items-center justify-center border-t border-meeting-line bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <div
            className="flex h-12 w-9 items-end justify-center gap-1"
            aria-label={
              isMicActive
                ? 'Live audio level'
                : isMicStarting
                  ? 'Microphone starting'
                  : 'Microphone stopped'
            }
          >
            {[0, 1, 2, 3].map((bar) => (
              <span
                key={bar}
                className={`w-1.5 rounded-full bg-meeting-accent ${isMicActive ? 'animate-audio-level' : 'h-1.5 opacity-25'}`}
                style={{ animationDelay: `${bar * 110}ms` }}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => void toggleMicrophone()}
            aria-pressed={isMicActive}
            aria-label={
              isMicActive
                ? 'Stop microphone'
                : isMicStarting
                  ? 'Cancel microphone startup'
                  : 'Start microphone'
            }
            className={`relative grid size-16 place-items-center rounded-full text-white shadow-panel transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-meeting-accent active:scale-[0.97] ${
              isMicActive || isMicStarting
                ? 'bg-meeting-accent hover:bg-meeting-accentStrong'
                : 'bg-[#8793a1]'
            }`}
          >
            {isMicActive && (
              <span className="absolute inset-[-7px] animate-mic-ring rounded-full border-2 border-meeting-accent/30" />
            )}
            {isMicActive || isMicStarting ? (
              <Microphone aria-hidden="true" size={27} weight="fill" />
            ) : (
              <MicrophoneSlash aria-hidden="true" size={27} weight="fill" />
            )}
          </button>
        </div>

        {visibleError && (
          <p
            role="alert"
            className="absolute bottom-1 left-4 max-w-[42%] text-xs leading-4 text-meeting-danger"
          >
            {visibleError}
          </p>
        )}

        <div className="absolute right-4 sm:right-6">
          {isEnding ? (
            <div className="fixed bottom-28 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-meeting-danger/30 bg-white p-1.5 shadow-panel sm:absolute sm:bottom-auto sm:left-auto sm:right-6 sm:translate-x-0">
              <button
                type="button"
                onClick={onEndMeeting}
                className="inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-lg bg-meeting-danger px-3 text-sm font-semibold text-white transition hover:bg-[#ad3434] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meeting-danger active:scale-[0.98]"
              >
                <PhoneDisconnect aria-hidden="true" size={18} weight="bold" /> End now
              </button>
              <button
                type="button"
                onClick={() => setIsEnding(false)}
                aria-label="Cancel ending meeting"
                className="grid size-10 place-items-center rounded-lg text-meeting-muted transition hover:bg-meeting-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meeting-accent"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEnding(true)}
              className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl border border-meeting-danger px-4 text-sm font-semibold text-meeting-danger transition hover:bg-meeting-danger/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meeting-danger active:scale-[0.98]"
            >
              <PhoneDisconnect aria-hidden="true" size={18} />
              <span className="hidden sm:inline">End Meeting</span>
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}
