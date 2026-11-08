import type { BackendState, SessionStore } from '../core/sessionStore'
import { ptBR } from './i18n/pt-BR'

interface HomeScreenProps {
  store: SessionStore
  email: string | null
  backend: BackendState
}

const BACKEND_TEXT: Record<BackendState, string> = {
  checking: ptBR.home.backendChecking,
  ok: ptBR.home.backendOk,
  unavailable: ptBR.home.backendUnavailable,
}

function HomeScreen({ store, email, backend }: HomeScreenProps) {
  return (
    <main>
      <h1>{ptBR.appTitle}</h1>
      <p>{email === null ? ptBR.home.signedIn : ptBR.home.signedInAs(email)}</p>
      <p role="status">{BACKEND_TEXT[backend]}</p>
      <button type="button" onClick={() => void store.signOut()}>
        {ptBR.home.signOut}
      </button>
    </main>
  )
}

export default HomeScreen
