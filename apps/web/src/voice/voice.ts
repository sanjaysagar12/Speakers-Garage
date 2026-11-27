import { gameStore, saveBlocked } from '../store/gameStore';
import { session } from '../game/net/session';
import { remotes } from '../game/net/entities';
import { QUALITY } from '../game/config';
import { MeshVoiceAdapter } from './MeshVoiceAdapter';
import { VoiceError } from './VoiceAdapter';

/**
 * The voice controller for the HUD: one MeshVoiceAdapter while the player has joined voice, mirrored into
 * the store (zustand) at a low rate. Nothing here runs until the player clicks "Join voice", so the
 * microphone permission is only ever requested on that click.
 */

/** listener pose, written by the world every frame (cheap assignment), read by the 20 Hz audio loop */
export const listenerPose = { x: 0, z: 0, yaw: 0 };

let adapter: MeshVoiceAdapter | null = null;
let publishTimer = 0;

const store = () => gameStore.getState();

function publish(): void {
  const a = adapter;
  if (!a) return;
  const peers = a.peerStatus().map((p) => ({ id: p.id, quality: p.quality }));
  const v = store().voice;
  const next = { muted: a.isMuted, deafened: a.isDeafened, ptt: a.isPtt, micLive: a.micLive, speaking: a.speakingNow, peers };
  const changed =
    v.muted !== next.muted ||
    v.deafened !== next.deafened ||
    v.ptt !== next.ptt ||
    v.micLive !== next.micLive ||
    v.speaking !== next.speaking ||
    v.peers.length !== peers.length ||
    v.peers.some((p, i) => p.id !== peers[i]?.id || p.quality !== peers[i]?.quality);
  if (changed) store().setVoice(next);
}

async function listDevices(): Promise<void> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const ctx = AudioContext.prototype as AudioContext & { setSinkId?: unknown };
    store().setVoice({
      inputs: all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
      outputs: all.filter((d) => d.kind === 'audiooutput').map((d, i) => ({ id: d.deviceId, label: d.label || `Speaker ${i + 1}` })),
      canPickOutput: typeof ctx.setSinkId === 'function',
    });
  } catch {
    /* no device list */
  }
}

export const voice = {
  get active(): boolean {
    return adapter !== null;
  },

  async join(): Promise<void> {
    if (adapter || store().voice.joining) return;
    const net = session.adapter;
    if (!net.authoritative || !net.sendVoice) {
      store().setVoice({ error: 'Voice needs an online room.' });
      return;
    }
    const q = QUALITY[store().ui.quality];
    store().setVoice({ joining: true, error: undefined });
    const a = new MeshVoiceAdapter(net, {
      maxPeers: q.voicePeers,
      bitrate: q.voiceBitrate,
      spatial: q.voiceSpatial,
      selfId: () => remotes.selfId,
      ice: () => session.ws?.welcome?.ice ?? [],
      selfPos: () => ({ x: listenerPose.x, z: listenerPose.z }),
      listener: () => listenerPose,
      isBlocked: (id) => store().voice.blocked.includes(id),
    });
    a.onChange = publish;
    try {
      await a.connect();
    } catch (e) {
      a.dispose();
      store().setVoice({ joining: false, joined: false, error: e instanceof VoiceError ? e.message : 'Voice could not start.' });
      return;
    }
    adapter = a;
    // re-apply per-player volumes chosen earlier
    a.onRemoteStream((id) => {
      const pv = store().voice.peerVolume[id];
      if (pv) a.setPeerVolume(id, pv.volume, pv.muted);
    });
    publishTimer = window.setInterval(publish, 200);
    store().setVoice({ joining: false, joined: true });
    publish();
    void listDevices();
  },

  leave(): void {
    window.clearInterval(publishTimer);
    adapter?.dispose();
    adapter = null;
    store().setVoice({ joined: false, joining: false, micLive: false, speaking: false, peers: [] });
  },

  toggleMute(): void {
    adapter?.setLocalMute(!adapter.isMuted);
  },
  toggleDeafen(): void {
    adapter?.setDeafened(!adapter.isDeafened);
  },
  setPushToTalk(on: boolean): void {
    adapter?.setPushToTalk(on);
  },
  setPttHeld(held: boolean): void {
    adapter?.setPttHeld(held);
  },
  async setInput(id: string): Promise<void> {
    try {
      await adapter?.setInputDevice(id);
    } catch (e) {
      store().setVoice({ error: e instanceof VoiceError ? e.message : 'Could not switch the microphone.' });
    }
  },
  async setOutput(id: string): Promise<void> {
    const ok = await adapter?.setOutputDevice(id);
    if (ok === false) store().setVoice({ error: 'This browser cannot choose the speaker.' });
  },
  setPeerVolume(id: number, volume: number, muted: boolean): void {
    store().setVoice({ peerVolume: { ...store().voice.peerVolume, [id]: { volume, muted } } });
    adapter?.setPeerVolume(id, volume, muted);
  },
  setBlocked(id: number, blocked: boolean): void {
    const list = store().voice.blocked.filter((x) => x !== id);
    if (blocked) list.push(id);
    store().setVoice({ blocked: list });
    saveBlocked(list);
    if (blocked) adapter?.block(id);
  },
};
