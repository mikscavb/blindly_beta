import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const launchScreenMountedAt = performance.now()
const minimumLaunchScreenDurationMs = 2400

function dismissLaunchScreen() {
  const splash = document.getElementById('launch-splash')

  if (!splash || splash.dataset.state === 'hidden') {
    return
  }

  const elapsed = performance.now() - launchScreenMountedAt
  const remainingDuration = Math.max(0, minimumLaunchScreenDurationMs - elapsed)

  window.setTimeout(() => {
    document.body.style.overflow = 'auto'
    splash.dataset.state = 'hidden'

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        splash.classList.add('is-hidden')
        window.setTimeout(() => splash.remove(), 260)
      })
    })
  }, remainingDuration)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App onReady={dismissLaunchScreen} />
  </StrictMode>,
)
