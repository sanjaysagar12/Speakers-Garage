import { VoiceError, type VoiceAdapter } from './VoiceAdapter';

/**
 * Placeholder for larger crowds. A mesh sends your audio once per peer, which is fine for ~6 people in
 * earshot; beyond that an SFU (selective forwarding unit) is the standard answer: each client uploads one
 * stream and the SFU forwards what each listener needs.
 *
 * Plan (not implemented):
 *  - run LiveKit (self-hosted, Apache-2.0) next to the game server; the game server mints a LiveKit access
 *    token per player (room = game room) and sends it in `welcome`
 *  - connect with livekit-client, publish the mic track (Opus, DTX, same constraints as the mesh)
 *  - proximity stays client-side: subscribe only to participants within the connect radius (LiveKit's
 *    selective subscription), and feed each subscribed track into the same spatial graph (voice/spatial.ts)
 *  - speaking detection comes from LiveKit's active-speaker events instead of local analysers
 * The VoiceAdapter interface stays the same, so the HUD and the world code don't change.
 */
export class LiveKitVoiceAdapter implements VoiceAdapter {
  connect(): Promise<void> {
    return Promise.reject(new VoiceError('unsupported', 'LiveKit voice is not set up on this server.'));
  }
  setLocalMute(): void {
    /* not implemented */
  }
  onRemoteStream(): () => void {
    return () => undefined;
  }
  dispose(): void {
    /* nothing to release */
  }
}
