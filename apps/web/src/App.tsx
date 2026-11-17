import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { TempleMark } from './components/TempleMark';
import { useAuth } from './lib/store';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import AiChat from './pages/AiChat';
import LibraryPage from './pages/Library';
import NormDetail from './pages/NormDetail';
import NewsPage from './pages/News';
import NewsDetail from './pages/NewsDetail';
import UpdatesPage from './pages/Updates';
import Community from './pages/Community';
import Messages from './pages/Messages';
import Rooms from './pages/Rooms';
import Room from './pages/Room';
import Profile from './pages/Profile';
import SettingsPage from './pages/Settings';
import Admin from './pages/Admin';
import NotFound from './pages/NotFound';
import { AboutPage, PrivacyPage, TermsPage } from './pages/Legal';

const PUBLIC_PATHS = new Set(['/login', '/registro', '/acerca', '/privacidad', '/terminos']);

const TITLES: Record<string, string> = {
  '/login': 'Acceso — ETON LEX',
  '/registro': 'Crear cuenta — ETON LEX',
  '/acerca': 'Acerca de ETON LEX — Creada por Zalet Gozzer',
  '/privacidad': 'Política de privacidad — ETON LEX',
  '/terminos': 'Términos de uso — ETON LEX',
};

const DESCRIPTIONS: Record<string, string> = {
  '/login':
    'Ingresa a ETON LEX, la plataforma jurídica para estudiantes de Derecho del Perú: legislación con enlace a la fuente oficial, ETON AI que cita fuentes y comunidad académica privada.',
  '/registro':
    'Crea tu cuenta en ETON LEX: biblioteca normativa peruana, ETON AI con fuentes, comunidad de estudio y app instalable. Plataforma creada por Zalet Gozzer.',
  '/acerca':
    'Conoce ETON LEX, la plataforma jurídica peruana creada por Zalet Gozzer para estudiantes de Derecho, con compromiso de información verificable y privacidad.',
  '/privacidad':
    'Política de privacidad de ETON LEX: qué datos tratamos, con qué finalidad y cómo ejercer tus derechos conforme a la Ley N.º 29733 del Perú.',
  '/terminos':
    'Términos de uso de ETON LEX: condiciones de acceso, uso aceptable, contenido del usuario, información jurídica y responsabilidad.',
};

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-5">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-line/80 bg-paper text-fg shadow-[0_18px_38px_-24px_rgba(0,0,0,.9)]">
          <TempleMark className="h-9 w-9" />
          <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/60 dark:ring-white/10" />
        </div>
        <div className="text-center">
          <p className="font-display text-lg tracking-[0.18em] text-fg/80">ETON LEX</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.24em] text-fg/30">El Derecho, siempre a tu alcance</p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { user, ready, bootstrap } = useAuth();
  const location = useLocation();

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const theme = (user as { theme?: string } | null)?.theme;
    const stored = localStorage.getItem('eton-theme');
    const dark = (theme ?? stored ?? 'light') === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    if (theme) localStorage.setItem('eton-theme', dark ? 'dark' : 'light');
  }, [user]);

  // SEO: solo las páginas públicas se indexan. Las rutas con sesión
  // (panel, mensajes, perfiles, conversaciones, administración) quedan
  // fuera de los buscadores, además de estar bloqueadas en robots.txt.
  useEffect(() => {
    const isPublic = PUBLIC_PATHS.has(location.pathname);
    let robots = document.head.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.setAttribute('name', 'robots');
      document.head.appendChild(robots);
    }
    robots.setAttribute('content', isPublic ? 'index,follow,max-image-preview:large' : 'noindex,nofollow');

    const canonical = document.head.querySelector('link[rel="canonical"]');
    if (canonical) {
      canonical.setAttribute('href', `${window.location.origin}${isPublic ? location.pathname : '/login'}`);
    }

    let description = document.head.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement('meta');
      description.setAttribute('name', 'description');
      document.head.appendChild(description);
    }
    description.setAttribute('content', DESCRIPTIONS[location.pathname] ?? 'ETON LEX, plataforma jurídica para estudiantes de Derecho del Perú. Creada por Zalet Gozzer.');

    document.title = TITLES[location.pathname] ?? 'ETON LEX — El Derecho, siempre a tu alcance';
  }, [location.pathname]);

  if (!ready) return <Splash />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/registro" element={user ? <Navigate to="/" replace /> : <Register />} />
      <Route path="/acerca" element={<AboutPage />} />
      <Route path="/privacidad" element={<PrivacyPage />} />
      <Route path="/terminos" element={<TermsPage />} />
      <Route
        element={
          user ? <Layout /> : <Navigate to="/login" replace state={{ from: location.pathname }} />
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="/ai" element={<AiChat />} />
        <Route path="/biblioteca" element={<LibraryPage />} />
        <Route path="/biblioteca/:slug" element={<NormDetail />} />
        <Route path="/noticias" element={<NewsPage />} />
        <Route path="/noticias/:id" element={<NewsDetail />} />
        <Route path="/actualizaciones" element={<UpdatesPage />} />
        <Route path="/comunidad" element={<Community />} />
        <Route path="/mensajes" element={<Messages />} />
        <Route path="/mensajes/:id" element={<Messages />} />
        <Route path="/salas" element={<Rooms />} />
        <Route path="/sala/:id" element={<Room />} />
        <Route path="/perfil" element={<Profile />} />
        <Route path="/perfil/:id" element={<Profile />} />
        <Route path="/configuracion" element={<SettingsPage />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
