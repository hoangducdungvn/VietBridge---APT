// Main entry point for VietBridge Voice — wires the VoicePipeline to the
// debug/demo UI defined in index.html.

import { VoicePipeline, type VoicePipelineEvents } from './pipeline/voicePipeline';
import { WebAudioCaptureAdapter } from './audio/captureAdapter';
import { EnvironmentMonitor, type EnvLevel, type EnvSuggestion } from './audio/environmentMonitor';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// UI elements
const micSelect    = $<HTMLSelectElement>('mic-select');
const speakerInput = $<HTMLInputElement>('speaker-id');
const langSelect   = $<HTMLSelectElement>('lang-select');
const wsUrlInput   = $<HTMLInputElement>('ws-url');
const btnStart     = $<HTMLButtonElement>('btn-start');
const btnStop      = $<HTMLButtonElement>('btn-stop');
const connDot      = $<HTMLSpanElement>('conn-dot');
const connState    = $<HTMLSpanElement>('conn-state');
const vadDot       = $<HTMLSpanElement>('vad-dot');
const vadStateEl   = $<HTMLSpanElement>('vad-state');
const levelDb      = $<HTMLDivElement>('level-db');
const levelBar     = $<HTMLDivElement>('level-bar');
const snrVal       = $<HTMLSpanElement>('snr-val');
const mChunks      = $<HTMLDivElement>('m-chunks');
const mUtterances  = $<HTMLDivElement>('m-utterances');
const mDuration    = $<HTMLDivElement>('m-duration');
const mSeq         = $<HTMLDivElement>('m-seq');
const mAcked       = $<HTMLDivElement>('m-acked');
const mBuffer      = $<HTMLDivElement>('m-buffer');
const eventLog     = $<HTMLDivElement>('event-log');
const transcriptDisplay = $<HTMLDivElement>('transcript-display');
const sttBadge          = $<HTMLSpanElement>('stt-badge');
const studioCheck       = $<HTMLInputElement>('studio-mode');
const envLevelEl        = $<HTMLSpanElement>('env-level');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let pipeline: VoicePipeline | null = null;
let envMonitor: EnvironmentMonitor | null = null;
let lastVadState = 'IDLE';

// ---------------------------------------------------------------------------
// Environment monitor UI
// ---------------------------------------------------------------------------
function setEnvLevelUI(level: EnvLevel, noiseFloorDbfs: number): void {
  const map: Record<EnvLevel, [string, string]> = {
    quiet:    ['🟢 Yên tĩnh', 'var(--green)'],
    moderate: ['🟡 Vừa', 'var(--yellow)'],
    noisy:    ['🔴 Ồn', 'var(--red)'],
  };
  const [label, color] = map[level];
  envLevelEl.textContent = `${label} (${noiseFloorDbfs.toFixed(0)} dBFS)`;
  envLevelEl.style.color = color;
}

function showEnvToast(s: EnvSuggestion): void {
  document.getElementById('env-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'env-toast';
  toast.style.cssText =
    'position: fixed; bottom: 20px; right: 20px; z-index: 1000; max-width: 340px;' +
    'background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius);' +
    'padding: 14px 16px; box-shadow: 0 8px 30px rgba(0,0,0,0.5); font-size: 0.85rem;';
  const actionLabel = s.action === 'enable_studio' ? 'Bật Studio Mode' : 'Tắt Studio Mode';
  toast.innerHTML = `
    <div style="margin-bottom: 10px;">${escapeHtml(s.reason)}</div>
    <div style="display: flex; gap: 8px;">
      <button id="env-toast-apply" style="flex: 1; padding: 6px 10px; border: none; border-radius: 6px;
        background: var(--accent); color: #fff; cursor: pointer; font-family: var(--font);">${actionLabel}</button>
      <button id="env-toast-dismiss" style="padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px;
        background: transparent; color: var(--text-muted); cursor: pointer; font-family: var(--font);">Bỏ qua</button>
    </div>`;
  document.body.appendChild(toast);

  document.getElementById('env-toast-apply')!.addEventListener('click', async () => {
    toast.remove();
    studioCheck.checked = s.action === 'enable_studio';
    appendLog('ev', `🔄 Đổi mode theo gợi ý: Studio ${studioCheck.checked ? 'ON' : 'OFF'} — khởi động lại capture...`);
    await stopPipeline();
    await startPipeline();
  });
  document.getElementById('env-toast-dismiss')!.addEventListener('click', () => {
    toast.remove();
    envMonitor?.dismiss();
  });
}

// ---------------------------------------------------------------------------
// Microphone listing
// ---------------------------------------------------------------------------
async function populateMicList(): Promise<void> {
  try {
    // Need a temporary stream to trigger permission prompt so labels are available
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach(t => t.stop());

    const devices = await WebAudioCaptureAdapter.listDevices();
    micSelect.innerHTML = '';
    if (devices.length === 0) {
      micSelect.innerHTML = '<option value="">No microphones found</option>';
      return;
    }
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '(Default microphone)';
    micSelect.appendChild(defaultOpt);

    for (const d of devices) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone ${d.deviceId.slice(0, 8)}`;
      micSelect.appendChild(opt);
    }
  } catch (err) {
    micSelect.innerHTML = '<option value="">Mic permission denied</option>';
    appendLog('err', `Failed to list microphones: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function appendLog(type: 'ev' | 'speech' | 'warn' | 'err' | 'ts', message: string): void {
  const line = document.createElement('div');
  line.className = 'log-line';
  const now = new Date().toLocaleTimeString('en-GB', { hour12: false });
  line.innerHTML = `<span class="ts">${now}</span> <span class="${type}">${escapeHtml(message)}</span>`;
  eventLog.appendChild(line);
  // Auto-scroll to bottom
  eventLog.scrollTop = eventLog.scrollHeight;

  // Cap log at 500 lines
  while (eventLog.children.length > 500) {
    eventLog.removeChild(eventLog.firstChild!);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------
function setConnectionUI(state: string): void {
  connState.textContent = state;
  connDot.className = 'dot';
  switch (state) {
    case 'connected':     connDot.classList.add('green'); break;
    case 'connecting':
    case 'reconnecting':  connDot.classList.add('yellow'); break;
    case 'throttled':     connDot.classList.add('yellow'); break;
    case 'closed':        connDot.classList.add('red'); break;
    default:              break;
  }
}

function setVadUI(state: string): void {
  vadStateEl.textContent = state;
  vadDot.className = 'dot';
  switch (state) {
    case 'SPEAKING':        vadDot.classList.add('green'); break;
    case 'POSSIBLE_SPEECH':
    case 'POSSIBLE_END':    vadDot.classList.add('yellow'); break;
    default:                break;
  }
}

// ---------------------------------------------------------------------------
// Pipeline lifecycle
// ---------------------------------------------------------------------------
async function startPipeline(): Promise<void> {
  if (pipeline) return;

  btnStart.disabled = true;
  btnStop.disabled = false;
  studioCheck.disabled = true; // constraints can't change mid-capture; re-enabled on stop
  eventLog.innerHTML = '';

  const studioMode = studioCheck.checked;
  envMonitor = new EnvironmentMonitor(studioMode, {
    onLevelChange: setEnvLevelUI,
    onSuggestion: showEnvToast,
  });

  const events: VoicePipelineEvents = {
    onConnectionStateChange: (state) => {
      setConnectionUI(state);
      appendLog('ev', `Connection → ${state}`);
    },

    onVadStateChange: (state) => {
      lastVadState = state;
      setVadUI(state);
    },

    onDeviceStateChange: (state) => {
      if (state.type === 'active') {
        appendLog('ev', `Mic active: ${state.deviceLabel}`);
      } else if (state.type === 'disconnected') {
        appendLog('err', 'Microphone disconnected');
      } else if (state.type === 'permission_denied') {
        appendLog('err', 'Microphone permission denied');
      } else if (state.type === 'error') {
        appendLog('err', `Mic error: ${state.message}`);
      }
    },

    onAudioLevel: (quality) => {
      const db = quality.rms_dbfs;
      levelDb.textContent = `${db.toFixed(1)} dBFS`;
      // Map -60..0 dBFS to 0..100%
      const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
      levelBar.style.width = `${pct}%`;
      snrVal.textContent = quality.estimated_snr_db.toFixed(1);
      envMonitor?.feedLevel(db, lastVadState);
    },

    onUtteranceStart: (id) => {
      appendLog('speech', `▶ utterance.start: ${id}`);
      updateMetrics();
    },

    onUtteranceEnd: (id, reason) => {
      appendLog('speech', `■ utterance.end: ${id} (${reason})`);
      updateMetrics();
    },

    onChunkSent: (_seq) => {
      updateMetrics();
    },

    onAcked: (seq) => {
      mAcked.textContent = String(seq);
    },

    onLog: (msg) => {
      appendLog('ts', msg);
    },

    onError: (code, message) => {
      appendLog('err', `${code}: ${message}`);
    },

    onSttResult: (res) => {
      if (transcriptDisplay.querySelector('span[style*="italic"]')) {
        transcriptDisplay.innerHTML = '';
      }

      if (res.type === 'partial') {
        sttBadge.textContent = `⚡ Partial (${res.backend} | ${res.latencyMs}ms)`;
        sttBadge.style.background = 'var(--green-glow)';
        sttBadge.style.color = 'var(--green)';

        let partialEl = document.getElementById('live-partial');
        if (!partialEl) {
          partialEl = document.createElement('div');
          partialEl.id = 'live-partial';
          partialEl.style.cssText = 'padding: 10px; border: 1px dashed var(--blue); border-radius: 6px; color: var(--blue); margin-bottom: 8px; font-style: italic;';
          transcriptDisplay.appendChild(partialEl);
        }
        partialEl.innerHTML = `⏳ <b>${escapeHtml(res.text)}</b> <span style="font-size: 0.75rem; color: var(--text-muted);">[${res.backend}]</span>`;
        transcriptDisplay.scrollTop = transcriptDisplay.scrollHeight;
      } else if (res.type === 'final') {
        envMonitor?.feedSttFinal(res.text.trim() === '', res.lowConfidence === true);
        sttBadge.textContent = `✨ Finalized (${res.backend} | ${res.latencyMs}ms)`;
        sttBadge.style.background = 'var(--accent-glow)';
        sttBadge.style.color = 'var(--accent)';

        const partialEl = document.getElementById('live-partial');
        if (partialEl) partialEl.remove();

        const finalEl = document.createElement('div');
        finalEl.id = `utt-${res.utteranceId}`;
        finalEl.style.cssText = 'margin-bottom: 12px; padding: 12px; background: var(--surface); border-left: 4px solid var(--green); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
        finalEl.innerHTML = `
          <div style="font-size: 1.1rem; font-weight: 600; color: #fff; margin-bottom: 4px;">${escapeHtml(res.text)}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">🎙️ <b>${res.backend}</b> (${res.language.toUpperCase()}) • ${res.latencyMs}ms</div>
          <div id="tr-${res.utteranceId}" style="margin-top: 8px; padding: 8px 10px; background: rgba(108,92,231,0.08); border-left: 3px solid var(--accent); border-radius: 4px; color: var(--text-muted); font-style: italic; font-size: 0.95rem;">⏳ Translating...</div>
        `;
        transcriptDisplay.appendChild(finalEl);
        transcriptDisplay.scrollTop = transcriptDisplay.scrollHeight;
      }
    },

    onTranslationResult: (res) => {
      const trEl = document.getElementById(`tr-${res.utteranceId}`);
      if (trEl) {
        const flag = res.targetLang === 'en' ? '🇺🇸' : '🇻🇳';
        trEl.style.color = 'var(--text)';
        trEl.style.fontStyle = 'normal';
        trEl.innerHTML = `${flag} <b>${escapeHtml(res.translatedText)}</b> <span style="font-size:0.7rem;color:var(--text-muted);">[${res.model} • ${res.latencyMs}ms]</span>`;
      }
      appendLog('ts', `🌐 Translation (${res.sourceLang}→${res.targetLang}): ${res.translatedText}`);
    },
  };

  pipeline = new VoicePipeline(
    {
      gatewayUrl: wsUrlInput.value || 'ws://localhost:8081',
      speakerId: speakerInput.value || 'speaker-a',
      languageHint: (langSelect.value as 'vi' | 'en' | 'auto') || 'vi',
      deviceId: micSelect.value || undefined,
      sourceId: `mic-${speakerInput.value || 'a'}`,
      participantId: `participant-${speakerInput.value || 'a'}`,
      studioMode,
    },
    events,
  );

  try {
    await pipeline.start();
    appendLog('ev', `✅ Pipeline started${studioMode ? ' — 🎙️ STUDIO MODE' : ''}`);
  } catch (err) {
    appendLog('err', `Pipeline start failed: ${err}`);
    pipeline = null;
    btnStart.disabled = false;
    btnStop.disabled = true;
    studioCheck.disabled = false;
  }
}

async function stopPipeline(): Promise<void> {
  if (!pipeline) return;

  await pipeline.stop();
  appendLog('ev', '⬛ Pipeline stopped');

  pipeline = null;
  envMonitor = null;
  btnStart.disabled = false;
  btnStop.disabled = true;
  studioCheck.disabled = false;
  document.getElementById('env-toast')?.remove();
  envLevelEl.textContent = '—';
  envLevelEl.style.color = 'var(--text-muted)';

  setConnectionUI('closed');
  setVadUI('IDLE');
  levelDb.textContent = '— dBFS';
  levelBar.style.width = '0%';
  snrVal.textContent = '—';

  sttBadge.textContent = 'Stopped';
  sttBadge.style.background = 'var(--surface-2)';
  sttBadge.style.color = 'var(--text-muted)';
  const partialEl = document.getElementById('live-partial');
  if (partialEl) partialEl.remove();
}

function updateMetrics(): void {
  if (!pipeline) return;
  const m = pipeline.getMetrics();
  mChunks.textContent = String(m.totalChunksSent);
  mUtterances.textContent = String(m.totalUtterances);
  mDuration.textContent = `${(m.totalAudioDurationMs / 1000).toFixed(1)}s`;
  mSeq.textContent = String(m.currentSequence);

  // Resend buffer size = currentSequence - lastAcked (approximation)
  const acked = mAcked.textContent;
  const ackedNum = acked === '—' ? -1 : parseInt(acked, 10);
  const bufferSize = Math.max(0, m.currentSequence - ackedNum - 1);
  mBuffer.textContent = String(bufferSize);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  populateMicList();

  btnStart.addEventListener('click', () => startPipeline());
  btnStop.addEventListener('click', () => stopPipeline());

  appendLog('ts', 'VietBridge Voice ready — click Start to begin');
});
