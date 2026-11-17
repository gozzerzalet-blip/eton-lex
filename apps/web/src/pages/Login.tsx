import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { useAuth } from '../lib/store';
import { Logo } from '../components/Logo';
import { Spinner } from '../components/ui';
import type { User } from '../lib/types';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { setSession } = useAuth();
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api<{ accessToken: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setSession(data.user, data.accessToken);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

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
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-fg/30">Acceso a la plataforma</p>
            <h2 className="font-display text-[30px] leading-tight text-fg/95">Bienvenido de vuelta</h2>
            <p className="mt-2 text-[13px] text-fg/40">Ingresa con tu cuenta académica para continuar.</p>

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
              </div>

              {error && <p className="rounded-xl border border-dashed border-fg/25 bg-white/40 px-3 py-2.5 text-[12px] text-fg/70 dark:bg-white/[.04]">{error}</p>}

              <button type="submit" disabled={loading} className="btn btn-primary w-full">
                {loading ? <Spinner size={15} className="border-paper/30 border-t-paper" /> : <>Ingresar <ArrowRight size={15} /></>}
              </button>
            </form>

            <p className="mt-6 text-center text-[12.5px] text-fg/35">
              ¿Aún no tienes cuenta?{' '}
              <Link to="/registro" className="text-fg underline decoration-fg/25 underline-offset-4 transition-colors hover:decoration-fg">Crear cuenta</Link>
            </p>
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
