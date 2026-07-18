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
import type {
  RealtimeSttResult,
  RealtimeTranslationResult
} from '@infrastructure/websocket/SessionSocketClient';

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
  /** 'translation' items carry the other speaker's words rendered in THIS
   *  pane's language; they get a small "Translated" tag. */
  kind: 'stt' | 'translation';
  /** Epoch ms — merges stt + translation items in arrival order. */
  sortKey: number;
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
      data-local-source={isOwnLanguage ? 'true' : 'false'}
      className={`relative flex h-[36rem] min-h-0 min-w-0 flex-col overflow-hidden sm:h-[40rem] lg:h-full ${
        isOwnLanguage ? 'bg-[#f3faf5] ring-2 ring-inset ring-meeting-live/55' : 'bg-white'
      }`}
      aria-label={`${details.name} transcript`}
    >
      <header
        className={`flex min-h-[76px] items-center justify-between border-b px-5 py-4 sm:px-7 ${
          isOwnLanguage ? 'border-meeting-live/25 bg-[#eaf6ee]' : 'border-meeting-line bg-white'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`relative grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${
              isOwnLanguage ? 'bg-meeting-live' : 'bg-meeting-accent'
            } ${isSpeaking ? 'ring-4 ring-meeting-live/20' : ''}`}
          >
            {isOwnLanguage ? 'ME' : speakerLabel.slice(-1).toUpperCase()}
            {isSpeaking && (
              <span className="absolute inset-[-5px] animate-speaking-ring rounded-full border-2 border-meeting-live" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="truncate font-semibold text-meeting-ink">{speakerLabel}</h2>
              {isOwnLanguage && (
                <span className="rounded-md bg-meeting-live/10 px-2 py-0.5 text-xs font-semibold text-meeting-live">
                  Your source language
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
        tabIndex={0}
        aria-label={`${details.name} transcript history`}
        className="transcript-scrollbar min-h-0 flex-1 scroll-smooth overflow-y-auto overscroll-contain px-5 py-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-meeting-accent sm:px-7"
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
                  item.kind === 'translation'
                    ? 'border border-meeting-accent/25 bg-meeting-accent/[0.05]'
                    : item.turn % 2 === 0
                      ? 'bg-meeting-canvas'
                      : 'bg-meeting-accent/[0.07]'
                }`}
              >
                {item.kind === 'translation' && (
                  <span className="mb-1 inline-flex items-center gap-1 rounded-md bg-meeting-accent/10 px-2 py-0.5 text-xs font-semibold text-meeting-accent">
                    <Translate aria-hidden="true" size={12} weight="bold" /> Translated
                  </span>
                )}
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
        className={`min-h-[132px] border-t px-5 py-4 sm:px-7 ${
          isOwnLanguage
            ? 'border-meeting-live/25 bg-[#eaf6ee]'
            : 'border-meeting-accent/20 bg-meeting-accent/[0.055]'
        }`}
        aria-live="assertive"
        aria-atomic="true"
      >
        <div
          className={`mb-2 flex items-center gap-2 text-xs font-semibold ${
            isOwnLanguage ? 'text-meeting-live' : 'text-meeting-accent'
          }`}
        >
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
  // ws transport: results arrive through the VoicePipeline callbacks instead
  // of the (stubbed) NestJS Socket.IO gateway that feeds the sttResults prop.
  const [wsSttResults, setWsSttResults] = useState<RealtimeSttResult[]>([]);
  const [translations, setTranslations] = useState<RealtimeTranslationResult[]>([]);
  const [wsConnectionState, setWsConnectionState] = useState<string>('connecting');
  const pipelineRef = useRef<VoicePipeline>();
  const startRequestRef = useRef(0);
  const autoStartEnabledRef = useRef(true);
  const transportMode = env.transport;
  const results = transportMode === 'ws' ? wsSttResults : sttResults;

  const orderedLanguages = useMemo(
    () => [localLanguage, otherLanguage] as const,
    [localLanguage, otherLanguage]
  );
  const liveCaptions = useMemo(() => {
    const captions: Record<'en' | 'vi', string> = { en: '', vi: '' };
    for (const result of results) {
      if (result.type === 'partial') captions[result.language] = result.text;
    }
    return captions;
  }, [results]);
  const transcripts = useMemo(() => {
    const timeFormat = new Intl.DateTimeFormat('en', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const grouped: Record<'en' | 'vi', TranscriptItem[]> = { en: [], vi: [] };
    results
      .filter((result) => result.type === 'final' && result.text.trim() !== '')
      .forEach((result) => {
        grouped[result.language].push({
          id: result.turnId,
          text: result.text,
          timestamp: timeFormat.format(new Date(result.receivedAt)),
          turn: 0,
          kind: 'stt',
          sortKey: result.receivedAt
        });
      });
    // Translations land in the TARGET-language pane: A speaks VI → the EN
    // reader finds A's words, translated, in their own pane.
    translations.forEach((tr) => {
      grouped[tr.targetLang].push({
        id: `tr-${tr.turnId}`,
        text: tr.translatedText,
        timestamp: timeFormat.format(new Date(tr.receivedAt)),
        turn: 0,
        kind: 'translation',
        sortKey: tr.receivedAt
      });
    });
    for (const language of ['en', 'vi'] as const) {
      grouped[language].sort((a, b) => a.sortKey - b.sortKey);
      grouped[language].forEach((item, index) => {
        item.turn = index;
      });
    }
    return grouped;
  }, [results, translations]);
  const remotePartial = [...results]
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
    // socketio mode needs the NestJS room socket; ws mode talks straight to
    // the mock gateway and must NOT be gated on it (NestJS realtime is a stub).
    let socketForTransport: Socket | undefined;
    if (transportMode !== 'ws') {
      if (!roomSocket?.connected) {
        setVoiceError('Waiting for the realtime connection before starting the microphone.');
        return;
      }
      socketForTransport = roomSocket;
    }

    autoStartEnabledRef.current = true;
    const requestId = startRequestRef.current + 1;
    startRequestRef.current = requestId;
    setVoiceError(undefined);
    setIsMicStarting(true);
    const pipeline = new VoicePipeline(
      {
        enableSileroVad: true,
        gatewayUrl: transportMode === 'ws' ? env.mockGatewayUrl : env.backendWsUrl,
        languageHint: activeSession.sourceLanguage,
        participantId: activeSession.participantId,
        sessionId: activeSession.sessionId,
        speakerId: activeSession.participantId,
        ...(socketForTransport
          ? {
              transportFactory: (config, events) =>
                new SocketIoVoiceTransport(socketForTransport, config, events)
            }
          : {})
      },
      {
        onError: (code, message) => {
          if (startRequestRef.current === requestId) {
            setVoiceError(`${code}: ${message}`);
          }
        },
        onVadStateChange: (state) =>
          setIsVadSpeaking(state === 'SPEAKING' || state === 'POSSIBLE_END'),
        onConnectionStateChange: (state) => setWsConnectionState(state),
        onSttResult: (res) => {
          if (transportMode !== 'ws') return;
          const mapped: RealtimeSttResult = {
            backend: res.backend,
            language: res.language === 'en' ? 'en' : 'vi',
            participantId: res.speakerId ?? res.sourceId ?? 'unknown',
            providerLatencyMs: res.latencyMs,
            receivedAt: Date.now(),
            text: res.text,
            turnId: res.utteranceId,
            type: res.type
          };
          setWsSttResults((current) => {
            const withoutSamePartial = current.filter(
              (item) => !(item.turnId === mapped.turnId && item.type === 'partial')
            );
            return [...withoutSamePartial, mapped].slice(-30);
          });
        },
        onTranslationResult: (res) => {
          if (transportMode !== 'ws') return;
          setTranslations((current) =>
            [
              ...current,
              {
                participantId: res.speakerId ?? res.sourceId ?? 'unknown',
                receivedAt: Date.now(),
                sourceLang: res.sourceLang === 'en' ? ('en' as const) : ('vi' as const),
                sourceText: res.sourceText,
                targetLang: res.targetLang === 'vi' ? ('vi' as const) : ('en' as const),
                translatedText: res.translatedText,
                turnId: res.utteranceId
              }
            ].slice(-30)
          );
        },
        onSttError: (evt) => {
          if (transportMode !== 'ws') return;
          // No stt.final will follow — drop the stuck live partial(s).
          setWsSttResults((current) =>
            current.filter(
              (item) =>
                item.type !== 'partial' ||
                (evt.utteranceId !== null && item.turnId !== evt.utteranceId)
            )
          );
        }
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
    if (transportMode === 'ws') {
      // Pipeline owns its own WS (with reconnect) — no room socket involved.
      if (autoStartEnabledRef.current) void startMicrophone();
      return;
    }
    if (!roomSocket?.connected) {
      if (pipelineRef.current) void stopMicrophone(false);
      return;
    }
    if (autoStartEnabledRef.current) void startMicrophone();
  }, [roomSocket, startMicrophone, stopMicrophone, transportMode]);

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

  // In ws mode the header reflects the pipeline's own gateway connection;
  // the NestJS realtime status is meaningless there (stub gateway).
  const effectiveStatus: 'connecting' | 'connected' | 'reconnecting' | 'error' =
    transportMode === 'ws'
      ? wsConnectionState === 'connected' || wsConnectionState === 'throttled'
        ? 'connected'
        : wsConnectionState === 'reconnecting'
          ? 'reconnecting'
          : wsConnectionState === 'closed'
            ? 'error'
            : 'connecting'
      : realtimeStatus;
  const connectionLabel =
    effectiveStatus === 'connected'
      ? 'Connected'
      : effectiveStatus === 'reconnecting'
        ? 'Reconnecting'
        : effectiveStatus === 'error'
          ? 'Connection failed'
          : 'Connecting';
  const visibleError = voiceError ?? (transportMode === 'ws' ? undefined : realtimeError);

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
                effectiveStatus === 'connected'
                  ? 'bg-meeting-live'
                  : effectiveStatus === 'error'
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

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-visible lg:grid-cols-2 lg:overflow-hidden">
        {orderedLanguages.map((language, index) => (
          <div
            key={language}
            className={`min-h-0 lg:h-full ${
              index === 0 ? 'border-b border-meeting-accent lg:border-b-0 lg:border-r' : ''
            }`}
          >
            <LanguagePane
              language={language}
              isOwnLanguage={language === localLanguage}
              isSpeaking={speakingLanguage === language}
              speakerLabel={language === localLanguage ? 'You' : 'Other participant'}
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
