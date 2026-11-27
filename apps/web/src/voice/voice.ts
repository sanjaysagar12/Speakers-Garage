import { gameStore, saveBlocked } from '../store/gameStore';
import { session } from '../game/net/session';
import { remotes } from '../game/net/entities';
import { QUALITY } from '../game/config';
import { MeshVoiceAdapter } from './MeshVoiceAdapter';
import { VoiceError, type VoiceConnectOptions } from './VoiceAdapter';
import { releasePrimed, takePrimed } from './prime';

/**
 * The voice controller for the HUD: one MeshVoiceAdapter while the player is in voice, mirrored into the
 * store (zustand) at a low rate. Voice joins automatically when the player enters an online room: the
 * "Enter" click primed the audio and started the microphone request (prime.ts), autoJoin() adopts them
 * once the server has welcomed us. The microphone is never requested on page load or on the landing page.
 * Without a microphone (denied, none, no HTTPS) the player joins listen-only and can retry.
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
  const next = { muted: a.isMuted, deafened: a.isDeafened, ptt: a.isPtt, micLive: a.micLive, speaking: a.speakingNow, peers, mic: a.micState, micError: a.micError?.message, soundBlocked: a.soundBlocked };
  const changed =
    v.mic !== next.mic ||
    v.micError !== next.micError ||
    v.soundBlocked !== next.soundBlocked ||
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

  /** Join from the HUD button (a click: it may open the microphone itself). */
  async join(): Promise<void> {
    await start({ micOn: store().micOnJoin });
  },

  /** Join automatically after entering an online room, with what the Enter click primed. */
  async autoJoin(): Promise<void> {
    const { ctx, mic } = takePrimed();
    await start({ ctx, mic, micOn: store().micOnJoin });
  },

  /** Retry the microphone after it was denied or missing (from the banner's button: a click). */
  async retryMic(): Promise<void> {
    if (!adapter) return void (await voice.join());
    try {
      await adapter.enableMic();
      store().setVoice({ error: undefined });
    } catch {
      /* the reason is shown by the indicator */
    }
    publish();
  },

  /** The browser blocked audio until a click: resume it (from the "Click to enable sound" prompt). */
  async unlockSound(): Promise<void> {
    await adapter?.unlockSound();
    publish();
  },

  /** Leave voice: every peer closed, the microphone released (also anything primed but never used). */
  leave(): void {
    window.clearInterval(publishTimer);
    releasePrimed();
    adapter?.dispose();
    adapter = null;
    store().setVoice({ joined: false, joining: false, micLive: false, mic: 'muted', micError: undefined, soundBlocked: false, speaking: false, peers: [] });
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

async function start(opts: VoiceConnectOptions): Promise<void> {
  if (adapter || store().voice.joining) {
    // already in voice: whatever was primed is not needed
    opts.mic?.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => undefined);
    return;
  }
  const net = session.adapter;
  if (!net.authoritative || !net.sendVoice) {
    opts.mic?.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => undefined);
    void opts.ctx?.close().catch(() => undefined);
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
    await a.connect(store().roomId, opts);
  } catch (e) {
    a.dispose();
    store().setVoice({ joining: false, joined: false, error: e instanceof VoiceError ? e.message : 'Voice could not start.' });
    return;
  }
  adapter = a;
  if (import.meta.env.DEV) (window as unknown as { __voice: MeshVoiceAdapter }).__voice = a;
  // re-apply per-player volumes chosen earlier
  a.onRemoteStream((id) => {
    const pv = store().voice.peerVolume[id];
    if (pv) a.setPeerVolume(id, pv.volume, pv.muted);
  });
  publishTimer = window.setInterval(publish, 200);
  store().setVoice({ joining: false, joined: true });
  publish();
  void listDevices();
}

// closing or hiding the tab for good releases the microphone at once
if (typeof window !== 'undefined') window.addEventListener('pagehide', (e) => !e.persisted && voice.leave());
