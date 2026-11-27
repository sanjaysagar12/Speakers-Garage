/**
 * Voice priming for the "Enter" click. Browsers only let a page start audio, and only show the
 * microphone prompt reliably, inside a user gesture, so the click handler calls primeVoice() synchronously:
 *  - it creates and resumes the AudioContext (remote voices can play without another click),
 *  - it starts the microphone request (the browser's prompt appears while the world loads).
 * Nothing here runs on page load or while the player is still choosing on the landing page. The track
 * stays disabled (not sending, not recorded) until the voice connection is up; voice.ts adopts both, or
 * releases them if the game ends up offline.
 *
 * Tiny on purpose: the landing page imports it (no WebRTC or three.js code).
 */

export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  video: false,
};

let ctx: AudioContext | null = null;
let mic: Promise<MediaStream> | null = null;

/** Call synchronously from the Enter click handler. */
export function primeVoice(opts: { online: boolean; micOn: boolean }): void {
  releasePrimed();
  if (!opts.online) return;
  try {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    void ctx.resume().catch(() => undefined);
  } catch {
    ctx = null;
  }
  if (opts.micOn && window.isSecureContext && navigator.mediaDevices?.getUserMedia) {
    mic = navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS).then((s) => {
      for (const t of s.getAudioTracks()) t.enabled = false;
      return s;
    });
    mic.catch(() => undefined); // the outcome is read by voice.ts
  }
}

/** Hand the primed context and microphone request over (once). */
export function takePrimed(): { ctx: AudioContext | null; mic: Promise<MediaStream> | null } {
  const out = { ctx, mic };
  ctx = null;
  mic = null;
  return out;
}

/** Drop anything primed but not used (offline game, leaving before voice started): the mic is released. */
export function releasePrimed(): void {
  const { ctx: c, mic: m } = takePrimed();
  m?.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => undefined);
  void c?.close().catch(() => undefined);
}

/** 'granted' | 'denied' | 'prompt' | 'unknown' (for the hint under the Enter button). */
export async function micPermission(): Promise<string> {
  try {
    const st = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return st.state;
  } catch {
    return 'unknown';
  }
}
