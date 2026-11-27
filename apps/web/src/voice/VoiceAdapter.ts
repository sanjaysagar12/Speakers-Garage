/**
 * Voice seam. The game only talks to this interface; MeshVoiceAdapter (peer-to-peer, ~6 peers) is the
 * implementation today, LiveKitVoiceAdapter is the documented path for crowds (an SFU).
 */
export interface VoiceAdapter {
  /** join voice in the current room (asks for the microphone) */
  connect(room: string): Promise<void>;
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
