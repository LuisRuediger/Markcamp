import { useState, type FormEvent } from 'react'
import type { SessionNotice, SessionStore, SignInFailureKind } from '../core/sessionStore'
import { ptBR } from './i18n/pt-BR'

interface SignInScreenProps {
  store: SessionStore
  notice: SessionNotice | null
}

function SignInScreen({ store, notice }: SignInScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<SignInFailureKind | null>(null)

  async function run(attempt: () => Promise<SignInFailureKind | null>) {
    setPending(true)
    setFailure(null)
    setFailure(await attempt())
    setPending(false)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void run(() => store.signInWithEmail(email, password))
  }

  return (
    <main>
      <h1>{ptBR.appTitle}</h1>
      {notice === 'sessionExpired' && <p role="status">{ptBR.signIn.sessionExpired}</p>}
      <form onSubmit={handleSubmit}>
        <label>
          {ptBR.signIn.email}
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          {ptBR.signIn.password}
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" disabled={pending}>
          {ptBR.signIn.submit}
        </button>
      </form>
      <button type="button" disabled={pending} onClick={() => void run(store.signInWithGoogle)}>
        {ptBR.signIn.google}
      </button>
      {failure !== null && <p role="alert">{ptBR.signIn.errors[failure]}</p>}
    </main>
  )
}

export default SignInScreen
