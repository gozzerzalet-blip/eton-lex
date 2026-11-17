import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  Camera, CameraOff, Mic, MicOff, MonitorOff, MonitorUp, Sparkles, Video,
} from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { cn } from '../lib/utils';

type CallMember = { id: string; name: string; avatar_url?: string | null };

type RoomSignal =
  | { kind: 'description'; description: RTCSessionDescriptionInit }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit }
  | { kind: 'hello'; name: string }
  | { kind: 'bye' };

type RemoteTile = { id: string; name: string; stream: MediaStream };

type CameraFilter = 'none' | 'grayscale' | 'sepia' | 'blur';

const FILTERS: Record<CameraFilter, string> = {
  none: 'none',
  grayscale: 'grayscale(1)',
  sepia: 'sepia(.85) saturate(1.2)',
  blur: 'blur(3px)',
};

/** Orden determinista: solo un extremo de cada par inicia la oferta. */
const initiates = (a: string, b: string) => a < b;

function VideoTile({ tile, muted = false, filter, className, label, mirror = false }: {
  tile: RemoteTile;
  muted?: boolean;
  filter?: string;
  className?: string;
  label?: string;
  mirror?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== tile.stream) ref.current.srcObject = tile.stream;
  }, [tile.stream]);
  return (
    <div className={cn('group relative overflow-hidden rounded-2xl bg-black', className)}>
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
  const shareIdRef = useRef<string | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);
  const disposedRef = useRef(false);
  const stopShareRef = useRef<() => Promise<void>>(async () => {});

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<RemoteTile[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [filter, setFilter] = useState<CameraFilter>('none');
  const [sharing, setSharing] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const publishRemotes = useCallback(() => {
    setRemotes(
      [...streamsRef.current.entries()].map(([id, stream]) => ({
        id,
        stream,
        name: namesRef.current.get(id) ?? 'Participante',
      })),
    );
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

  const sendOffer = useCallback((remoteId: string, pc: RTCPeerConnection) => {
    if (disposedRef.current || suppressNegotiationRef.current.has(remoteId)) return;
    runNegotiation(remoteId, async () => {
      if (pc.signalingState !== 'stable' || pcsRef.current.get(remoteId) !== pc) return;
      makingOfferRef.current.add(remoteId);
      try {
        const offer = await pc.createOffer();
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
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && !disposedRef.current) pc.restartIce();
    };
    return pc;
  }, [emitSignal, publishRemotes, sendOffer]);

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
    screenStreamRef.current = null;
    setScreenStream(null);
    setSharing(false);
    stream?.getTracks().forEach((track) => track.stop());

    for (const [remoteId, pc] of pcsRef.current) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
        ?? pc.getTransceivers().find((t) => t.receiver.track.kind === 'video')?.sender;
      if (sender) {
        await sender.replaceTrack(cameraTrackRef.current ?? null).catch(() => {});
        renegotiateScreen(remoteId, pc);
      }
    }
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
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      screenStreamRef.current = stream;
      setScreenStream(stream);
      setMediaError(null);
      track.addEventListener('ended', () => { void stopShareRef.current(); }, { once: true });

      const response = await api<{ id: string }>(`/rooms/${roomId}/screens`, {
        method: 'POST',
        body: JSON.stringify({ label: `Pantalla de ${userName || 'participante'}` }),
      });
      shareIdRef.current = response.id;
      setSharing(true);

      for (const [remoteId, pc] of pcsRef.current) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
          ?? pc.getTransceivers().find((t) => t.receiver.track.kind === 'video')?.sender;
        if (sender) {
          await sender.replaceTrack(track).catch(() => {});
          renegotiateScreen(remoteId, pc);
        }
      }
    } catch (error) {
      // El usuario canceló el selector: no es un error.
      if (error instanceof DOMException && error.name === 'NotAllowedError' && !screenStreamRef.current) return;
      setMediaError('No se pudo compartir la pantalla.');
    }
  }, [renegotiateScreen, roomId, sharing, stopShare, userName]);

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
          audio: true,
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;
        cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
        setLocalStream(stream);
      } catch {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (cancelled) { audioOnly.getTracks().forEach((t) => t.stop()); return; }
          localStreamRef.current = audioOnly;
          setLocalStream(audioOnly);
          setCameraOn(false);
          setMediaError('Cámara no disponible: te conectamos solo con audio.');
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
  }, [closePeer, createPeer, publishRemotes, roomId, userId, userName]);

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
  }, [closePeer, createPeer, handleDescription, publishRemotes, roomId, socket, userId]);

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

  const localTile: RemoteTile = {
    id: userId,
    name: 'Tú',
    stream: screenStream ?? localStream ?? new MediaStream(),
  };

  return (
    <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-[#101013] shadow-[0_30px_60px_-45px_rgba(0,0,0,.95)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_500px_at_50%_-15%,rgba(255,255,255,.09),transparent_60%)]" />
      <div className="relative flex h-[380px] flex-col p-3 sm:h-[460px] lg:h-[520px]">
        {remotes.length > 0 ? (
          <>
            <div className={cn('grid min-h-0 flex-1 gap-2', remotes.length > 4 ? 'grid-cols-2 sm:grid-cols-3' : remotes.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
              {remotes.map((tile) => <VideoTile key={tile.id} tile={tile} className="h-full min-h-[140px] w-full" />)}
            </div>
            {(localStream || screenStream) && (
              <div className="absolute bottom-[86px] right-5 z-10 h-24 w-36 overflow-hidden rounded-xl border border-white/20 bg-black shadow-lift sm:h-32 sm:w-48">
                <VideoTile tile={localTile} muted mirror={!screenStream} filter={screenStream ? 'none' : FILTERS[filter]} className="h-full w-full" label={screenStream ? 'Compartiendo pantalla' : 'Tú'} />
              </div>
            )}
          </>
        ) : (
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            {(localStream || screenStream) ? (
              <VideoTile tile={localTile} muted mirror={!screenStream} filter={screenStream ? 'none' : FILTERS[filter]} className="h-full w-full" label={screenStream ? 'Compartiendo pantalla' : 'Tú'} />
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
