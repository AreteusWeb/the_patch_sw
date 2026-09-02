/**
 * Gemini Live API session — mic + camera + PCM playback.
 * Nothing is persisted unless the user explicitly taps Record (opt-in).
 * 3-minute hard limit (POC rules).
 */

import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../lib/appConfig';
import { setLiveCoachSessionActive } from '../lib/liveCoachActivity';
import useStore from '../store/useStore';

export const LIVE_SESSION_LIMIT_MS = 3 * 60 * 1000;
/** Camera frames to Gemini Live (ms). 1000 = 1 fps; lower for more frames (more tokens). */
const FRAME_INTERVAL_MS = 1000;
/** Ask the coach to speak if it goes quiet (proactive form cues). */
const COACH_NUDGE_INTERVAL_MS = 16_000;

const LIVE_MODEL_ID =
  import.meta.env.VITE_GEMINI_LIVE_MODEL ||
  'gemini-2.5-flash-native-audio-preview-12-2025';

export const LIVE_MODEL = LIVE_MODEL_ID.startsWith('models/')
  ? LIVE_MODEL_ID
  : `models/${LIVE_MODEL_ID}`;

const SYSTEM_INSTRUCTION =
  'You are an energetic live fitness coach watching the user on camera with microphone. ' +
  'ALWAYS speak out loud — never stay silent for long. ' +
  'Continuously watch the video: name the movement or body position you see, and give short spoken feedback. ' +
  'Be proactive: if they start an exercise, coach them; if they stand still, say what you see and invite them to move. ' +
  'Prefer 1–2 spoken sentences per turn. Correct form with one clear cue (hips, knees, back, elbows, etc.). ' +
  'If form looks good, praise it briefly. Do not wait to be asked — react to what you see.';

const KICKOFF_TEXT =
  'Hi coach — I am on camera now. Greet me in one short sentence out loud, ' +
  'then immediately say what you see in the frame and keep giving spoken form feedback as I move.';

const NUDGE_TEXT =
  'Look at the live camera right now and speak one short coaching note out loud about my posture or movement. ' +
  'If I am not exercising, briefly say what you see and ask me to show a rep.';

function liveWsUrl(token: string): string {
  const base =
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';
  // Do NOT encodeURIComponent — auth_tokens/... must keep the slash.
  return `${base}?access_token=${token}`;
}

function floatTo16BitPCM(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function downsample(
  buffer: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const newLen = Math.floor(buffer.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    result[i] = buffer[Math.floor(i * ratio)] ?? 0;
  }
  return result;
}

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

async function wsPayloadToText(data: unknown): Promise<string | null> {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return null;
}

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

/** Camera/mic require a secure context (https or localhost). */
function getMediaDevicesOrThrow(): MediaDevices {
  if (typeof window === 'undefined') {
    throw new Error('Camera is only available in the browser.');
  }
  if (!window.isSecureContext) {
    throw new Error(
      'Camera needs HTTPS or localhost. Open the app via https://… or http://localhost:3000 (not a raw LAN IP over http).'
    );
  }
  const devices = navigator.mediaDevices;
  if (!devices || typeof devices.getUserMedia !== 'function') {
    throw new Error(
      'This browser blocked camera/mic access. Use Chrome/Edge on https or localhost, and allow permissions.'
    );
  }
  return devices;
}

function formatRecordingClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Backoff before each reconnect attempt: 1s, then 2s, then 4s. */
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000] as const;

export type LiveSessionPhase = 'idle' | 'starting' | 'live' | 'ended' | 'error';

export function useLiveCoachSession() {
  const currentUser = useStore(s => s.currentUser);
  const [phase, setPhase] = useState<LiveSessionPhase>('idle');
  const [status, setStatus] = useState(
    'Ready — voice and video are not saved unless you tap Record.'
  );
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(LIVE_SESSION_LIMIT_MS / 1000);
  const [hasPreview, setHasPreview] = useState(false);
  const [youSaid, setYouSaid] = useState('');
  const [coachSaid, setCoachSaid] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null);
  const [isSavingRecording, setIsSavingRecording] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const sessionTimerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const nudgeTimerRef = useRef<number | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const setupDoneRef = useRef(false);
  const stoppingRef = useRef(false);
  /** True when we close on purpose (Stop, time limit, unmount) — never auto-reconnect. */
  const intentionalCloseRef = useRef(false);
  const reconnectingRef = useRef(false);
  /** TEMP: how many times auto-reconnect has been triggered this page lifetime. */
  const reconnectAttemptCountRef = useRef(0);
  /** TEMP: reconnect # that last opened a socket and is waiting for setupComplete (0 = initial). */
  const awaitingSetupAfterReconnectRef = useRef(0);
  const liveRef = useRef(false);
  const lastServerErrorRef = useRef<string | null>(null);
  const attemptReconnectRef = useRef<
    ((code: number, reason: string) => void) | null
  >(null);
  const audioChunkLogRef = useRef(0);
  const micLevelTickRef = useRef(0);
  /** TEMP diagnostics: count Live→Gemini audio/video packets while Record is on/off. */
  const liveAudioSendCountRef = useRef(0);
  const liveVideoSendCountRef = useRef(0);

  const liveSessionIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStartedAtRef = useRef<number | null>(null);
  const recordTickerRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);

  const recordingSupported =
    typeof MediaRecorder !== 'undefined' && !!pickRecorderMimeType();

  // Signal PWA update UI to defer prompts while Voice & Video is running.
  useEffect(() => {
    const busy = phase === 'starting' || phase === 'live';
    setLiveCoachSessionActive(busy);
    return () => {
      if (busy) setLiveCoachSessionActive(false);
    };
  }, [phase]);

  const unlockAudioContexts = () => {
    if (!playCtxRef.current) {
      playCtxRef.current = new AudioContext({ sampleRate: 24000 });
      nextPlayTimeRef.current = 0;
    }
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext({ sampleRate: 16000 });
    }
    void playCtxRef.current.resume();
    void audioCtxRef.current.resume();
  };

  const clearRecordTicker = () => {
    if (recordTickerRef.current != null) {
      window.clearInterval(recordTickerRef.current);
      recordTickerRef.current = null;
    }
  };

  const uploadRecordingBlob = async (blob: Blob, durationSeconds: number) => {
    if (!currentUser || typeof currentUser.getIdToken !== 'function') {
      setRecordingNotice('Sign in required to save recording.');
      return;
    }
    const sessionId = liveSessionIdRef.current;
    if (!sessionId) {
      setRecordingNotice('Could not save recording (missing session).');
      return;
    }
    if (!blob || blob.size === 0) {
      setRecordingNotice('Recording was empty.');
      return;
    }

    setIsSavingRecording(true);
    setRecordingNotice(null);
    try {
      const token = await currentUser.getIdToken();
      const form = new FormData();
      form.append('sessionId', sessionId);
      form.append(
        'durationSeconds',
        String(Math.max(0, Math.round(durationSeconds)))
      );
      form.append('recording', blob, 'session.webm');

      const res = await fetch(`${API_BASE}/api/coach/save-recording`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === 'string' ? data.error : 'save_recording_failed'
        );
      }
      setRecordingNotice('Recording saved');
    } catch (err) {
      console.warn('[LiveCoach] save recording failed:', err);
      setRecordingNotice(
        err instanceof Error
          ? `Could not save recording: ${err.message}`
          : 'Could not save recording.'
      );
    } finally {
      setIsSavingRecording(false);
    }
  };

  /** Stop MediaRecorder (if active), build blob, upload. Does not stop camera tracks. */
  const finalizeRecording = async (): Promise<void> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      isRecordingRef.current = false;
      setIsRecording(false);
      clearRecordTicker();
      return;
    }

    const durationSec =
      recordStartedAtRef.current != null
        ? (Date.now() - recordStartedAtRef.current) / 1000
        : recordingSeconds;

    const blob = await new Promise<Blob>((resolve) => {
      const finish = () => {
        const type = recorder.mimeType || 'video/webm';
        resolve(new Blob(recordChunksRef.current, { type }));
      };
      recorder.onstop = finish;
      try {
        if (recorder.state === 'recording') recorder.requestData();
        recorder.stop();
      } catch {
        finish();
      }
    });

    mediaRecorderRef.current = null;
    recordChunksRef.current = [];
    recordStartedAtRef.current = null;
    isRecordingRef.current = false;
    setIsRecording(false);
    clearRecordTicker();
    setRecordingSeconds(0);

    await uploadRecordingBlob(blob, durationSec);
  };

  const startRecording = () => {
    setRecordingNotice(null);
    const stream = streamRef.current;
    if (!stream || phase !== 'live') {
      setRecordingNotice('Start the live session before recording.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setRecordingNotice('Recording is not supported in this browser.');
      return;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      return;
    }

    const mimeType = pickRecorderMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      // TEMP: confirm Record binds the live stream object (not a clone).
      console.log('[LiveCoach][diag] MediaRecorder using stream', {
        sameAsStreamRef: stream === streamRef.current,
        streamId: stream.id,
        tracks: stream.getTracks().map((t) => ({
          kind: t.kind,
          id: t.id,
          readyState: t.readyState,
          muted: t.muted,
          enabled: t.enabled,
        })),
      });
    } catch (err) {
      console.warn('[LiveCoach] MediaRecorder start failed:', err);
      setRecordingNotice('Could not start recording.');
      return;
    }

    recordChunksRef.current = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) recordChunksRef.current.push(ev.data);
    };
    recorder.onerror = () => {
      setRecordingNotice('Recording error.');
    };

    mediaRecorderRef.current = recorder;
    recordStartedAtRef.current = Date.now();
    isRecordingRef.current = true;
    setIsRecording(true);
    setRecordingSeconds(0);
    clearRecordTicker();
    recordTickerRef.current = window.setInterval(() => {
      if (recordStartedAtRef.current == null) return;
      setRecordingSeconds(
        Math.floor((Date.now() - recordStartedAtRef.current) / 1000)
      );
    }, 250);

    try {
      recorder.start(1000);
      // TEMP: MediaRecorder.start should not stop/mute shared tracks — log post-start state.
      console.log('[LiveCoach][diag] after MediaRecorder.start track state', {
        tracks: stream.getTracks().map((t) => ({
          kind: t.kind,
          id: t.id,
          readyState: t.readyState,
          muted: t.muted,
          enabled: t.enabled,
        })),
      });
    } catch (err) {
      console.warn('[LiveCoach] MediaRecorder.start failed:', err);
      mediaRecorderRef.current = null;
      isRecordingRef.current = false;
      setIsRecording(false);
      clearRecordTicker();
      setRecordingNotice('Could not start recording.');
    }
  };

  const stopRecording = () => {
    void finalizeRecording();
  };

  const toggleRecording = () => {
    if (isRecordingRef.current) stopRecording();
    else startRecording();
  };

  const cleanup = (endedReason?: string) => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    intentionalCloseRef.current = true;
    reconnectingRef.current = false;

    const hadRecording =
      isRecordingRef.current ||
      (mediaRecorderRef.current != null &&
        mediaRecorderRef.current.state !== 'inactive');

    const finishCleanup = () => {
      if (frameTimerRef.current != null) {
        window.clearInterval(frameTimerRef.current);
        frameTimerRef.current = null;
      }
      if (sessionTimerRef.current != null) {
        window.clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = null;
      }
      if (countdownRef.current != null) {
        window.clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      if (nudgeTimerRef.current != null) {
        window.clearInterval(nudgeTimerRef.current);
        nudgeTimerRef.current = null;
      }

      try {
        processorRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      processorRef.current = null;

      try {
        void audioCtxRef.current?.close();
      } catch {
        /* ignore */
      }
      audioCtxRef.current = null;

      try {
        void playCtxRef.current?.close();
      } catch {
        /* ignore */
      }
      playCtxRef.current = null;
      nextPlayTimeRef.current = 0;

      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          if (
            wsRef.current.readyState === WebSocket.OPEN ||
            wsRef.current.readyState === WebSocket.CONNECTING
          ) {
            wsRef.current.close();
          }
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      }

      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      setupDoneRef.current = false;
      liveRef.current = false;
      setHasPreview(false);
      setMicLevel(0);
      if (endedReason) {
        setPhase('ended');
        setStatus(endedReason);
      }
      stoppingRef.current = false;
    };

    if (hadRecording) {
      void finalizeRecording()
        .catch(() => undefined)
        .finally(finishCleanup);
      return;
    }

    finishCleanup();
  };

  useEffect(() => {
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playPcm24k = (b64: string) => {
    try {
      if (!playCtxRef.current) {
        playCtxRef.current = new AudioContext({ sampleRate: 24000 });
        nextPlayTimeRef.current = 0;
      }
      const ctx = playCtxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();
      const pcm = base64ToInt16(b64);
      const float32 = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) float32[i] = pcm[i] / 32768;
      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.copyToChannel(float32, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const now = ctx.currentTime;
      if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now;
      src.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += buffer.duration;
      audioChunkLogRef.current += 1;
      if (audioChunkLogRef.current === 1 || audioChunkLogRef.current % 20 === 0) {
        console.log(
          '[LiveCoach] playing coach audio chunk #',
          audioChunkLogRef.current
        );
      }
    } catch (err) {
      console.warn('[LiveCoach] audio playback failed:', err);
    }
  };

  const sendJson = (ws: WebSocket, payload: unknown) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  };

  const startMicStreaming = (ws: WebSocket, stream: MediaStream) => {
    try {
      processorRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    processorRef.current = null;

    const audioCtx =
      audioCtxRef.current ?? new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = audioCtx;
    if (audioCtx.state === 'suspended') void audioCtx.resume();

    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    const mute = audioCtx.createGain();
    mute.gain.value = 0;

    processor.onaudioprocess = (ev) => {
      if (!setupDoneRef.current || ws.readyState !== WebSocket.OPEN) return;
      const input = ev.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / Math.max(1, input.length));
      micLevelTickRef.current += 1;
      if (micLevelTickRef.current % 8 === 0) {
        setMicLevel(Math.min(1, rms * 8));
      }

      const down = downsample(input, audioCtx.sampleRate, 16000);
      const pcm = floatTo16BitPCM(down);
      const data = int16ToBase64(pcm);
      sendJson(ws, {
        realtimeInput: {
          audio: {
            mimeType: 'audio/pcm',
            data,
          },
        },
      });
      liveAudioSendCountRef.current += 1;
      // TEMP: verify mic→Gemini loop keeps firing (esp. while Record is active).
      if (
        liveAudioSendCountRef.current === 1 ||
        liveAudioSendCountRef.current % 50 === 0
      ) {
        console.log(
          '[LiveCoach][diag] audio send #',
          liveAudioSendCountRef.current,
          '| recording=',
          isRecordingRef.current
        );
      }
    };

    source.connect(processor);
    processor.connect(mute);
    mute.connect(audioCtx.destination);
  };

  const startFrameStreaming = (ws: WebSocket) => {
    if (frameTimerRef.current != null) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    frameTimerRef.current = window.setInterval(() => {
      if (!setupDoneRef.current || ws.readyState !== WebSocket.OPEN) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;

      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      // Higher res + quality so the model can read posture/limbs better.
      canvas.width = Math.min(w, 960);
      canvas.height = Math.round((canvas.width / Math.max(w, 1)) * h);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      const data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      sendJson(ws, {
        realtimeInput: {
          video: {
            mimeType: 'image/jpeg',
            data,
          },
        },
      });
      liveVideoSendCountRef.current += 1;
      // TEMP: verify canvas→Gemini frame loop keeps firing (esp. while Record is active).
      console.log(
        '[LiveCoach][diag] video frame send #',
        liveVideoSendCountRef.current,
        '| recording=',
        isRecordingRef.current,
        '| size=',
        canvas.width,
        'x',
        canvas.height
      );
    }, FRAME_INTERVAL_MS);
  };

  const startCoachNudges = (ws: WebSocket) => {
    if (nudgeTimerRef.current != null) {
      window.clearInterval(nudgeTimerRef.current);
    }
    nudgeTimerRef.current = window.setInterval(() => {
      if (!setupDoneRef.current || !liveRef.current) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      sendJson(ws, {
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: NUDGE_TEXT }] }],
          turnComplete: true,
        },
      });
    }, COACH_NUDGE_INTERVAL_MS);
  };

  const handleWsMessage = async (raw: MessageEvent) => {
    try {
      const text = await wsPayloadToText(raw.data);
      if (!text) return;
      const msg = JSON.parse(text) as {
        setupComplete?: unknown;
        serverContent?: {
          interrupted?: boolean;
          inputTranscription?: { text?: string };
          outputTranscription?: { text?: string };
          modelTurn?: {
            parts?: Array<{
              inlineData?: { data?: string; mimeType?: string };
            }>;
          };
        };
        error?: { message?: string } | string;
      };

      if (msg.setupComplete != null) {
        setupDoneRef.current = true;
        const afterReconnectN = awaitingSetupAfterReconnectRef.current;
        awaitingSetupAfterReconnectRef.current = 0;
        console.log('[LiveCoach] setupComplete received', {
          at: new Date().toISOString(),
          afterReconnectAttempt:
            afterReconnectN > 0 ? afterReconnectN : null,
          isInitialSetup: afterReconnectN === 0,
        });
        setStatus('Live — move or speak; coach is watching.');
        if (wsRef.current) {
          sendJson(wsRef.current, {
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: KICKOFF_TEXT }] }],
              turnComplete: true,
            },
          });
          startCoachNudges(wsRef.current);
        }
        return;
      }

      if (msg.error) {
        const errText =
          typeof msg.error === 'string'
            ? msg.error
            : msg.error?.message || JSON.stringify(msg.error);
        lastServerErrorRef.current = errText;
        console.warn('[LiveCoach] server error:', errText);
        return;
      }

      const sc = msg.serverContent;
      if (!sc) return;

      if (sc.interrupted) {
        nextPlayTimeRef.current = 0;
      }

      const inT = sc.inputTranscription?.text;
      if (typeof inT === 'string' && inT) {
        setYouSaid((prev) => (prev + inT).slice(-400));
      }
      const outT = sc.outputTranscription?.text;
      if (typeof outT === 'string' && outT) {
        setCoachSaid((prev) => (prev + outT).slice(-600));
      }

      const parts = sc.modelTurn?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          const inline = part.inlineData;
          if (
            inline &&
            typeof inline.data === 'string' &&
            typeof inline.mimeType === 'string' &&
            inline.mimeType.startsWith('audio/')
          ) {
            playPcm24k(inline.data);
          }
        }
      }
    } catch (err) {
      console.warn('[LiveCoach] bad WS message:', err);
    }
  };

  /** Tear down Live WS transport only — keep MediaStream + MediaRecorder. */
  const detachLiveTransport = () => {
    setupDoneRef.current = false;

    if (frameTimerRef.current != null) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (nudgeTimerRef.current != null) {
      window.clearInterval(nudgeTimerRef.current);
      nudgeTimerRef.current = null;
    }

    try {
      processorRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    processorRef.current = null;

    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        if (
          wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING
        ) {
          wsRef.current.close();
        }
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }
  };

  const fetchLiveToken = async (): Promise<string> => {
    if (!currentUser || typeof currentUser.getIdToken !== 'function') {
      throw new Error('Sign in required.');
    }
    const idToken = await currentUser.getIdToken();
    const res = await fetch(`${API_BASE}/api/coach/live-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data.token !== 'string') {
      throw new Error(
        data?.message || data?.error || 'Could not get live token'
      );
    }
    console.log('[LiveCoach] token prefix:', data.token.slice(0, 24));
    return data.token;
  };

  const bindWsHandlers = (ws: WebSocket) => {
    ws.onmessage = (ev) => {
      void handleWsMessage(ev);
    };
    ws.onclose = (ev) => {
      const detail = [
        `code=${ev.code}`,
        ev.reason ? `reason=${ev.reason}` : null,
        lastServerErrorRef.current
          ? `server=${lastServerErrorRef.current}`
          : null,
        setupDoneRef.current ? 'afterSetup' : 'beforeSetup',
      ]
        .filter(Boolean)
        .join(' · ');
      console.warn('[LiveCoach] WS closed:', detail, ev);

      // Stop / time limit / unmount — never auto-reconnect.
      if (intentionalCloseRef.current || stoppingRef.current) {
        return;
      }

      const wasLive = liveRef.current || setupDoneRef.current;
      // Unexpected close while the user still expects a live session
      // (esp. Google 1011 "service unavailable"). Not user-initiated 1000 Stop.
      if (wasLive && !reconnectingRef.current) {
        attemptReconnectRef.current?.(ev.code, ev.reason || '');
        return;
      }

      if (!wasLive && !stoppingRef.current && !reconnectingRef.current) {
        setPhase('error');
        setError(`WebSocket closed before live (${detail}).`);
        setStatus('Failed to start.');
      }
    };
    ws.onerror = () => {
      if (!intentionalCloseRef.current && !reconnectingRef.current) {
        setError('Live WebSocket error');
      }
    };
  };

  const connectLiveSocket = async (token: string): Promise<WebSocket> => {
    const ws = new WebSocket(liveWsUrl(token));
    wsRef.current = ws;

    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(
        () => reject(new Error('WebSocket connect timeout')),
        15000
      );
      ws.onopen = () => {
        window.clearTimeout(t);
        resolve();
      };
      ws.onerror = () => {
        window.clearTimeout(t);
        reject(new Error('WebSocket connection failed'));
      };
    });

    bindWsHandlers(ws);
    return ws;
  };

  const bootstrapLiveOnSocket = (ws: WebSocket, stream: MediaStream) => {
    setupDoneRef.current = false;
    sendJson(ws, {
      setup: {
        model: LIVE_MODEL,
        generationConfig: {
          responseModalities: ['AUDIO'],
        },
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });
    startMicStreaming(ws, stream);
    startFrameStreaming(ws);
  };

  const attemptReconnect = async (code: number, reason: string) => {
    if (intentionalCloseRef.current || stoppingRef.current) return;
    if (reconnectingRef.current) return;

    const stream = streamRef.current;
    if (!stream || !liveRef.current) {
      cleanup(
        lastServerErrorRef.current
          ? `Session closed: ${lastServerErrorRef.current}`
          : 'Session closed unexpectedly.'
      );
      return;
    }

    reconnectingRef.current = true;
    reconnectAttemptCountRef.current += 1;
    const reconnectN = reconnectAttemptCountRef.current;
    console.warn(`[LiveCoach] reconnect attempt #${reconnectN}`, {
      at: new Date().toISOString(),
      code,
      reason,
      streamStillPresent: !!streamRef.current,
      streamTrackStates: streamRef.current?.getTracks().map((t) => ({
        kind: t.kind,
        readyState: t.readyState,
        enabled: t.enabled,
        muted: t.muted,
      })),
    });
    setError(null);
    setStatus('Reconnecting…');
    setPhase('live');

    // Drop dead socket + mic/frame senders; keep cam/mic tracks + MediaRecorder.
    detachLiveTransport();

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < RECONNECT_BACKOFF_MS.length; attempt++) {
      if (intentionalCloseRef.current || stoppingRef.current) {
        reconnectingRef.current = false;
        return;
      }

      await sleep(RECONNECT_BACKOFF_MS[attempt]);

      if (intentionalCloseRef.current || stoppingRef.current) {
        reconnectingRef.current = false;
        return;
      }

      try {
        console.warn(
          `[LiveCoach] reconnect attempt #${reconnectN} backoff try ${attempt + 1}/${RECONNECT_BACKOFF_MS.length}`,
          { at: new Date().toISOString() }
        );
        setStatus(
          attempt === 0
            ? 'Reconnecting…'
            : `Reconnecting… (try ${attempt + 1}/${RECONNECT_BACKOFF_MS.length})`
        );
        const token = await fetchLiveToken();
        if (intentionalCloseRef.current || stoppingRef.current) {
          reconnectingRef.current = false;
          return;
        }
        const ws = await connectLiveSocket(token);
        if (!streamRef.current) {
          throw new Error('Camera stream lost during reconnect');
        }
        awaitingSetupAfterReconnectRef.current = reconnectN;
        bootstrapLiveOnSocket(ws, streamRef.current);
        // If Google drops the socket immediately after open, treat as failed attempt.
        await sleep(250);
        if (intentionalCloseRef.current || stoppingRef.current) {
          reconnectingRef.current = false;
          return;
        }
        if (
          wsRef.current !== ws ||
          ws.readyState !== WebSocket.OPEN
        ) {
          throw new Error('Socket closed immediately after reconnect');
        }
        liveAudioSendCountRef.current = 0;
        liveVideoSendCountRef.current = 0;
        nextPlayTimeRef.current = 0;
        reconnectingRef.current = false;
        setError(null);
        setStatus('Waiting for setupComplete…');
        console.log(
          `[LiveCoach] reconnect attempt #${reconnectN} socket open — waiting for setupComplete`,
          { at: new Date().toISOString(), code, backoffTry: attempt + 1 }
        );
        return;
      } catch (err) {
        lastErr = err;
        awaitingSetupAfterReconnectRef.current = 0;
        console.warn(
          `[LiveCoach] reconnect attempt #${reconnectN} failed`,
          { at: new Date().toISOString(), backoffTry: attempt + 1 },
          err
        );
        detachLiveTransport();
      }
    }

    reconnectingRef.current = false;
    const msg =
      lastErr instanceof Error
        ? lastErr.message
        : 'Connection lost after several reconnect attempts.';
    setPhase('error');
    setError(`${msg} Tap Start session to try again.`);
    setStatus('Reconnect failed.');
    cleanup();
  };
  attemptReconnectRef.current = (c, r) => {
    void attemptReconnect(c, r);
  };

  const startSession = async () => {
    if (phase === 'starting' || phase === 'live') return;

    setError(null);
    lastServerErrorRef.current = null;
    setYouSaid('');
    setCoachSaid('');
    setMicLevel(0);
    setRecordingNotice(null);
    audioChunkLogRef.current = 0;
    setPhase('starting');
    setStatus('Requesting live token…');
    stoppingRef.current = false;
    intentionalCloseRef.current = false;
    reconnectingRef.current = false;
    setupDoneRef.current = false;
    liveSessionIdRef.current =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `live_${Date.now()}`;

    unlockAudioContexts();

    if (!currentUser || typeof currentUser.getIdToken !== 'function') {
      setPhase('error');
      setError('Sign in required.');
      return;
    }

    try {
      // Fail early with a clear message if cam/mic APIs are unavailable.
      const mediaDevices = getMediaDevicesOrThrow();

      const token = await fetchLiveToken();

      setStatus('Requesting camera + microphone…');
      const stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setHasPreview(true);
      unlockAudioContexts();

      setStatus('Connecting to Gemini Live…');
      const ws = await connectLiveSocket(token);
      bootstrapLiveOnSocket(ws, stream);

      liveRef.current = true;
      setPhase('live');
      setSecondsLeft(LIVE_SESSION_LIMIT_MS / 1000);
      setStatus('Waiting for setupComplete…');
      liveAudioSendCountRef.current = 0;
      liveVideoSendCountRef.current = 0;

      countdownRef.current = window.setInterval(() => {
        setSecondsLeft((s) => Math.max(0, s - 1));
      }, 1000);

      sessionTimerRef.current = window.setTimeout(() => {
        cleanup('Session ended (demo limit)');
      }, LIVE_SESSION_LIMIT_MS);
    } catch (err) {
      cleanup();
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Failed to start session');
      setStatus('Failed to start.');
    }
  };

  const stopSession = () => {
    intentionalCloseRef.current = true;
    cleanup('Session stopped.');
  };

  return {
    phase,
    status,
    error,
    secondsLeft,
    hasPreview,
    youSaid,
    coachSaid,
    micLevel,
    videoRef,
    canvasRef,
    startSession,
    stopSession,
    LIVE_MODEL,
    recordingSupported,
    isRecording,
    recordingSeconds,
    recordingClock: formatRecordingClock(recordingSeconds),
    recordingNotice,
    isSavingRecording,
    toggleRecording,
  };
}
