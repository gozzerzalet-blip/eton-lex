import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Compass, Scale } from 'lucide-react';
import { Logo } from '../components/Logo';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-6 flex justify-center">
          <Logo />
        </div>

        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-fg text-paper shadow-[0_18px_38px_-24px_rgba(0,0,0,.9)]">
          <Compass size={26} />
        </div>

        <p className="mt-6 font-display text-[64px] leading-none text-fg/15">404</p>
        <h1 className="mt-2 font-display text-2xl text-fg/95">Esta página no existe</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-fg/40">
          La dirección que intentaste abrir no corresponde a ninguna sección de ETON LEX.
          Revisa el enlace o vuelve al inicio para continuar estudiando.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          <Link to="/" className="btn btn-primary btn-sm">
            <Scale size={13} /> Ir al inicio
          </Link>
          <button onClick={() => navigate(-1)} className="btn btn-sm">
            <ArrowLeft size={13} /> Volver atrás
          </button>
        </div>

        <p className="mt-8 text-[10px] uppercase tracking-[0.22em] text-fg/20">
          ETON LEX — El Derecho, siempre a tu alcance
        </p>
      </div>
    </div>
  );
}
