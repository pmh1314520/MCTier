import { useEffect, useRef, useState } from 'react';
import { MAX_VOICE_BYTES } from '../services/chat/voiceMessage';
import { captureVoiceStream } from '../services/voice/nvidiaNoise';
import { lobbyCaptureGate } from '../services/voice/lobbyCaptureGate';

export function useHoldVoice(enabled: boolean, send: (blob: Blob, duration: number) => Promise<void>, failed: () => void, context: string) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const deliveryGeneration = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const startY = useRef(0);
  const cancelled = useRef(false);
  const started = useRef(0);
  const releaseLobby = useRef<(() => void) | null>(null);
  const job = useRef<{ cancelled: boolean } | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  const finish = (cancel: boolean) => {
    generation.current++;
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    cancelled.current = cancel;
    const active = recorder.current;
    if (job.current) job.current.cancelled = cancel;
    job.current = null;
    recorder.current = null;
    try {
      if (active && active.state !== 'inactive') active.stop();
    } catch {
      failed();
    } finally {
      active?.stream.getTracks().forEach(track => track.stop());
      releaseLobby.current?.();
      releaseLobby.current = null;
      setSeconds(null);
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (!enabled) finish(true);
    const cancel = () => finish(true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', key);
    return () => {
      deliveryGeneration.current++;
      cancel();
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', cancel);
      window.removeEventListener('keydown', key);
    };
  }, [context, enabled]);

  return {
    seconds, cancelling,
    cancel: () => finish(true),
    handlers: {
      onPointerDown: (event: React.PointerEvent<HTMLTextAreaElement>) => {
        if (!enabled || event.button !== 0 || pending.current || recorder.current) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        startY.current = event.clientY;
        cancelled.current = false;
        const ticket = ++generation.current;
        pending.current = setTimeout(async () => {
          let stream: MediaStream | null = null;
          const release = lobbyCaptureGate.suspend();
          releaseLobby.current = release;
          try {
            stream = await captureVoiceStream();
            if (ticket !== generation.current) { stream.getTracks().forEach(t => t.stop()); release(); return; }
            const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
            if (!mimeType) { stream.getTracks().forEach(t => t.stop()); throw new Error('No voice codec'); }
            // Mono Opus at 16 kbps keeps speech intelligible with ~120 KB/minute.
            await Promise.all(stream.getAudioTracks().map(track => track.applyConstraints({ channelCount: 1 }).catch(() => {})));
            if (ticket !== generation.current) { stream.getTracks().forEach(t => t.stop()); release(); return; }
            const active = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: mimeType.includes('opus') ? 16000 : 24000 });
            const currentJob = { cancelled: false };
            job.current = currentJob;
            const sendRecording = sendRef.current;
            const deliveryTicket = deliveryGeneration.current;
            const began = performance.now();
            const chunks: Blob[] = [];
            recorder.current = active;
            stream.getAudioTracks()[0]?.addEventListener?.('ended', () => {
              if (recorder.current === active) { finish(true); failed(); }
            }, { once: true });
            active.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
            active.onerror = () => { finish(true); failed(); };
            active.onstop = () => {
              if (deliveryTicket !== deliveryGeneration.current) return;
              const duration = Math.min(60, (performance.now() - began) / 1000);
              const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
              if (!currentJob.cancelled && duration >= 0.5 && blob.size > 0 && blob.size <= MAX_VOICE_BYTES) {
                void sendRecording(blob, duration).catch(failed);
              } else if (!currentJob.cancelled) failed();
            };
            started.current = performance.now();
            active.start();
            setSeconds(0);
            timer.current = setInterval(() => {
              const elapsed = (performance.now() - started.current) / 1000;
              setSeconds(Math.floor(elapsed));
              if (elapsed >= 60) finish(cancelled.current);
            }, 100);
          } catch {
            stream?.getTracks().forEach(track => track.stop());
            release();
            if (ticket === generation.current) { finish(true); failed(); }
          }
        }, 400);
      },
      onPointerMove: (event: React.PointerEvent<HTMLTextAreaElement>) => {
        if (!pending.current) return;
        cancelled.current = startY.current - event.clientY > 60;
        setCancelling(cancelled.current);
      },
      onPointerUp: () => finish(cancelled.current),
      onPointerCancel: () => finish(true),
      onContextMenu: (event: React.MouseEvent) => { if (pending.current) event.preventDefault(); },
    },
  };
}
