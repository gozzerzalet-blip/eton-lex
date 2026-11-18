/**
 * Tonos locales de llamada generados con Web Audio API.
 *
 * Timbre tipo marimba: ataque muy corto, parciales suaves y caída natural.
 * Busca una sensación parecida a los tonos modernos de móvil sin reproducir
 * ninguna melodía protegida. No descarga archivos y se detiene al cambiar
 * el estado de la llamada.
 */
type RingRole = 'caller' | 'callee';
type Voice = { oscs: OscillatorNode[]; bus: GainNode; filter: BiquadFilterNode };

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

/** Nota "percutida": fundamental triangular + armónicos, con envolvente de marimba. */
function pluck(audio: AudioContext, freq: number, at: number, duration: number, volume: number) {
  const bus = audio.createGain();
  bus.gain.setValueAtTime(volume, at);
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(5200, at);
  filter.frequency.exponentialRampToValueAtTime(1900, at + duration);
  filter.Q.setValueAtTime(0.6, at);
  bus.connect(filter).connect(audio.destination);

  const partials = [
    { ratio: 1, type: 'triangle' as OscillatorType, level: 0.9, decay: 1 },
    { ratio: 2.005, type: 'sine' as OscillatorType, level: 0.26, decay: 0.62 },
    { ratio: 3.99, type: 'sine' as OscillatorType, level: 0.1, decay: 0.38 },
  ];

  const voice: Voice = { oscs: [], bus, filter };
  let pending = partials.length;
  for (const partial of partials) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = partial.type;
    osc.frequency.setValueAtTime(freq * partial.ratio, at);
    const end = at + duration * partial.decay;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(partial.level, at + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(bus);
    osc.start(at);
    osc.stop(end + 0.04);
    voice.oscs.push(osc);
    osc.onended = () => {
      pending -= 1;
      if (pending === 0) {
        voices.delete(voice);
        try {
          for (const node of voice.oscs) node.disconnect();
          gain.disconnect();
          bus.disconnect();
          filter.disconnect();
        } catch { /* ya desconectado */ }
      }
    };
  }
  voices.add(voice);
}

/** Motivo ascendente de cinco notas, parecido en textura a un tono de móvil. */
function arpeggio(audio: AudioContext, notes: number[], at: number, spacing: number, duration: number, volume: number) {
  notes.forEach((freq, index) => {
    pluck(audio, freq, at + index * spacing, duration + index * 0.04, volume * (1 - index * 0.06));
  });
}

function ringCycle(audio: AudioContext, role: RingRole) {
  const now = audio.currentTime + 0.03;
  if (role === 'callee') {
    // Timbre entrante: arpegio brillante en Do mayor.
    arpeggio(audio, [523.25, 659.25, 783.99, 1046.5], now, 0.12, 0.5, 0.075);
  } else {
    // Ringback: mismo estilo, más suave y en La mayor para diferenciarlo.
    arpeggio(audio, [440, 554.37, 659.25, 880], now, 0.15, 0.48, 0.05);
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
  }, role === 'callee' ? 2400 : 2700);
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
        voice.bus.gain.cancelScheduledValues(now);
        voice.bus.gain.setValueAtTime(Math.max(voice.bus.gain.value, 0.0001), now);
        voice.bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
        for (const osc of voice.oscs) osc.stop(now + 0.07);
      } catch { /* la nota ya terminó */ }
    }
  }
  voices.clear();
}

/** Tono breve y distinto cuando la llamada se establece. */
export async function playConnectTone() {
  const audio = await resume();
  if (!audio) return;
  const now = audio.currentTime + 0.03;
  arpeggio(audio, [659.25, 987.77], now, 0.13, 0.3, 0.06);
}

/** Tono descendente suave al rechazar, finalizar o perder la llamada. */
export async function playEndTone() {
  const audio = await resume();
  if (!audio) return;
  const now = audio.currentTime + 0.03;
  arpeggio(audio, [659.25, 523.25, 392], now, 0.12, 0.26, 0.045);
}
