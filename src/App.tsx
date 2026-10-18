import { useEffect, useState } from 'react'
import { api, getToken, setToken } from './api/client'
import type { Interview, User } from './api/types'
import { showOnGlasses } from './glasses/bridge'
import { glassesTexts } from './glasses/texts'
import { Auth } from './screens/Auth'
import { Briefing } from './screens/Briefing'
import { Clips } from './screens/Clips'
import { GlassesTest } from './screens/GlassesTest'
import { History } from './screens/History'
import { Home } from './screens/Home'
import { Live } from './screens/Live'
import { Results } from './screens/Results'
import { Mocky } from './components/ui'

export type Route =
  | { name: 'loading' }
  | { name: 'signIn' }
  | { name: 'signUp' }
  | { name: 'home' }
  | { name: 'briefing'; interview: Interview }
  | { name: 'live'; interview: Interview }
  | { name: 'results'; resultId: string }
  | { name: 'clips'; resultId: string; clipId?: string }
  | { name: 'history' }
  | { name: 'glassesTest' }

export type Nav = (route: Route) => void

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'loading' })
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    if (!getToken()) return setRoute({ name: 'signIn' })
    api
      .me()
      .then((me) => {
        setUser(me)
        setRoute({ name: 'home' })
      })
      .catch(() => {
        setToken(null)
        setRoute({ name: 'signIn' })
      })
  }, [])

  useEffect(() => {
    if (route.name === 'signIn' || route.name === 'signUp') showOnGlasses(glassesTexts.idle())
    window.scrollTo(0, 0)
  }, [route])

  const signOut = () => {
    setToken(null)
    setUser(null)
    setRoute({ name: 'signIn' })
  }

  switch (route.name) {
    case 'loading':
      return (
        <main className="screen stripes center" style={{ justifyContent: 'center' }}>
          <Mocky size={96} />
        </main>
      )
    case 'signIn':
    case 'signUp':
      return (
        <Auth
          mode={route.name}
          nav={setRoute}
          onSession={(session) => {
            setToken(session.token)
            setUser(session.user)
            setRoute({ name: 'home' })
          }}
        />
      )
    case 'home':
      return user && <Home user={user} onUser={setUser} nav={setRoute} onSignOut={signOut} />
    case 'briefing':
      return <Briefing interview={route.interview} nav={setRoute} />
    case 'live':
      return <Live interview={route.interview} nav={setRoute} />
    case 'results':
      return <Results resultId={route.resultId} nav={setRoute} />
    case 'clips':
      return <Clips resultId={route.resultId} clipId={route.clipId} nav={setRoute} />
    case 'history':
      return <History nav={setRoute} />
    case 'glassesTest':
      return <GlassesTest nav={setRoute} />
  }
}
