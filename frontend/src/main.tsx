// Composition root (ADR 0007): the only file allowed to import both adapters and ui.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ui/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
