import { lazy, Suspense } from 'react'
import { useLocation } from 'react-router-dom'
import { LandingPage, VisitorPage } from './PublicPages'
import { LegalPage } from './LegalPages'

const ResidentApp = lazy(() => import('./ResidentApp'))

export default function App() {
  const { pathname } = useLocation()

  if (pathname === '/') return <LandingPage />
  if (pathname.startsWith('/t/')) return <VisitorPage />
  if (pathname === '/privacidad') return <LegalPage type="privacy" />
  if (pathname === '/condiciones') return <LegalPage type="terms" />
  return <Suspense fallback={<div className="full-screen-loading"><span className="loading-spinner" /></div>}><ResidentApp /></Suspense>
}
