import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage, getProfileId, setProfileId } from './api/client'
import type { Company, Profile, ResumeInfo, SessionCreated } from './api/types'
import { showOnGlasses } from './glasses/bridge'
import { glassesTexts } from './glasses/texts'
import { Briefing } from './screens/Briefing'
import { GlassesTest } from './screens/GlassesTest'
import { History } from './screens/History'
import { Home } from './screens/Home'
import { Live } from './screens/Live'
import { Moment } from './screens/Moment'
import { Results } from './screens/Results'
import { Setup } from './screens/Setup'
import { Mocky } from './components/ui'

export type Route =
  | { name: 'loading' }
  | { name: 'setup' }
  | { name: 'home' }
  | { name: 'briefing'; company: Company }
  | { name: 'live'; session: SessionCreated; company: Company }
  | { name: 'results'; sessionId: string }
  | { name: 'moment'; sessionId: string; findingId: string }
  | { name: 'history' }
  | { name: 'glassesTest' }

export type Nav = (route: Route) => void

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'loading' })
  const [profile, setProfile] = useState<Profile | null>(null)
  const [resume, setResume] = useState<ResumeInfo | null>(null)
  const [loadError, setLoadError] = useState('')

  // Restore the saved profile, or ask who this is.
  const restore = useCallback(async () => {
    setLoadError('')
    const id = getProfileId()
    if (!id) return setRoute({ name: 'setup' })
    try {
      const [me, cv] = await Promise.all([api.getProfile(id), api.getResume(id)])
      setProfile(me)
      setResume(cv)
      setRoute({ name: 'home' })
    } catch (err) {
      // The profile no longer exists on the server (or the mock reset): ask again.
      if ((err as { status?: number }).status === 404) {
        setProfileId(null)
        return setRoute({ name: 'setup' })
      }
      setLoadError(errorMessage(err, "Couldn't load your profile."))
    }
  }, [])

  useEffect(() => {
    restore()
  }, [restore])

  useEffect(() => {
    if (route.name === 'setup') showOnGlasses(glassesTexts.idle())
    window.scrollTo(0, 0)
  }, [route])

  const signOut = () => {
    setProfileId(null)
    setProfile(null)
    setResume(null)
    setRoute({ name: 'setup' })
  }

  switch (route.name) {
    case 'loading':
      return (
        <main className="screen stripes center" style={{ justifyContent: 'center', gap: 12 }}>
          <Mocky size={96} />
          {loadError && (
            <>
              <p className="error" role="alert">{loadError}</p>
              <button className="btn" onClick={restore}>Try again</button>
              <button className="btn ghost" onClick={signOut}>Start over</button>
            </>
          )}
        </main>
      )
    case 'setup':
      return (
        <Setup
          onProfile={(created) => {
            setProfileId(created.id)
            setProfile(created)
            setResume(null)
            setRoute({ name: 'home' })
          }}
        />
      )
    case 'home':
      return (
        profile && (
          <Home profile={profile} resume={resume} onProfile={setProfile} onResume={setResume} nav={setRoute} onSignOut={signOut} />
        )
      )
    case 'briefing':
      return profile && resume && <Briefing company={route.company} profile={profile} resume={resume} nav={setRoute} />
    case 'live':
      return <Live session={route.session} company={route.company} nav={setRoute} />
    case 'results':
      return <Results sessionId={route.sessionId} nav={setRoute} />
    case 'moment':
      return <Moment sessionId={route.sessionId} findingId={route.findingId} nav={setRoute} />
    case 'history':
      return profile && <History profileId={profile.id} nav={setRoute} />
    case 'glassesTest':
      return <GlassesTest nav={setRoute} />
  }
}
