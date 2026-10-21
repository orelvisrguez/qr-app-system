import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bell,
  BellOff,
  Check,
  ChevronRight,
  Clock3,
  DoorOpen,
  ExternalLink,
  History,
  House,
  LogOut,
  Menu,
  QrCode,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom'
import { buenosAiresDateKey, formatDate, formatTime, getErrorMessage } from './lib/format'
import {
  defaultReplies,
  isSupabaseConfigured,
  quickReasons,
  supabase,
  type Door,
  type RingEvent,
} from './lib/supabase'

const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY
const TurnstileWidget = lazy(() => import('@marsidev/react-turnstile').then(({ Turnstile }) => ({ default: Turnstile })))

function ResidentApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)

  useEffect(() => {
    if (!supabase) return
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error('No se pudo recuperar la sesión:', error)
      } else {
        setSession(data.session)
      }
      setAuthReady(true)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (!authReady) return <LoadingScreen />

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/t/:slug" element={<VisitorPage />} />
      <Route path="/login" element={session ? <Navigate to="/panel" replace /> : <LoginPage />} />
      <Route path="/panel" element={session ? <DashboardPage /> : <Navigate to="/login" replace />} />
      <Route path="/panel/historial" element={session ? <HistoryPage /> : <Navigate to="/login" replace />} />
      <Route path="/panel/ajustes" element={session ? <SettingsPage /> : <Navigate to="/login" replace />} />
      <Route path="/panel/qr" element={session ? <QrPage /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

function useResidentData(userId: string | undefined) {
  const [door, setDoor] = useState<Door | null>(null)
  const [events, setEvents] = useState<RingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    if (!supabase || !userId) {
      setLoading(false)
      return
    }
    setError('')
    const { data: doorRow, error: doorError } = await supabase
      .from('doors')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at')
      .limit(1)
      .maybeSingle()
    if (doorError) {
      setError(doorError.message)
      setLoading(false)
      return
    }
    setDoor(doorRow as Door | null)

    if (!doorRow) {
      setEvents([])
      setLoading(false)
      return
    }

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const { data: eventRows, error: eventError } = await supabase
      .from('ring_events')
      .select('id, door_id, visitor_name, reason, status, response_text, created_at, responded_at')
      .eq('door_id', doorRow.id)
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: false })
      .limit(100)
    if (eventError) {
      setError(eventError.message)
    } else {
      setEvents((eventRows ?? []) as RingEvent[])
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    setLoading(true)
    void reload()
  }, [reload])

  useEffect(() => {
    if (!supabase || !door) return
    const channel = supabase
      .channel(`door-events-${door.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ring_events', filter: `door_id=eq.${door.id}` },
        () => void reload(),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Se perdió la conexión en tiempo real. Actualizá la página para volver a conectar.')
        }
      })
    return () => {
      void supabase?.removeChannel(channel)
    }
  }, [door, reload])

  return { door, events, loading, error, reload, setDoor, setEvents }
}

function LandingPage() {
  return (
    <main className="landing-page">
      <PublicHeader />
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> TU PUERTA, MÁS SIMPLE</span>
          <h1>Un aviso.<br /><span>Y listo.</span></h1>
          <p className="hero-lede">Un timbre inteligente que vive en un QR. Sin aparatos, sin apps para tus visitas, sin complicaciones.</p>
          <div className="hero-actions">
            <Link className="button button-dark" to="/login">Configurar mi timbre <ChevronRight size={18} /></Link>
            <a className="text-link" href="#como-funciona">¿Cómo funciona?</a>
          </div>
          <div className="hero-proof"><ShieldCheck size={17} /> Privado por diseño <span /> Gratis para empezar</div>
        </div>
        <div className="hero-art" aria-label="Vista previa del timbre en un celular">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="phone-mock">
            <div className="phone-camera" />
            <div className="phone-content">
              <div className="mini-top"><span className="mini-mark"><Bell size={14} /></span><span>TOC, TOC</span><span className="mini-menu">•••</span></div>
              <div className="door-circle"><DoorOpen size={34} strokeWidth={1.5} /></div>
              <span className="phone-kicker">ESTÁS EN CASA DE</span>
              <h2>Tu vecino</h2>
              <p>Dejá un aviso y ya le contamos que llegaste.</p>
              <div className="phone-input">¿Quién sos? <span>Opcional</span></div>
              <div className="phone-chips"><b>Visita</b><span>Delivery</span></div>
              <div className="phone-ring"><Bell size={19} fill="currentColor" /> Tocar timbre</div>
              <div className="phone-foot">No hace falta instalar nada ✨</div>
            </div>
          </div>
          <div className="notification-float"><div className="notification-icon"><Bell size={17} fill="currentColor" /></div><div><strong>Alguien llegó</strong><span>Visita · Ahora</span></div><span className="live-dot" /></div>
          <div className="safe-float"><ShieldCheck size={15} /> Tus datos, siempre privados</div>
          <span className="hero-sparkle sparkle-a">✳</span><span className="hero-sparkle sparkle-b">✳</span>
        </div>
      </section>
      <section className="feature-strip" id="como-funciona">
        <div><span className="feature-number">01</span><div><strong>Pegá el QR</strong><p>Lo imprimís y lo ponés en tu puerta.</p></div></div>
        <div><span className="feature-number">02</span><div><strong>Te avisan al instante</strong><p>El residente recibe el aviso en su panel.</p></div></div>
        <div><span className="feature-number">03</span><div><strong>Respondé con un toque</strong><p>Tu respuesta le llega a quien te visita.</p></div></div>
      </section>
      <footer className="landing-footer"><Logo /><span>Hecho para que llegar sea más fácil.</span><Link to="/login">Entrar a mi panel <ChevronRight size={15} /></Link></footer>
    </main>
  )
}

function PublicHeader() {
  return <header className="public-header"><Link to="/" className="brand"><Logo /></Link><nav><a href="#como-funciona">Cómo funciona</a><Link className="header-login" to="/login">Soy residente <ChevronRight size={15} /></Link></nav></header>
}

function Logo() {
  return <span className="logo-lockup"><span className="logo-icon"><Bell size={19} fill="currentColor" /></span><span className="logo-word">timbre<span>.</span></span></span>
}

function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function continueWithGoogle() {
    if (!supabase) return
    setBusy(true)
    setError('')
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/panel` },
    })
    if (authError) {
      setBusy(false)
      setError(authError.message)
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/panel` },
    })
    setBusy(false)
    if (authError) {
      setError(authError.message.toLowerCase().includes('email rate limit exceeded')
        ? 'Supabase alcanzó el límite de envíos de correo. Esperá a que se libere (puede tardar hasta una hora) o configurá SMTP propio para permitir el acceso por email.'
        : authError.message)
    } else {
      setSent(true)
    }
  }

  if (!isSupabaseConfigured) return <SetupRequired />

  return (
    <main className="auth-page">
      <div className="auth-top"><Link to="/"><Logo /></Link><Link to="/" className="back-link">Volver al inicio</Link></div>
      <section className="auth-card">
        <div className="auth-icon"><Bell size={22} /></div>
        {sent ? (
          <><span className="eyebrow">REVISÁ TU CORREO</span><h1>Ya casi estás.</h1><p className="auth-description">Te mandamos un enlace a <strong>{email}</strong>. Abrilo desde este dispositivo para entrar a tu panel.</p><div className="success-note"><Check size={17} /> Enlace enviado. También podés revisar correo no deseado.</div><button className="button button-quiet full-width" onClick={() => setSent(false)}>Usar otro correo</button></>
        ) : (
          <><span className="eyebrow">PANEL DEL RESIDENTE</span><h1>Tu puerta,<br />bajo control.</h1><p className="auth-description">Entrá con tu cuenta de Google, sin contraseña ni correos de acceso.</p><button className="google-sign-in full-width" type="button" onClick={() => void continueWithGoogle()} disabled={busy}><GoogleMark />{busy ? 'Conectando…' : 'Continuar con Google'}</button><div className="auth-divider"><span>o con enlace por correo</span></div><form className="auth-form" onSubmit={submit}><label htmlFor="email">Tu correo electrónico</label><input id="email" type="email" autoComplete="email" placeholder="vos@ejemplo.com" value={email} onChange={(event) => setEmail(event.target.value)} required /><button className="button button-dark full-width" type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Mandarme un enlace'} <ChevronRight size={18} /></button></form>{error && <p className="inline-error" role="alert">{error}{error.startsWith('Supabase alcanzó el límite') && <> <a href="https://supabase.com/dashboard/project/mtaarwgdeatipdmarxkh/auth/smtp" target="_blank" rel="noreferrer">Configurar SMTP en Supabase</a>.</>}</p>}<div className="privacy-note"><ShieldCheck size={15} /> Solo solicitamos los datos básicos de tu cuenta para iniciar sesión.</div></>
        )}
      </section>
      <p className="auth-footnote">Al continuar aceptás las <Link to="/condiciones">condiciones del servicio</Link> y la <Link to="/privacidad">política de privacidad</Link>.</p>
    </main>
  )
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" className="google-mark"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" /><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" /><path fill="#FBBC05" d="M12.6 27.7a12 12 0 0 1 0-7.5v-5.3H5.8a20 20 0 0 0 0 18.1l6.8-5.3Z" /><path fill="#EA4335" d="M24 11.8c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 5.7 29.5 4 24 4A20 20 0 0 0 5.8 14.9l6.8 5.3c1.6-4.8 6.1-8.4 11.4-8.4Z" /></svg>
}

function ResidentLayout({ children, active, userId, onSignOut }: { children: React.ReactNode; active: string; userId: string; onSignOut: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const links = [
    { to: '/panel', title: 'Inicio', icon: House, end: true },
    { to: '/panel/historial', title: 'Historial', icon: History },
    { to: '/panel/qr', title: 'Mi QR', icon: QrCode },
    { to: '/panel/ajustes', title: 'Ajustes', icon: Settings },
  ]
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <Link className="sidebar-brand" to="/panel"><Logo /></Link>
        <div className="sidebar-door"><span className="door-avatar"><DoorOpen size={17} /></span><span><small>MI PUERTA</small><strong>Mi timbre</strong></span><span className="door-status-dot" /></div>
        <span className="nav-caption">MENÚ</span>
        <nav className="side-nav">
          {links.map(({ to, title, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)} className={({ isActive }) => `side-link ${isActive ? 'side-link-active' : ''}`}><Icon size={18} strokeWidth={1.8} /><span>{title}</span>{title === 'Mi QR' && <span className="nav-arrow"><ExternalLink size={13} /></span>}</NavLink>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-tip"><span className="tip-star"><Sparkles size={16} /></span><strong>Un tip para vos</strong><p>Imprimí tu QR en tamaño A6 y plastificalo para que dure más.</p><Link to="/panel/qr">Ver mi QR <ChevronRight size={13} /></Link></div>
        <div className="sidebar-profile"><span className="profile-avatar">{userId.slice(0, 1).toUpperCase()}</span><span className="profile-email">Tu cuenta</span><button className="icon-button" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={onSignOut}><LogOut size={17} /></button></div>
      </aside>
      {menuOpen && <button className="mobile-scrim" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}
      <main className="main-area">
        <header className="dashboard-topbar"><button className="mobile-menu" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}><Menu size={21} /></button><div className="breadcrumb"><span>Mi espacio</span><ChevronRight size={14} /><strong>{active}</strong></div><div className="topbar-right"><span className="secure-label"><span /> Conexión segura</span><button className="topbar-avatar" title="Cuenta">{userId.slice(0, 1).toUpperCase()}</button></div></header>
        {children}
      </main>
    </div>
  )
}

function useUserId() {
  const [userId, setUserId] = useState<string>()
  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getUser().then(({ data, error }) => {
      if (error) console.error('No se pudo obtener el usuario:', error)
      else setUserId(data.user?.id)
    })
  }, [])
  return userId
}

function useSignOut() {
  const navigate = useNavigate()
  return useCallback(async () => {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) {
      window.alert(`No se pudo cerrar la sesión: ${error.message}`)
      return
    }
    navigate('/')
  }, [navigate])
}

function DashboardPage() {
  const userId = useUserId()
  const signOut = useSignOut()
  const data = useResidentData(userId)
  return <ResidentLayout active="Inicio" userId={userId ?? '?'} onSignOut={() => void signOut()}><DashboardContent {...data} /></ResidentLayout>
}

function DashboardContent({ door, events, loading, error, reload, setEvents }: ReturnType<typeof useResidentData>) {
  const pending = events.filter((event) => event.status === 'pending')
  const todayKey = buenosAiresDateKey(new Date())
  const todayCount = events.filter((event) => buenosAiresDateKey(event.created_at) === todayKey).length

  async function respond(event: RingEvent, response: string) {
    if (!supabase || !door) return
    const { data, error: updateError } = await supabase
      .from('ring_events')
      .update({ status: 'answered', response_text: response, responded_at: new Date().toISOString() })
      .eq('id', event.id)
      .eq('door_id', door.id)
      .eq('status', 'pending')
      .select('id')
    if (updateError) {
      window.alert(`No se pudo enviar la respuesta: ${updateError.message}`)
    } else if (!data?.length) {
      window.alert('Este timbre ya fue respondido o venció.')
      void reload()
    } else {
      setEvents((current) => current.map((row) => row.id === event.id ? { ...row, status: 'answered', response_text: response, responded_at: new Date().toISOString() } : row))
    }
  }

  return (
    <div className="page-content">
      <PageHeading eyebrow="MI ESPACIO" title="Buen día 👋" description="Este es el resumen de lo que pasa en tu puerta." action={<Link className="button button-dark button-small" to="/panel/qr"><QrCode size={16} /> Ver mi QR</Link>} />
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingCard /> : !door ? <EmptyDoor /> : <>
        <section className="welcome-card"><div className="welcome-orb" /><div className="welcome-copy"><span className="welcome-tag"><span className={door.active ? 'door-status-dot' : 'door-status-dot status-off'} /> {door.active ? 'TIMBRE ACTIVO' : 'TIMBRE PAUSADO'}</span><h2>Tu puerta está {door.active ? 'lista' : 'en pausa'}.</h2><p>Compartí tu QR para que las visitas puedan avisarte cuando lleguen.</p><Link to="/panel/qr" className="welcome-link">Ver y descargar mi QR <ChevronRight size={15} /></Link></div><div className="welcome-art"><div className="art-door"><span className="art-knob" /><span className="art-bell"><Bell size={17} /></span></div><div className="art-plant"><span /><i /><b /></div></div></section>
        <section className="stat-grid"><StatCard icon={<Bell size={17} />} label="Avisos de hoy" value={String(todayCount)} note={todayCount === 1 ? '1 visita en tu puerta' : 'visitas en tu puerta'} /><StatCard icon={<Clock3 size={17} />} label="Esperando respuesta" value={String(pending.length)} note={pending.length ? 'Un visitante está esperando' : 'Todo al día'} alert={pending.length > 0} /><StatCard icon={<ShieldCheck size={17} />} label="Tu puerta" value={door.active ? 'Activa' : 'Pausada'} note={door.dnd_enabled ? `No molestar · ${door.dnd_start?.slice(0, 5)} a ${door.dnd_end?.slice(0, 5)}` : 'Lista para recibir visitas'} /></section>
        <section className="section-block"><div className="section-heading"><div><span className="eyebrow">EN TIEMPO REAL</span><h2>Actividad reciente</h2></div><Link className="subtle-link" to="/panel/historial">Ver historial <ChevronRight size={15} /></Link></div>
          {events.length === 0 ? <div className="empty-activity"><span className="empty-bell"><Bell size={23} /></span><strong>Todo tranquilo por acá</strong><p>Cuando alguien toque tu timbre, vas a ver el aviso acá.</p></div> : <div className="event-list">{events.slice(0, 6).map((event) => <EventCard key={event.id} event={event} door={door} onRespond={respond} />)}</div>}
        </section>
      </>}
    </div>
  )
}

function StatCard({ icon, label, value, note, alert = false }: { icon: React.ReactNode; label: string; value: string; note: string; alert?: boolean }) {
  return <div className={`stat-card ${alert ? 'stat-alert' : ''}`}><div className="stat-top"><span className="stat-icon">{icon}</span><span>{label}</span></div><strong className="stat-value">{value}</strong><span className="stat-note">{note}</span></div>
}

function EventCard({ event, door, onRespond }: { event: RingEvent; door: Door; onRespond: (event: RingEvent, response: string) => void }) {
  const isPending = event.status === 'pending'
  const visitor = event.visitor_name?.trim() || 'Alguien'
  return <article className={`event-card ${isPending ? 'event-pending' : ''}`}><div className={`event-icon ${isPending ? 'event-icon-pending' : ''}`}><Bell size={17} /></div><div className="event-main"><div className="event-title-row"><strong>{visitor} llegó</strong><span className="event-time">{formatTime(event.created_at)}</span></div><div className="event-meta"><span>{event.reason || 'Visita'}</span><i />{formatDate(event.created_at)}</div>{event.status === 'answered' && event.response_text && <div className="event-response"><Check size={13} /> Respondiste: “{event.response_text}”</div>}{isPending && <div className="quick-actions">{(door.quick_replies?.length ? door.quick_replies : defaultReplies).map((reply) => <button key={reply} onClick={() => onRespond(event, reply)}>{reply}</button>)}</div>}</div>{isPending && <span className="pending-pill">Esperando</span>}</article>
}

function HistoryPage() {
  const userId = useUserId()
  const signOut = useSignOut()
  const data = useResidentData(userId)
  const [filter, setFilter] = useState('Todos')
  const filtered = useMemo(() => data.events.filter((event) => filter === 'Todos' || (filter === 'Respondidos' ? event.status === 'answered' : event.status === 'pending')), [data.events, filter])
  return <ResidentLayout active="Historial" userId={userId ?? '?'} onSignOut={() => void signOut()}><div className="page-content">
    <PageHeading eyebrow="TU ACTIVIDAD" title="Historial" description="Todos tus avisos de los últimos 30 días." />
    {data.error && <ErrorBanner message={data.error} />}
    <div className="history-toolbar"><div className="filter-tabs">{['Todos', 'Esperando', 'Respondidos'].map((name) => <button key={name} className={filter === name ? 'filter-active' : ''} onClick={() => setFilter(name)}>{name}</button>)}</div><span className="history-count">{filtered.length} {filtered.length === 1 ? 'aviso' : 'avisos'}</span></div>
    {data.loading ? <LoadingCard /> : !filtered.length ? <div className="empty-activity history-empty"><span className="empty-bell"><History size={23} /></span><strong>No hay avisos para mostrar</strong><p>Cuando recibas un timbre, va a aparecer en este historial.</p></div> : <div className="history-list">{filtered.map((event) => <EventHistoryRow key={event.id} event={event} />)}</div>}
    <p className="retention-note"><ShieldCheck size={15} /> Los avisos se conservan por 30 días.</p>
  </div></ResidentLayout>
}

function EventHistoryRow({ event }: { event: RingEvent }) {
  return <article className="history-row"><div className={`event-icon ${event.status === 'pending' ? 'event-icon-pending' : ''}`}><Bell size={17} /></div><div className="history-row-main"><strong>{event.visitor_name?.trim() || 'Alguien'} llegó</strong><span>{event.reason || 'Visita'}{event.response_text && ` · “${event.response_text}”`}</span></div><div className="history-row-date"><strong>{formatDate(event.created_at)}</strong><span className={`history-status ${event.status === 'answered' ? 'answered-status' : ''}`}>{event.status === 'answered' ? 'Respondido' : event.status === 'pending' ? 'Esperando' : 'Sin respuesta'}</span></div></article>
}

function SettingsPage() {
  const userId = useUserId()
  const signOut = useSignOut()
  const data = useResidentData(userId)
  const [name, setName] = useState('')
  const [active, setActive] = useState(true)
  const [dndEnabled, setDndEnabled] = useState(false)
  const [dndStart, setDndStart] = useState('22:00')
  const [dndEnd, setDndEnd] = useState('08:00')
  const [replies, setReplies] = useState(defaultReplies)
  const [telegramChatId, setTelegramChatId] = useState<string | null>(null)
  const [telegramLink, setTelegramLink] = useState('')
  const [telegramBusy, setTelegramBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!data.door) return
    setName(data.door.name)
    setActive(data.door.active)
    setDndEnabled(data.door.dnd_enabled)
    setDndStart(data.door.dnd_start?.slice(0, 5) || '22:00')
    setDndEnd(data.door.dnd_end?.slice(0, 5) || '08:00')
    setReplies(data.door.quick_replies?.length ? data.door.quick_replies : defaultReplies)
  }, [data.door])

  useEffect(() => {
    if (!supabase || !userId) return
    void supabase.from('profiles').select('telegram_chat_id').eq('id', userId).maybeSingle()
      .then(({ data: profile, error: profileError }) => {
        if (profileError) setError(profileError.message)
        else setTelegramChatId(profile?.telegram_chat_id ?? null)
      })
  }, [userId])

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !data.door) return
    const cleanReplies = replies.map((reply) => reply.trim()).filter(Boolean)
    if (cleanReplies.length < 1 || cleanReplies.length > 4) {
      setError('Elegí entre 1 y 4 respuestas rápidas.')
      return
    }
    if (cleanReplies.some((reply) => reply.length > 60)) {
      setError('Cada respuesta rápida puede tener hasta 60 caracteres.')
      return
    }
    setSaving(true)
    setError('')
    setSaved(false)
    const { error: saveError } = await supabase.from('doors').update({
      name: name.trim() || 'Mi puerta',
      active,
      dnd_enabled: dndEnabled,
      dnd_start: dndEnabled ? dndStart : null,
      dnd_end: dndEnabled ? dndEnd : null,
      quick_replies: cleanReplies,
    }).eq('id', data.door.id)
    setSaving(false)
    if (saveError) setError(saveError.message)
    else {
      setSaved(true)
      await data.reload()
    }
  }

  async function regenerateSlug() {
    if (!supabase || !data.door || !window.confirm('El QR anterior dejará de funcionar. ¿Querés generar uno nuevo?')) return
    const alphabet = '23456789abcdefghjkmnpqrstuvwxyz'
    const bytes = crypto.getRandomValues(new Uint8Array(10))
    const slug = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
    setError('')
    const { error: updateError } = await supabase.from('doors').update({ slug }).eq('id', data.door.id)
    if (updateError) setError(updateError.message)
    else await data.reload()
  }

  async function connectTelegram() {
    if (!supabase) return
    setTelegramBusy(true)
    setError('')
    const { data: linkData, error: linkError } = await supabase.functions.invoke('telegram-link-code', { body: {} })
    setTelegramBusy(false)
    if (linkError) {
      setError(linkError.message)
    } else if (typeof linkData?.link_url === 'string') {
      setTelegramLink(linkData.link_url)
    } else {
      setError('No pudimos generar el enlace de Telegram.')
    }
  }

  async function disconnectTelegram() {
    if (!supabase || !userId || !window.confirm('¿Querés dejar de recibir avisos por Telegram?')) return
    setTelegramBusy(true)
    setError('')
    const { error: unlinkError } = await supabase.from('profiles').update({ telegram_chat_id: null }).eq('id', userId)
    setTelegramBusy(false)
    if (unlinkError) setError(unlinkError.message)
    else {
      setTelegramChatId(null)
      setTelegramLink('')
    }
  }

  return <ResidentLayout active="Ajustes" userId={userId ?? '?'} onSignOut={() => void signOut()}><div className="page-content">
    <PageHeading eyebrow="PERSONALIZÁ TU TIMBRE" title="Ajustes" description="Administrá tu puerta y elegí cómo responder." />
    {data.error && <ErrorBanner message={data.error} />}
    {data.loading ? <LoadingCard /> : !data.door ? <EmptyDoor /> : <>
      <form className="settings-form" onSubmit={(event) => void save(event)}>
        <section className="settings-card"><div className="settings-card-heading"><div className="settings-card-icon"><DoorOpen size={18} /></div><div><h2>Tu puerta</h2><p>Esta información es solo para vos.</p></div></div><label className="field-label" htmlFor="door-name">Nombre interno</label><input className="text-input" id="door-name" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /><p className="field-hint">No se muestra a tus visitas.</p><div className="setting-toggle-row"><div><strong>Timbre activo</strong><p>Las visitas pueden avisarte desde el QR.</p></div><Toggle checked={active} onChange={setActive} label="Activar timbre" /></div></section>
        <section className="settings-card"><div className="settings-card-heading"><div className="settings-card-icon"><BellOff size={18} /></div><div><h2>No molestar</h2><p>Durante este horario se guardan avisos, sin notificaciones sonoras.</p></div></div><div className="setting-toggle-row dnd-toggle"><div><strong>Activar horario</strong><p>Usamos la hora de Buenos Aires.</p></div><Toggle checked={dndEnabled} onChange={setDndEnabled} label="Activar No molestar" /></div>{dndEnabled && <div className="time-fields"><label><span>Desde</span><input className="text-input" type="time" value={dndStart} onChange={(event) => setDndStart(event.target.value)} /></label><span className="time-separator">a</span><label><span>Hasta</span><input className="text-input" type="time" value={dndEnd} onChange={(event) => setDndEnd(event.target.value)} /></label></div>}</section>
        <section className="settings-card"><div className="settings-card-heading"><div className="settings-card-icon"><Check size={18} /></div><div><h2>Respuestas rápidas</h2><p>Las opciones que ve la persona que está en tu puerta.</p></div></div><div className="reply-inputs">{[0, 1, 2, 3].map((index) => <label key={index} className="reply-field"><span>{index + 1}</span><input className="text-input" maxLength={60} placeholder="Escribí una respuesta" value={replies[index] ?? ''} onChange={(event) => setReplies((current) => current.map((reply, item) => item === index ? event.target.value : reply).concat(current.length <= index ? [event.target.value] : []))} /><span className="character-count">{(replies[index] ?? '').length}/60</span></label>)}</div></section>
        <section className="settings-card slug-settings"><div className="settings-card-heading"><div className="settings-card-icon"><QrCode size={18} /></div><div><h2>Enlace de tu puerta</h2><p>Tu QR abre este enlace público y anónimo.</p></div></div><div className="slug-row"><code>/t/{data.door.slug}</code><button type="button" className="button button-quiet button-small" onClick={() => void regenerateSlug()}>Regenerar QR</button></div><p className="field-hint">Al regenerarlo, el enlace y el QR anteriores dejan de funcionar.</p></section>
        {error && <ErrorBanner message={error} />}{saved && <div className="success-note"><Check size={16} /> Ajustes guardados.</div>}
        <div className="settings-actions"><button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'} <Check size={17} /></button></div>
      </form>
      <section className="settings-card channel-card"><div className="settings-card-heading"><div className="settings-card-icon"><Smartphone size={18} /></div><div><h2>Notificaciones</h2><p>Vinculá canales para enterarte más rápido.</p></div></div><div className="channel-row"><span className="channel-symbol telegram-symbol">✈</span><div><strong>Telegram</strong><p>{telegramChatId ? 'Este chat recibe avisos y permite responder.' : 'Vinculá el bot para recibir avisos y responder.'}</p></div>{telegramChatId ? <button className="channel-action" disabled={telegramBusy} onClick={() => void disconnectTelegram()}>{telegramBusy ? '…' : 'Desconectar'}</button> : <button className="channel-action" disabled={telegramBusy} onClick={() => void connectTelegram()}>{telegramBusy ? 'Preparando…' : 'Vincular'}</button>}</div>{telegramLink && <div className="telegram-link-note"><span>El enlace vence en 10 minutos. Abrilo y tocá <strong>Iniciar</strong> en Telegram.</span><a className="button button-quiet button-small" href={telegramLink} target="_blank" rel="noreferrer">Abrir Telegram <ExternalLink size={13} /></a></div>}<div className="channel-row"><span className="channel-symbol push-symbol"><Bell size={17} /></span><div><strong>Notificaciones web</strong><p>Los avisos push todavía no están disponibles.</p></div><span className="coming-soon">PRÓXIMAMENTE</span></div><InstallGuide /></section>
    </>}
  </div></ResidentLayout>
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'toggle-on' : ''}`} onClick={() => onChange(!checked)}><span /></button>
}

function InstallGuide() {
  const [open, setOpen] = useState(false)
  return <div className="install-guide"><button type="button" onClick={() => setOpen(!open)} aria-expanded={open}><Smartphone size={16} /> ¿Cómo instalar en iPhone? <ChevronRight className={open ? 'rotate-icon' : ''} size={15} /></button>{open && <ol><li>Abrí esta página en Safari.</li><li>Tocá el botón <strong>Compartir</strong> (el cuadrado con flecha).</li><li>Elegí <strong>“Agregar a pantalla de inicio”</strong>.</li><li>Abrí Timbre desde el nuevo ícono.</li></ol>}</div>
}

function QrPage() {
  const userId = useUserId()
  const signOut = useSignOut()
  const data = useResidentData(userId)
  const [qrData, setQrData] = useState('')
  const [size, setSize] = useState<'A6' | 'A5'>('A6')
  const publicUrl = data.door ? `${window.location.origin}/t/${data.door.slug}` : ''

  useEffect(() => {
    if (!publicUrl) return
    let cancelled = false
    void import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(publicUrl, { width: 640, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#24483b', light: '#ffffff' } }))
      .then((image) => {
        if (!cancelled) setQrData(image)
      })
      .catch((error: unknown) => console.error('No se pudo generar el QR:', error))
    return () => { cancelled = true }
  }, [publicUrl])

  async function downloadSvg() {
    if (!publicUrl) return
    try {
      const { default: QRCode } = await import('qrcode')
      const svg = await QRCode.toString(publicUrl, { type: 'svg', width: 640, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#24483b', light: '#ffffff' } })
      downloadFile(new Blob([svg], { type: 'image/svg+xml' }), 'mi-timbre.svg')
    } catch (error) {
      window.alert(`No se pudo descargar el SVG: ${getErrorMessage(error)}`)
    }
  }

  function printQr() {
    document.body.classList.toggle('print-a5', size === 'A5')
    window.print()
    document.body.classList.remove('print-a5')
  }

  return <ResidentLayout active="Mi QR" userId={userId ?? '?'} onSignOut={() => void signOut()}><div className="page-content qr-page-content">
    <PageHeading eyebrow="TU ACCESO PÚBLICO" title="Tu QR" description="Imprimilo y pegalo en la entrada. Tus visitas escanean y te avisan." />
    {data.error && <ErrorBanner message={data.error} />}
    {data.loading ? <LoadingCard /> : !data.door ? <EmptyDoor /> : <>
      <div className="qr-layout"><section className="qr-preview-card"><div className="qr-paper"><span className="qr-paper-logo"><Logo /></span><span className="qr-paper-eyebrow">HOLA, LLEGASTE</span><h2>Escaneá para<br /><em>tocar el timbre</em></h2><p>Te avisamos cuando llegues.</p>{qrData ? <img className="qr-image" src={qrData} alt="Código QR para tocar el timbre" /> : <div className="qr-loading" />}<span className="qr-paper-url">Sin apps. Sin esperas.</span><span className="qr-paper-dots">● ● ●</span></div><div className="qr-size-controls"><span>Tamaño de impresión</span><div>{(['A6', 'A5'] as const).map((option) => <button key={option} className={size === option ? 'size-selected' : ''} onClick={() => setSize(option)}>{option}</button>)}</div></div></section>
        <section className="qr-actions-panel"><span className="eyebrow">LISTO PARA COMPARTIR</span><h2>Tu puerta, a un escaneo.</h2><p>Descargá tu QR en la mejor calidad o imprimí una hoja lista para pegar.</p><div className="share-url"><span><small>ENLACE DE TU TIMBRE</small><code>{publicUrl}</code></span><button aria-label="Copiar enlace" title="Copiar enlace" onClick={() => void navigator.clipboard.writeText(publicUrl).then(() => window.alert('Enlace copiado.')).catch((error: unknown) => window.alert(`No se pudo copiar el enlace: ${getErrorMessage(error)}`))}><CopyIcon /></button></div><div className="download-actions"><button className="button button-dark full-width" onClick={() => qrData && downloadFile(dataUrlToBlob(qrData), 'mi-timbre.png')} disabled={!qrData}><QrCode size={17} /> Descargar PNG</button><button className="button button-quiet full-width" onClick={() => void downloadSvg()}><ExternalLink size={16} /> Descargar SVG</button><button className="button button-quiet full-width print-button" onClick={printQr}><ExternalLink size={16} /> Imprimir hoja {size}</button></div><div className="qr-privacy-note"><ShieldCheck size={17} /><span><strong>Un QR privado.</strong> No muestra tu nombre, dirección ni número de departamento.</span></div><Link className="qr-settings-link" to="/panel/ajustes">¿Necesitás cambiar tu enlace? <span>Regenerar QR <ChevronRight size={14} /></span></Link></section></div>
    </>}
  </div></ResidentLayout>
}

function CopyIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>
}

function downloadFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function dataUrlToBlob(dataUrl: string) {
  const [metadata, encoded] = dataUrl.split(',')
  const binary = atob(encoded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: metadata.match(/data:(.*);base64/)?.[1] || 'image/png' })
}

function VisitorPage() {
  const { slug = '' } = useParams()
  const [doorActive, setDoorActive] = useState<boolean | null>(null)
  const [doorLoading, setDoorLoading] = useState(true)
  const [name, setName] = useState('')
  const [reason, setReason] = useState<string>('Visita')
  const [token, setToken] = useState('')
  const [widgetKey, setWidgetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [eventId, setEventId] = useState('')
  const [response, setResponse] = useState('')
  const [waitExpired, setWaitExpired] = useState(false)
  const [message, setMessage] = useState('')
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'answered' | 'expired'>('idle')

  useEffect(() => {
    let cancelled = false
    async function getDoor() {
      if (!supabase) {
        setMessage('El timbre todavía no está configurado. Probá de nuevo más tarde.')
        setDoorLoading(false)
        return
      }
      const { data, error } = await supabase.functions.invoke('get-door-public', { body: { slug } })
      if (cancelled) return
      if (error) {
        setMessage(error.message)
        setDoorActive(false)
      }
      else if (!data || data.active !== true) setDoorActive(false)
      else setDoorActive(true)
      setDoorLoading(false)
    }
    void getDoor()
    return () => { cancelled = true }
  }, [slug])

  useEffect(() => {
    if (!eventId || phase !== 'waiting') return
    let active = true
    const startedAt = Date.now()
    const poll = async () => {
      if (!active) return
      if (Date.now() - startedAt >= 60_000) {
        setWaitExpired(true)
        setPhase('expired')
        return
      }
      if (!supabase) return
      const { data, error } = await supabase.functions.invoke('get-event-status', { body: { event_id: eventId } })
      if (!active) return
      if (error) {
        setMessage('No pudimos actualizar el estado. Seguimos intentando…')
        return
      }
      if (data?.status === 'answered') {
        setResponse(data.response_text || 'El residente recibió tu aviso.')
        setPhase('answered')
      } else if (data?.status === 'expired') {
        setWaitExpired(true)
        setPhase('expired')
      }
    }
    void poll()
    const interval = window.setInterval(() => void poll(), 3000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [eventId, phase])

  async function ring() {
    if (!supabase || !token || busy) return
    setBusy(true)
    setMessage('')
    const deviceKey = 'timbre-device-id'
    let deviceId = localStorage.getItem(deviceKey)
    if (!deviceId) {
      deviceId = crypto.randomUUID()
      localStorage.setItem(deviceKey, deviceId)
    }
    const { data, error } = await supabase.functions.invoke('ring', {
      body: { slug, visitor_name: name.trim().slice(0, 40) || null, reason, device_id: deviceId, turnstile_token: token },
    })
    setBusy(false)
    if (error) {
      const status = error.context instanceof Response ? error.context.status : undefined
      setMessage(status === 429 ? 'Ya tocaste hace poquito. Esperá un momento antes de volver a intentar.' : error.message)
      setToken('')
      setWidgetKey((key) => key + 1)
    } else if (typeof data?.event_id === 'string') {
      setEventId(data.event_id)
      setPhase('waiting')
      setWaitExpired(false)
      setResponse('')
      if (!data.notification_sent) setMessage('El aviso quedó registrado, pero esta puerta no tiene Telegram vinculado. Si podés, avisá directamente en la puerta.')
    } else {
      setMessage('No pudimos enviar el aviso. Probá de nuevo.')
    }
  }

  function retry() {
    setPhase('idle')
    setEventId('')
    setToken('')
    setMessage('')
    setWidgetKey((key) => key + 1)
  }

  const unavailable = !doorLoading && doorActive === false
  return <main className="visitor-page"><header className="visitor-header"><Link to="/" className="visitor-brand"><Logo /></Link><span className="visitor-secure"><ShieldCheck size={14} /> Conexión segura</span></header>
    <section className="visitor-card">
      {doorLoading ? <div className="visitor-loading"><span className="loading-spinner" /><p>Un segundito…</p></div> : unavailable ? <><div className="visitor-result-icon muted-result"><DoorOpen size={26} /></div><span className="eyebrow">TIMBRE NO DISPONIBLE</span><h1>Por ahora no se puede tocar.</h1><p>El timbre está pausado o el enlace ya no está activo.</p></> : phase === 'answered' ? <><div className="visitor-result-icon answered-result"><Check size={27} /></div><span className="eyebrow">RESPUESTA RECIBIDA</span><h1>{response}</h1><p>Ya le avisamos que llegaste. ¡Gracias por esperar!</p><button className="visitor-secondary" onClick={retry}>Volver al inicio</button></> : phase === 'expired' || waitExpired ? <><div className="visitor-result-icon muted-result"><Clock3 size={25} /></div><span className="eyebrow">SIN RESPUESTA</span><h1>No hubo respuesta.</h1><p>Podés volver a intentar en un momento.</p><button className="button button-dark full-width visitor-retry" onClick={retry}>Volver a intentar <ChevronRight size={18} /></button></> : phase === 'waiting' ? <><div className="visitor-result-icon waiting-result"><span className="loading-spinner" /></div><span className="eyebrow">AVISANDO</span><h1>Ya le avisamos.</h1><p>Esperá un momentito, estamos esperando la respuesta.</p>{message && <p className="visitor-notification-warning" role="status">{message}</p>}<div className="waiting-dots"><i /><i /><i /></div><span className="visitor-wait-note">Te mostramos la respuesta acá mismo.</span></> : <><div className="visitor-bell-mark"><Bell size={27} /></div><span className="eyebrow">HOLA, LLEGASTE</span><h1>Dejá un aviso<br />y ya le contamos.</h1><p className="visitor-intro">No hace falta instalar nada. Completá tus datos si querés y tocá el timbre.</p><label className="visitor-label" htmlFor="visitor-name">¿Quién sos? <span>Opcional</span></label><input className="visitor-name-input" id="visitor-name" placeholder="Tu nombre" maxLength={40} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /><span className="visitor-label reason-label">¿A qué venís?</span><div className="reason-chips">{quickReasons.map((item) => <button key={item} className={reason === item ? 'reason-selected' : ''} onClick={() => setReason(item)}>{item}</button>)}</div>{turnstileSiteKey ? <div className="turnstile-slot"><Suspense fallback={<span className="loading-spinner" />}><TurnstileWidget key={widgetKey} siteKey={turnstileSiteKey} onSuccess={setToken} onExpire={() => setToken('')} onError={() => { setToken(''); setMessage('No pudimos verificar la solicitud. Actualizá el desafío y probá de nuevo.') }} options={{ theme: 'light', size: 'flexible' }} /></Suspense></div> : <div className="turnstile-missing">Falta configurar la verificación antispam para habilitar el timbre.</div>}<button className="button button-dark visitor-ring" onClick={() => void ring()} disabled={!token || busy || !turnstileSiteKey}>{busy ? <><span className="button-spinner" /> Avisando…</> : <><Bell size={19} fill="currentColor" /> Tocar timbre</>}</button>{message && <p className="inline-error visitor-error" role="alert">{message}</p>}<div className="visitor-privacy"><ShieldCheck size={14} /> Tu información no se comparte ni se muestra públicamente.</div></>}
    </section><footer className="visitor-footer"><Logo /><span>Un aviso y listo.</span></footer>
  </main>
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="error-banner" role="alert"><span>{message}</span><button aria-label="Cerrar aviso" onClick={(event) => event.currentTarget.parentElement?.remove()}><X size={16} /></button></div>
}

function LoadingCard() {
  return <div className="loading-card"><span className="loading-spinner" /> Cargando tu espacio…</div>
}

function LoadingScreen() {
  return <main className="full-screen-loading"><span className="loading-spinner" /><Logo /></main>
}

function SetupRequired() {
  return <main className="setup-page"><div className="setup-card"><Logo /><span className="eyebrow">FALTA UN PASO</span><h1>Conectá tu proyecto Supabase</h1><p>Para activar el timbre, configurá las variables del proyecto y aplicá la migración incluida.</p><pre>VITE_SUPABASE_URL=…<br />VITE_SUPABASE_ANON_KEY=…</pre><p className="setup-footnote">Copiá <code>.env.example</code> a <code>.env.local</code>, completá tus credenciales y reiniciá el servidor.</p><Link className="button button-dark" to="/">Volver al inicio <ChevronRight size={17} /></Link></div></main>
}

function EmptyDoor() {
  return <div className="empty-activity"><span className="empty-bell"><DoorOpen size={23} /></span><strong>No encontramos tu puerta</strong><p>Verificá que la migración de Supabase esté aplicada y volvé a cargar.</p></div>
}

function NotFoundPage() {
  return <main className="not-found"><Logo /><span className="eyebrow">404 · POR ACÁ NO ES</span><h1>Esta página no existe.</h1><Link className="button button-dark" to="/">Volver al inicio <ChevronRight size={17} /></Link></main>
}

export default ResidentApp
