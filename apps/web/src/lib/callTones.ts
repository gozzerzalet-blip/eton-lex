/**
 * Tonos locales de llamada generados con Web Audio API.
 *
 * Timbre melódico suave, con ataque gradual, armónicos cálidos y vibrato
 * ligero: busca la sensación de un tono moderno de móvil, sin reproducir
 * ninguna melodía protegida. No descarga archivos y se detiene al cambiar
 * el estado de la llamada.
 */
type RingRole = 'caller' | 'callee';
type Voice = { oscs: OscillatorNode[]; gain: GainNode; cleanup: () => void };

let ctx: AudioContext | null = null;
let ringTimer: number | null = null;
let ringRole: RingRole | null = null;
let gestureArmed = false;
const voices = new Set<Voice>();

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx || ctx.state === 'closed') ctx = new Ctor();
  return ctx;
}

async function resume(): Promise<AudioContext | null> {
  const audio = context();
  if (!audio) return null;
  if (audio.state !== 'running') {
    try { await audio.resume(); } catch { /* el navegador puede exigir un gesto */ }
  }
  return audio.state === 'running' ? audio : null;
}

function armGesture() {
  if (gestureArmed || typeof document === 'undefined') return;
  gestureArmed = true;
  const retry = () => {
    const role = ringRole;
    if (role) void startRingtone(role);
  };
  document.addEventListener('pointerdown', retry, { once: true });
  document.addEventListener('keydown', retry, { once: true });
}

/** Nota redonda: fundamental triangular + octava suave, filtro y vibrato. */
function pluck(audio: AudioContext, freq: number, at: number, duration: number, volume: number) {
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.03);
  gain.gain.exponentialRampToValueAtTime(Math.max(volume * 0.55, 0.0002), at + duration * 0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2800, at);
  filter.frequency.exponentialRampToValueAtTime(1000, at + duration);
  filter.Q.setValueAtTime(0.5, at);
  gain.connect(filter).connect(audio.destination);

  const partials = [
    { ratio: 1, type: 'triangle' as OscillatorType, level: 0.9, decay: 1 },
    { ratio: 2, type: 'sine' as OscillatorType, level: 0.14, decay: 0.55 },
  ];

  const voice: Voice = { oscs: [], gain, cleanup: () => {} };
  const nodes: AudioNode[] = [gain, filter];
  let pending = partials.length + 1;
  const done = () => {
    pending -= 1;
    if (pending === 0) {
      voices.delete(voice);
      voice.cleanup();
    }
  };

  for (const partial of partials) {
    const osc = audio.createOscillator();
    const partialGain = audio.createGain();
    osc.type = partial.type;
    osc.frequency.setValueAtTime(freq * partial.ratio, at);
    const end = at + duration * partial.decay;
    partialGain.gain.setValueAtTime(0.0001, at);
    partialGain.gain.exponentialRampToValueAtTime(partial.level, at + 0.018);
    partialGain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(partialGain).connect(gain);
    osc.start(at);
    osc.stop(end + 0.06);
    voice.oscs.push(osc);
    nodes.push(osc, partialGain);
    osc.onended = done;
  }

  const lfo = audio.createOscillator();
  const depth = audio.createGain();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(4.5, at);
  depth.gain.setValueAtTime(freq * 0.0035, at);
  lfo.connect(depth);
  for (const osc of voice.oscs) depth.connect(osc.frequency);
  lfo.start(at);
  lfo.stop(at + duration + 0.06);
  voice.oscs.push(lfo);
  nodes.push(lfo, depth);
  lfo.onended = done;

  voice.cleanup = () => {
    for (const node of nodes) {
      try { node.disconnect(); } catch { /* ya desconectado */ }
    }
  };
  voices.add(voice);
}

/** Frase melódica original, con notas que se solapan para no sonar a pitidos. */
type RingNote = { freq: number; offset: number; duration: number; level: number };

const CALLEE_MOTIF: RingNote[] = [
  { freq: 523.25, offset: 0, duration: 0.95, level: 0.078 },
  { freq: 659.25, offset: 0.22, duration: 0.95, level: 0.072 },
  { freq: 783.99, offset: 0.46, duration: 1.05, level: 0.072 },
  { freq: 659.25, offset: 0.78, duration: 0.85, level: 0.052 },
  { freq: 880, offset: 1.05, duration: 1.25, level: 0.058 },
];

const CALLER_MOTIF: RingNote[] = [
  { freq: 392, offset: 0, duration: 1, level: 0.054 },
  { freq: 523.25, offset: 0.24, duration: 1, level: 0.05 },
  { freq: 659.25, offset: 0.5, duration: 1.1, level: 0.05 },
  { freq: 523.25, offset: 0.84, duration: 0.9, level: 0.036 },
  { freq: 783.99, offset: 1.12, duration: 1.3, level: 0.044 },
];

/** Motivo breve para los tonos de conexión y fin de llamada. */
function arpeggio(audio: AudioContext, notes: number[], at: number, spacing: number, duration: number, volume: number) {
  notes.forEach((freq, index) => {
    pluck(audio, freq, at + index * spacing, duration + index * 0.05, volume * (1 - index * 0.08));
  });
}

function ringCycle(audio: AudioContext, role: RingRole) {
  const now = audio.currentTime + 0.03;
  if (role === 'callee') {
    pluck(audio, 261.63, now, 1.5, 0.026);
    for (const note of CALLEE_MOTIF) pluck(audio, note.freq, now + note.offset, note.duration, note.level);
  } else {
    pluck(audio, 196, now, 1.6, 0.02);
    for (const note of CALLER_MOTIF) pluck(audio, note.freq, now + note.offset, note.duration, note.level);
  }
}

export async function startRingtone(role: RingRole) {
  stopRingtone();
  ringRole = role;
  armGesture();
  const audio = await resume();
  if (!audio || ringRole !== role) return;
  ringCycle(audio, role);
  ringTimer = window.setInterval(() => {
    if (ringRole === role) ringCycle(audio, role);
  }, role === 'callee' ? 3600 : 3800);
}

export function stopRingtone() {
  if (ringTimer !== null) {
    window.clearInterval(ringTimer);
    ringTimer = null;
  }
  ringRole = null;
  const audio = ctx;
  if (audio) {
    const now = audio.currentTime;
    for (const voice of voices) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        for (const osc of voice.oscs) osc.stop(now + 0.14);
      } catch { /* la nota ya terminó */ }
    }
  }
  voices.clear();
}

/** Tono breve y distinto cuando la llamada se establece. */
export async function playConnectTone() {
  const audio = await resume();
  if (!audio) return;
  arpeggio(audio, [523.25, 659.25], audio.currentTime + 0.03, 0.2, 0.55, 0.05);
}

/** Tono descendente suave al rechazar, finalizar o perder la llamada. */
export async function playEndTone() {
  const audio = await resume();
  if (!audio) return;
  arpeggio(audio, [523.25, 440, 349.23], audio.currentTime + 0.03, 0.18, 0.5, 0.042);
}
