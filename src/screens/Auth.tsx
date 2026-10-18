import { useState, type FormEvent } from 'react'
import type { Nav } from '../App'
import { api } from '../api/client'
import type { Session } from '../api/types'
import { Logo, Mocky } from '../components/ui'

type Props = {
  mode: 'signIn' | 'signUp'
  nav: Nav
  onSession: (session: Session) => void
}

export function Auth({ mode, nav, onSession }: Props) {
  const signUp = mode === 'signUp'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSession(signUp ? await api.signUp(name.trim(), email.trim(), password) : await api.signIn(email.trim(), password))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="screen stripes">
      <div className="stack center" style={{ gap: 4, paddingTop: 24 }}>
        <Logo width={signUp ? 150 : 190} />
        <Mocky size={signUp ? 104 : 140} style={{ transform: `rotate(${signUp ? 8 : -6}deg)`, margin: '8px 0' }} />
        <h1 className="h1">{signUp ? <>Let's get you<br />interview-ready.</> : <>Find your weak spots<br />before they do.</>}</h1>
        <p className="muted">{signUp ? 'Create your account.' : 'Behavioral mock interviews with Mocky.'}</p>
      </div>

      <form className="stack" style={{ gap: 12, paddingTop: 24 }} onSubmit={submit}>
        {signUp && (
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={signUp ? 'new-password' : 'current-password'}
            required
            minLength={signUp ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" type="submit" disabled={busy} style={{ marginTop: 4 }}>
          {busy ? 'One moment…' : signUp ? 'Create account' : 'Sign in'}
        </button>
        <p className="muted" style={{ textAlign: 'center', paddingTop: 6 }}>
          {signUp ? 'Already have one? ' : 'New here? '}
          <button type="button" className="link" onClick={() => nav({ name: signUp ? 'signIn' : 'signUp' })}>
            {signUp ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </form>
    </main>
  )
}
