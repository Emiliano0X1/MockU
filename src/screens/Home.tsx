import { useRef, useState } from 'react'
import type { Nav } from '../App'
import { api } from '../api/client'
import type { User } from '../api/types'
import { icons, Logo, Mocky } from '../components/ui'
import { useGlassesStatus } from '../glasses/useGlassesStatus'

type Props = {
  user: User
  onUser: (user: User) => void
  nav: Nav
  onSignOut: () => void
}

export function Home({ user, onUser, nav, onSignOut }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const glasses = useGlassesStatus()
  const ready = user.hasResume && !uploading
  const firstName = user.name.split(' ')[0]

  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      onUser(await api.uploadResume(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that file. Try another PDF.")
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const start = async () => {
    setStarting(true)
    setError('')
    try {
      nav({ name: 'briefing', interview: await api.createInterview() })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the interview. Try again.")
      setStarting(false)
    }
  }

  return (
    <main className="screen stripes">
      <header className="row" style={{ justifyContent: 'space-between' }}>
        <Logo />
        <div className="row" style={{ gap: 10 }}>
          <button className="pill" onClick={() => nav({ name: 'history' })}>
            {icons.history}
            My mocks
          </button>
          <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Account" style={{ background: 'var(--ice-strong)' }}>
            <span className="display" style={{ fontSize: 15, color: 'var(--sky)' }}>
              {initials(user.name)}
            </span>
          </button>
        </div>
      </header>

      <section className="stack" style={{ gap: 6, paddingTop: 16 }}>
        <h1 className="h1" style={{ fontSize: 32, lineHeight: '38px' }}>
          {ready ? <>You're all set, {firstName}.<br />Pick your mock.</> : <>Hi {firstName}! First,<br />tell Mocky about you.</>}
        </h1>
        <p className="muted">
          {ready
            ? 'Mocky read your resume and built your profile. Swap it anytime.'
            : 'Your resume lets Mocky build your profile and pick questions about your real projects.'}
        </p>
      </section>

      <section style={{ position: 'relative', paddingTop: 40 }}>
        {!ready && <Mocky size={64} className="in" style={{ position: 'absolute', right: 14, top: 7 }} />}
        <input ref={fileInput} type="file" accept="application/pdf" hidden onChange={(e) => upload(e.target.files?.[0])} />
        <button className={`upload ${ready ? 'done' : ''}`} onClick={() => fileInput.current?.click()} disabled={uploading}>
          <span className="upload-icon">{ready ? icons.check() : icons.upload}</span>
          <span className="stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="display" style={{ fontSize: ready ? 17 : 19, color: ready ? 'var(--ink)' : 'var(--sky)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {uploading ? 'Mocky is reading…' : ready ? user.resumeFileName ?? 'Resume uploaded' : 'Upload your resume!'}
            </span>
            <span className="small">{ready ? `Profile ready${user.resumeSummary ? ` · ${user.resumeSummary}` : ''}` : 'PDF'}</span>
          </span>
        </button>
      </section>

      <section className="stack" style={{ gap: 14, paddingTop: 32, position: 'relative' }}>
        {ready && <Mocky size={52} className="in" style={{ position: 'absolute', right: 96, top: -2, transform: 'rotate(10deg)', zIndex: 1 }} />}
        <button className="start behavioral" disabled={!ready || starting} onClick={start}>
          <span className="stack" style={{ gap: 2 }}>
            <span className="title">Begin mock<br />behavioral</span>
            <span className="sub">{ready ? (starting ? 'Finding a company…' : 'About 30 min') : 'Upload a resume to unlock'}</span>
          </span>
          {icons.bigPlay}
        </button>
        <button className="start system" disabled>
          <span className="stack" style={{ gap: 2 }}>
            <span className="title">Begin mock<br />system design</span>
            <span className="sub">Coming soon</span>
          </span>
          {icons.bigPlay}
        </button>
      </section>

      {error && <p className="error" role="alert" style={{ paddingTop: 12 }}>{error}</p>}

      <div className="spacer" />

      <section className="row" style={{ gap: 10, paddingTop: 28 }}>
        <div className="chip">
          <span className={`dot ${glasses.connected ? 'on' : ''}`} />
          <span className="stack">
            <span style={{ fontWeight: 700, fontSize: 13 }}>Glasses</span>
            <span className="small" style={{ fontSize: 12 }}>
              {glasses.connected ? `Connected${glasses.battery != null ? ` · ${glasses.battery}%` : ''}` : glasses.available ? 'Not connected' : 'Open in Even app'}
            </span>
          </span>
        </div>
        <div className="chip">
          <span className="dot" />
          <span className="stack">
            <span style={{ fontWeight: 700, fontSize: 13 }}>Heart rate</span>
            <span className="small" style={{ fontSize: 12 }}>Via Pulsoid</span>
          </span>
        </div>
      </section>

      {menuOpen && (
        <div className="scrim" onClick={() => setMenuOpen(false)}>
          <div className="sheet rise" onClick={(e) => e.stopPropagation()}>
            <div className="stack" style={{ padding: '12px 0 8px' }}>
              <span style={{ fontWeight: 700 }}>{user.name}</span>
              <span className="small">{user.email}</span>
            </div>
            <button className="sheet-item" onClick={() => nav({ name: 'glassesTest' })}>
              {icons.glasses()}
              Test glasses texts
            </button>
            <button className="sheet-item" onClick={() => { setMenuOpen(false); fileInput.current?.click() }}>
              Replace resume
            </button>
            <button className="sheet-item" onClick={onSignOut} style={{ color: 'var(--bad-ink)' }}>
              Sign out
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}
