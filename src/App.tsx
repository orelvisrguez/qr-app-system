import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { LandingPage, VisitorPage } from './PublicPages'
import { LegalPage } from './LegalPages'

const ResidentApp = lazy(() => import('./ResidentApp'))

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/t/:slug" element={<VisitorPage />} />
      <Route path="/privacidad" element={<LegalPage type="privacy" />} />
      <Route path="/condiciones" element={<LegalPage type="terms" />} />
      <Route path="/*" element={<Suspense fallback={<div className="full-screen-loading"><span className="loading-spinner" /></div>}><ResidentApp /></Suspense>} />
    </Routes>
  )
}
