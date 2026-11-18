import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive, ArrowLeft, BellOff, Camera, Check, CheckCheck, Copy, Eye, FileText, Forward,
  Image as ImageIcon, Info, Lock, MessageSquare, Mic, MicOff, MonitorOff, MonitorUp, MoreHorizontal,
  Palette, Paperclip, Pause, Phone, PhoneCall, Pin, Play, Search, Send, Smile, Square, Trash2, UserPlus, Video,
  VideoOff, Volume2, X, Users, Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiClientError } from '../lib/api';
import { useSocket } from '../lib/socket';
import { playConnectTone, playEndTone, startRingtone, stopRingtone } from '../lib/callTones';
import { useAuth } from '../lib/store';
import type { Conversation, Message } from '../lib/types';
import { EmojiPicker } from '../components/EmojiPicker';
import { BubbleColorPicker } from '../components/BubbleColorPicker';
import { Avatar, Badge, EmptyState, Modal, Skeleton, Tabs } from '../components/ui';
import { bubbleStyle, useBubbleColors } from '../lib/bubbleColors';
import { cn, formatBytes, timeAgo } from '../lib/utils';

type ConversationsResponse = { conversations: Conversation[] };
type ConversationResponse = { conversation: Conversation };
type MessagesResponse = { messages: Message[]; hasMore: boolean };
type StudentsResponse = { users: Array<{ id: string; name: string; avatarUrl?: string; university?: string; cycle?: string }> };
type SearchResponse = { messages: Message[] };
type StickerPack = { id: string; name: string; description?: string | null; sticker_count?: number };
type Sticker = { id: string; pack_id: string; name: string; mime: string; size: number; keywords?: string; url: string };
type ListFilter = 'all' | 'unread' | 'pinned' | 'archived';

type SearchUser = {
  id: string;
  name: string;
  username: string;
  publicId: string;
  avatarUrl: string | null;
  relation: 'none' | 'pending' | 'accepted' | 'blocked' | null;
  direction?: 'incoming' | 'outgoing';
  university?: string | null;
};
type PeopleSearchResponse = { users: SearchUser[] };
type FriendEntry = {
  request_id?: string;
  id: string;
  name: string;
  avatar_url?: string | null;
  university?: string | null;
  created_at?: string | null;
};
type FriendsResponse = { friends: FriendEntry[]; incoming: FriendEntry[]; outgoing: FriendEntry[] };

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '🙏'];

function formatClock(value: number) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Auricular clásico inclinado hacia abajo, propio de los botones de colgar. */
function HangUpIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g transform="rotate(135 12 12)">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </g>
    </svg>
  );
}

/** Imagen autenticada: se descarga con la sesión y se muestra como blob. */
function AuthedImage({ path, name, className }: { path: string; name?: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelada = false;
    let objectUrl: string | null = null;
    setSrc(null);
    setFailed(false);
    api<Response>(path, {}, { raw: true })
      .then(async (response) => {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        if (cancelada) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setSrc(url);
      })
      .catch(() => { if (!cancelada) setFailed(true); });
    return () => {
      cancelada = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, attempt]);

  if (failed) {
    return (
      <span className="flex flex-wrap items-center gap-2 py-1 text-[11px] italic opacity-60">
        Imagen no disponible
        <button type="button" onClick={() => setAttempt((value) => value + 1)} className="underline">
          Reintentar
        </button>
      </span>
    );
  }

  if (!src) {
    return <div className={cn('min-h-20 animate-pulse rounded-lg bg-fg/[.06]', className)} aria-label="Cargando imagen" />;
  }

  return (
    <a href={src} target="_blank" rel="noreferrer" className="block">
      <img
        src={src}
        alt={name ?? 'Imagen del chat'}
        className={className}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </a>
  );
}

function AudioNote({ fileId }: { fileId: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [audioError, setAudioError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  // Forma de onda estable por archivo: no es decorativa, cada barra marca una
  // posición real de la grabación y se ilumina con el progreso de reproducción.
  const waveform = useMemo(() => {
    let seed = 0;
    for (const char of fileId) seed = (seed * 31 + char.charCodeAt(0)) | 0;
    return Array.from({ length: 30 }, (_, index) => {
      const wave = Math.abs(Math.sin(Math.abs(seed % 997) / 71 + index * 0.68));
      return Math.round(26 + wave * 66);
    });
  }, [fileId]);

  useEffect(() => {
    let cancelled = false;
    api<{ token: string; url: string }>(`/files/${fileId}/audio-token`)
      .then((data) => {
        if (!cancelled) {
          setSrc(`${data.url}?token=${encodeURIComponent(data.token)}`);
          setAudioError(false);
          audioRef.current?.load();
        }
      })
      .catch(() => { if (!cancelled) setAudioError(true); });
    return () => { cancelled = true; };
  }, [fileId]);

  // Al cambiar el archivo, HTMLAudioElement puede restablecer la velocidad.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, src]);

  const refreshUrl = () => {
    api<{ token: string; url: string }>(`/files/${fileId}/audio-token`)
      .then((data) => { setSrc(`${data.url}?token=${encodeURIComponent(data.token)}`); setAudioError(false); })
      .catch(() => setAudioError(true));
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => { if (!src) refreshUrl(); });
    else audio.pause();
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const next = Math.max(0, Math.min(value, duration));
    audio.currentTime = next;
    setCurrent(next);
  };

  const cycleRate = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  return (
    <div className="w-[min(10.5rem,48vw)] select-none">
      <audio
        ref={audioRef}
        src={src ?? undefined}
        preload="metadata"
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          event.currentTarget.playbackRate = rate;
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onSeeked={(event) => setCurrent(event.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          if (audioRef.current) audioRef.current.currentTime = 0;
          setCurrent(0);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => { setAudioError(true); refreshUrl(); }}
      />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={toggle}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/90 text-[#111214] shadow-[0_6px_16px_-10px_rgba(0,0,0,.9)] transition-transform hover:scale-105 dark:bg-white/95"
          aria-label={playing ? 'Pausar nota de voz' : 'Reproducir nota de voz'}
          title={playing ? 'Pausar' : 'Reproducir'}
        >
          {playing ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" className="ml-0.5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="relative flex h-4 items-end gap-[1px]">
            {waveform.map((height, index) => (
              <span
                key={index}
                className={cn(
                  'w-full rounded-full transition-opacity duration-150',
                  index / waveform.length <= progress ? 'opacity-90' : 'opacity-25',
                )}
                style={{ height: `${height}%`, backgroundColor: 'currentColor' }}
              />
            ))}
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.05}
              value={Math.min(current, duration || 1)}
              onChange={(event) => seek(Number(event.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Progreso de la nota de voz"
              aria-valuetext={`${formatClock(current)} de ${formatClock(duration)}`}
            />
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[8px] tabular-nums opacity-50">
            <span>{formatClock(current)}</span>
            <span>{formatClock(duration)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={cycleRate}
          className="shrink-0 rounded-full border border-current px-1 py-0 text-[8px] font-semibold tabular-nums opacity-75 transition-opacity hover:opacity-100"
          title="Velocidad de reproducción"
          aria-label={`Velocidad de reproducción: ${rate}x`}
        >
          {rate}x
        </button>
      </div>
      {audioError && (
        <div className="mt-1 flex items-center gap-2 text-[9px] italic opacity-65">
          Audio no disponible
          <button type="button" onClick={refreshUrl} className="underline">Reintentar</button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Llamadas WebRTC ─────────────────────────── */

type CallKind = 'audio' | 'video';
type ActiveCall = {
  callId: string;
  kind: CallKind;
  peerId: string;
  peerName: string;
  role: 'caller' | 'callee';
  status: 'calling' | 'ringing' | 'connecting' | 'active';
};
type MediaDevicesInfo = {
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  canSelectOutput: boolean;
};
type IncomingCall = { callId: string; from: { id: string; name: string }; conversationId: string; kind: CallKind };

function useCallController() {
  const socket = useSocket();
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteAudioLive, setRemoteAudioLive] = useState(false);
  const [connected, setConnected] = useState(false);
  const [iceState, setIceState] = useState<string>('new');
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);
  const [devices, setDevices] = useState<MediaDevicesInfo>({ audioInputs: [], videoInputs: [], audioOutputs: [], canSelectOutput: false });
  const [audioInputId, setAudioInputId] = useState('');
  const [videoInputId, setVideoInputId] = useState('');
  const [audioOutputId, setAudioOutputId] = useState('');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const activeRef = useRef<ActiveCall | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingOfferRef = useRef<{ callId: string; description: RTCSessionDescriptionInit } | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const startedAtRef = useRef(0);
  const negotiatingRef = useRef(false);
  const iceStateRef = useRef('new');
  const audioLiveRef = useRef(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoSenderRef = useRef<RTCRtpSender | null>(null);
  const screenAudioSendersRef = useRef<Set<RTCRtpSender>>(new Set());
  const shareNegotiatingRef = useRef(false);
  const stopShareRef = useRef<() => Promise<void>>(async () => {});
  const connectTonePlayedRef = useRef(false);

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => () => stopRingtone(), []);
  useEffect(() => { iceStateRef.current = iceState; setConnected(iceState === 'connected' || iceState === 'completed' ? audioLiveRef.current : false); }, [iceState]);
  useEffect(() => { audioLiveRef.current = remoteAudioLive; setConnected((iceStateRef.current === 'connected' || iceStateRef.current === 'completed') && remoteAudioLive); }, [remoteAudioLive]);
  useEffect(() => {
    if (connected) {
      setActive((current) => (current && current.status !== 'active' ? { ...current, status: 'active' } : current));
      if (!connectTonePlayedRef.current) {
        connectTonePlayedRef.current = true;
        stopRingtone();
        void playConnectTone();
      }
    } else {
      connectTonePlayedRef.current = false;
    }
  }, [connected]);
  useEffect(() => {
    // Con vídeo remoto (cámara o pantalla) el sonido viaja en el <video>;
    // el <audio> queda silenciado para no duplicarlo.
    const element = remoteStream?.getVideoTracks().length ? remoteVideoRef.current : remoteAudioRef.current;
    if (!element || !audioOutputId) return;
    const withSink = element as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
    if (typeof withSink.setSinkId === 'function') void withSink.setSinkId(audioOutputId).catch(() => {});
  }, [audioOutputId, remoteStream]);

  useEffect(() => {
    let cancelled = false;
    const loadDevices = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setDevices({
          audioInputs: all.filter((d) => d.kind === 'audioinput' && d.deviceId),
          videoInputs: all.filter((d) => d.kind === 'videoinput' && d.deviceId),
          audioOutputs: all.filter((d) => d.kind === 'audiooutput' && d.deviceId),
          canSelectOutput: typeof (HTMLMediaElement.prototype as any).setSinkId === 'function',
        });
      } catch { /* permisos aún no concedidos */ }
    };
    void loadDevices();
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    }
    return () => {
      cancelled = true;
      if (navigator.mediaDevices?.removeEventListener) navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
    };
  }, []);

  useEffect(() => {
    api<{ iceServers: RTCIceServer[] }>('/system/ice')
      .then((res) => { if (res.iceServers?.length) setIceServers(res.iceServers); })
      .catch(() => { /* STUN por defecto */ });
  }, []);

  const cleanup = useCallback(() => {
    stopRingtone();
    try { pcRef.current?.getSenders().forEach((s) => s.track?.stop()); } catch { /* noop */ }
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    screenVideoSenderRef.current = null;
    screenAudioSendersRef.current.clear();
    shareNegotiatingRef.current = false;
    setSharing(false);
    setShareError(null);
    setLocalStream(null);
    setLocalScreenStream(null);
    setRemoteStream(null);
    remoteStreamRef.current = null;
    remoteAudioRef.current?.removeAttribute('src');
    remoteAudioRef.current?.load();
    remoteVideoRef.current?.removeAttribute('src');
    remoteVideoRef.current?.load();
    setRemoteAudioLive(false);
    setConnected(false);
    setIceState('new');
    iceStateRef.current = 'new';
    audioLiveRef.current = false;
    setMuted(false);
    setCameraOn(true);
    setError(null);
    pendingOfferRef.current = null;
    pendingCandidatesRef.current = [];
    negotiatingRef.current = false;
  }, []);

  const signal = useCallback((to: string, callId: string, value: unknown) => {
    socket?.emit('call:signal', { to, callId, signal: value });
  }, [socket]);

  const createPeer = useCallback((peerId: string, callId: string) => {
    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;
    setIceState(pc.iceConnectionState);

    const refreshRemote = () => {
      const current = remoteStreamRef.current ?? new MediaStream();
      const live = current.getTracks().filter((track) => track.readyState === 'live');
      setRemoteStream(new MediaStream(live));
      // `track.muted` puede quedarse en true en algunos navegadores aunque el
      // audio ya esté llegando; la existencia de la pista es el dato fiable.
      setRemoteAudioLive(live.some((track) => track.kind === 'audio'));
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) signal(peerId, callId, { candidate: event.candidate.toJSON() });
    };
    pc.ontrack = (event) => {
      const target = remoteStreamRef.current ?? new MediaStream();
      // Solo puede haber un vídeo remoto: al compartir pantalla se sustituye
      // la cámara. Los pistas de audio se conservan para no perder la voz.
      if (event.track.kind === 'video') {
        for (const track of target.getVideoTracks()) target.removeTrack(track);
      }
      if (!target.getTracks().some((track) => track.id === event.track.id)) target.addTrack(event.track);
      remoteStreamRef.current = target;
      event.track.addEventListener('unmute', refreshRemote);
      event.track.addEventListener('mute', refreshRemote);
      event.track.addEventListener('ended', refreshRemote);
      refreshRemote();
    };
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      setIceState(state);
      if (state === 'failed' || (state === 'disconnected' && iceStateRef.current === 'connected')) {
        const current = activeRef.current;
        if (!current || current.callId !== callId || negotiatingRef.current) return;
        negotiatingRef.current = true;
        if (current.role === 'caller') {
          void (async () => {
            try {
              pc.restartIce();
              if (pc.signalingState !== 'stable') return;
              const offer = await pc.createOffer({ iceRestart: true });
              await pc.setLocalDescription(offer);
              if (pc.localDescription?.sdp) signal(peerId, callId, { type: 'offer', sdp: pc.localDescription.sdp, iceRestart: true });
            } catch { /* la conexión puede haberse cerrado */ }
            finally { negotiatingRef.current = false; }
          })();
        } else {
          signal(peerId, callId, { kind: 'restart-request' });
          negotiatingRef.current = false;
        }
      }
    };
    pc.onconnectionstatechange = () => {
      setIceState(pc.connectionState === 'failed' ? 'failed' : pc.iceConnectionState);
    };
    return pc;
  }, [iceServers, signal]);

  const getMedia = useCallback(async (kind: CallKind) => {
    const videoConstraints: MediaTrackConstraints | boolean = kind === 'video'
      ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: { ideal: facingMode },
          ...(videoInputId ? { deviceId: { exact: videoInputId } } : {}),
        }
      : false;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioInputId
        ? { deviceId: { exact: audioInputId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } },
      video: videoConstraints,
    });
    localRef.current = stream;
    setLocalStream(stream);
    setCameraOn(kind === 'video' && stream.getVideoTracks().some((track) => track.enabled));
    void navigator.mediaDevices?.enumerateDevices?.().then((all) => {
      setDevices({
        audioInputs: all.filter((d) => d.kind === 'audioinput' && d.deviceId),
        videoInputs: all.filter((d) => d.kind === 'videoinput' && d.deviceId),
        audioOutputs: all.filter((d) => d.kind === 'audiooutput' && d.deviceId),
        canSelectOutput: typeof (HTMLMediaElement.prototype as any).setSinkId === 'function',
      });
    }).catch(() => {});
    return stream;
  }, [audioInputId, facingMode, videoInputId]);

  const start = useCallback(async (peer: { id: string; name: string }, kind: CallKind, conversationId: string) => {
    if (!socket) { setError('La conexión en tiempo real no está disponible.'); return; }
    const callId = crypto.randomUUID();
    setError(null);
    setActive({ callId, kind, peerId: peer.id, peerName: peer.name, role: 'caller', status: 'calling' });
    startedAtRef.current = Date.now();
    try {
      const stream = await getMedia(kind);
      const pc = createPeer(peer.id, callId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      socket.emit('call:invite', { callId, to: peer.id, conversationId, kind });
      void startRingtone('caller');
    } catch {
      setError('No se pudo acceder al micrófono o a la cámara. Revisa los permisos del navegador.');
      cleanup();
      setActive(null);
    }
  }, [cleanup, createPeer, getMedia, socket]);

  const accept = useCallback(async () => {
    if (!incoming) return;
    const call = incoming;
    setIncoming(null);
    stopRingtone();
    setError(null);
    setActive({ callId: call.callId, kind: call.kind, peerId: call.from.id, peerName: call.from.name, role: 'callee', status: 'ringing' });
    startedAtRef.current = Date.now();
    try {
      const stream = await getMedia(call.kind);
      const pc = createPeer(call.from.id, call.callId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      socket?.emit('call:accept', { callId: call.callId, to: call.from.id });
      const pending = pendingOfferRef.current;
      if (pending && pending.callId === call.callId) {
        await pc.setRemoteDescription(pending.description);
        pendingOfferRef.current = null;
        for (const candidate of pendingCandidatesRef.current) await pc.addIceCandidate(candidate).catch(() => {});
        pendingCandidatesRef.current = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signal(call.from.id, call.callId, { type: 'answer', sdp: answer.sdp });
        setActive((current) => (current ? { ...current, status: 'connecting' } : current));
      }
    } catch {
      setError('No se pudo acceder al micrófono o a la cámara.');
      cleanup();
      setActive(null);
    }
  }, [cleanup, createPeer, getMedia, incoming, signal, socket]);

  const decline = useCallback(() => {
    if (!incoming) return;
    socket?.emit('call:decline', { callId: incoming.callId, to: incoming.from.id });
    setIncoming(null);
    stopRingtone();
    void playEndTone();
  }, [incoming, socket]);

  const end = useCallback(() => {
    const current = activeRef.current;
    if (current && socket) {
      socket.emit('call:end', {
        callId: current.callId,
        to: current.peerId,
        durationS: Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)),
      });
    }
    cleanup();
    setActive(null);
    void playEndTone();
  }, [cleanup, socket]);

  const toggleMute = useCallback(() => {
    const tracks = localRef.current?.getAudioTracks() ?? [];
    const next = !muted;
    tracks.forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const tracks = localRef.current?.getVideoTracks() ?? [];
    const next = !cameraOn;
    tracks.forEach((track) => { track.enabled = next; });
    setCameraOn(next);
  }, [cameraOn]);

  const switchAudioInput = useCallback(async (deviceId: string) => {
    setAudioInputId(deviceId);
    const track = localRef.current?.getAudioTracks()[0];
    if (!track || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
      const newTrack = replacement.getAudioTracks()[0];
      if (!newTrack) return;
      for (const sender of pcRef.current?.getSenders() ?? []) {
        if (sender.track?.kind === 'audio') await sender.replaceTrack(newTrack);
      }
      track.stop();
      const stream = localRef.current;
      stream?.removeTrack(track);
      if (stream && newTrack) stream.addTrack(newTrack);
    } catch { setError('No se pudo cambiar el micrófono.'); }
  }, []);

  const switchVideoInput = useCallback(async (deviceId: string) => {
    setVideoInputId(deviceId);
    const track = localRef.current?.getVideoTracks()[0];
    if (!track || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      const newTrack = replacement.getVideoTracks()[0];
      if (!newTrack) return;
      for (const sender of pcRef.current?.getSenders() ?? []) {
        if (sender.track?.kind === 'video') await sender.replaceTrack(newTrack);
      }
      track.stop();
      const stream = localRef.current;
      stream?.removeTrack(track);
      if (stream) stream.addTrack(newTrack);
    } catch { setError('No se pudo cambiar la cámara.'); }
  }, []);

  const switchFacingMode = useCallback(async () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    const track = localRef.current?.getVideoTracks()[0];
    try { await track?.applyConstraints({ facingMode: { ideal: next } }); }
    catch { setError('Este dispositivo no permite cambiar de cámara.'); }
  }, [facingMode]);

  /** Renegociación de la compartición: como máximo un offer en vuelo a la vez. */
  const sendShareOffer = useCallback((current: ActiveCall, pc: RTCPeerConnection) => {
    if (shareNegotiatingRef.current || negotiatingRef.current || pc.signalingState !== 'stable') return;
    shareNegotiatingRef.current = true;
    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (pc.localDescription?.sdp) {
          signal(current.peerId, current.callId, { type: 'offer', sdp: pc.localDescription.sdp });
        }
      } catch {
        setShareError('No se pudo renegociar la compartición de pantalla.');
      } finally {
        shareNegotiatingRef.current = false;
      }
    })();
  }, [signal]);

  const stopShare = useCallback(async () => {
    const stream = screenStreamRef.current;
    screenStreamRef.current = null;
    setSharing(false);
    setLocalScreenStream(null);
    setShareError(null);
    stream?.getTracks().forEach((track) => track.stop());

    const pc = pcRef.current;
    const current = activeRef.current;
    if (!pc || !current) return;

    const cameraTrack = localRef.current?.getVideoTracks()[0] ?? null;
    const videoSender = screenVideoSenderRef.current
      ?? pc.getSenders().find((sender) => sender.track?.kind === 'video');
    if (videoSender) await videoSender.replaceTrack(cameraTrack).catch(() => {});
    for (const sender of screenAudioSendersRef.current) {
      if (pc.getSenders().includes(sender)) await sender.replaceTrack(null).catch(() => {});
    }
    screenAudioSendersRef.current.clear();
    screenVideoSenderRef.current = null;
    // La vuelta a la cámara (o la retirada del vídeo en llamadas de voz)
    // también necesita renegociarse para que el otro lado lo vea.
    sendShareOffer(current, pc);
  }, [sendShareOffer]);
  stopShareRef.current = stopShare;

  const startShare = useCallback(async () => {
    if (sharing) {
      await stopShare();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      const message = 'Este dispositivo o navegador no permite compartir pantalla en llamadas';
      setShareError(message);
      toast.info(message);
      return;
    }
    const current = activeRef.current;
    const pc = pcRef.current;
    if (!current || !pc) return;

    setShareError(null);
    let stream: MediaStream;
    try {
      // Debe ejecutarse dentro del gesto del usuario: el selector del navegador.
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      const message = name === 'AbortError'
        ? 'Compartición de pantalla cancelada.'
        : name === 'NotAllowedError'
          ? 'Permiso denegado para compartir la pantalla. Revisa los permisos del navegador.'
          : 'No se pudo iniciar la compartición de pantalla.';
      setShareError(message);
      toast.error(name === 'AbortError' ? message : 'No se pudo compartir la pantalla. Revisa los permisos del navegador.');
      return;
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      stream.getTracks().forEach((track) => track.stop());
      setShareError('El navegador no entregó video de la pantalla.');
      return;
    }
    const audioTrack = stream.getAudioTracks()[0] ?? null;
    screenStreamRef.current = stream;
    videoTrack.addEventListener('ended', () => { void stopShareRef.current(); }, { once: true });
    audioTrack?.addEventListener('ended', () => setShareError('Se detuvo el audio compartido; el video sigue activo.'), { once: true });

    const videoSender = pc.getSenders().find((sender) => sender.track?.kind === 'video');
    let videoAttached = false;
    try {
      if (videoSender) {
        await videoSender.replaceTrack(videoTrack);
      } else {
        // Llamada de voz: no hay sender de vídeo, se añade y se renegocia.
        screenVideoSenderRef.current = pc.addTrack(videoTrack, stream);
      }
      videoAttached = true;
    } catch { /* se reporta el fallo y no se simula la compartición */ }
    if (!videoAttached) {
      screenStreamRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      setShareError('No se pudo adjuntar la pantalla a la llamada.');
      return;
    }
    if (audioTrack) {
      try { screenAudioSendersRef.current.add(pc.addTrack(audioTrack, stream)); }
      catch { setShareError('El video se comparte; el audio de pantalla no está disponible en este navegador.'); }
    }
    setSharing(true);
    setLocalScreenStream(stream);
    if (!audioTrack) {
      setShareError('Audio de pantalla no disponible: depende del navegador y de la opción elegida en el selector.');
    }
    // Siempre renegociamos: en llamadas de voz añade el vídeo y, cuando se
    // comparte audio del sistema, añade también esa pista.
    sendShareOffer(current, pc);
  }, [sendShareOffer, sharing, stopShare]);

  useEffect(() => {
    if (!socket) return;

    const onIncoming = (payload: IncomingCall) => {
      if (activeRef.current) {
        socket.emit('call:decline', { callId: payload.callId, to: payload.from.id });
        return;
      }
      setIncoming(payload);
      void startRingtone('callee');
    };

    const sendOffer = async (current: ActiveCall, iceRestart = false) => {
      const pc = pcRef.current;
      if (!pc || pc.signalingState !== 'stable') return;
      if (iceRestart) pc.restartIce();
      const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await pc.setLocalDescription(offer);
      if (pc.localDescription?.sdp) {
        signal(current.peerId, current.callId, { type: 'offer', sdp: pc.localDescription.sdp, iceRestart });
      }
    };

    const onAccepted = async (payload: { callId: string; by: string }) => {
      const current = activeRef.current;
      if (!current || current.callId !== payload.callId || current.role !== 'caller') return;
      try { await sendOffer(current); }
      catch { setError('No se pudo negociar el canal de audio.'); }
    };

    const onSignal = async (payload: { from: string; callId: string; signal: any }) => {
      const current = activeRef.current;
      const value = payload.signal;
      if (!current || payload.callId !== current.callId || !value) return;

      if (value.kind === 'restart-request' && current.role === 'caller') {
        try { await sendOffer(current, true); } catch { /* esperar al siguiente evento */ }
        return;
      }
      if (value.kind === 'restart-ice') {
        pcRef.current?.restartIce();
        return;
      }

      if (value.candidate) {
        const pc = pcRef.current;
        if (pc?.remoteDescription) await pc.addIceCandidate(value.candidate).catch(() => {});
        else pendingCandidatesRef.current.push(value.candidate);
        return;
      }

      if (value.type === 'offer') {
        const pc = pcRef.current;
        if (!pc) {
          pendingOfferRef.current = { callId: payload.callId, description: { type: 'offer', sdp: value.sdp } };
          return;
        }
        await pc.setRemoteDescription({ type: 'offer', sdp: value.sdp });
        for (const candidate of pendingCandidatesRef.current) await pc.addIceCandidate(candidate).catch(() => {});
        pendingCandidatesRef.current = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signal(payload.from, payload.callId, { type: 'answer', sdp: answer.sdp });
        setActive((state) => (state ? { ...state, status: 'connecting' } : state));
        return;
      }

      if (value.type === 'answer') {
        await pcRef.current?.setRemoteDescription({ type: 'answer', sdp: value.sdp }).catch(() => {});
        setActive((state) => (state ? { ...state, status: 'connecting' } : state));
      }
    };

    const onDeclined = (payload: { callId: string }) => {
      stopRingtone();
      if (activeRef.current?.callId !== payload.callId) return;
      toast.info('La llamada fue rechazada.');
      cleanup();
      setActive(null);
      void playEndTone();
    };

    const onEnded = (payload: { callId: string }) => {
      stopRingtone();
      setIncoming((current) => (current?.callId === payload.callId ? null : current));
      if (activeRef.current?.callId !== payload.callId) return;
      cleanup();
      setActive(null);
      void playEndTone();
    };

    const onBusy = (payload?: { callId?: string }) => {
      stopRingtone();
      if (payload?.callId && activeRef.current?.callId !== payload.callId) return;
      toast.error('La persona está en otra llamada');
      cleanup();
      setActive(null);
      void playEndTone();
    };

    const onMissed = (payload?: { callId?: string }) => {
      stopRingtone();
      if (payload?.callId && activeRef.current?.callId !== payload.callId) return;
      toast.info('Llamada perdida.');
      cleanup();
      setActive(null);
      void playEndTone();
    };

    const onFailed = (payload?: { callId?: string; reason?: string }) => {
      stopRingtone();
      if (payload?.callId && activeRef.current?.callId !== payload.callId) return;
      toast.error(payload?.reason === 'expired' ? 'La llamada ya no está disponible.' : 'No se pudo establecer la llamada.');
      cleanup();
      setActive(null);
      void playEndTone();
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:accepted', onAccepted);
    socket.on('call:signal', onSignal);
    socket.on('call:declined', onDeclined);
    socket.on('call:ended', onEnded);
    socket.on('call:busy', onBusy);
    socket.on('call:missed', onMissed);
    socket.on('call:failed', onFailed);

    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:accepted', onAccepted);
      socket.off('call:signal', onSignal);
      socket.off('call:declined', onDeclined);
      socket.off('call:ended', onEnded);
      socket.off('call:busy', onBusy);
      socket.off('call:missed', onMissed);
      socket.off('call:failed', onFailed);
    };
  }, [cleanup, signal, socket]);

  return {
    active, incoming, localStream, localScreenStream, remoteStream, connected, iceState, remoteAudioLive,
    devices, audioInputId, videoInputId, audioOutputId, facingMode,
    muted, cameraOn, error, start, accept, decline, end, toggleMute, toggleCamera,
    switchAudioInput, switchVideoInput, switchFacingMode, setAudioOutputId,
    sharing, shareError, startShare, stopShare,
    remoteAudioRef, remoteVideoRef, setError,
  };
}

type CallController = ReturnType<typeof useCallController>;

function CallLayer({ call }: { call: CallController }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!call.active) { setSeconds(0); return; }
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [call.active]);

  useEffect(() => {
    const attach = (element: HTMLMediaElement | null) => {
      if (!element) return;
      element.volume = 1;
      if (element.srcObject !== call.remoteStream) {
        element.srcObject = call.remoteStream ?? null;
        if (call.remoteStream) void element.play().catch(() => {});
      } else if (call.remoteStream && element.paused) {
        void element.play().catch(() => {});
      }
    };
    // Adjuntamos a ambos elementos: el audio siempre suena por el <audio>
    // cuando no hay vídeo, y por el <video> cuando hay cámara o pantalla.
    attach(call.remoteAudioRef.current);
    attach(call.remoteVideoRef.current);
    const hasRemoteVideo = !!call.remoteStream?.getVideoTracks().length;
    if (call.remoteAudioRef.current) call.remoteAudioRef.current.muted = hasRemoteVideo;
  }, [call.remoteAudioRef, call.remoteVideoRef, call.remoteStream]);

  if (!call.active && !call.incoming) return null;

  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  if (call.incoming && !call.active) {
    return (
      <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md">
        <div className="glass w-full max-w-sm rounded-3xl p-7 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/50 bg-white/40 dark:border-white/15 dark:bg-white/[.06]">
            <Avatar name={call.incoming.from.name} size={64} />
          </div>
          <p className="mt-4 font-display text-xl text-fg/95">{call.incoming.from.name}</p>
          <p className="mt-1 text-[12px] text-fg/40">
            Llamada {call.incoming.kind === 'video' ? 'de video' : 'de voz'} entrante
          </p>
          <div className="mt-7 flex items-center justify-center gap-7">
            <div className="flex flex-col items-center gap-1.5">
              <button onClick={call.decline} className="flex h-14 w-14 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 text-red-500 shadow-sm transition-transform hover:scale-105 hover:bg-red-500/20" aria-label="Rechazar llamada" title="Rechazar llamada">
                <HangUpIcon size={22} />
              </button>
              <span className="text-[10px] font-medium text-fg/45">Rechazar</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <button onClick={call.accept} className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_14px_30px_-18px_rgba(16,185,129,.9)] transition-transform hover:scale-105" aria-label="Contestar llamada" title="Contestar llamada">
                {call.incoming.kind === 'video' ? <Video size={22} /> : <PhoneCall size={22} />}
              </button>
              <span className="text-[10px] font-medium text-emerald-500">Contestar</span>
            </div>
          </div>
          <p className="mx-auto mt-5 max-w-[17rem] text-[10px] leading-relaxed text-fg/25">
            Llamada directa y cifrada · al contestar se solicitan permisos de micrófono
            {call.incoming.kind === 'video' ? ' y cámara' : ''}. El audio viaja directamente entre ustedes.
          </p>
        </div>
      </div>
    );
  }

  if (!call.active) return null;
  const video = call.active.kind === 'video';
  const hasRemoteVideo = !!call.remoteStream?.getVideoTracks().length;

  const forceAudio = () => {
    const element = hasRemoteVideo ? call.remoteVideoRef.current : call.remoteAudioRef.current;
    if (!element) return;
    if (element.srcObject !== call.remoteStream) element.srcObject = call.remoteStream ?? null;
    element.muted = false;
    element.volume = 1;
    void element.play().catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-[#0a0a0b] text-white backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_600px_at_50%_-10%,rgba(255,255,255,.08),transparent_65%)]" />
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <Avatar name={call.active.peerName} size={36} />
          <div>
            <p className="text-[14px] font-medium text-white/90">{call.active.peerName}</p>
            <p className="text-[11px] text-white/40">
              {call.connected ? `En llamada · ${clock}` : call.active.status === 'ringing' || call.active.status === 'connecting' ? 'Conectando…' : 'Llamando…'}
            </p>
            {call.active.status === 'active' && !call.connected && (
              <p className="mt-0.5 text-[10px] text-amber-300/70">
                {call.iceState === 'failed' ? 'Audio no disponible · revisa tu red o permisos' : 'Conectando audio…'}
              </p>
            )}
            {call.sharing && (
              <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-emerald-300/80">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Compartiendo pantalla
              </p>
            )}
          </div>
        </div>
        <Badge tone={call.connected ? 'success' : 'warn'}>
          {video ? 'Video' : 'Voz'}
        </Badge>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4">
        {hasRemoteVideo ? (
          <video
            ref={call.remoteVideoRef}
            autoPlay
            playsInline
            className="max-h-full w-full max-w-5xl rounded-2xl bg-black object-contain"
          />
        ) : (
          <div className="text-center">
            <div className="mx-auto flex h-32 w-32 items-center justify-center rounded-full border border-white/15 bg-white/[.05]">
              <Avatar name={call.active.peerName} size={112} />
            </div>
            <p className="mt-5 font-display text-2xl text-white/90">{call.active.peerName}</p>
            <p className="mt-1 text-[12px] text-white/35">{call.connected ? `En llamada · ${clock}` : 'Estableciendo conexión…'}</p>
            <p className={cn('mt-3 flex items-center justify-center gap-1.5 text-[11px]', call.connected ? 'text-white/60' : 'text-amber-300/70')}>
              <Volume2 size={12} />{' '}
              {call.connected
                ? 'Audio conectado'
                : call.iceState === 'failed'
                  ? 'Audio no disponible'
                  : 'Conectando audio…'}
            </p>
          </div>
        )}

        {call.localScreenStream && (
          <video
            ref={(element) => { if (element && element.srcObject !== call.localScreenStream) element.srcObject = call.localScreenStream; }}
            autoPlay
            playsInline
            muted
            className="absolute bottom-4 left-6 h-28 w-44 rounded-xl border border-emerald-300/40 bg-black object-contain shadow-lift sm:h-36 sm:w-56"
          />
        )}
        {video && (
          <video
            ref={(element) => { if (element && element.srcObject !== call.localStream) element.srcObject = call.localStream; }}
            autoPlay
            playsInline
            muted
            className="absolute bottom-4 right-6 h-32 w-24 rounded-xl border border-white/15 bg-black object-cover shadow-lift sm:h-40 sm:w-28"
          />
        )}

        {!call.connected && (
          <button
            type="button"
            onClick={forceAudio}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-black/60 px-3 py-1 text-[10px] text-white/75 hover:bg-white/10"
          >
            Activar audio
          </button>
        )}

        <audio ref={call.remoteAudioRef} autoPlay playsInline className="hidden" />
      </div>

      <p className="relative mx-auto mt-1 max-w-md px-4 text-center text-[10px] leading-relaxed text-white/30">
        Se solicitan permisos de micrófono{video ? ' y cámara' : ''}. La llamada es directa: el audio
        {video ? ' y el video' : ''} viajan directamente entre ustedes, sin pasar por nuestros servidores.
      </p>

      {call.error && (
        <p className="relative mx-auto mb-3 max-w-md rounded-xl border border-white/20 bg-white/[.06] px-4 py-2 text-center text-[11.5px] text-white/70">
          {call.error}
        </p>
      )}

      {call.shareError && (
        <p className="relative mx-auto mb-3 max-w-md rounded-xl border border-white/20 bg-white/[.06] px-4 py-2 text-center text-[11.5px] text-white/70">
          {call.shareError} {!call.sharing && 'La llamada continúa con normalidad.'}
        </p>
      )}

      {(call.devices.audioInputs.length > 1 || call.devices.videoInputs.length > 1 || call.devices.audioOutputs.length > 0) && (
        <div className="relative mx-auto mb-2 flex max-w-3xl flex-wrap items-center justify-center gap-2 px-4 text-[10px] text-white/45">
          {call.devices.audioInputs.length > 1 && (
            <label className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[.04] px-2 py-1">
              Micrófono
              <select value={call.audioInputId} onChange={(event) => void call.switchAudioInput(event.target.value)} className="max-w-[130px] bg-transparent text-white/70 outline-none [&>option]:bg-[#101013]">
                {call.devices.audioInputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Micrófono ${index + 1}`}</option>)}
              </select>
            </label>
          )}
          {video && call.devices.videoInputs.length > 1 && (
            <label className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[.04] px-2 py-1">
              Cámara
              <select value={call.videoInputId} onChange={(event) => void call.switchVideoInput(event.target.value)} className="max-w-[130px] bg-transparent text-white/70 outline-none [&>option]:bg-[#101013]">
                {call.devices.videoInputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Cámara ${index + 1}`}</option>)}
              </select>
            </label>
          )}
          {call.devices.canSelectOutput && call.devices.audioOutputs.length > 0 && (
            <label className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[.04] px-2 py-1">
              Salida
              <select value={call.audioOutputId} onChange={(event) => call.setAudioOutputId(event.target.value)} className="max-w-[130px] bg-transparent text-white/70 outline-none [&>option]:bg-[#101013]">
                <option value="">Predeterminada</option>
                {call.devices.audioOutputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Altavoz ${index + 1}`}</option>)}
              </select>
            </label>
          )}
          {video && (
            <button type="button" onClick={() => void call.switchFacingMode()} className="rounded-lg border border-white/10 bg-white/[.04] px-2 py-1 text-white/60 hover:bg-white/[.1]">
              Cámara {call.facingMode === 'user' ? 'frontal' : 'trasera'}
            </button>
          )}
        </div>
      )}

      <div className="relative flex items-center justify-center gap-3 px-5 pb-8 pt-4">
        <button
          onClick={call.toggleMute}
          className={cn('flex h-12 w-12 items-center justify-center rounded-full border transition-colors', call.muted ? 'border-transparent bg-white text-[#0a0a0b]' : 'border-white/15 bg-white/[.06] text-white/80 hover:bg-white/[.12]')}
          aria-label={call.muted ? 'Activar micrófono' : 'Silenciar micrófono'}
        >
          {call.muted ? <MicOff size={19} /> : <Mic size={19} />}
        </button>
        {video && (
          <button
            onClick={call.toggleCamera}
            className={cn('flex h-12 w-12 items-center justify-center rounded-full border transition-colors', !call.cameraOn ? 'border-transparent bg-white text-[#0a0a0b]' : 'border-white/15 bg-white/[.06] text-white/80 hover:bg-white/[.12]')}
            aria-label={call.cameraOn ? 'Apagar cámara' : 'Encender cámara'}
          >
            {call.cameraOn ? <Camera size={19} /> : <VideoOff size={19} />}
          </button>
        )}
        <button
          type="button"
          onClick={() => void call.startShare()}
          className={cn(
            'flex h-12 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition-colors',
            call.sharing
              ? 'border-transparent bg-white text-[#0a0a0b]'
              : 'border-white/15 bg-white/[.06] text-white/80 hover:bg-white/[.12]',
          )}
          aria-label={call.sharing ? 'Detener compartición' : 'Compartir pantalla'}
          title={call.sharing ? 'Detener compartición' : 'Compartir pantalla'}
        >
          {call.sharing ? <MonitorOff size={18} /> : <MonitorUp size={18} />}
          {call.sharing ? 'Detener compartición' : 'Compartir pantalla'}
        </button>
        <button
          type="button"
          onClick={call.end}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white shadow-[0_16px_34px_-18px_rgba(239,68,68,.95)] ring-4 ring-red-500/15 transition-transform hover:scale-105 hover:bg-red-600"
          aria-label="Finalizar llamada"
          title="Finalizar llamada"
        >
          <HangUpIcon size={23} />
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────── Mensajería ─────────────────────────── */

export default function Messages() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const socket = useSocket();
  const call = useCallController();
  const bubbleColors = useBubbleColors();

  const [search, setSearch] = useState('');
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [typingName, setTypingName] = useState<string | null>(null);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [infoOpen, setInfoOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [reactionFor, setReactionFor] = useState<string | null>(null);
  const [toolbarFor, setToolbarFor] = useState<string | null>(null);
  const [forwardFor, setForwardFor] = useState<Message | null>(null);
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [newPackName, setNewPackName] = useState('');
  const [stickerUploading, setStickerUploading] = useState(false);
  const [oneTimeImages, setOneTimeImages] = useState<Record<string, string>>({});
  const [headerSearchOpen, setHeaderSearchOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [peopleTab, setPeopleTab] = useState<'search' | 'requests'>('search');
  const [peopleSearch, setPeopleSearch] = useState('');
  const [debouncedPeopleSearch, setDebouncedPeopleSearch] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const oneTimeFileRef = useRef<HTMLInputElement>(null);
  const stickerFileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const discardRecordingRef = useRef(false);
  const typingTimerRef = useRef<number | null>(null);
  const typingClearRef = useRef<number | null>(null);
  const longPressRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const oneTimeUrlsRef = useRef<Set<string>>(new Set());

  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<ConversationsResponse>('/messaging/conversations'),
  });

  const conversationQuery = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api<ConversationResponse>(`/messaging/conversations/${id}`),
    enabled: Boolean(id),
  });

  const messagesQuery = useQuery({
    queryKey: ['messages', id],
    queryFn: () => api<MessagesResponse>(`/messaging/conversations/${id}/messages?limit=60`),
    enabled: Boolean(id),
  });

  const studentsQuery = useQuery({
    queryKey: ['message-students', studentSearch],
    queryFn: () => api<StudentsResponse>(`/users?q=${encodeURIComponent(studentSearch)}&limit=20`),
    enabled: newChatOpen,
  });

  const peopleQuery = useQuery({
    queryKey: ['people-search', debouncedPeopleSearch],
    queryFn: () => api<PeopleSearchResponse>(`/users/search?q=${encodeURIComponent(debouncedPeopleSearch)}&limit=20`),
    enabled: peopleOpen && peopleTab === 'search' && debouncedPeopleSearch.length >= 2,
  });

  const friendsQuery = useQuery({
    queryKey: ['community-friends'],
    queryFn: () => api<FriendsResponse>('/community/friends'),
    enabled: peopleOpen,
  });

  const packsQuery = useQuery({
    queryKey: ['sticker-packs'],
    queryFn: () => api<{ packs: StickerPack[] }>('/stickers/packs'),
    staleTime: 60_000,
  });

  const stickersQuery = useQuery({
    queryKey: ['sticker-stickers'],
    queryFn: async () => {
      const packs = await api<{ packs: StickerPack[] }>('/stickers/packs');
      const lists = await Promise.all(
        packs.packs.map((pack) => api<{ stickers: Sticker[] }>(`/stickers/packs/${pack.id}/stickers`)),
      );
      return lists.flatMap((list) => list.stickers);
    },
    staleTime: 60_000,
  });

  const messageSearchQuery = useQuery({
    queryKey: ['message-search', id, headerSearch.trim()],
    queryFn: () => api<SearchResponse>(`/messaging/conversations/${id}/search?q=${encodeURIComponent(headerSearch.trim())}`),
    enabled: Boolean(id && headerSearch.trim()),
  });

  const conversation = conversationQuery.data?.conversation;
  const messages = messagesQuery.data?.messages ?? [];

  const otherMember = useMemo(
    () => conversation?.type === 'direct' ? conversation.members.find((member) => member.id !== user?.id) ?? null : null,
    [conversation, user?.id],
  );

  const stickerByBody = useMemo(() => {
    const map = new Map<string, Sticker>();
    for (const sticker of stickersQuery.data ?? []) {
      if (!map.has(sticker.name)) map.set(sticker.name, sticker);
    }
    return map;
  }, [stickersQuery.data]);

  const visibleStickers = useMemo(() => {
    const all = stickersQuery.data ?? [];
    const packId = activePackId ?? packsQuery.data?.packs[0]?.id ?? null;
    return packId ? all.filter((sticker) => sticker.pack_id === packId) : all;
  }, [activePackId, packsQuery.data, stickersQuery.data]);

  const unreadConversations = (conversationsQuery.data?.conversations ?? []).filter((item) => item.unread > 0).length;

  const filteredConversations = useMemo(() => {
    const list = conversationsQuery.data?.conversations ?? [];
    const term = search.trim().toLowerCase();
    return list
      .filter((item) => {
        if (listFilter === 'archived') {
          if (!item.archived) return false;
        } else if (item.archived) {
          return false;
        }
        if (listFilter === 'unread' && item.unread <= 0) return false;
        if (listFilter === 'pinned' && !item.pinned) return false;
        if (!term) return true;
        return item.title.toLowerCase().includes(term) ||
          item.members.some((member) => member.name.toLowerCase().includes(term));
      })
      .sort((a, b) =>
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
        new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime(),
      );
  }, [conversationsQuery.data, listFilter, search]);

  const invalidateChat = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    if (id) {
      queryClient.invalidateQueries({ queryKey: ['messages', id] });
      queryClient.invalidateQueries({ queryKey: ['conversation', id] });
    }
  }, [id, queryClient]);

  // Solo busca cuando el texto deja de cambiar y tiene al menos 2 caracteres.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedPeopleSearch(peopleSearch.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [peopleSearch]);

  useEffect(() => {
    setDraft('');
    setReplyTo(null);
    setEditing(null);
    setTypingName(null);
    setHeaderSearch('');
    setHeaderSearchOpen(false);
    setHighlightedId(null);
    setReactionFor(null);
    setToolbarFor(null);
    setMenuFor(null);
    setComposerEmojiOpen(false);
    setStickerOpen(false);
    setForwardFor(null);
    setOneTimeImages({});
  }, [id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuFor(null);
      setToolbarFor(null);
      setReactionFor(null);
      setComposerEmojiOpen(false);
      setStickerOpen(false);
      setHeaderSearchOpen(false);
      setForwardFor(null);
      setPeopleOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!menuFor) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('[data-conversation-menu]')) setMenuFor(null);
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuFor]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, id]);

  useEffect(() => {
    if (!id || !messagesQuery.data) return;
    api(`/messaging/conversations/${id}/read`, { method: 'POST' })
      .then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
      .catch(() => {});
  }, [id, messagesQuery.data, queryClient]);

  useEffect(() => {
    if (!socket) return;
    socket.emit('presence:sync');

    const onPresenceList = (payload: { online: string[] }) => setOnline(new Set(payload.online));
    const onPresenceUpdate = (payload: { userId: string; online: boolean }) => {
      setOnline((current) => {
        const next = new Set(current);
        if (payload.online) next.add(payload.userId);
        else next.delete(payload.userId);
        return next;
      });
    };
    const onNewMessage = (message: Message) => {
      if (message.conversationId === id) {
        queryClient.setQueryData<MessagesResponse>(['messages', id], (current) => {
          if (!current) return current;
          if (current.messages.some((item) => item.id === message.id)) return current;
          return { ...current, messages: [...current.messages, message] };
        });
        setTypingName(null);
      }
      invalidateChat();
    };
    const onMessageUpdated = () => invalidateChat();
    const onMessageDeleted = () => invalidateChat();
    const onReaction = () => invalidateChat();
    const onNewConversation = () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };
    const onRead = () => invalidateChat();
    const onTyping = (payload: { conversationId: string; userId: string; name: string; typing: boolean }) => {
      if (payload.conversationId !== id || payload.userId === user?.id) return;
      setTypingName(payload.typing ? payload.name : null);
      if (typingClearRef.current) window.clearTimeout(typingClearRef.current);
      if (payload.typing) {
        typingClearRef.current = window.setTimeout(() => setTypingName(null), 2600);
      }
    };

    socket.on('presence:list', onPresenceList);
    socket.on('presence:update', onPresenceUpdate);
    socket.on('message:new', onNewMessage);
    socket.on('message:updated', onMessageUpdated);
    socket.on('message:deleted', onMessageDeleted);
    socket.on('message:reaction', onReaction);
    socket.on('reaction:new', onReaction);
    socket.on('conversation:new', onNewConversation);
    socket.on('conversation:activity', onNewConversation);
    socket.on('conversation:read', onRead);
    socket.on('typing', onTyping);

    return () => {
      socket.off('presence:list', onPresenceList);
      socket.off('presence:update', onPresenceUpdate);
      socket.off('message:new', onNewMessage);
      socket.off('message:updated', onMessageUpdated);
      socket.off('message:deleted', onMessageDeleted);
      socket.off('message:reaction', onReaction);
      socket.off('reaction:new', onReaction);
      socket.off('conversation:new', onNewConversation);
      socket.off('conversation:activity', onNewConversation);
      socket.off('conversation:read', onRead);
      socket.off('typing', onTyping);
    };
  }, [id, invalidateChat, queryClient, socket, user?.id]);

  useEffect(() => () => {
    if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    if (typingClearRef.current) window.clearTimeout(typingClearRef.current);
    if (longPressRef.current) window.clearTimeout(longPressRef.current);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    oneTimeUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    oneTimeUrlsRef.current.clear();
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
  }, []);

  const handleDraft = (value: string) => {
    setDraft(value);
    if (!id || !socket) return;
    socket.emit('typing', { conversationId: id, typing: Boolean(value.trim()) });
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      socket.emit('typing', { conversationId: id, typing: false });
    }, 1800);
  };

  const insertEmoji = (emoji: string) => {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? draft.length;
    const end = element?.selectionEnd ?? draft.length;
    handleDraft(`${draft.slice(0, start)}${emoji}${draft.slice(end)}`);
    setComposerEmojiOpen(false);
    window.requestAnimationFrame(() => {
      element?.focus();
      const caret = start + emoji.length;
      element?.setSelectionRange(caret, caret);
    });
  };

  const startLongPress = (messageId: string) => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current);
    longPressRef.current = window.setTimeout(() => setToolbarFor(messageId), 500);
  };

  const endLongPress = () => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const updatePreferences = async (
    item: Conversation,
    patch: Partial<Pick<Conversation, 'pinned' | 'archived' | 'muted'>>,
  ) => {
    setMenuFor(null);
    try {
      await api(`/messaging/conversations/${item.id}/preferences`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      queryClient.setQueryData<ConversationsResponse>(['conversations'], (current) => current ? {
        ...current,
        conversations: current.conversations.map((entry) => entry.id === item.id ? { ...entry, ...patch } : entry),
      } : current);
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo actualizar la conversación.');
    }
  };

  const copyMessage = async (message: Message) => {
    setToolbarFor(null);
    try {
      if (!navigator.clipboard) throw new Error('Portapapeles no disponible.');
      await navigator.clipboard.writeText(message.body ?? '');
      toast.success('Mensaje copiado.');
    } catch {
      toast.error('No se pudo copiar el mensaje.');
    }
  };

  const openOneTime = async (message: Message) => {
    setToolbarFor(null);
    try {
      const response = await api<Response>(`/messaging/messages/${message.id}/one-time`, {}, { raw: true });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      oneTimeUrlsRef.current.add(url);
      setOneTimeImages((current) => ({ ...current, [message.id]: url }));
      queryClient.setQueryData<MessagesResponse>(['messages', id], (current) => current ? {
        ...current,
        messages: current.messages.map((entry) => entry.id === message.id ? { ...entry, viewed: true } : entry),
      } : current);
      void queryClient.invalidateQueries({ queryKey: ['messages', id] });
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo abrir la foto.');
    }
  };

  const jumpToMessage = async (messageId: string) => {
    if (!id) return;
    const inCache = () => (queryClient.getQueryData<MessagesResponse>(['messages', id])?.messages ?? [])
      .some((entry) => entry.id === messageId);
    let found = inCache();
    let attempts = 0;
    while (!found && attempts < 6) {
      const current = queryClient.getQueryData<MessagesResponse>(['messages', id]);
      const oldest = current?.messages[0];
      if (!current?.hasMore || !oldest?.createdAt) break;
      const older = await api<MessagesResponse>(
        `/messaging/conversations/${id}/messages?before=${encodeURIComponent(oldest.createdAt)}&limit=100`,
      );
      if (!older.messages.length) break;
      queryClient.setQueryData<MessagesResponse>(['messages', id], (previous) => previous ? {
        ...older,
        messages: [...older.messages, ...previous.messages],
      } : previous);
      found = inCache();
      attempts += 1;
    }
    if (!found) {
      toast.info('No se pudo cargar ese mensaje.');
      return;
    }
    setHeaderSearchOpen(false);
    window.setTimeout(() => {
      document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedId(messageId);
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => setHighlightedId(null), 2200);
    }, 100);
  };

  const send = async () => {
    if (!id || !draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    try {
      await api(`/messaging/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text, kind: 'text', replyTo: replyTo?.id ?? null }),
      });
      setReplyTo(null);
      invalidateChat();
      socket?.emit('typing', { conversationId: id, typing: false });
    } catch (error) {
      setDraft(text);
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo enviar el mensaje.');
    }
  };

  const uploadAndSend = async (file: File, kind: 'image' | 'file' | 'audio') => {
    if (!id) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('files', file);
      const uploaded = await api<{ documents: Array<{ id: string; name: string }> }>('/documents', { method: 'POST', body: form });
      const document = uploaded.documents[0];
      await api(`/messaging/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          kind,
          attachmentId: document.id,
          body: kind === 'image' || kind === 'audio' ? undefined : document.name,
          replyTo: replyTo?.id ?? null,
        }),
      });
      setReplyTo(null);
      invalidateChat();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo enviar el archivo.');
    } finally {
      setUploading(false);
    }
  };

  const uploadAndSendOneTime = async (file: File) => {
    if (!id) return;
    if (!file.type.startsWith('image/')) {
      toast.error('La foto única debe ser una imagen.');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('files', file);
      const uploaded = await api<{ documents: Array<{ id: string; name: string }> }>('/documents', { method: 'POST', body: form });
      const document = uploaded.documents[0];
      await api(`/messaging/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          kind: 'image',
          attachmentId: document.id,
          oneTime: true,
          replyTo: replyTo?.id ?? null,
        }),
      });
      setReplyTo(null);
      invalidateChat();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo enviar la foto única.');
    } finally {
      setUploading(false);
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Tu navegador no permite grabar notas de voz.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      discardRecordingRef.current = false;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
        setRecording(false);
        setRecordSeconds(0);
        const discarded = discardRecordingRef.current;
        discardRecordingRef.current = false;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (discarded) { toast.info('Grabación cancelada.'); return; }
        if (blob.size < 600) { toast.error('La nota de voz quedó vacía.'); return; }
        await uploadAndSend(new File([blob], `nota-de-voz-${Date.now()}.webm`, { type: blob.type || 'audio/webm' }), 'audio');
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = window.setInterval(() => setRecordSeconds((value) => value + 1), 1000);
    } catch {
      toast.error('No se pudo acceder al micrófono.');
    }
  };

  const cancelRecording = () => {
    discardRecordingRef.current = true;
    recorderRef.current?.stop();
  };

  const react = async (message: Message, emoji: string) => {
    setReactionFor(null);
    try {
      await api(`/messaging/messages/${message.id}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) });
      invalidateChat();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo reaccionar.');
    }
  };

  const sendSticker = async (sticker: Sticker) => {
    if (!id) return;
    try {
      const response = await api<Response>(sticker.url.replace(/^\/api/, ''), {}, { raw: true });
      const blob = await response.blob();
      const form = new FormData();
      form.append('files', new File([blob], `${sticker.name}.png`, { type: sticker.mime || 'image/png' }));
      const uploaded = await api<{ documents: Array<{ id: string }> }>('/documents', { method: 'POST', body: form });
      await api(`/messaging/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          kind: 'image',
          attachmentId: uploaded.documents[0].id,
          stickerPack: sticker.pack_id,
          replyTo: replyTo?.id ?? null,
        }),
      });
      setStickerOpen(false);
      setReplyTo(null);
      invalidateChat();
      socket?.emit('typing', { conversationId: id, typing: false });
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo enviar la pegatina.');
    }
  };

  const createPack = async () => {
    const name = newPackName.trim();
    if (!name) return;
    try {
      const response = await api<{ pack: StickerPack }>('/stickers/packs', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setActivePackId(response.pack.id);
      setNewPackName('');
      await queryClient.invalidateQueries({ queryKey: ['sticker-packs'] });
      toast.success('Paquete de pegatinas creado.');
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo crear el paquete.');
    }
  };

  const uploadSticker = async (file: File) => {
    const packId = activePackId ?? packsQuery.data?.packs[0]?.id;
    if (!packId) {
      toast.error('Crea un paquete antes de subir pegatinas.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('Las pegatinas deben ser imágenes.');
      return;
    }
    setStickerUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('keywords', file.name.replace(/\.[^.]+$/, '').slice(0, 200));
      await api(`/stickers/packs/${packId}/stickers`, { method: 'POST', body: form });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sticker-packs'] }),
        queryClient.invalidateQueries({ queryKey: ['sticker-stickers'] }),
      ]);
      toast.success('Pegatina agregada al paquete.');
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo subir la pegatina.');
    } finally {
      setStickerUploading(false);
    }
  };

  const sendForward = async (targetId: string) => {
    if (!forwardFor) return;
    const ownAttachment = forwardFor.sender.id === user?.id ? forwardFor.attachment ?? null : null;
    let attachmentId = ownAttachment?.id ?? null;
    let body: string | undefined = forwardFor.body ??
      (forwardFor.attachment && !ownAttachment ? `📎 ${forwardFor.attachment.name}` : 'Mensaje reenviado');
    try {
      if (forwardFor.attachment && !ownAttachment && forwardFor.attachment.mime.startsWith('image/')) {
        const response = await api<Response>(`/files/${forwardFor.attachment.id}`, {}, { raw: true });
        const blob = await response.blob();
        const form = new FormData();
        form.append('files', new File([blob], forwardFor.attachment.name, { type: forwardFor.attachment.mime }));
        const uploaded = await api<{ documents: Array<{ id: string }> }>('/documents', { method: 'POST', body: form });
        attachmentId = uploaded.documents[0].id;
        body = undefined;
      }
      await api(`/messaging/conversations/${targetId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body,
          kind: attachmentId && forwardFor.attachment?.mime.startsWith('image/') ? 'image' : forwardFor.kind,
          attachmentId,
          stickerPack: forwardFor.stickerPack ?? null,
        }),
      });
      setForwardFor(null);
      toast.success('Mensaje reenviado.');
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo reenviar el mensaje.');
    }
  };

  const remove = async (message: Message) => {
    if (!window.confirm('¿Eliminar este mensaje para todos?')) return;
    try {
      await api(`/messaging/messages/${message.id}`, { method: 'DELETE' });
      invalidateChat();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo eliminar.');
    }
  };

  const saveEdit = async () => {
    if (!editing || !editDraft.trim()) return;
    try {
      await api(`/messaging/messages/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ body: editDraft.trim() }) });
      setEditing(null);
      invalidateChat();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo editar.');
    }
  };

  const startChat = async (studentId: string, fromPeople = false) => {
    try {
      const response = await api<ConversationResponse>('/messaging/conversations', {
        method: 'POST',
        body: JSON.stringify({ type: 'direct', memberIds: [studentId] }),
      });
      setNewChatOpen(false);
      setStudentSearch('');
      if (fromPeople) {
        setPeopleOpen(false);
        setPeopleSearch('');
        setDebouncedPeopleSearch('');
      }
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      navigate(`/mensajes/${response.conversation.id}`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo iniciar la conversación.');
    }
  };

  const refreshPeople = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['people-search'] }),
      queryClient.invalidateQueries({ queryKey: ['community-friends'] }),
      queryClient.invalidateQueries({ queryKey: ['friends'] }),
    ]);
  }, [queryClient]);

  const runFriendAction = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      await refreshPeople();
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'No se pudo completar la acción.');
    }
  };

  const addFriend = (userId: string) => runFriendAction(
    () => api('/community/friends/request', { method: 'POST', body: JSON.stringify({ userId }) }),
    'Solicitud de amistad enviada.',
  );

  const respondFriend = (requestId: string, action: 'accept' | 'reject' | 'block') => runFriendAction(
    () => api(`/community/friends/${requestId}/respond`, { method: 'POST', body: JSON.stringify({ action }) }),
    action === 'accept' ? 'Solicitud aceptada.' : action === 'reject' ? 'Solicitud rechazada.' : 'Usuario bloqueado.',
  );

  const cancelFriend = (userId: string) => runFriendAction(
    () => api(`/community/friends/${userId}`, { method: 'DELETE' }),
    'Solicitud cancelada.',
  );

  const directChatId = (userId: string) => (conversationsQuery.data?.conversations ?? []).find(
    (item) => item.type === 'direct' && item.members.some((member) => member.id === userId),
  )?.id;

  const hasChatWith = (userId: string) => Boolean(directChatId(userId));

  const isReadByPeer = (message: Message) => {
    if (!conversation || conversation.type !== 'direct' || message.sender.id !== user?.id) return false;
    const peer = conversation.members.find((member) => member.id !== user?.id);
    if (!peer?.lastReadAt) return false;
    return new Date(peer.lastReadAt).getTime() >= new Date(message.createdAt).getTime();
  };

  const list = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line/70 p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg/25" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar conversación…" className="input !py-2 !text-[12px] pl-9" />
          </div>
          <button onClick={() => setNewChatOpen(true)} className="btn btn-primary btn-sm !px-2.5" aria-label="Nueva conversación"><Plus size={15} /></button>
          <button onClick={() => setPeopleOpen(true)} className="btn btn-sm !px-2.5" aria-label="Buscar personas" title="Buscar personas"><UserPlus size={15} /></button>
        </div>
      </div>

      <div className="border-b border-line/70 px-2 pb-2 pt-2">
        <Tabs<ListFilter>
          value={listFilter}
          onChange={setListFilter}
          className="flex w-full [&>button]:flex-1 [&>button]:px-1.5 [&>button]:text-[10.5px]"
          items={[
            { id: 'all', label: 'Todos' },
            { id: 'unread', label: 'Sin leer', count: unreadConversations },
            { id: 'pinned', label: 'Fijados' },
            { id: 'archived', label: 'Archivados' },
          ]}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversationsQuery.isLoading && (
          <div className="space-y-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        )}

        {!conversationsQuery.isLoading && filteredConversations.length === 0 && (
          <div className="px-4 py-10 text-center">
            <MessageSquare size={22} className="mx-auto text-fg/20" />
            <p className="mt-3 text-[12px] text-fg/40">
              {search.trim() ? 'No encontramos conversaciones con ese nombre.' :
                listFilter === 'archived' ? 'No tienes conversaciones archivadas.' :
                  listFilter === 'pinned' ? 'Aún no tienes conversaciones fijadas.' :
                    'Aún no tienes conversaciones.'}
            </p>
            {listFilter === 'all' && !search.trim() && (
              <button onClick={() => setNewChatOpen(true)} className="btn btn-sm mt-3">Iniciar una conversación</button>
            )}
          </div>
        )}

        {filteredConversations.map((item) => {
          const peer = item.type === 'direct' ? item.members.find((member) => member.id !== user?.id) : null;
          const active = item.id === id;
          const preview = item.lastMessage
            ? item.lastMessage.deleted
              ? 'Mensaje eliminado'
              : item.lastMessage.oneTime
                ? '🔒 Foto única'
                : item.lastMessage.stickerPack
                  ? '🎨 Pegatina'
                  : item.lastMessage.kind === 'image'
                    ? '📷 Imagen'
                    : item.lastMessage.kind === 'audio'
                      ? '🎙️ Nota de voz'
                      : item.lastMessage.kind === 'file'
                        ? `📎 ${item.lastMessage.attachment?.name ?? 'Archivo'}`
                        : item.lastMessage.body ?? '—'
            : 'Sin mensajes todavía';

          return (
            <div key={item.id} className="relative" data-conversation-menu>
              <Link
                to={`/mensajes/${item.id}`}
                className={cn(
                  'flex items-center gap-3 border-b border-line px-3 py-3 transition-colors',
                  active ? 'bg-fg/[.055] shadow-[inset_0_0_0_1px_rgba(10,10,10,.035)] dark:bg-white/[.08]' : 'hover:bg-fg/[.03]',
                )}
              >
                <span className="relative">
                  <Avatar name={item.title} url={item.avatarUrl} size={40} />
                  {peer && online.has(peer.id) && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-paper bg-fg" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-[13px] font-medium text-fg/85">{item.title}</span>
                    {item.pinned && <Pin size={10} className="shrink-0 text-fg/35" />}
                    {item.muted && <BellOff size={10} className="shrink-0 text-fg/30" />}
                    <span className="ml-auto shrink-0 text-[9.5px] text-fg/25">{timeAgo(item.lastMessageAt)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span className="truncate text-[11.5px] text-fg/35">{preview}</span>
                    {item.unread > 0 && (
                      <span className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-fg px-1 text-[9px] font-bold text-paper">
                        {item.unread > 9 ? '9+' : item.unread}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenuFor(menuFor === item.id ? null : item.id);
                }}
                className="absolute bottom-2 right-1.5 rounded-full p-1 text-fg/30 transition-colors hover:bg-fg/10 hover:text-fg/70"
                aria-label="Opciones de la conversación"
                title="Opciones"
              >
                <MoreHorizontal size={15} />
              </button>
              {menuFor === item.id && (
                <div
                  className="absolute right-2 top-10 z-30 w-48 rounded-xl border border-line/80 bg-white/95 p-1 text-[12px] shadow-lift backdrop-blur-xl dark:bg-white/[.1]"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={(event) => { event.preventDefault(); void updatePreferences(item, { pinned: !item.pinned }); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-fg/70 hover:bg-fg/[.06] hover:text-fg"
                  >
                    <Pin size={12} /> {item.pinned ? 'Desfijar conversación' : 'Fijar conversación'}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => { event.preventDefault(); void updatePreferences(item, { archived: !item.archived }); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-fg/70 hover:bg-fg/[.06] hover:text-fg"
                  >
                    <Archive size={12} /> {item.archived ? 'Sacar del archivo' : 'Archivar conversación'}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => { event.preventDefault(); void updatePreferences(item, { muted: !item.muted }); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-fg/70 hover:bg-fg/[.06] hover:text-fg"
                  >
                    <BellOff size={12} /> {item.muted ? 'Activar notificaciones' : 'Silenciar notificaciones'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const chat = id ? (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-line/70 px-3 py-2.5 sm:px-4">
        <button onClick={() => navigate('/mensajes')} className="btn btn-ghost btn-sm !px-1.5 lg:hidden" aria-label="Volver"><ArrowLeft size={17} /></button>
        {conversation ? (
          <>
            <span className="relative">
              <Avatar name={conversation.title} url={conversation.avatarUrl} size={36} />
              {otherMember && online.has(otherMember.id) && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-paper bg-fg" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-fg/90">{conversation.title}</p>
              <p className="truncate text-[10.5px] text-fg/35">
                {typingName
                  ? `${typingName} está escribiendo…`
                  : otherMember
                    ? online.has(otherMember.id) ? 'En línea' : otherMember.university ?? 'Estudiante de Derecho'
                    : `${conversation.members.length} integrantes`}
              </p>
            </div>
            {conversation.type === 'direct' && otherMember && (
              <>
                <button onClick={() => call.start(otherMember, 'audio', conversation.id)} className="btn btn-ghost btn-sm !px-2" title="Llamada de voz"><Phone size={15} /></button>
                <button onClick={() => call.start(otherMember, 'video', conversation.id)} className="btn btn-ghost btn-sm !px-2" title="Llamada de video"><Video size={15} /></button>
              </>
            )}
            <button
              onClick={() => setColorsOpen(true)}
              className="btn btn-ghost btn-sm !px-2"
              title="Colores de las burbujas"
              aria-label="Colores de las burbujas"
            >
              <Palette size={15} />
            </button>
            <button
              onClick={() => setHeaderSearchOpen((open) => !open)}
              className={cn('btn btn-ghost btn-sm !px-2', headerSearchOpen && 'bg-fg/[.08]')}
              title="Buscar en la conversación"
              aria-label="Buscar en la conversación"
            >
              <Search size={15} />
            </button>
            <button onClick={() => setInfoOpen(true)} className="btn btn-ghost btn-sm !px-2" title="Detalles"><Info size={15} /></button>
          </>
        ) : (
          <Skeleton className="h-9 w-48" />
        )}
      </header>

      {headerSearchOpen && (
        <div className="border-b border-line/70 bg-white/40 px-3 py-2.5 dark:bg-white/[.035]">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg/25" />
              <input
                autoFocus
                value={headerSearch}
                onChange={(event) => setHeaderSearch(event.target.value)}
                placeholder="Buscar mensajes en esta conversación…"
                className="input !py-2 !text-[12px] pl-9"
              />
            </div>
            <button
              onClick={() => { setHeaderSearch(''); setHeaderSearchOpen(false); }}
              className="btn btn-ghost btn-sm !px-2"
              aria-label="Cerrar búsqueda"
            >
              <X size={14} />
            </button>
          </div>
          {headerSearch.trim() && (
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {messageSearchQuery.isLoading && <p className="py-2 text-center text-[11px] text-fg/35">Buscando…</p>}
              {messageSearchQuery.data?.messages.map((result) => (
                <button
                  key={result.id}
                  onClick={() => void jumpToMessage(result.id)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-fg/[.05]"
                >
                  <Avatar name={result.sender.name} size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="text-[11px] font-medium text-fg/70">{result.sender.name}</span>
                      <span className="text-[9px] text-fg/30">
                        {new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(result.createdAt))}
                      </span>
                    </span>
                    <span className="block truncate text-[11px] text-fg/45">{result.body ?? 'Archivo adjunto'}</span>
                  </span>
                </button>
              ))}
              {!messageSearchQuery.isLoading && (messageSearchQuery.data?.messages.length ?? 0) === 0 && (
                <p className="py-2 text-center text-[11px] text-fg/35">Sin coincidencias.</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 space-y-1 overflow-y-auto px-3 py-4 sm:px-5">
        {messagesQuery.isLoading && (
          <div className="space-y-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className={cn('h-12', i % 2 ? 'ml-auto w-2/3' : 'w-1/2')} />)}</div>
        )}

        {!messagesQuery.isLoading && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line/80 bg-white/45 dark:bg-white/[.05]"><MessageSquare size={22} className="text-fg/40" /></div>
            <p className="mt-4 font-display text-lg text-fg/85">Empieza la conversación</p>
            <p className="mt-1 max-w-xs text-[12px] text-fg/35">Los mensajes se entregan en tiempo real. También puedes enviar archivos, imágenes y notas de voz.</p>
          </div>
        )}

        {messages.map((message, index) => {
          const mine = message.sender.id === user?.id;
          const previous = messages[index - 1];
          const showDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
          const showSender = conversation?.type === 'group' && (!previous || previous.sender.id !== message.sender.id);
          const sticker = message.stickerPack && message.body ? stickerByBody.get(message.body) : undefined;
          const isImageAttachment = Boolean(
            message.attachment && (message.kind === 'image' || message.attachment.mime.startsWith('image/')),
          );
          const oneTimeUrl = oneTimeImages[message.id];

          return (
            <div key={message.id} id={`message-${message.id}`}>
              {showDay && (
                <div className="my-4 flex items-center justify-center">
                  <span className="rounded-full border border-line bg-fg/[.03] px-3 py-0.5 text-[9.5px] uppercase tracking-[0.12em] text-fg/30">
                    {new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(message.createdAt))}
                  </span>
                </div>
              )}

              <div className={cn('group flex items-end gap-2', mine ? 'flex-row-reverse' : 'flex-row')}>
                {!mine && <Avatar name={message.sender.name} url={message.sender.avatarUrl} size={26} className={cn(showSender ? '' : 'invisible')} />}

                <div className={cn('relative max-w-[72%] sm:max-w-[62%]', mine ? 'items-end' : 'items-start')}>
                  {showSender && !mine && <p className="mb-0.5 pl-1 text-[10px] font-medium text-fg/40">{message.sender.name}</p>}

                  <div
                    onTouchStart={() => startLongPress(message.id)}
                    onTouchEnd={endLongPress}
                    onTouchMove={endLongPress}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setToolbarFor(message.id);
                    }}
                    style={bubbleStyle(mine ? 'mine' : 'other', bubbleColors.colors)}
                    className={cn(
                      'relative px-3 py-1 text-[12.5px] leading-normal transition-shadow',
                      mine ? 'bubble-me' : 'bubble-other',
                      message.deleted && 'italic opacity-60',
                      highlightedId === message.id && 'ring-2 ring-fg/40 shadow-lift',
                    )}
                  >
                    {message.replyTo && !message.deleted && (
                      <div className={cn('mb-1 rounded-lg border-l-2 px-1.5 py-0.5 text-[10px] leading-snug', mine ? 'border-white/40 bg-white/10 text-current opacity-75' : 'border-current bg-black/[.04] text-current opacity-55')}>
                        <p className="font-medium">{message.replyTo.sender_name}</p>
                        <p className="line-clamp-2">{message.replyTo.body ?? 'Archivo adjunto'}</p>
                      </div>
                    )}

                    {message.deleted ? (
                      <p>Mensaje eliminado</p>
                    ) : (
                      <>
                        {sticker && (
                          <AuthedImage path={sticker.url.replace(/^\/api/, '')} name={sticker.name} className="h-28 w-28 object-contain" />
                        )}

                        {message.oneTime && message.kind === 'image' && !mine ? (
                          oneTimeUrl ? (
                            <span className="relative block">
                              <img src={oneTimeUrl} alt="Foto única" className="max-h-72 rounded-lg object-cover" />
                              <span className="absolute right-1 top-1 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[9px] text-white">
                                <Eye size={10} /> Vista una vez
                              </span>
                            </span>
                          ) : message.viewed ? (
                            <span className="flex items-center gap-1.5 py-1 text-[11px] italic opacity-50"><Eye size={12} /> Foto única visualizada</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void openOneTime(message)}
                              className="flex items-center gap-2 rounded-lg border border-dashed border-current px-3 py-3 text-[11px] opacity-70 transition-opacity hover:opacity-100"
                            >
                              <Lock size={14} /> Ver foto única
                            </button>
                          )
                        ) : isImageAttachment && !sticker ? (
                          <AuthedImage
                            path={`/files/${message.attachment!.id}`}
                            name={message.attachment!.name}
                            className="max-h-72 rounded-lg object-cover"
                          />
                        ) : null}

                        {message.attachment && (message.kind === 'audio' || message.attachment.mime.startsWith('audio/')) && (
                          <AudioNote fileId={message.attachment.id} />
                        )}
                        {message.attachment && message.kind === 'file' && (
                          <a href={`/api/files/${message.attachment.id}`} target="_blank" rel="noreferrer" className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5', mine ? 'bg-white/10 hover:bg-white/20' : 'bg-black/[.05] hover:bg-black/[.09]')}>
                            <FileText size={16} className="shrink-0 opacity-60" />
                            <span className="min-w-0">
                              <span className="block truncate text-[12px] opacity-90">{message.attachment.name}</span>
                              <span className="block text-[10px] opacity-50">{formatBytes(message.attachment.size)}</span>
                            </span>
                          </a>
                        )}

                        {message.body && !sticker && !isImageAttachment && message.kind !== 'audio' && !message.attachment?.mime.startsWith('audio/') && (message.kind !== 'file' || message.body !== message.attachment?.name) && (
                          <p className="whitespace-pre-wrap break-words">{message.body}</p>
                        )}
                      </>
                    )}

                    <div className={cn('mt-1 flex items-center gap-1.5 text-[9px] opacity-50', mine && 'justify-end')}>
                      <span>{new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.createdAt))}</span>
                      {message.oneTime && <Lock size={10} aria-label="Visualización única" />}
                      {message.editedAt && <span>editado</span>}
                      {mine && !message.deleted && <CheckCheck size={11} className={cn('text-current', !isReadByPeer(message) && 'opacity-60')} />}
                    </div>
                  </div>

                  {message.reactions.length > 0 && (
                    <div className={cn('mt-0.5 flex flex-wrap gap-1', mine ? 'justify-end' : 'justify-start')}>
                      {message.reactions.map((reaction) => (
                        <button key={reaction.emoji} onClick={() => react(message, reaction.emoji)} className="rounded-full border border-line/80 bg-white/70 px-1.5 py-0.5 text-[10px] text-fg/60 backdrop-blur-sm transition-colors hover:border-fg/25 dark:bg-white/[.06]">
                          {reaction.emoji} {reaction.count}
                        </button>
                      ))}
                    </div>
                  )}

                  {!message.deleted && (
                    <div
                      className={cn(
                        'absolute -top-2 z-10 flex items-center gap-0.5 rounded-full border border-line/70 bg-white/85 px-1 py-0.5 opacity-0 shadow-lg backdrop-blur-xl transition-opacity group-hover:opacity-100 dark:bg-white/[.1]',
                        toolbarFor === message.id && 'opacity-100',
                        mine ? 'right-1' : 'left-1',
                      )}
                    >
                      <button onClick={() => { setToolbarFor(null); setReactionFor(reactionFor === message.id ? null : message.id); }} className="rounded-full p-1 text-fg/45 hover:bg-fg/10 hover:text-fg" aria-label="Reaccionar" title="Reaccionar"><Smile size={11} /></button>
                      <button onClick={() => { setReplyTo(message); setEditing(null); setToolbarFor(null); }} className="rounded-full p-1 text-fg/45 hover:bg-fg/10 hover:text-fg" aria-label="Responder" title="Responder"><MessageSquare size={11} /></button>
                      <button onClick={() => void copyMessage(message)} className="rounded-full p-1 text-fg/45 hover:bg-fg/10 hover:text-fg" aria-label="Copiar" title="Copiar"><Copy size={11} /></button>
                      <button onClick={() => { setForwardFor(message); setToolbarFor(null); }} className="rounded-full p-1 text-fg/45 hover:bg-fg/10 hover:text-fg" aria-label="Reenviar" title="Reenviar"><Forward size={11} /></button>
                      {message.oneTime && message.kind === 'image' && !mine && !message.viewed && !oneTimeUrl && (
                        <button onClick={() => void openOneTime(message)} className="rounded-full p-1 text-fg/45 hover:bg-fg/10 hover:text-fg" aria-label="Ver una vez" title="Ver una vez"><Eye size={11} /></button>
                      )}
                      {mine && <button onClick={() => { setEditing(message); setEditDraft(message.body ?? ''); setReplyTo(null); setToolbarFor(null); }} className="rounded-full p-1 text-fg/45 hover:bg-fg/10 hover:text-fg" aria-label="Editar" title="Editar"><FileText size={11} /></button>}
                      {mine && <button onClick={() => { setToolbarFor(null); remove(message); }} className="rounded-full p-1 text-fg/45 hover:bg-fg/10 hover:text-fg" aria-label="Eliminar" title="Eliminar"><Trash2 size={11} /></button>}
                    </div>
                  )}

                  {reactionFor === message.id && (
                    <div className={cn('absolute bottom-full z-20 mb-1 flex flex-col gap-1', mine ? 'right-0' : 'left-0')}>
                      <div className="flex gap-0.5 self-end rounded-full border border-line/70 bg-white/90 px-1.5 py-1 shadow-lift backdrop-blur-xl dark:bg-white/[.1]">
                        {QUICK_REACTIONS.map((emoji) => (
                          <button key={emoji} onClick={() => react(message, emoji)} className="rounded-full px-1 text-[14px] hover:scale-110" aria-label={`Reaccionar con ${emoji}`}>{emoji}</button>
                        ))}
                      </div>
                      <EmojiPicker onPick={(emoji) => void react(message, emoji)} onClose={() => setReactionFor(null)} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="relative border-t border-line/70 p-2.5 sm:p-3">
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border-l-2 border-fg/25 bg-white/45 px-3 py-1.5 dark:bg-white/[.04]">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium text-fg/60">Respondiendo a {replyTo.sender.name}</p>
              <p className="truncate text-[11px] text-fg/35">{replyTo.body ?? 'Archivo adjunto'}</p>
            </div>
            <button onClick={() => setReplyTo(null)} className="p-1 text-fg/30 hover:text-fg/70" aria-label="Cancelar respuesta"><X size={13} /></button>
          </div>
        )}

        {editing && (
          <div className="mb-2 rounded-xl border border-dashed border-fg/25 bg-white/40 p-2 dark:bg-white/[.04]">
            <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-fg/45">Editando mensaje</p>
            <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={2} className="input resize-none !py-1.5 !text-[12px]" />
            <div className="mt-1.5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="btn btn-ghost btn-sm">Cancelar</button>
              <button onClick={saveEdit} className="btn btn-primary btn-sm">Guardar</button>
            </div>
          </div>
        )}

        {composerEmojiOpen && (
          <div className="absolute bottom-full left-3 z-30 mb-2" onClick={(event) => event.stopPropagation()}>
            <EmojiPicker onPick={insertEmoji} onClose={() => setComposerEmojiOpen(false)} />
          </div>
        )}

        {stickerOpen && (
          <div className="absolute bottom-full left-3 z-30 mb-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line/80 bg-white/95 shadow-lift backdrop-blur-xl dark:bg-white/[.1]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line/70 px-3 py-2">
              <p className="text-[11px] font-medium text-fg/70">Pegatinas</p>
              <button
                type="button"
                onClick={() => stickerFileRef.current?.click()}
                disabled={stickerUploading || !packsQuery.data?.packs.length}
                className="btn btn-ghost btn-sm !px-2 !py-1 !text-[10px]"
                title="Subir pegatina al paquete activo"
              >
                {stickerUploading ? 'Subiendo…' : 'Subir pegatina'}
              </button>
            </div>
            <div className="flex gap-1 overflow-x-auto px-3 py-2">
              {packsQuery.data?.packs.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setActivePackId(pack.id)}
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-1 text-[10px] transition-colors',
                    (activePackId ?? packsQuery.data?.packs[0]?.id) === pack.id
                      ? 'border-fg/30 bg-fg text-paper'
                      : 'border-line text-fg/55 hover:text-fg/85',
                  )}
                >
                  {pack.name} <span className="opacity-50">{pack.sticker_count ?? 0}</span>
                </button>
              ))}
              {!packsQuery.data?.packs.length && (
                <p className="text-[10px] text-fg/40">Crea un paquete para guardar tus pegatinas.</p>
              )}
            </div>
            <div className="grid max-h-44 grid-cols-5 gap-1 overflow-y-auto px-3 pb-2">
              {visibleStickers.map((sticker) => (
                <button
                  key={sticker.id}
                  type="button"
                  onClick={() => void sendSticker(sticker)}
                  title={sticker.name}
                  className="flex h-14 items-center justify-center rounded-lg border border-line/70 bg-white/50 transition-colors hover:bg-fg/[.06] dark:bg-white/[.05]"
                >
                  <AuthedImage path={sticker.url.replace(/^\/api/, '')} name={sticker.name} className="h-12 w-12 object-contain" />
                </button>
              ))}
              {!visibleStickers.length && (
                <p className="col-span-5 py-3 text-center text-[10px] text-fg/35">Este paquete aún no tiene pegatinas.</p>
              )}
            </div>
            <div className="flex gap-1.5 border-t border-line/70 px-3 py-2">
              <input
                value={newPackName}
                onChange={(event) => setNewPackName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createPack(); } }}
                placeholder="Nombre del paquete"
                className="input !py-1.5 !text-[11px] flex-1"
              />
              <button type="button" onClick={() => void createPack()} className="btn btn-sm !py-1.5 !text-[11px]">Crear</button>
            </div>
          </div>
        )}

        {recording ? (
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-fg/30 bg-white/40 px-4 py-2.5 dark:bg-white/[.04]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-fg" />
            <span className="text-[12px] text-fg/70">
              Grabando nota de voz · {formatClock(recordSeconds)}
            </span>
            <button
              type="button"
              onClick={cancelRecording}
              className="btn btn-ghost btn-sm !px-2 !py-1 !text-[11px]"
              title="Cancelar grabación"
            >
              <X size={12} /> Cancelar
            </button>
            <button onClick={toggleRecording} className="ml-auto flex items-center gap-1.5 rounded-full bg-fg px-3 py-1.5 text-[11px] font-medium text-paper"><Square size={11} /> Detener y enviar</button>
          </div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="glass flex items-end gap-1.5 rounded-[20px] p-1.5">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                void uploadAndSend(file, file.type.startsWith('image/') ? 'image' : 'file');
              }}
            />
            <input
              ref={oneTimeFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                void uploadAndSendOneTime(file);
              }}
            />
            <input
              ref={stickerFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                void uploadSticker(file);
              }}
            />
            <div className="flex items-center">
              <button type="button" onClick={() => { setStickerOpen(false); setComposerEmojiOpen((open) => !open); }} className="btn btn-ghost btn-sm !px-1.5" title="Emojis" aria-label="Emojis"><Smile size={17} /></button>
              <button type="button" onClick={() => { setComposerEmojiOpen(false); setStickerOpen((open) => !open); }} className={cn('btn btn-ghost btn-sm !px-1.5', stickerOpen && 'bg-fg/[.08]')} title="Pegatinas" aria-label="Pegatinas"><ImageIcon size={17} /></button>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="btn btn-ghost btn-sm !px-1.5" title="Adjuntar archivo" aria-label="Adjuntar archivo">
                <Paperclip size={17} className={uploading ? 'animate-pulse' : ''} />
              </button>
              <button type="button" onClick={() => oneTimeFileRef.current?.click()} disabled={uploading} className="btn btn-ghost btn-sm !px-1.5" title="Foto única" aria-label="Foto única"><Camera size={17} /></button>
              <button type="button" onClick={toggleRecording} className="btn btn-ghost btn-sm !px-1.5" title="Grabar nota de voz" aria-label="Grabar nota de voz"><Mic size={17} /></button>
            </div>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => handleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              onPaste={(event) => {
                const file = Array.from(event.clipboardData.items)
                  .find((item) => item.type.startsWith('image/'))
                  ?.getAsFile();
                if (file) {
                  event.preventDefault();
                  void uploadAndSend(file, 'image');
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith('image/'));
                if (file) void uploadAndSend(file, 'image');
              }}
              rows={1}
              placeholder="Escribe un mensaje…"
              className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-[13px] text-fg/90 outline-none placeholder:text-fg/30"
            />
            <button type="submit" disabled={!draft.trim()} className="btn btn-primary !rounded-xl !px-3 !py-2" aria-label="Enviar"><Send size={15} /></button>
          </form>
        )}
      </div>
    </div>
  ) : (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-fg text-paper shadow-[0_18px_38px_-24px_rgba(0,0,0,.9)]">
        <MessageSquare size={26} />
      </div>
      <h2 className="mt-5 font-display text-[26px] text-fg/90">Tus mensajes</h2>
      <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-fg/40">
        Conversaciones privadas en tiempo real con otros estudiantes. Elige una conversación o inicia una nueva.
      </p>
      <button onClick={() => setNewChatOpen(true)} className="btn btn-primary btn-sm mt-5"><Plus size={13} /> Nueva conversación</button>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-fg/30">Mensajería privada</p>
          <h1 className="mt-1 font-display text-[30px] leading-none text-fg/95">Conversaciones</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-[10px] text-fg/25">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-fg/60" /> Tiempo real</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">Llamadas WebRTC P2P</span>
          </div>
          <button onClick={() => setPeopleOpen(true)} className="btn btn-sm"><UserPlus size={13} /> Buscar personas</button>
        </div>
      </div>

      <div className="card grid h-[calc(100dvh-190px)] min-h-[520px] grid-cols-1 overflow-hidden lg:grid-cols-[320px_1fr]">
        <aside className={cn('min-h-0 border-r border-line', id ? 'hidden lg:block' : 'block')}>{list}</aside>
        <section className={cn('min-h-0', id ? 'block' : 'hidden lg:block')}>{chat}</section>
      </div>

      <p className="px-1 text-[10px] leading-relaxed text-fg/20">
        Los mensajes se almacenan en el servidor y se entregan por Socket.IO. Las llamadas son P2P mediante WebRTC; sin servidor TURN configurado, algunas redes restrictivas pueden impedir la conexión.
      </p>

      <CallLayer call={call} />

      <Modal open={colorsOpen} onClose={() => setColorsOpen(false)} title="Colores de las burbujas" width="max-w-md">
        <BubbleColorPicker
          value={bubbleColors.colors}
          onChange={(next) => void bubbleColors.update(next)}
          onReset={() => void bubbleColors.reset()}
          saving={bubbleColors.saving}
        />
      </Modal>

      <Modal open={infoOpen} onClose={() => setInfoOpen(false)} title="Detalles de la conversación">
        {conversation && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={conversation.title} url={conversation.avatarUrl} size={48} />
              <div>
                <p className="font-display text-lg text-fg/90">{conversation.title}</p>
                <p className="text-[11px] text-fg/35">{conversation.type === 'direct' ? 'Conversación directa' : `Grupo · ${conversation.members.length} integrantes`}</p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg/30">Integrantes</p>
              <div className="space-y-1.5">
                {conversation.members.map((member) => (
                  <div key={member.id} className="flex items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
                    <Avatar name={member.name} url={member.avatarUrl} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] text-fg/80">{member.name}{member.id === user?.id ? ' (tú)' : ''}</p>
                      <p className="truncate text-[10px] text-fg/30">{member.university ?? 'Estudiante de Derecho'}</p>
                    </div>
                    {online.has(member.id) && <span className="text-[9px] text-ok/70">En línea</span>}
                  </div>
                ))}
              </div>
            </div>

            {otherMember && (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { setInfoOpen(false); call.start(otherMember, 'audio', conversation.id); }} className="btn btn-sm"><Phone size={13} /> Llamar</button>
                <button onClick={() => { setInfoOpen(false); call.start(otherMember, 'video', conversation.id); }} className="btn btn-sm"><Video size={13} /> Video</button>
              </div>
            )}

            <Link to={`/perfil/${otherMember?.id ?? ''}`} onClick={() => setInfoOpen(false)} className={cn('btn btn-sm w-full', !otherMember && 'hidden')}>
              <Users size={13} /> Ver perfil
            </Link>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(forwardFor)} onClose={() => setForwardFor(null)} title="Reenviar mensaje">
        <p className="mb-3 line-clamp-2 rounded-xl bg-fg/[.04] px-3 py-2 text-[12px] text-fg/55 dark:bg-white/[.05]">
          {forwardFor?.body ?? (forwardFor?.attachment ? `📎 ${forwardFor.attachment.name}` : 'Mensaje adjunto')}
        </p>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {(conversationsQuery.data?.conversations ?? [])
            .filter((item) => item.id !== id)
            .map((item) => (
              <button
                key={item.id}
                onClick={() => void sendForward(item.id)}
                className="flex w-full items-center gap-2.5 rounded-xl border border-line px-2.5 py-2 text-left transition-colors hover:bg-fg/[.04]"
              >
                <Avatar name={item.title} url={item.avatarUrl} size={30} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg/80">{item.title}</span>
                <Send size={13} className="text-fg/25" />
              </button>
            ))}
          {(conversationsQuery.data?.conversations ?? []).filter((item) => item.id !== id).length === 0 && (
            <p className="py-4 text-center text-[11px] text-fg/40">No hay otras conversaciones.</p>
          )}
        </div>
      </Modal>

      <Modal open={peopleOpen} onClose={() => setPeopleOpen(false)} title="Buscar personas" width="max-w-xl">
        <div className="space-y-3">
          <Tabs<'search' | 'requests'>
            value={peopleTab}
            onChange={setPeopleTab}
            className="w-full [&>button]:flex-1 [&>button]:text-[11px]"
            items={[
              { id: 'search', label: 'Buscar' },
              { id: 'requests', label: 'Solicitudes', count: friendsQuery.data?.incoming.length || undefined },
            ]}
          />

          {peopleTab === 'search' ? (
            <>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg/25" />
                <input
                  autoFocus
                  value={peopleSearch}
                  onChange={(event) => setPeopleSearch(event.target.value)}
                  placeholder="Busca por nombre o @username…"
                  className="input !py-2 !text-[12px] pl-9"
                />
              </div>

              {peopleSearch.trim().length < 2 ? (
                <p className="py-8 text-center text-[11px] text-fg/35">Escribe al menos 2 caracteres para buscar personas.</p>
              ) : (
                <div className="max-h-[22rem] space-y-1.5 overflow-y-auto">
                  {peopleQuery.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}

                  {peopleQuery.isError && (
                    <div className="rounded-xl border border-line px-3 py-6 text-center">
                      <p className="text-[11px] text-fg/50">No se pudo realizar la búsqueda.</p>
                      <button onClick={() => void peopleQuery.refetch()} className="btn btn-sm mt-2">Reintentar</button>
                    </div>
                  )}

                  {!peopleQuery.isLoading && !peopleQuery.isError && (peopleQuery.data?.users ?? [])
                    .filter((person) => person.id !== user?.id)
                    .map((person) => {
                      const incomingEntry = friendsQuery.data?.incoming.find((entry) => entry.id === person.id);
                      const incomingRequestId = incomingEntry?.request_id;
                      const university = person.university
                        ?? incomingEntry?.university
                        ?? friendsQuery.data?.outgoing.find((entry) => entry.id === person.id)?.university
                        ?? friendsQuery.data?.friends.find((entry) => entry.id === person.id)?.university;
                      return (
                        <div key={person.id} className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
                          <Avatar name={person.name} url={person.avatarUrl} size={34} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12.5px] text-fg/85">{person.name}</p>
                            <p className="truncate text-[10px] text-fg/35">
                              @{person.username || person.publicId}
                              {university ? ` · ${university}` : ''}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            {(person.relation === 'none' || person.relation === null) && (
                              <button onClick={() => void addFriend(person.id)} className="btn btn-sm !px-2 !py-1 !text-[10px]"><UserPlus size={11} /> Agregar amigo</button>
                            )}
                            {person.relation === 'pending' && person.direction === 'outgoing' && (
                              <>
                                <button disabled className="btn btn-ghost btn-sm !px-2 !py-1 !text-[10px] opacity-60"><Check size={11} /> Solicitud enviada</button>
                                <button onClick={() => void cancelFriend(person.id)} className="btn btn-ghost btn-sm !px-2 !py-1 !text-[10px] text-fg/50" title="Cancelar solicitud">Cancelar</button>
                              </>
                            )}
                            {person.relation === 'pending' && person.direction === 'incoming' && (
                              incomingRequestId ? (
                                <>
                                  <button onClick={() => void respondFriend(incomingRequestId, 'accept')} className="btn btn-sm !px-2 !py-1 !text-[10px]"><Check size={11} /> Aceptar solicitud</button>
                                  <button onClick={() => void respondFriend(incomingRequestId, 'reject')} className="btn btn-ghost btn-sm !px-2 !py-1 !text-[10px]">Rechazar</button>
                                </>
                              ) : (
                                <button onClick={() => setPeopleTab('requests')} className="btn btn-sm !px-2 !py-1 !text-[10px]">Ver solicitud</button>
                              )
                            )}
                            {person.relation === 'accepted' && (
                              <>
                                <span className="flex items-center gap-1 rounded-full border border-line px-2 py-1 text-[10px] text-fg/50"><Check size={11} /> Amigos</span>
                                {!hasChatWith(person.id) && (
                                  <button onClick={() => void startChat(person.id, true)} className="btn btn-sm !px-2 !py-1 !text-[10px]"><Send size={11} /> Iniciar chat</button>
                                )}
                              </>
                            )}
                            {person.relation === 'blocked' && (
                              <span className="rounded-full border border-line px-2 py-1 text-[10px] text-fg/40">Bloqueado</span>
                            )}
                          </div>
                        </div>
                      );
                    })}

                  {!peopleQuery.isLoading && !peopleQuery.isError && (peopleQuery.data?.users ?? []).filter((person) => person.id !== user?.id).length === 0 && (
                    <EmptyState icon={<Users size={18} />} title="No se encontraron usuarios" description="Prueba con otro nombre o @username." />
                  )}
                </div>
              )}
              <p className="text-[10px] leading-relaxed text-fg/25">Encuentra a cualquier estudiante registrado, esté en línea o no. Solo se muestran datos públicos; nunca correos ni mensajes.</p>
            </>
          ) : (
            <div className="space-y-3">
              {friendsQuery.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
              {friendsQuery.isError && (
                <div className="rounded-xl border border-line px-3 py-6 text-center">
                  <p className="text-[11px] text-fg/50">No se pudieron cargar tus solicitudes.</p>
                  <button onClick={() => void friendsQuery.refetch()} className="btn btn-sm mt-2">Reintentar</button>
                </div>
              )}

              {!friendsQuery.isLoading && !friendsQuery.isError && (
                <div className="max-h-[24rem] space-y-4 overflow-y-auto">
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg/35">Recibidas ({friendsQuery.data?.incoming.length ?? 0})</p>
                    {friendsQuery.data?.incoming.map((request) => (
                      <div key={request.request_id ?? request.id} className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
                        <Avatar name={request.name} url={request.avatar_url} size={32} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] text-fg/85">{request.name}</p>
                          <p className="truncate text-[10px] text-fg/35">{request.university ?? 'Estudiante de Derecho'}</p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button onClick={() => void respondFriend(request.request_id ?? request.id, 'accept')} className="btn btn-sm !px-2 !py-1 !text-[10px]"><Check size={11} /> Aceptar</button>
                          <button onClick={() => void respondFriend(request.request_id ?? request.id, 'reject')} className="btn btn-ghost btn-sm !px-2 !py-1 !text-[10px]">Rechazar</button>
                        </div>
                      </div>
                    ))}
                    {!friendsQuery.data?.incoming.length && <p className="py-2 text-center text-[11px] text-fg/35">No tienes solicitudes recibidas.</p>}
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg/35">Enviadas ({friendsQuery.data?.outgoing.length ?? 0})</p>
                    {friendsQuery.data?.outgoing.map((request) => (
                      <div key={request.request_id ?? request.id} className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
                        <Avatar name={request.name} url={request.avatar_url} size={32} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] text-fg/85">{request.name}</p>
                          <p className="truncate text-[10px] text-fg/35">Enviada {timeAgo(request.created_at)}</p>
                        </div>
                        <button onClick={() => void cancelFriend(request.id)} className="btn btn-ghost btn-sm !px-2 !py-1 !text-[10px] text-fg/50">Cancelar</button>
                      </div>
                    ))}
                    {!friendsQuery.data?.outgoing.length && <p className="py-2 text-center text-[11px] text-fg/35">No tienes solicitudes enviadas.</p>}
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg/35">Amistades ({friendsQuery.data?.friends.length ?? 0})</p>
                    {friendsQuery.data?.friends.map((friend) => (
                      <div key={friend.id} className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
                        <Avatar name={friend.name} url={friend.avatar_url} size={32} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] text-fg/85">{friend.name}</p>
                          <p className="truncate text-[10px] text-fg/35">{friend.university ?? 'Amigo'}</p>
                        </div>
                        {directChatId(friend.id) ? (
                          <Link to={`/mensajes/${directChatId(friend.id)}`} onClick={() => setPeopleOpen(false)} className="btn btn-ghost btn-sm !px-2 !py-1 !text-[10px]">Abrir chat</Link>
                        ) : (
                          <button onClick={() => void startChat(friend.id, true)} className="btn btn-sm !px-2 !py-1 !text-[10px]"><Send size={11} /> Iniciar chat</button>
                        )}
                      </div>
                    ))}
                    {!friendsQuery.data?.friends.length && <p className="py-2 text-center text-[11px] text-fg/35">Aún no tienes amistades en la comunidad.</p>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal open={newChatOpen} onClose={() => setNewChatOpen(false)} title="Nueva conversación">
        <div className="space-y-3">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg/25" />
            <input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Busca por nombre, universidad o correo…" className="input !py-2 !text-[12px] pl-9" />
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {studentsQuery.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            {studentsQuery.data?.users.map((student) => (
              <button key={student.id} onClick={() => startChat(student.id)} className="flex w-full items-center gap-2.5 rounded-xl border border-line px-2.5 py-2 text-left hover:bg-fg/[.04]">
                <Avatar name={student.name} url={student.avatarUrl} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-fg/80">{student.name}</span>
                  <span className="block truncate text-[10px] text-fg/30">{[student.university, student.cycle].filter(Boolean).join(' · ') || 'Sin datos académicos'}</span>
                </span>
                <Send size={13} className="text-fg/25" />
              </button>
            ))}
            {!studentsQuery.isLoading && (studentsQuery.data?.users.length ?? 0) === 0 && (
              <EmptyState icon={<Users size={18} />} title="Sin estudiantes" description="No encontramos estudiantes con ese criterio." />
            )}
          </div>
          <p className="text-[10px] leading-relaxed text-fg/25">Solo puedes iniciar conversaciones con estudiantes registrados. La otra persona recibirá una notificación real.</p>
        </div>
      </Modal>
    </div>
  );
}
