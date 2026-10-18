import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api/client'
import { API_URL, USE_MOCK } from '../api/config'
import type { ExperienceLevel, Profile } from '../api/types'
import { Logo, Mocky } from '../components/ui'

export const levelNames: Record<ExperienceLevel, string> = { intern: 'Intern', new_grad: 'New grad' }

// First run: the server has no login, so we only ask who this is.
export function Setup({ onProfile }: { onProfile: (profile: Profile) => void }) {
  const [name, setName] = useState('')
  const [level, setLevel] = useState<ExperienceLevel | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!level) return setError('Pick the role you are interviewing for.')
    setBusy(true)
    setError('')
    // DEBUG: remove once profile creation is confirmed against the real server.
    console.log('[setup] creating profile', { full_name: name.trim(), experience_level: level, server: USE_MOCK ? 'mock' : API_URL })
    try {
      const profile = await api.createProfile(name.trim(), level)
      console.log('[setup] profile created', profile)
      onProfile(profile)
    } catch (err) {
      console.error('[setup] profile creation failed', err)
      setError(errorMessage(err, 'Something went wrong. Try again.'))
      setBusy(false)
    }
  }

  return (
    <main className="screen stripes">
      <div className="stack center" style={{ gap: 4, paddingTop: 24 }}>
        <Logo width={170} />
        <Mocky size={120} style={{ transform: 'rotate(-6deg)', margin: '8px 0' }} />
        <h1 className="h1">Find your weak spots<br />before they do.</h1>
        <p className="muted">Behavioral mock interviews with Mocky.</p>
      </div>

      <form className="stack" style={{ gap: 12, paddingTop: 24 }} onSubmit={submit}>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Interviewing as</span>
          <LevelPicker value={level} onChange={setLevel} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" type="submit" disabled={busy || !name.trim()} style={{ marginTop: 4 }}>
          {busy ? 'One moment…' : 'Meet Mocky'}
        </button>
        {/* DEBUG: which server this build talks to. */}
        <p className="small" style={{ textAlign: 'center', fontSize: 11 }}>
          Server: {USE_MOCK ? 'built-in mock (VITE_API_URL is empty)' : API_URL}
        </p>
      </form>
    </main>
  )
}

export function LevelPicker({ value, onChange }: { value: ExperienceLevel | null; onChange: (level: ExperienceLevel) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {(Object.keys(levelNames) as ExperienceLevel[]).map((level) => (
        <button key={level} type="button" role="radio" aria-checked={value === level} className={value === level ? 'on' : ''} onClick={() => onChange(level)}>
          {levelNames[level]}
        </button>
      ))}
    </div>
  )
}
