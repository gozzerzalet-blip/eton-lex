/**
 * Tonos locales de llamada generados con Web Audio API.
 * No descargan archivos, no contienen contenido protegido y se detienen
 * en cuanto cambia el estado de la llamada.
 */
type RingRole = 'caller' | 'callee';

let ctx: AudioContext | null = null;
let ringTimer: number | null = null;
let ringRole: RingRole | null = null;
let gestureArmed = false;
const voices = new Set<{ gain: GainNode; osc: OscillatorNode }>();

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

function note(audio: AudioContext, freq: number, at: number, duration: number, volume: number) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, at);
  // Ataque y caída suaves: evita el "clic" de los tonos rectangularmente cortados.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.045);
  gain.gain.setValueAtTime(volume, at + duration - 0.09);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(audio.destination);
  const voice = { osc, gain };
  voices.add(voice);
  osc.onended = () => {
    voices.delete(voice);
    try { osc.disconnect(); gain.disconnect(); } catch { /* noop */ }
  };
  osc.start(at);
  osc.stop(at + duration + 0.03);
}

function ringCycle(audio: AudioContext, role: RingRole) {
  const now = audio.currentTime + 0.02;
  if (role === 'callee') {
    // Timbre entrante: dos notas cálidas y un descanso largo.
    note(audio, 587.33, now, 0.22, 0.055);
    note(audio, 783.99, now + 0.26, 0.3, 0.05);
  } else {
    // Ringback: tercera mayor, más suave y espaciado.
    note(audio, 659.25, now, 0.2, 0.04);
    note(audio, 880.0, now + 0.24, 0.28, 0.037);
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
  }, role === 'callee' ? 2100 : 2500);
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
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
        voice.osc.stop(now + 0.08);
      } catch { /* la nota ya terminó */ }
    }
  }
  voices.clear();
}

/** Tono breve y distinto cuando la llamada se establece. */
export async function playConnectTone() {
  const audio = await resume();
  if (!audio) return;
  const now = audio.currentTime + 0.02;
  note(audio, 523.25, now, 0.14, 0.05);
  note(audio, 783.99, now + 0.16, 0.24, 0.055);
}

/** Tono descendente suave al rechazar, finalizar o perder la llamada. */
export async function playEndTone() {
  const audio = await resume();
  if (!audio) return;
  const now = audio.currentTime + 0.02;
  note(audio, 493.88, now, 0.13, 0.035);
  note(audio, 329.63, now + 0.15, 0.22, 0.03);
}
