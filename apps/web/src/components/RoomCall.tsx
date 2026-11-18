import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  Camera, CameraOff, Mic, MicOff, MonitorOff, MonitorUp, Sparkles, Video, Volume2, VolumeX,
} from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { cn } from '../lib/utils';

type CallMember = { id: string; name: string; avatar_url?: string | null };

type RoomSignal =
  | { kind: 'description'; description: RTCSessionDescriptionInit }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit }
  | { kind: 'hello'; name: string }
  | { kind: 'bye' }
  | { kind: 'restart-request' };

type RemoteTile = { id: string; name: string; stream: MediaStream; speaking?: boolean };

type CameraFilter = 'none' | 'grayscale' | 'sepia' | 'blur';

const FILTERS: Record<CameraFilter, string> = {
  none: 'none',
  grayscale: 'grayscale(1)',
  sepia: 'sepia(.85) saturate(1.2)',
  blur: 'blur(3px)',
};

/** Orden determinista: solo un extremo de cada par inicia la oferta. */
const initiates = (a: string, b: string) => a < b;

function VideoTile({ tile, muted = false, filter, className, label, mirror = false, sinkId, forcePlay = 0 }: {
  tile: RemoteTile;
  muted?: boolean;
  filter?: string;
  className?: string;
  label?: string;
  mirror?: boolean;
  sinkId?: string;
  forcePlay?: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (element.srcObject !== tile.stream) {
      element.srcObject = tile.stream;
      if (tile.stream) void element.play().catch(() => {});
    } else if (tile.stream && element.paused) {
      void element.play().catch(() => {});
    }
  }, [tile.stream, forcePlay]);
  useEffect(() => {
    const element = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (element && sinkId && typeof element.setSinkId === 'function') void element.setSinkId(sinkId).catch(() => {});
  }, [sinkId, tile.stream]);
  return (
    <div className={cn('group relative overflow-hidden rounded-2xl bg-black', tile.speaking && 'ring-2 ring-emerald-400/80', className)}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={cn('h-full w-full object-cover', mirror && 'scale-x-[-1]')}
        style={{ filter: filter ?? 'none' }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
        <span className="text-[11px] font-medium text-white/90">{label ?? tile.name}</span>
      </div>
    </div>
  );
}

/** Detecta voz real con Web Audio; no conecta el analizador a la salida. */
function useVoiceActivity(sources: Array<{ id: string; stream: MediaStream }>, resumeKey = 0): Set<string> {
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    void ctxRef.current?.resume().catch(() => {});
  }, [resumeKey]);

  useEffect(() => {
    const AudioCtx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    let ctx: AudioContext;
    try { ctx = new AudioCtx(); } catch { return; }
    ctxRef.current = ctx;
    void ctx.resume().catch(() => {});
    const nodes = new Map<string, { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> }>();

    for (const { id, stream } of sources) {
      if (!stream.getAudioTracks().length || nodes.has(id)) continue;
      try {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        nodes.set(id, { source, analyser, data: new Uint8Array(new ArrayBuffer(analyser.fftSize)) });
      } catch { /* flujo sin audio utilizable */ }
    }

    const timer = window.setInterval(() => {
      const active = new Set<string>();
      for (const [id, node] of nodes) {
        node.analyser.getByteTimeDomainData(node.data);
        let sum = 0;
        for (const sample of node.data) sum += ((sample - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / node.data.length);
        if (rms > 0.035) active.add(id);
      }
      setSpeaking((current) => {
        if (current.size === active.size && [...active].every((id) => current.has(id))) return current;
        return active;
      });
    }, 140);

    return () => {
      window.clearInterval(timer);
      for (const node of nodes.values()) { node.source.disconnect(); node.analyser.disconnect(); }
      void ctx.close().catch(() => {});
    };
  }, [sources]);

  return speaking;
}

export default function RoomCall({ roomId, members, userId, userName }: {
  roomId: string;
  members: CallMember[];
  userId: string;
  userName: string;
}) {
  const socket = getSocket();
  const socketRef = useRef<Socket | null>(socket);
  socketRef.current = socket;

  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const makingOfferRef = useRef<Set<string>>(new Set());
  const ignoreOfferRef = useRef<Map<string, boolean>>(new Map());
  const settingAnswerRef = useRef<Set<string>>(new Set());
  const suppressNegotiationRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<Map<string, Promise<void>>>(new Map());
  const namesRef = useRef<Map<string, string>>(new Map(members.map((m) => [m.id, m.name])));
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenAudioSendersRef = useRef<Set<RTCRtpSender>>(new Set());
  const shareIdRef = useRef<string | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);
  const disposedRef = useRef(false);
  const restartingRef = useRef<Set<string>>(new Set());
  const stopShareRef = useRef<() => Promise<void>>(async () => {});

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<RemoteTile[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [filter, setFilter] = useState<CameraFilter>('none');
  const [sharing, setSharing] = useState(false);
  const [shareAudio, setShareAudio] = useState(false);
  const [shareAudioAvailable, setShareAudioAvailable] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [audioInputId, setAudioInputId] = useState('');
  const [videoInputId, setVideoInputId] = useState('');
  const [audioOutputId, setAudioOutputId] = useState('');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [deviceList, setDeviceList] = useState<MediaDeviceInfo[]>([]);
  const [playEpoch, setPlayEpoch] = useState(0);

  const publishRemotes = useCallback(() => {
    setRemotes(
      [...streamsRef.current.entries()].map(([id, stream]) => ({
        id,
        stream,
        name: namesRef.current.get(id) ?? 'Participante',
      })),
    );
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices?.enumerateDevices?.() ?? [];
      if (!disposedRef.current) setDeviceList(all.filter((device) => device.deviceId));
    } catch { /* permisos aún no concedidos */ }
  }, []);

  const emitSignal = useCallback((to: string, signal: RoomSignal) => {
    socketRef.current?.emit('room:signal', { roomId, to, signal });
  }, [roomId]);

  /** Serializa las renegociaciones de cada par para evitar gluces de SDP. */
  const runNegotiation = useCallback((remoteId: string, task: () => Promise<void>) => {
    const previous = queueRef.current.get(remoteId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task).catch(() => {});
    queueRef.current.set(remoteId, next);
  }, []);

  const sendOffer = useCallback((remoteId: string, pc: RTCPeerConnection, iceRestart = false) => {
    if (disposedRef.current || (!iceRestart && suppressNegotiationRef.current.has(remoteId))) return;
    runNegotiation(remoteId, async () => {
      if (pc.signalingState !== 'stable' || pcsRef.current.get(remoteId) !== pc) return;
      makingOfferRef.current.add(remoteId);
      try {
        if (iceRestart) pc.restartIce();
        const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        if (pc.localDescription?.sdp) {
          emitSignal(remoteId, { kind: 'description', description: { type: 'offer', sdp: pc.localDescription.sdp } });
        }
      } catch {
        /* la conexión puede cambiar de estado durante la negociación */
      } finally {
        makingOfferRef.current.delete(remoteId);
      }
    });
  }, [emitSignal, runNegotiation]);

  const createPeer = useCallback((remoteId: string) => {
    const existing = pcsRef.current.get(remoteId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    pcsRef.current.set(remoteId, pc);
    const stream = new MediaStream();
    streamsRef.current.set(remoteId, stream);

    const local = localStreamRef.current;
    if (local) {
      for (const track of local.getTracks()) pc.addTrack(track, local);
    } else {
      // Sin permisos: seguimos recibiendo audio y video de los demás.
      pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.addTransceiver('video', { direction: 'recvonly' });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        emitSignal(remoteId, { kind: 'candidate', candidate: event.candidate.toJSON() });
      }
    };
    pc.onnegotiationneeded = () => sendOffer(remoteId, pc);
    pc.ontrack = (event) => {
      const target = streamsRef.current.get(remoteId) ?? new MediaStream();
      if (!target.getTracks().some((track) => track.id === event.track.id)) {
        target.addTrack(event.track);
      }
      streamsRef.current.set(remoteId, target);
      publishRemotes();
    };
    pc.oniceconnectionstatechange = () => {
      if (disposedRef.current || restartingRef.current.has(remoteId)) return;
      if (pc.iceConnectionState !== 'failed' && pc.iceConnectionState !== 'disconnected') return;
      restartingRef.current.add(remoteId);
      if (initiates(userId, remoteId)) sendOffer(remoteId, pc, true);
      else emitSignal(remoteId, { kind: 'restart-request' });
      window.setTimeout(() => restartingRef.current.delete(remoteId), 6_000);
    };
    return pc;
  }, [emitSignal, publishRemotes, sendOffer, userId]);

  const closePeer = useCallback((remoteId: string) => {
    const pc = pcsRef.current.get(remoteId);
    if (pc) {
      pc.onnegotiationneeded = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    pcsRef.current.delete(remoteId);
    streamsRef.current.delete(remoteId);
    pendingCandidatesRef.current.delete(remoteId);
    queueRef.current.delete(remoteId);
    publishRemotes();
  }, [publishRemotes]);

  const handleDescription = useCallback(async (remoteId: string, pc: RTCPeerConnection, description: RTCSessionDescriptionInit) => {
    if (!description.type || !description.sdp || disposedRef.current) return;
    const polite = userId > remoteId;
    const readyForOffer = !makingOfferRef.current.has(remoteId) && (pc.signalingState === 'stable' || settingAnswerRef.current.has(remoteId));
    const collision = description.type === 'offer' && !readyForOffer;
    ignoreOfferRef.current.set(remoteId, !polite && collision);
    if (ignoreOfferRef.current.get(remoteId)) return;

    if (collision && polite && pc.signalingState === 'have-local-offer') {
      await pc.setLocalDescription({ type: 'rollback' });
    }
    if (description.type === 'answer') settingAnswerRef.current.add(remoteId);
    try {
      await pc.setRemoteDescription(description);
    } finally {
      settingAnswerRef.current.delete(remoteId);
    }

    for (const candidate of pendingCandidatesRef.current.get(remoteId) ?? []) {
      await pc.addIceCandidate(candidate).catch(() => {});
    }
    pendingCandidatesRef.current.set(remoteId, []);

    if (description.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (pc.localDescription?.sdp) {
        emitSignal(remoteId, { kind: 'description', description: { type: 'answer', sdp: pc.localDescription.sdp } });
      }
      window.setTimeout(() => suppressNegotiationRef.current.delete(remoteId), 250);
    }
  }, [emitSignal, userId]);

  /** Renegociación explícita al añadir o quitar la pista de pantalla compartida. */
  const renegotiateScreen = useCallback((remoteId: string, pc: RTCPeerConnection) => {
    runNegotiation(remoteId, async () => {
      if (disposedRef.current || pc.signalingState !== 'stable') return;
      makingOfferRef.current.add(remoteId);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (pc.localDescription?.sdp) {
          emitSignal(remoteId, { kind: 'description', description: { type: 'offer', sdp: pc.localDescription.sdp } });
        }
      } catch {
        /* noop */
      } finally {
        makingOfferRef.current.delete(remoteId);
      }
    });
  }, [emitSignal, runNegotiation]);

  const stopShare = useCallback(async () => {
    const stream = screenStreamRef.current;
    const audioTrack = screenAudioTrackRef.current;
    screenStreamRef.current = null;
    screenAudioTrackRef.current = null;
    setScreenStream(null);
    setSharing(false);
    setShareAudio(false);
    setShareAudioAvailable(false);
    stream?.getTracks().forEach((track) => track.stop());
    audioTrack?.stop();

    for (const [remoteId, pc] of pcsRef.current) {
      const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video')
        ?? pc.getTransceivers().find((t) => t.receiver.track.kind === 'video')?.sender;
      if (videoSender) await videoSender.replaceTrack(cameraTrackRef.current ?? null).catch(() => {});
      for (const sender of screenAudioSendersRef.current) {
        if (pc.getSenders().includes(sender)) await sender.replaceTrack(null).catch(() => {});
      }
      renegotiateScreen(remoteId, pc);
    }
    screenAudioSendersRef.current.clear();
    const shareId = shareIdRef.current;
    shareIdRef.current = null;
    if (shareId) {
      await api(`/rooms/${roomId}/screens/${shareId}/stop`, { method: 'POST' }).catch(() => {});
    }
  }, [renegotiateScreen, roomId]);
  stopShareRef.current = stopShare;

  const startShare = useCallback(async () => {
    if (sharing) {
      await stopShare();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaError('Tu navegador no permite compartir la pantalla.');
      return;
    }
    try {
      // audio:true es indispensable: el navegador solo ofrece audio si el usuario
      // marca "compartir audio del sistema" en el selector.
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) return;
      const audioTrack = stream.getAudioTracks()[0] ?? null;
      screenStreamRef.current = stream;
      screenAudioTrackRef.current = audioTrack;
      setScreenStream(stream);
      setShareAudio(Boolean(audioTrack));
      setShareAudioAvailable(Boolean(audioTrack));
      setMediaError(audioTrack
        ? null
        : 'Esta combinación no entregó audio. Activa "compartir audio del sistema" en el selector o comparte una ventana compatible.');
      videoTrack.addEventListener('ended', () => { void stopShareRef.current(); }, { once: true });
      audioTrack?.addEventListener('ended', () => setShareAudioAvailable(false), { once: true });

      const response = await api<{ id: string }>(`/rooms/${roomId}/screens`, {
        method: 'POST',
        body: JSON.stringify({ label: `Pantalla de ${userName || 'participante'}` }),
      });
      shareIdRef.current = response.id;
      setSharing(true);

      for (const [remoteId, pc] of pcsRef.current) {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video')
          ?? pc.getTransceivers().find((t) => t.receiver.track.kind === 'video')?.sender;
        if (videoSender) await videoSender.replaceTrack(videoTrack).catch(() => {});
        if (audioTrack) {
          // Un transceiver nuevo conserva el micrófono y añade el audio de la pantalla.
          const sender = pc.addTrack(audioTrack, stream);
          screenAudioSendersRef.current.add(sender);
        }
        renegotiateScreen(remoteId, pc);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError' && !screenStreamRef.current) return;
      setMediaError('No se pudo compartir la pantalla.');
    }
  }, [renegotiateScreen, roomId, sharing, stopShare, userName]);

  const toggleShareAudio = useCallback(() => {
    const next = !shareAudio;
    for (const sender of screenAudioSendersRef.current) {
      const track = sender.track;
      if (track) track.enabled = next;
    }
    if (screenAudioTrackRef.current) screenAudioTrackRef.current.enabled = next;
    setShareAudio(next);
  }, [shareAudio]);

  const switchMic = useCallback(async (deviceId: string) => {
    setAudioInputId(deviceId);
    const current = localStreamRef.current?.getAudioTracks()[0];
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
      const track = fresh.getAudioTracks()[0];
      if (!track) return;
      for (const pc of pcsRef.current.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'audio' && s.track !== screenAudioTrackRef.current);
        await sender?.replaceTrack(track).catch(() => {});
      }
      if (current) { current.stop(); localStreamRef.current?.removeTrack(current); }
      if (localStreamRef.current) localStreamRef.current.addTrack(track);
    } catch { setMediaError('No se pudo cambiar el micrófono.'); }
  }, []);

  const switchCamera = useCallback(async (deviceId: string) => {
    setVideoInputId(deviceId);
    const current = cameraTrackRef.current;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      const track = fresh.getVideoTracks()[0];
      if (!track) return;
      for (const pc of pcsRef.current.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        await sender?.replaceTrack(sharing ? null : track).catch(() => {});
      }
      if (current) { current.stop(); localStreamRef.current?.removeTrack(current); }
      cameraTrackRef.current = track;
      if (localStreamRef.current && !sharing) localStreamRef.current.addTrack(track);
      setLocalStream(new MediaStream(localStreamRef.current?.getTracks() ?? []));
    } catch { setMediaError('No se pudo cambiar la cámara.'); }
  }, [sharing]);

  const switchFacing = useCallback(async () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    try { await cameraTrackRef.current?.applyConstraints({ facingMode: { ideal: next } }); }
    catch { setMediaError('Este dispositivo no permite cambiar de cámara.'); }
  }, [facingMode]);

  // Media local, descubrimiento de pares y señalización.
  useEffect(() => {
    disposedRef.current = false;
    let cancelled = false;

    void api<{ iceServers: RTCIceServer[] }>('/system/ice')
      .then((data) => {
        if (!cancelled && data.iceServers?.length) iceServersRef.current = data.iceServers;
      })
      .catch(() => {});

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;
        cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
        setLocalStream(stream);
        void loadDevices();
      } catch {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (cancelled) { audioOnly.getTracks().forEach((t) => t.stop()); return; }
          localStreamRef.current = audioOnly;
          setLocalStream(audioOnly);
          setCameraOn(false);
          setMediaError('Cámara no disponible: te conectamos solo con audio.');
          void loadDevices();
        } catch {
          if (cancelled) return;
          setMediaError('Sin permisos de micrófono o cámara. Puedes ver y escuchar a los demás.');
        }
      }
      if (cancelled || disposedRef.current) return;

      // Anunciamos presencia y creamos los pares que nos corresponde ofrecer.
      socketRef.current?.emit('room:signal', { roomId, signal: { kind: 'hello', name: userName } });
      for (const member of members) {
        if (member.id === userId || !initiates(userId, member.id)) continue;
        namesRef.current.set(member.id, member.name);
        createPeer(member.id);
      }
      publishRemotes();
    };
    void init();

    return () => {
      cancelled = true;
      disposedRef.current = true;
      socketRef.current?.emit('room:signal', { roomId, signal: { kind: 'bye' } });
      for (const id of [...pcsRef.current.keys()]) closePeer(id);
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenAudioTrackRef.current?.stop();
      screenAudioSendersRef.current.clear();
      const shareId = shareIdRef.current;
      shareIdRef.current = null;
      if (shareId) void api(`/rooms/${roomId}/screens/${shareId}/stop`, { method: 'POST' }).catch(() => {});
      localStreamRef.current = null;
      screenStreamRef.current = null;
      cameraTrackRef.current = null;
      setLocalStream(null);
      setScreenStream(null);
      setRemotes([]);
    };
  }, [closePeer, createPeer, loadDevices, publishRemotes, roomId, userId, userName]);

  useEffect(() => {
    for (const member of members) namesRef.current.set(member.id, member.name);
    publishRemotes();
  }, [members, publishRemotes]);

  useEffect(() => {
    const activeSocket = socket;
    if (!activeSocket) return;

    const onSignal = (payload: { from: string; roomId: string; signal: RoomSignal }) => {
      if (payload.roomId !== roomId || payload.from === userId || !payload.signal) return;
      const { from, signal } = payload;

      if (signal.kind === 'restart-request') {
        const pc = pcsRef.current.get(from);
        if (pc && initiates(userId, from) && !restartingRef.current.has(from)) {
          restartingRef.current.add(from);
          sendOffer(from, pc, true);
          window.setTimeout(() => restartingRef.current.delete(from), 6_000);
        }
        return;
      }
      if (signal.kind === 'hello') {
        namesRef.current.set(from, signal.name || 'Participante');
        if (initiates(userId, from)) {
          createPeer(from);
          publishRemotes();
        }
        return;
      }
      if (signal.kind === 'bye') {
        closePeer(from);
        return;
      }
      if (signal.kind === 'candidate') {
        const pc = pcsRef.current.get(from);
        if (!pc) return;
        if (pc.remoteDescription) {
          void pc.addIceCandidate(signal.candidate).catch(() => {});
        } else {
          pendingCandidatesRef.current.set(from, [...(pendingCandidatesRef.current.get(from) ?? []), signal.candidate]);
        }
        return;
      }
      if (signal.kind === 'description') {
        suppressNegotiationRef.current.add(from);
        let pc = pcsRef.current.get(from);
        if (!pc) pc = createPeer(from);
        void handleDescription(from, pc, signal.description);
      }
    };

    activeSocket.on('room:signal', onSignal);
    return () => { activeSocket.off('room:signal', onSignal); };
  }, [closePeer, createPeer, handleDescription, publishRemotes, roomId, sendOffer, socket, userId]);

  const toggleMute = () => {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  };

  const toggleCamera = () => {
    const next = !cameraOn;
    cameraTrackRef.current && (cameraTrackRef.current.enabled = next);
    setCameraOn(next);
  };

  const voiceSources = useMemo(
    () => [
      ...remotes.map((tile) => ({ id: tile.id, stream: tile.stream })),
      ...(localStream ? [{ id: userId, stream: localStream }] : []),
    ],
    [localStream, remotes, userId],
  );
  const speaking = useVoiceActivity(voiceSources, playEpoch);

  const localTile: RemoteTile = {
    id: userId,
    name: 'Tú',
    speaking: speaking.has(userId),
    stream: screenStream ?? localStream ?? new MediaStream(),
  };

  return (
    <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-[#101013] shadow-[0_30px_60px_-45px_rgba(0,0,0,.95)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_500px_at_50%_-15%,rgba(255,255,255,.09),transparent_60%)]" />
      <div className="relative flex h-[380px] flex-col p-3 sm:h-[460px] lg:h-[520px]">
        {remotes.length > 0 ? (
          <>
            <div className={cn('grid min-h-0 flex-1 gap-2', remotes.length > 4 ? 'grid-cols-2 sm:grid-cols-3' : remotes.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
              {remotes.map((tile) => (
                <VideoTile
                  key={tile.id}
                  tile={{ ...tile, speaking: speaking.has(tile.id) }}
                  sinkId={audioOutputId}
                  forcePlay={playEpoch}
                  className="h-full min-h-[140px] w-full"
                />
              ))}
            </div>
            {(localStream || screenStream) && (
              <div className="absolute bottom-[86px] right-5 z-10 h-24 w-36 overflow-hidden rounded-xl border border-white/20 bg-black shadow-lift sm:h-32 sm:w-48">
                <VideoTile tile={localTile} muted mirror={!screenStream} filter={screenStream ? 'none' : FILTERS[filter]} sinkId={audioOutputId} forcePlay={playEpoch} className="h-full w-full" label={screenStream ? 'Compartiendo pantalla' : 'Tú'} />
              </div>
            )}
          </>
        ) : (
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            {(localStream || screenStream) ? (
              <VideoTile tile={localTile} muted mirror={!screenStream} filter={screenStream ? 'none' : FILTERS[filter]} sinkId={audioOutputId} forcePlay={playEpoch} className="h-full w-full" label={screenStream ? 'Compartiendo pantalla' : 'Tú'} />
            ) : (
              <div className="flex flex-col items-center text-center text-white/60">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/[.05]"><Video size={26} /></div>
                <p className="mt-4 font-display text-xl text-white/85">Estás en la sala</p>
                <p className="mt-1 max-w-xs text-[12px] text-white/40">Comparte el enlace para invitar a otros estudiantes.</p>
              </div>
            )}
          </div>
        )}

        {mediaError && (
          <div className="absolute left-5 top-5 z-10 max-w-[70%] rounded-xl border border-white/10 bg-black/55 px-3 py-1.5 text-[11px] leading-snug text-white/75 backdrop-blur-sm">
            {mediaError}
          </div>
        )}
        {sharing && (
          <div className="absolute right-5 top-5 z-10 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#101013]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Pantalla activa
            <span className="ml-1 flex items-center gap-1 normal-case tracking-normal text-white/10">
              {shareAudio ? <Volume2 size={11} /> : <VolumeX size={11} />}
              {shareAudio ? 'con audio' : 'sin audio'}
            </span>
          </div>
        )}

        {/* Controles estilo FaceTime */}
        <div className="relative z-10 mt-2 flex flex-wrap items-center justify-center gap-2 border-t border-white/10 pt-3">
          <button
            onClick={toggleMute}
            className={cn('flex h-11 w-11 items-center justify-center rounded-full border transition-transform hover:scale-105', muted ? 'border-transparent bg-white text-[#101013]' : 'border-white/15 bg-white/[.08] text-white/85 hover:bg-white/[.15]')}
            aria-label={muted ? 'Activar micrófono' : 'Silenciar micrófono'}
            title={muted ? 'Activar micrófono' : 'Silenciar micrófono'}
          >
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button
            onClick={toggleCamera}
            className={cn('flex h-11 w-11 items-center justify-center rounded-full border transition-transform hover:scale-105', !cameraOn ? 'border-transparent bg-white text-[#101013]' : 'border-white/15 bg-white/[.08] text-white/85 hover:bg-white/[.15]')}
            aria-label={cameraOn ? 'Apagar cámara' : 'Encender cámara'}
            title={cameraOn ? 'Apagar cámara' : 'Encender cámara'}
          >
            {cameraOn ? <Camera size={18} /> : <CameraOff size={18} />}
          </button>
          <button
            onClick={() => { void startShare(); }}
            className={cn('flex h-11 w-11 items-center justify-center rounded-full border transition-transform hover:scale-105', sharing ? 'border-transparent bg-white text-[#101013]' : 'border-white/15 bg-white/[.08] text-white/85 hover:bg-white/[.15]')}
            aria-label={sharing ? 'Detener compartición' : 'Compartir pantalla'}
            title={sharing ? 'Detener compartición' : 'Compartir pantalla'}
          >
            {sharing ? <MonitorOff size={18} /> : <MonitorUp size={18} />}
          </button>
          {sharing && shareAudioAvailable && (
            <button
              onClick={toggleShareAudio}
              className={cn('flex h-11 items-center gap-1.5 rounded-full border px-3 text-[11px] transition-transform hover:scale-105', shareAudio ? 'border-transparent bg-white text-[#101013]' : 'border-white/15 bg-white/[.08] text-white/85')}
              aria-label={shareAudio ? 'Silenciar audio compartido' : 'Activar audio compartido'}
              title={shareAudio ? 'Silenciar audio compartido' : 'Activar audio compartido'}
            >
              {shareAudio ? <Volume2 size={16} /> : <VolumeX size={16} />} Audio
            </button>
          )}
          <button
            onClick={() => setPlayEpoch((value) => value + 1)}
            className="flex h-11 items-center gap-1.5 rounded-full border border-white/15 bg-white/[.08] px-3 text-[11px] text-white/80 hover:bg-white/[.15]"
            title="Reanudar reproducción de audio si el navegador la bloqueó"
          >
            <Volume2 size={16} /> Activar audio
          </button>
          {deviceList.filter((device) => device.kind === 'audioinput').length > 1 && (
            <label className="flex items-center gap-1 rounded-full border border-white/15 bg-white/[.08] px-2.5 py-2 text-[10px] text-white/70">
              Mic
              <select value={audioInputId} onChange={(event) => void switchMic(event.target.value)} className="max-w-[100px] bg-transparent text-white/80 outline-none [&>option]:bg-[#101013]">
                {deviceList.filter((device) => device.kind === 'audioinput').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Mic ${index + 1}`}</option>)}
              </select>
            </label>
          )}
          {deviceList.filter((device) => device.kind === 'videoinput').length > 1 && (
            <label className="flex items-center gap-1 rounded-full border border-white/15 bg-white/[.08] px-2.5 py-2 text-[10px] text-white/70">
              Cámara
              <select value={videoInputId} onChange={(event) => void switchCamera(event.target.value)} className="max-w-[100px] bg-transparent text-white/80 outline-none [&>option]:bg-[#101013]">
                {deviceList.filter((device) => device.kind === 'videoinput').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Cámara ${index + 1}`}</option>)}
              </select>
              <button type="button" onClick={() => void switchFacing()} className="ml-1 text-white/60 hover:text-white" title="Cambiar cámara frontal/trasera">↻</button>
            </label>
          )}
          {(typeof HTMLMediaElement !== 'undefined') && typeof (HTMLMediaElement.prototype as any).setSinkId === 'function' && deviceList.filter((device) => device.kind === 'audiooutput').length > 0 && (
            <label className="flex items-center gap-1 rounded-full border border-white/15 bg-white/[.08] px-2.5 py-2 text-[10px] text-white/70">
              Salida
              <select value={audioOutputId} onChange={(event) => setAudioOutputId(event.target.value)} className="max-w-[100px] bg-transparent text-white/80 outline-none [&>option]:bg-[#101013]">
                <option value="">Predeterminada</option>
                {deviceList.filter((device) => device.kind === 'audiooutput').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Altavoz ${index + 1}`}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[.08] px-2.5 py-2 text-white/80" title="Filtro de cámara">
            <Sparkles size={15} />
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as CameraFilter)}
              className="max-w-[92px] bg-transparent text-[11px] outline-none [&>option]:bg-[#101013]"
              aria-label="Filtro de cámara"
            >
              <option value="none">Sin filtro</option>
              <option value="grayscale">Blanco y negro</option>
              <option value="sepia">Sepia</option>
              <option value="blur">Difuminar</option>
            </select>
          </label>
          <span className="ml-1 hidden text-[10px] text-white/35 sm:inline">WebRTC · malla P2P</span>
        </div>
      </div>
    </div>
  );
}
