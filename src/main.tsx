import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyAppearance } from './use-probe'
import './styles.css'

const LuminaApp = lazy(() => import('./lumina/LuminaApp').then((module) => ({ default: module.LuminaApp })))
const useLuminaPreview = new URLSearchParams(window.location.search).get('ui')?.startsWith('lumina') === true

applyAppearance()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {useLuminaPreview ? (
      <Suspense fallback={<main className="center">正在载入新版界面…</main>}>
        <LuminaApp />
      </Suspense>
    ) : <App />}
  </StrictMode>,
)
