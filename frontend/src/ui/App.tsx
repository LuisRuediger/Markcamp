import { useSyncExternalStore } from 'react'
import type { SessionStore } from '../core/sessionStore'
import HomeScreen from './HomeScreen'
import { ptBR } from './i18n/pt-BR'
import SignInScreen from './SignInScreen'

interface AppProps {
  store: SessionStore
}

function App({ store }: AppProps) {
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot)

  switch (session.status) {
    case 'loading':
      return (
        <main>
          <p>{ptBR.loading}</p>
        </main>
      )
    case 'signedOut':
      return <SignInScreen store={store} notice={session.notice} />
    case 'signedIn':
      return <HomeScreen store={store} email={session.email} backend={session.backend} />
  }
}

export default App
