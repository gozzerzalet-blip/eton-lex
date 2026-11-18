import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { useAuth } from '../lib/store';
import { Logo } from '../components/Logo';
import { Spinner } from '../components/ui';
import type { User } from '../lib/types';

type Mode = 'login' | 'forgot' | 'reset' | 'code-request' | 'code-login';

const COPY: Record<Mode, { eyebrow: string; title: string; description: string }> = {
  login: {
    eyebrow: 'Acceso a la plataforma',
    title: 'Bienvenido de vuelta',
    description: 'Ingresa con tu cuenta académica para continuar.',
  },
  forgot: {
    eyebrow: 'Recuperación de acceso',
    title: 'Recupera tu cuenta',
    description: 'Te enviaremos un código de 6 dígitos al correo con el que te registraste.',
  },
  reset: {
    eyebrow: 'Verificación por correo',
    title: 'Revisa tu correo',
    description: 'Ingresa el código que recibiste y elige una nueva contraseña.',
  },
  'code-request': {
    eyebrow: 'Acceso sin contraseña',
    title: 'Ingresa con un código',
    description: 'Te enviaremos un código de 6 dígitos al correo con el que te registraste.',
  },
  'code-login': {
    eyebrow: 'Verificación por correo',
    title: 'Revisa tu correo',
    description: 'Escribe el código de 6 dígitos que recibiste para entrar a tu cuenta.',
  },
};

export default function Login() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [codeEmail, setCodeEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const { setSession } = useAuth();
  const navigate = useNavigate();

  const goTo = (next: Mode) => {
    setMode(next);
    setError('');
    setNotice('');
  };

  const message = (err: unknown, fallback: string) =>
    err instanceof ApiClientError ? err.message : fallback;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const data = await api<{ accessToken: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setSession(data.user, data.accessToken);
      navigate('/');
    } catch (err) {
      setError(message(err, 'No se pudo iniciar sesión.'));
    } finally {
      setLoading(false);
    }
  };

  const requestLoginCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const data = await api<{ message: string }>('/auth/request-login-code', {
        method: 'POST',
        body: JSON.stringify({ email: codeEmail }),
      });
      goTo('code-login');
      setNotice(data.message ?? 'Si el correo está registrado, enviamos un código.');
    } catch (err) {
      setError(message(err, 'No se pudo enviar el código.'));
    } finally {
      setLoading(false);
    }
  };

  const submitCodeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const data = await api<{ accessToken: string; user: User }>('/auth/login-with-code', {
        method: 'POST',
        body: JSON.stringify({ email: codeEmail, code }),
      });
      setSession(data.user, data.accessToken);
      navigate('/');
    } catch (err) {
      setError(message(err, 'No se pudo iniciar sesión.'));
    } finally {
      setLoading(false);
    }
  };

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const data = await api<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: recoveryEmail }),
      });
      setNotice(data.message ?? 'Si el correo está registrado, enviamos un código.');
      setCode('');
      setNewPassword('');
      setConfirmPassword('');
      goTo('reset');
      setNotice(data.message ?? 'Si el correo está registrado, enviamos un código.');
    } catch (err) {
      setError(message(err, 'No se pudo enviar el código.'));
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas nuevas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      const data = await api<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: recoveryEmail, code, password: newPassword }),
      });
      setMode('login');
      setPassword('');
      setEmail(recoveryEmail);
      setNotice(`${data.message ?? 'Contraseña actualizada.'} Ingresa con tu nueva contraseña.`);
      setError('');
    } catch (err) {
      setError(message(err, 'No se pudo actualizar la contraseña.'));
    } finally {
      setLoading(false);
    }
  };

  const copy = COPY[mode];

  return (
    <div className="relative z-10 grid min-h-screen grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line/70 p-12 lg:flex">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(720px_520px_at_18%_8%,rgba(255,255,255,.95),transparent_68%)] dark:bg-[radial-gradient(720px_520px_at_18%_8%,rgba(255,255,255,.06),transparent_68%)]" />
        <Logo />

        <div className="max-w-lg">
          <p className="mb-6 text-[10.5px] font-semibold uppercase tracking-[0.26em] text-fg/35">Ecosistema jurídico inteligente</p>
          <h1 className="font-display text-[46px] leading-[1.05] tracking-[-0.02em] text-fg/95">
            El Derecho,<br />siempre a tu alcance.
          </h1>
          <p className="mt-6 max-w-md text-[14px] leading-relaxed text-fg/45">
            Legislación peruana verificable, un asistente jurídico que cita sus fuentes y una comunidad privada de estudiantes de Derecho.
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            {[
              { icon: Sparkles, title: 'ETON AI', text: 'Respuestas con fuentes oficiales, sin inventar normas.' },
              { icon: ShieldCheck, title: 'Veracidad jurídica', text: 'Estado de vigencia e historial de cada artículo.' },
            ].map((item) => (
              <div key={item.title} className="card p-4">
                <item.icon size={17} className="mb-3 text-fg/70" strokeWidth={1.8} />
                <p className="text-[12.5px] font-medium text-fg/85">{item.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-fg/35">{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[9.5px] uppercase tracking-[0.24em] text-fg/20">Creado por Zalet Gozzer · Perú</p>
      </aside>

      <main className="flex items-center justify-center px-4 py-10 sm:px-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-[420px]">
          <div className="mb-8 lg:hidden"><Logo /></div>

          <div className="card p-6 sm:p-8">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-fg/30">{copy.eyebrow}</p>
            <h2 className="font-display text-[30px] leading-tight text-fg/95">{copy.title}</h2>
            <p className="mt-2 text-[13px] text-fg/40">{copy.description}</p>

            {notice && (
              <p className="mt-5 rounded-xl border border-fg/15 bg-white/50 px-3 py-2.5 text-[12px] leading-relaxed text-fg/70 dark:bg-white/[.05]">
                {notice}
              </p>
            )}
            {error && <p className="mt-5 rounded-xl border border-dashed border-fg/25 bg-white/40 px-3 py-2.5 text-[12px] text-fg/70 dark:bg-white/[.04]">{error}</p>}

            {mode === 'login' && (
              <form onSubmit={submit} className="mt-7 space-y-4">
                <div>
                  <label className="label" htmlFor="email">Correo electrónico</label>
                  <div className="relative">
                    <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
                    <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input pl-10" placeholder="tu.correo@universidad.edu.pe" />
                  </div>
                </div>

                <div>
                  <label className="label" htmlFor="password">Contraseña</label>
                  <div className="relative">
                    <Lock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
                    <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="input px-10" placeholder="••••••••" />
                    <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/30 hover:text-fg/60" aria-label="Mostrar contraseña">
                      {show ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setRecoveryEmail(email); goTo('forgot'); }}
                    className="mt-2 text-[11.5px] font-medium text-fg/45 underline decoration-fg/20 underline-offset-4 transition-colors hover:text-fg/75"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>

                <button type="submit" disabled={loading} className="btn btn-primary w-full">
                  {loading ? <Spinner size={15} className="border-paper/30 border-t-paper" /> : <>Ingresar <ArrowRight size={15} /></>}
                </button>
                <button
                  type="button"
                  onClick={() => { setCodeEmail(email); goTo('code-request'); }}
                  className="flex w-full items-center justify-center gap-1.5 text-[12px] font-medium text-fg/45 transition-colors hover:text-fg/75"
                >
                  <KeyRound size={13} /> Ingresar con código en mi correo
                </button>
              </form>
            )}

            {mode === 'code-request' && (
              <form onSubmit={requestLoginCode} className="mt-7 space-y-4">
                <div>
                  <label className="label" htmlFor="code-email">Correo de tu cuenta</label>
                  <div className="relative">
                    <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
                    <input id="code-email" type="email" autoComplete="email" required value={codeEmail} onChange={(e) => setCodeEmail(e.target.value)} className="input pl-10" placeholder="tu.correo@gmail.com" />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-fg/35">
                    Sirve para cualquier cuenta registrada, aunque hayas olvidado tu contraseña.
                  </p>
                </div>

                <button type="submit" disabled={loading} className="btn btn-primary w-full">
                  {loading ? <Spinner size={15} className="border-paper/30 border-t-paper" /> : <>Enviar código <ArrowRight size={15} /></>}
                </button>
                <button type="button" onClick={() => goTo('login')} className="flex w-full items-center justify-center gap-1.5 text-[12px] text-fg/40 transition-colors hover:text-fg/70">
                  <ArrowLeft size={13} /> Volver a ingresar
                </button>
              </form>
            )}

            {mode === 'code-login' && (
              <form onSubmit={submitCodeLogin} className="mt-7 space-y-4">
                <div>
                  <label className="label" htmlFor="login-code-email">Correo de tu cuenta</label>
                  <div className="relative">
                    <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
                    <input id="login-code-email" type="email" autoComplete="email" required value={codeEmail} onChange={(e) => setCodeEmail(e.target.value)} className="input pl-10" placeholder="tu.correo@gmail.com" />
                  </div>
                </div>

                <div>
                  <label className="label" htmlFor="login-code">Código de 6 dígitos</label>
                  <input
                    id="login-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="input text-center text-[17px] tracking-[0.4em]"
                    placeholder="000000"
                  />
                </div>

                <button type="submit" disabled={loading} className="btn btn-primary w-full">
                  {loading ? <Spinner size={15} className="border-paper/30 border-t-paper" /> : <>Ingresar <ArrowRight size={15} /></>}
                </button>
                <button type="button" onClick={() => goTo('code-request')} className="flex w-full items-center justify-center gap-1.5 text-[12px] text-fg/40 transition-colors hover:text-fg/70">
                  <ArrowLeft size={13} /> Pedir otro código
                </button>
              </form>
            )}

            {mode === 'forgot' && (
              <form onSubmit={requestCode} className="mt-7 space-y-4">
                <div>
                  <label className="label" htmlFor="recovery-email">Correo de tu cuenta</label>
                  <div className="relative">
                    <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
                    <input id="recovery-email" type="email" autoComplete="email" required value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)} className="input pl-10" placeholder="tu.correo@gmail.com" />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-fg/35">
                    Puede ser cualquier correo con el que te hayas registrado, no solo Gmail.
                  </p>
                </div>

                <button type="submit" disabled={loading} className="btn btn-primary w-full">
                  {loading ? <Spinner size={15} className="border-paper/30 border-t-paper" /> : <>Enviar código <ArrowRight size={15} /></>}
                </button>
                <button type="button" onClick={() => goTo('login')} className="flex w-full items-center justify-center gap-1.5 text-[12px] text-fg/40 transition-colors hover:text-fg/70">
                  <ArrowLeft size={13} /> Volver a ingresar
                </button>
              </form>
            )}

            {mode === 'reset' && (
              <form onSubmit={submitReset} className="mt-7 space-y-4">
                <div>
                  <label className="label" htmlFor="reset-email">Correo de tu cuenta</label>
                  <div className="relative">
                    <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
                    <input id="reset-email" type="email" autoComplete="email" required value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)} className="input pl-10" placeholder="tu.correo@gmail.com" />
                  </div>
                </div>

                <div>
                  <label className="label" htmlFor="reset-code">Código de 6 dígitos</label>
                  <input
                    id="reset-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="input text-center text-[17px] tracking-[0.4em]"
                    placeholder="000000"
                  />
                </div>

                <div>
                  <label className="label" htmlFor="new-password">Nueva contraseña</label>
                  <div className="relative">
                    <Lock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
                    <input id="new-password" type={show ? 'text' : 'password'} autoComplete="new-password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input px-10" placeholder="Mínimo 8 caracteres" />
                    <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/30 hover:text-fg/60" aria-label="Mostrar contraseña">
                      {show ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="label" htmlFor="confirm-password">Confirmar contraseña</label>
                  <div className="relative">
                    <Lock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
                    <input id="confirm-password" type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="input pl-10" placeholder="Repite la contraseña" />
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn btn-primary w-full">
                  {loading ? <Spinner size={15} className="border-paper/30 border-t-paper" /> : <>Actualizar contraseña <ArrowRight size={15} /></>}
                </button>
                <button type="button" onClick={() => goTo('login')} className="flex w-full items-center justify-center gap-1.5 text-[12px] text-fg/40 transition-colors hover:text-fg/70">
                  <ArrowLeft size={13} /> Volver a ingresar
                </button>
              </form>
            )}

            {mode === 'login' && (
              <p className="mt-6 text-center text-[12.5px] text-fg/35">
                ¿Aún no tienes cuenta?{' '}
                <Link to="/registro" className="text-fg underline decoration-fg/25 underline-offset-4 transition-colors hover:decoration-fg">Crear cuenta</Link>
              </p>
            )}
          </div>

          <p className="mt-5 text-center text-[11px] leading-relaxed text-fg/30">
            Legislación peruana con enlace a la fuente oficial, ETON AI que cita sus fuentes y comunidad académica privada.
          </p>

          <p className="mt-4 px-2 text-center text-[9.5px] leading-relaxed text-fg/25">
            Al ingresar aceptas los{' '}
            <Link to="/terminos" className="underline decoration-fg/20 underline-offset-2 hover:text-fg/50">términos de uso</Link>{' '}
            y la{' '}
            <Link to="/privacidad" className="underline decoration-fg/20 underline-offset-2 hover:text-fg/50">política de privacidad</Link>.
            {' '}Creado por{' '}
            <Link to="/acerca" className="underline decoration-fg/20 underline-offset-2 hover:text-fg/50">Zalet Gozzer</Link>.
          </p>
        </motion.div>
      </main>
    </div>
  );
}
