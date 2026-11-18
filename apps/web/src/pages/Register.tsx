import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Building2, Check, Lock, Mail, User } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { useAuth } from '../lib/store';
import { Logo } from '../components/Logo';
import { Spinner } from '../components/ui';
import UniversityPicker, { emptyAcademicSelection, type AcademicSelection } from '../components/UniversityPicker';
import type { User as UserType } from '../lib/types';

export default function Register() {
  const [step, setStep] = useState(1);
  const [account, setAccount] = useState({ name: '', email: '', password: '', username: '' });
  const [academic, setAcademic] = useState<AcademicSelection>({ ...emptyAcademicSelection, cycle: '' });
  const [city, setCity] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const { setSession, setUser } = useAuth();
  const navigate = useNavigate();

  const next = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (account.password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return; }
    if (account.username && account.username.length < 3) { setError('El nombre de usuario debe tener al menos 3 caracteres.'); return; }
    setStep(2);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!academic.universityId && !academic.missingUniversity.trim()) {
      setError('Selecciona tu universidad del catálogo o usa «Mi universidad no aparece».');
      return;
    }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const data = await api<{
        accessToken: string;
        user: UserType;
        email?: string;
        emailConfigured?: boolean;
        requiresEmailVerification?: boolean;
        emailDeliveryFailed?: boolean;
      }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: account.name.trim(),
          email: account.email.trim(),
          password: account.password,
          username: account.username.trim() || null,
          university: academic.universityId ? academic.university : null,
          universityId: academic.universityId || null,
          campusId: academic.campusId || null,
          universityType: academic.universityType || null,
          faculty: academic.faculty || null,
          career: academic.career || null,
          cycle: academic.cycle || null,
          city: city.trim() || null,
          country: 'Perú',
          missingUniversity: academic.missingUniversity.trim() || null,
        }),
      });
      setSession(data.user, data.accessToken);
      if (data.emailConfigured) {
        setEmailConfigured(true);
        setVerificationEmail(data.email ?? account.email.trim());
        setVerificationCode('');
        setNotice(data.emailDeliveryFailed
          ? 'No pudimos entregar el correo. Pulsa «Reenviar código» en unos instantes.'
          : `Enviamos un código de 6 dígitos a ${data.email ?? account.email.trim()}.`);
        setStep(3);
        return;
      }
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'No se pudo crear la cuenta.');
    } finally {
      setLoading(false);
    }
  };

  const verifyEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const data = await api<{ ok: boolean; user: UserType }>('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ code: verificationCode }),
      });
      setUser(data.user);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'No se pudo verificar el correo.');
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const data = await api<{ message: string }>('/auth/resend-verification', {
        method: 'POST',
        body: '{}',
      });
      setNotice(data.message ?? 'Enviamos un nuevo código a tu correo.');
      setVerificationCode('');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'No se pudo reenviar el código.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-10 grid min-h-screen grid-cols-1 lg:grid-cols-[1fr_1.05fr]">
      <main className="flex items-center justify-center px-4 py-10 sm:px-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="w-full max-w-[460px]">
          <div className="mb-8"><Logo /></div>

          <div className="card p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em]">
              <span className={step === 1 ? 'text-fg/80' : 'text-fg/30'}>01 · Cuenta</span>
              <span className="h-px w-8 bg-fg/15" />
              <span className={step === 2 ? 'text-fg/80' : 'text-fg/30'}>02 · Perfil académico</span>
              {emailConfigured && (
                <>
                  <span className="h-px w-8 bg-fg/15" />
                  <span className={step === 3 ? 'text-fg/80' : 'text-fg/30'}>03 · Correo</span>
                </>
              )}
            </div>

            <h1 className="font-display text-[30px] leading-tight text-fg/95">
              {step === 1 ? 'Crea tu cuenta' : step === 2 ? 'Tu perfil académico' : 'Verifica tu correo'}
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-fg/40">
              {step === 1
                ? 'Acceso a la comunidad privada de estudiantes de Derecho.'
                : step === 2
                  ? 'Selecciona tu universidad desde el catálogo oficial de SUNEDU.'
                  : `Enviamos un código de 6 dígitos a ${verificationEmail}. Colócalo aquí para confirmar tu cuenta.`}
            </p>

            {step === 3 && notice && (
              <p className="mt-5 rounded-xl border border-fg/15 bg-white/50 px-3 py-2.5 text-[12px] leading-relaxed text-fg/70 dark:bg-white/[.05]">{notice}</p>
            )}

            {step === 1 ? (
              <form onSubmit={next} className="mt-7 space-y-4">
                <div>
                  <label className="label">Nombre completo</label>
                  <div className="relative">
                    <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
                    <input required value={account.name} onChange={(e) => setAccount((f) => ({ ...f, name: e.target.value }))} className="input pl-10" placeholder="Nombres y apellidos" />
                  </div>
                </div>
                <div>
                  <label className="label">Nombre de usuario <span className="text-fg/25">(opcional, único)</span></label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-fg/30">@</span>
                    <input value={account.username} onChange={(e) => setAccount((f) => ({ ...f, username: e.target.value.replace(/[^a-zA-Z0-9._-]/g, '') }))} className="input pl-10" placeholder="tu.usuario" maxLength={30} />
                  </div>
                </div>
                <div>
                  <label className="label">Correo electrónico</label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
                    <input type="email" required value={account.email} onChange={(e) => setAccount((f) => ({ ...f, email: e.target.value }))} className="input pl-10" placeholder="tu.correo@universidad.edu.pe" />
                  </div>
                </div>
                <div>
                  <label className="label">Contraseña</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
                    <input type="password" required value={account.password} onChange={(e) => setAccount((f) => ({ ...f, password: e.target.value }))} className="input pl-10" placeholder="Mínimo 8 caracteres" />
                  </div>
                </div>

                {error && <p className="rounded-xl border border-dashed border-fg/25 bg-white/40 px-3 py-2.5 text-[12px] text-fg/70 dark:bg-white/[.04]">{error}</p>}

                <button type="submit" className="btn btn-primary w-full">Continuar <ArrowRight size={15} /></button>

                <p className="text-center text-[12.5px] text-fg/35">
                  ¿Ya tienes cuenta? <Link to="/login" className="text-fg underline decoration-fg/25 underline-offset-4 transition-colors hover:decoration-fg">Ingresar</Link>
                </p>
              </form>
            ) : (
              <form onSubmit={submit} className="mt-7 space-y-4">
                <UniversityPicker value={academic} onChange={setAcademic} />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Ciudad</label>
                    <div className="relative">
                      <Building2 size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
                      <input value={city} onChange={(e) => setCity(e.target.value)} className="input pl-10" placeholder="Lima" />
                    </div>
                  </div>
                  <div>
                    <label className="label">Ciclo</label>
                    <select value={academic.cycle} onChange={(e) => setAcademic((f) => ({ ...f, cycle: e.target.value }))} className="input appearance-none">
                      <option value="">Selecciona</option>
                      {Array.from({ length: 12 }, (_, i) => `${i + 1}.º ciclo`).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                {error && <p className="rounded-xl border border-dashed border-fg/25 bg-white/40 px-3 py-2.5 text-[12px] text-fg/70 dark:bg-white/[.04]">{error}</p>}

                <div className="flex gap-2">
                  <button type="button" onClick={() => setStep(1)} className="btn flex-1"><ArrowLeft size={15} /> Atrás</button>
                  <button type="submit" disabled={loading} className="btn btn-primary flex-[1.4]">
                    {loading ? <Spinner size={15} className="border-paper/30 border-t-paper" /> : <>Crear cuenta <ArrowRight size={15} /></>}
                  </button>
                </div>
              </form>
            )}

            {step === 3 && (
              <form onSubmit={verifyEmail} className="mt-7 space-y-4">
                <div>
                  <label className="label" htmlFor="register-code">Código de 6 dígitos</label>
                  <input
                    id="register-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    required
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="input text-center text-[17px] tracking-[0.4em]"
                    placeholder="000000"
                  />
                </div>

                {error && <p className="rounded-xl border border-dashed border-fg/25 bg-white/40 px-3 py-2.5 text-[12px] text-fg/70 dark:bg-white/[.04]">{error}</p>}

                <button type="submit" disabled={loading} className="btn btn-primary w-full">
                  {loading ? <Spinner size={15} className="border-paper/30 border-t-paper" /> : <>Verificar correo <ArrowRight size={15} /></>}
                </button>
                <button type="button" onClick={resendVerification} disabled={loading} className="flex w-full items-center justify-center gap-1.5 text-[12px] text-fg/40 transition-colors hover:text-fg/70">
                  Reenviar código
                </button>
                <button type="button" onClick={() => navigate('/')} className="flex w-full items-center justify-center text-[11px] text-fg/30 transition-colors hover:text-fg/60">
                  Continuar después
                </button>
              </form>
            )}

            <p className="mt-4 text-center text-[9.5px] leading-relaxed text-fg/25">
              Al crear tu cuenta aceptas los{' '}
              <Link to="/terminos" className="underline decoration-fg/20 underline-offset-2 hover:text-fg/50">términos de uso</Link>{' '}
              y la{' '}
              <Link to="/privacidad" className="underline decoration-fg/20 underline-offset-2 hover:text-fg/50">política de privacidad</Link>.
            </p>
          </div>
        </motion.div>
      </main>

      <aside className="relative hidden flex-col justify-between overflow-hidden border-l border-line/70 p-12 lg:flex">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(720px_520px_at_82%_18%,rgba(255,255,255,.95),transparent_68%)] dark:bg-[radial-gradient(720px_520px_at_82%_18%,rgba(255,255,255,.06),transparent_68%)]" />
        <div />
        <div className="max-w-md">
          <p className="mb-5 text-[10.5px] font-semibold uppercase tracking-[0.26em] text-fg/35">Comunidad privada</p>
          <h2 className="font-display text-[36px] leading-[1.12] tracking-[-0.02em] text-fg/95">Estudia con quienes entienden el mismo Derecho.</h2>
          <ul className="mt-8 space-y-4">
            {[
              'Catálogo oficial de universidades SUNEDU con sedes y carreras.',
              'Biblioteca jurídica con estado de vigencia e historial.',
              'ETON AI cita la norma, el artículo y la fuente oficial.',
              'Grupos de estudio, mensajería, llamadas y videoconferencias.',
            ].map((t) => (
              <li key={t} className="flex items-start gap-3 text-[12.5px] leading-relaxed text-fg/45">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-fg/15 bg-white/50 text-fg/70 dark:bg-white/[.06]"><Check size={11} /></span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[9.5px] uppercase tracking-[0.24em] text-fg/20">ETON LEX · Creado por Zalet Gozzer</p>
      </aside>
    </div>
  );
}
