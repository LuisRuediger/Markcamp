// Composition root (ADR 0007): the only file allowed to import both adapters and ui.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createConsoleLogger } from './adapters/consoleLogger'
import { createFetchTransport } from './adapters/fetchTransport'
import { createFirebaseAuth } from './adapters/firebaseAuth'
import { createUuidV7Generator } from './adapters/uuidV7Generator'
import { createApiClient } from './core/apiClient'
import { parseFirebaseConfig } from './core/config'
import { createProjectsStore } from './core/projectsStore'
import { createSessionStore } from './core/sessionStore'
import App from './ui/App'
import ConfigErrorScreen from './ui/ConfigErrorScreen'
import './ui/styles.css'

// Same origin: through the Vite proxy in development, preferred in production (ADR 0007).
const API_BASE = '/api'

const root = createRoot(document.getElementById('root')!)

const firebaseConfig = parseFirebaseConfig({
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
})

if (firebaseConfig.ok) {
  const auth = createFirebaseAuth(firebaseConfig.config)
  const api = createApiClient(auth, createFetchTransport(API_BASE))
  const logger = createConsoleLogger()
  const store = createSessionStore(auth, api, logger)
  const projects = createProjectsStore(store, api, createUuidV7Generator(), logger)

  root.render(
    <StrictMode>
      <App store={store} projects={projects} />
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <ConfigErrorScreen missing={firebaseConfig.missing} />
    </StrictMode>,
  )
}
