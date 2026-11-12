// Composition root (ADR 0007): the only file allowed to import both adapters and ui.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserLifecycle } from './adapters/browserLifecycle'
import { createBrowserTimers } from './adapters/browserTimers'
import { createConsoleLogger } from './adapters/consoleLogger'
import { createDexieLocalAccounts } from './adapters/dexieLocalAccounts'
import { openDexieLocalStore } from './adapters/dexieLocalStore'
import { isInstalledApp } from './adapters/displayMode'
import { createFetchTransport } from './adapters/fetchTransport'
import { createFirebaseAuth } from './adapters/firebaseAuth'
import { createStoragePersistence } from './adapters/storagePersistence'
import { createUuidV7Generator } from './adapters/uuidV7Generator'
import { createApiClient } from './core/apiClient'
import { parseFirebaseConfig } from './core/config'
import { createLocalCommands } from './core/localCommands'
import { createLocalSession } from './core/localSession'
import { createSessionStore } from './core/sessionStore'
import { createSyncEngine } from './core/syncEngine'
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
  const timers = createBrowserTimers()

  // Opens each session's local database and runs the sync engine over it (ADR 0008). The
  // screens read and write only through it.
  const local = createLocalSession({
    session: store,
    accounts: createDexieLocalAccounts(),
    openStore: (userId) => openDexieLocalStore(userId, logger),
    createSync: (local) => createSyncEngine({ api, store: local, timers, logger }),
    lifecycle: createBrowserLifecycle(),
    persistence: createStoragePersistence(),
    logger,
  })
  const commands = createLocalCommands(local, createUuidV7Generator())
  // Once per run: installing opens another window (Android) or another storage (iOS).
  const installed = isInstalledApp()

  root.render(
    <StrictMode>
      <App store={store} local={local} commands={commands} installed={installed} />
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <ConfigErrorScreen missing={firebaseConfig.missing} />
    </StrictMode>,
  )
}
