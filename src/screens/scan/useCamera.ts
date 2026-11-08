// Live back camera for the viewfinder, on while the component using it is mounted. It is stopped whenever
// the page is hidden, so the camera light never stays on behind another app.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export type CameraStatus = 'starting' | 'live' | 'denied' | 'unavailable';

export interface Camera {
  status: CameraStatus;
  /** null when the device has no controllable torch. */
  torch: boolean | null;
  toggleTorch: () => void;
  /** Stop now (call before navigating away: iOS ties camera permission to the page). */
  stop: () => void;
  retry: () => void;
}

const CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
};

function errorStatus(err: unknown): CameraStatus {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable';
}

function hasTorch(track: MediaStreamTrack | undefined): boolean {
  // `torch` is not in the TS DOM types yet; WebKit and Chromium report it on capable back cameras.
  const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
  return caps?.torch === true;
}

export function useCamera(video: RefObject<HTMLVideoElement>): Camera {
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [torch, setTorch] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const stream = useRef<MediaStream | null>(null);
  // Bumped on every start/stop so a getUserMedia that resolves late can tell it is no longer wanted.
  const generation = useRef(0);

  const stop = useCallback(() => {
    generation.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setTorch(null);
  }, [video]);

  const start = useCallback(async () => {
    const gen = ++generation.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable'); // no camera API, or not a secure context
      return;
    }
    setStatus('starting');
    try {
      const media = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      if (gen !== generation.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const el = video.current;
      if (el) {
        el.srcObject = media;
        await el.play().catch(() => undefined); // autoplay + muted normally starts it anyway
      }
      if (gen !== generation.current) return;
      setTorch(hasTorch(media.getVideoTracks()[0]) ? false : null);
      setStatus('live');
    } catch (err) {
      if (gen === generation.current) setStatus(errorStatus(err));
    }
  }, [video]);

  useEffect(() => {
    const onVisibility = () => (document.hidden ? stop() : void start());
    if (!document.hidden) void start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [attempt, start, stop]);

  const toggleTorch = useCallback(() => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    const next = !torch;
    track
      .applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      .then(() => setTorch(next))
      .catch(() => setTorch(null));
  }, [torch]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, torch, toggleTorch, stop, retry };
}
