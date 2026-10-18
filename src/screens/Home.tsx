import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Nav } from '../App'
import { api, errorMessage, getCompanies } from '../api/client'
import type { ExperienceLevel, Profile, ResumeInfo } from '../api/types'
import { icons, Logo, Mocky } from '../components/ui'
import { setGlassesLabel, showOnGlasses } from '../glasses/bridge'
import { glassesTexts, tiltLabel } from '../glasses/texts'
import { recalibrateTilt, watchTilt } from '../glasses/tilt'
import { useGlassesStatus } from '../glasses/useGlassesStatus'
import { LevelPicker, levelNames } from './Setup'

type Props = {
  profile: Profile
  resume: ResumeInfo | null
  onProfile: (profile: Profile) => void
  onResume: (resume: ResumeInfo | null) => void
  nav: Nav
  onSignOut: () => void
}

export function Home({ profile, resume, onProfile, onResume, nav, onSignOut }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [sheet, setSheet] = useState<'menu' | 'profile' | 'removeResume' | null>(null)
  const glasses = useGlassesStatus()
  const server = useServerStatus()
  const ready = resume !== null && !uploading
  const firstName = profile.full_name.split(' ')[0] ?? profile.full_name

  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const { text_preview: _preview, ...info } = await api.uploadResume(profile.id, file)
      onResume(info)
    } catch (err) {
      setError(errorMessage(err, "Couldn't read that file. Try another PDF."))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const removeResume = async () => {
    setSheet(null)
    setError('')
    try {
      await api.deleteResume(profile.id)
      onResume(null)
    } catch (err) {
      setError(errorMessage(err, "Couldn't remove your resume."))
    }
  }

  // Mocky picks a random company from the server's catalog.
  const start = async () => {
    setStarting(true)
    setError('')
    try {
      const companies = await getCompanies()
      if (companies.length === 0) throw new Error('No companies are set up on the server yet.')
      nav({ name: 'briefing', company: companies[Math.floor(Math.random() * companies.length)]! })
    } catch (err) {
      setError(errorMessage(err, "Couldn't start the interview. Try again."))
      setStarting(false)
    }
  }

  // Welcome screen in the glasses; tilting left/right and holding picks a mock.
  const startRef = useRef(start)
  startRef.current = start
  useEffect(() => {
    if (starting) return
    if (!ready) {
      showOnGlasses(glassesTexts.welcomeNeedsResume(firstName))
      return
    }
    const welcome = glassesTexts.welcome(firstName)
    showOnGlasses(welcome)
    let lastLabel = welcome.label
    let resetTimer: ReturnType<typeof setTimeout> | undefined
    const setLabel = (label: string) => {
      if (label === lastLabel) return
      lastLabel = label
      setGlassesLabel(label)
    }
    const stop = watchTilt({
      onLean: (side, progress) => setLabel(side ? tiltLabel(side, progress) : welcome.label),
      onChoose: (side) => {
        if (side === 'left') return startRef.current()
        showOnGlasses(glassesTexts.systemDesignSoon())
        resetTimer = setTimeout(() => {
          lastLabel = welcome.label
          showOnGlasses(welcome)
        }, 2500)
      },
    })
    return () => {
      clearTimeout(resetTimer)
      stop.then((fn) => fn())
    }
  }, [ready, starting, firstName])

  return (
    <main className="screen stripes">
      <header className="row" style={{ justifyContent: 'space-between' }}>
        <Logo />
        <div className="row" style={{ gap: 10 }}>
          <button className="pill" onClick={() => nav({ name: 'history' })}>
            {icons.history}
            My mocks
          </button>
          <button className="icon-btn" onClick={() => setSheet('menu')} aria-label="Account" style={{ background: 'var(--ice-strong)' }}>
            <span className="display" style={{ fontSize: 15, color: 'var(--sky)' }}>
              {initials(profile.full_name)}
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
              {uploading ? 'Mocky is reading…' : ready ? resume.original_filename : 'Upload your resume!'}
            </span>
            <span className="small">{ready ? `Profile ready · ${levelNames[profile.experience_level]}` : 'PDF, up to 5 MB'}</span>
          </span>
        </button>
      </section>

      <section className="stack" style={{ gap: 14, paddingTop: 32, position: 'relative' }}>
        {ready && <Mocky size={52} className="in" style={{ position: 'absolute', right: 96, top: -2, transform: 'rotate(10deg)', zIndex: 1 }} />}
        <button className="start behavioral" disabled={!ready || starting} onClick={start}>
          <span className="stack" style={{ gap: 2 }}>
            <span className="title">Begin mock<br />behavioral</span>
            <span className="sub">{ready ? (starting ? 'Finding a company…' : 'About 20 min') : 'Upload a resume to unlock'}</span>
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

      {ready && glasses.available && (
        <div className="stack" style={{ alignItems: 'center', gap: 8, paddingTop: 12 }}>
          <p className="small" style={{ textAlign: 'center' }}>Or tilt your head and hold in the glasses.</p>
          <button className="pill" onClick={recalibrateTilt}>Recalibrate tilt (hold head straight)</button>
        </div>
      )}
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
          <span className={`dot ${server === 'ok' ? 'on' : ''}`} />
          <span className="stack">
            <span style={{ fontWeight: 700, fontSize: 13 }}>Server</span>
            <span className="small" style={{ fontSize: 12 }}>
              {server === 'checking' ? 'Checking…' : server === 'ok' ? 'Online' : server === 'degraded' ? 'Database down' : 'Offline'}
            </span>
          </span>
        </div>
      </section>

      {sheet && (
        <div className="scrim" onClick={() => setSheet(null)}>
          <div className="sheet rise" onClick={(e) => e.stopPropagation()}>
            {sheet === 'menu' && (
              <>
                <div className="stack" style={{ padding: '12px 0 8px' }}>
                  <span style={{ fontWeight: 700 }}>{profile.full_name}</span>
                  <span className="small">{levelNames[profile.experience_level]}</span>
                </div>
                <button className="sheet-item" onClick={() => setSheet('profile')}>Edit profile</button>
                <button className="sheet-item" onClick={() => { setSheet(null); fileInput.current?.click() }}>
                  {resume ? 'Replace resume' : 'Upload resume'}
                </button>
                {resume && <button className="sheet-item" onClick={() => setSheet('removeResume')}>Remove resume</button>}
                <button className="sheet-item" onClick={() => nav({ name: 'glassesTest' })}>
                  {icons.glasses()}
                  Test glasses texts
                </button>
                <button className="sheet-item" onClick={onSignOut} style={{ color: 'var(--bad-ink)' }}>
                  Switch profile
                </button>
              </>
            )}
            {sheet === 'profile' && <EditProfile profile={profile} onSaved={(p) => { onProfile(p); setSheet(null) }} />}
            {sheet === 'removeResume' && (
              <div className="stack" style={{ gap: 12, paddingTop: 12 }}>
                <h2 className="h2">Remove your resume?</h2>
                <p className="muted">Mocky deletes the file from the server. You'll need a new one to start a mock.</p>
                <button className="btn" style={{ background: 'var(--bad)' }} onClick={removeResume}>Remove resume</button>
                <button className="btn ghost" onClick={() => setSheet(null)}>Keep it</button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}

function EditProfile({ profile, onSaved }: { profile: Profile; onSaved: (profile: Profile) => void }) {
  const [name, setName] = useState(profile.full_name)
  const [level, setLevel] = useState<ExperienceLevel>(profile.experience_level)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSaved(await api.updateProfile(profile.id, { full_name: name.trim(), experience_level: level }))
    } catch (err) {
      setError(errorMessage(err, "Couldn't save your profile."))
      setBusy(false)
    }
  }

  return (
    <form className="stack" style={{ gap: 12, paddingTop: 12 }} onSubmit={save}>
      <h2 className="h2">Your profile</h2>
      <div className="field">
        <label htmlFor="edit-name">Your name</label>
        <input id="edit-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <LevelPicker value={level} onChange={setLevel} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  )
}

type ServerStatus = 'checking' | 'ok' | 'degraded' | 'offline'

function useServerStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>('checking')
  useEffect(() => {
    let cancelled = false
    api
      .health()
      .then((health) => !cancelled && setStatus(health.database === 'ok' ? 'ok' : 'degraded'))
      .catch((err) => !cancelled && setStatus((err as { status?: number }).status === 503 ? 'degraded' : 'offline'))
    return () => {
      cancelled = true
    }
  }, [])
  return status
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}
