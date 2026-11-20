import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyAccent, loadAccent } from './state/theme'

// Before the first render, so the page never flashes the default accent.
applyAccent(loadAccent())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
