import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { applyAppearance } from './use-probe'
import './styles.css'

const RanApp = lazy(() => import('./ran/RanApp').then((module) => ({ default: module.RanApp })))

applyAppearance()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<main className="center">Loading Ran…</main>}>
      <RanApp />
    </Suspense>
  </StrictMode>,
)
