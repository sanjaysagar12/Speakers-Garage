/**
 * Voice seam. The game only talks to this interface; MeshVoiceAdapter (peer-to-peer, ~6 peers) is the
 * implementation today, LiveKitVoiceAdapter is the documented path for crowds (an SFU).
 */
export interface VoiceConnectOptions {
  /** an AudioContext created (and resumed) inside the user's click, so remote audio may play */
  ctx?: AudioContext | null;
  /** a microphone request started inside the user's click */
  mic?: Promise<MediaStream> | null;
  /** false: join muted without opening the microphone (it opens on the first unmute) */
  micOn?: boolean;
}

/** live: sending; muted: open but not sending (or not opened yet); unavailable: denied / no device / no HTTPS */
export type MicState = 'live' | 'muted' | 'unavailable';

export interface VoiceAdapter {
  /**
   * Join voice in the current room. Never fails because of the microphone: without one (denied, missing,
   * no HTTPS) the player joins listen-only and can retry later.
   */
  connect(room: string, opts?: VoiceConnectOptions): Promise<void>;
  /** microphone state for the HUD indicator (optional for adapters added later) */
  readonly micState?: MicState;
  /** try to open the microphone again after it was denied or missing */
  enableMic?(): Promise<void>;
  setLocalMute(muted: boolean): void;
  /** a remote player's audio stream arrived (or changed) */
  onRemoteStream(cb: (playerId: number, stream: MediaStream) => void): () => void;
  /** leave voice, close every peer, release the microphone */
  dispose(): void;
}

export type VoiceErrorCode = 'denied' | 'no-device' | 'insecure' | 'unsupported' | 'failed';

export class VoiceError extends Error {
  constructor(
    readonly code: VoiceErrorCode,
    message: string,
  ) {
    super(message);
  }
}
