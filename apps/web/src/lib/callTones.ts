/**
 * Tonos de llamada originales de ETON LEX.
 *
 * Se reproducen archivos de audio generados por el propio proyecto: una frase
 * melódica con ataque suave, armónicos cálidos, vibrato y reverberación corta.
 * No son pitidos aislados ni copian una melodía protegida. Se detienen al
 * cambiar el estado de la llamada.
 */
type RingRole = 'caller' | 'callee';

const RING_URL = '/sounds/eton-ring.wav';
const CONNECT_URL = '/sounds/eton-connect.wav';
const END_URL = '/sounds/eton-end.wav';

let ringAudio: HTMLAudioElement | null = null;
let ringRole: RingRole | null = null;
let gestureArmed = false;
const oneShots = new Set<HTMLAudioElement>();

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

function createAudio(url: string, volume: number) {
  const audio = new Audio(url);
  audio.preload = 'auto';
  audio.volume = volume;
  return audio;
}

export async function startRingtone(role: RingRole) {
  stopRingtone();
  ringRole = role;
  armGesture();

  const audio = createAudio(RING_URL, role === 'callee' ? 0.85 : 0.45);
  audio.loop = true;
  ringAudio = audio;
  try {
    await audio.play();
  } catch {
    // El navegador puede exigir una interacción del usuario; armGesture reintenta.
  }
}

export function stopRingtone() {
  ringRole = null;
  if (!ringAudio) return;
  ringAudio.pause();
  ringAudio.currentTime = 0;
  ringAudio.removeAttribute('src');
  ringAudio = null;
}

async function playOnce(url: string, volume: number) {
  const audio = createAudio(url, volume);
  oneShots.add(audio);
  const cleanup = () => {
    oneShots.delete(audio);
    audio.removeAttribute('src');
  };
  audio.onended = cleanup;
  audio.onerror = cleanup;
  try {
    await audio.play();
  } catch {
    cleanup();
  }
}

/** Tono breve y distinto cuando la llamada se establece. */
export async function playConnectTone() {
  await playOnce(CONNECT_URL, 0.6);
}

/** Tono descendente suave al rechazar, finalizar o perder la llamada. */
export async function playEndTone() {
  await playOnce(END_URL, 0.55);
}
