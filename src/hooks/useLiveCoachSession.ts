/**
 * Gemini Live API session — mic + camera + PCM playback.
 * Nothing is persisted unless the user explicitly taps Record (opt-in).
 * 3-minute hard limit (POC rules).
 */

import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../lib/appConfig';
import useStore from '../store/useStore';

export const LIVE_SESSION_LIMIT_MS = 3 * 60 * 1000;
const FRAME_INTERVAL_MS = 1000;

const LIVE_MODEL_ID =
  import.meta.env.VITE_GEMINI_LIVE_MODEL ||
  'gemini-2.5-flash-native-audio-preview-12-2025';

export const LIVE_MODEL = LIVE_MODEL_ID.startsWith('models/')
  ? LIVE_MODEL_ID
  : `models/${LIVE_MODEL_ID}`;

const SYSTEM_INSTRUCTION =
  'You are a friendly fitness coach in a live voice+camera session. ' +
  'Always reply out loud with short spoken answers. ' +
  'Watch the camera feed and comment on form when the user asks or when you see an exercise. ' +
  'If form looks okay, say so clearly; if not, give one concrete correction. ' +
  'Keep each reply under two sentences.';

const KICKOFF_TEXT =
  'Hi coach — I am on camera and ready. Greet me briefly, then watch my form. ' +
  'When I speak or do an exercise, reply out loud with short feedback.';

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

function formatRecordingClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

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
  const playCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const setupDoneRef = useRef(false);
  const stoppingRef = useRef(false);
  const liveRef = useRef(false);
  const lastServerErrorRef = useRef<string | null>(null);
  const audioChunkLogRef = useRef(0);
  const micLevelTickRef = useRef(0);

  const liveSessionIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStartedAtRef = useRef<number | null>(null);
  const recordTickerRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);

  const recordingSupported =
    typeof MediaRecorder !== 'undefined' && !!pickRecorderMimeType();

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

    clearRecordTicker();
    mediaRecorderRef.current = null;
    recordChunksRef.current = [];
    recordStartedAtRef.current = null;
    isRecordingRef.current = false;
    setIsRecording(false);
    setRecordingSeconds(0);
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
    };

    source.connect(processor);
    processor.connect(mute);
    mute.connect(audioCtx.destination);
  };

  const startFrameStreaming = (ws: WebSocket) => {
    frameTimerRef.current = window.setInterval(() => {
      if (!setupDoneRef.current || ws.readyState !== WebSocket.OPEN) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;

      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      canvas.width = Math.min(w, 640);
      canvas.height = Math.round((canvas.width / w) * h);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      sendJson(ws, {
        realtimeInput: {
          video: {
            mimeType: 'image/jpeg',
            data,
          },
        },
      });
    }, FRAME_INTERVAL_MS);
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
        setStatus('Live — speak or show your form.');
        if (wsRef.current) {
          sendJson(wsRef.current, {
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: KICKOFF_TEXT }] }],
              turnComplete: true,
            },
          });
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

  const startSession = async () => {
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

      setStatus('Requesting camera + microphone…');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: { facingMode: 'user' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setHasPreview(true);
      unlockAudioContexts();

      setStatus('Connecting to Gemini Live…');
      const ws = new WebSocket(liveWsUrl(data.token));
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
        if (liveRef.current || setupDoneRef.current) {
          cleanup(
            lastServerErrorRef.current
              ? `Session closed: ${lastServerErrorRef.current}`
              : `Session closed (${detail}).`
          );
        } else if (!stoppingRef.current) {
          setPhase('error');
          setError(`WebSocket closed before live (${detail}).`);
          setStatus('Failed to start.');
        }
      };
      ws.onerror = () => {
        setError('Live WebSocket error');
      };

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

      liveRef.current = true;
      setPhase('live');
      setSecondsLeft(LIVE_SESSION_LIMIT_MS / 1000);
      setStatus('Waiting for setupComplete…');

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
