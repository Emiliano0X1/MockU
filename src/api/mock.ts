// In-browser stand-in for the Python server, used when VITE_API_URL is not set.
// Mirrors the real contract so screens can be built and demoed without a backend.
import type { LiveCommand, LiveEvent, Question, Result, User, HistoryItem, Interview } from './types'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let user: User = {
  id: 'mock-user',
  name: 'Alex Rivera',
  email: 'alex.rivera@gmail.com',
  hasResume: false,
}

const interview: Interview = {
  id: 'mock-interview',
  briefingSeconds: 5 * 60,
  timeLimitSeconds: 30 * 60,
  company: {
    name: 'Tidewater',
    tagline: 'Logistics software · Series C · 420 people',
    about:
      'Tidewater builds routing software that helps 3,000+ regional carriers move freight with fewer empty miles. Engineering is split into small teams that each own one product.',
    values: ['Own the outcome', 'Say it plainly', 'Ship, then sharpen', 'Drivers first'],
    projects: [
      { name: 'Live ETA engine', description: 'Rebuilding arrival predictions on streaming GPS data.' },
      { name: 'Driver mobile app v3', description: 'Offline-first redesign for rural routes.' },
      { name: 'Carbon reporting', description: 'Emissions dashboards for enterprise shippers.' },
    ],
    tip: "Your resume's offline-sync project maps well to Driver app v3. Have that story ready.",
  },
}

const script: (Question | 'final_round')[] = [
  { id: 'q1', kind: 'general', text: 'Walk me through your resume and what brought you to Tidewater.' },
  { id: 'q2', kind: 'general', text: 'Tell me about a time you disagreed with a teammate.' },
  { id: 'q3', kind: 'followup', text: 'What did you decide yourself in that situation?' },
  { id: 'q4', kind: 'general', text: 'Describe a project where you had to ship with incomplete information.' },
  'final_round',
  { id: 'q5', kind: 'final', text: 'What is your biggest professional failure?' },
  { id: 'q6', kind: 'final', text: 'Why should we pick you for the Driver app team?' },
]

const result: Result = {
  id: 'mock-result',
  interviewId: interview.id,
  companyName: 'Tidewater',
  createdAt: new Date().toISOString(),
  durationSeconds: 24 * 60,
  score: 72,
  scoreDelta: 9,
  headline: 'Your stories land. You hesitate on the easy questions.',
  signals: [
    { key: 'pauses', label: 'Long pauses', detail: '6 over 3s, 4 of them on easy questions', severity: 4, clipIds: ['c1'] },
    { key: 'fillers', label: 'Filler words', detail: '"um" ×14 · "like" ×9 · "so…" ×7', severity: 3, clipIds: ['c2'] },
    { key: 'restarts', label: 'Restarts & repeats', detail: '8 restarted sentences, 2 changed stories', severity: 2, clipIds: ['c2'] },
    { key: 'voice', label: 'Shaky or high voice', detail: 'Pitch rose on two answers, pulse peaked at 112', severity: 2, clipIds: ['c3'] },
    { key: 'pace', label: 'Unusual pace', detail: 'Rushed one answer at 182 wpm', severity: 1, clipIds: ['c3'] },
    { key: 'off_topic', label: 'Off-topic, no point', detail: 'Drifted for 48s before the result', severity: 3, clipIds: ['c2'] },
  ],
  strengths:
    'Your offline-sync story was clear and had numbers: "cut sync failures 40%". It matched Tidewater\'s "Drivers first" value.',
  weaknesses:
    'On conflict questions you set up context for too long and said "we" instead of what you did. Open with the decision, then the why.',
  clips: [
    {
      id: 'c2',
      signal: 'off_topic',
      questionText: 'Tell me about a time you disagreed with a teammate.',
      audioUrl: '',
      durationSeconds: 78,
      marks: [
        { start: 10, end: 14, signal: 'pauses', label: '4.1s pause' },
        { start: 28, end: 76, signal: 'off_topic', label: 'Drift' },
      ],
      transcript: [
        { text: 'So' },
        { text: 'um…', tag: 'filler' },
        { text: '4.1s', tag: 'pause' },
        { text: 'at my internship we' },
        { text: 'we, like,', tag: 'filler' },
        { text: 'had this sprint, and' },
        { text: 'the team also used Jira, and our standups were at 9…', tag: 'drift' },
      ],
      suggestion: '"I pushed back on a launch date because the offline mode wasn\'t safe for drivers."',
    },
    {
      id: 'c1',
      signal: 'pauses',
      questionText: 'Walk me through your resume.',
      audioUrl: '',
      durationSeconds: 14,
      marks: [{ start: 2, end: 7, signal: 'pauses', label: '5.0s pause' }],
      transcript: [{ text: 'Sure, so' }, { text: '5.0s', tag: 'pause' }, { text: 'I study computer science…' }],
      suggestion: 'Have a 20-second opener ready: school, one project, why this company.',
    },
    {
      id: 'c3',
      signal: 'voice',
      questionText: 'What is your biggest professional failure?',
      audioUrl: '',
      durationSeconds: 31,
      marks: [{ start: 4, end: 19, signal: 'voice', label: 'Pitch up' }],
      transcript: [{ text: 'I think my biggest failure was' }, { text: 'when I, when I', tag: 'restart' }, { text: 'missed a deadline…' }],
      suggestion: 'Slow down on the first sentence; your pace settles once you start the story.',
    },
  ],
}

const history: HistoryItem[] = [
  { resultId: 'mock-result', companyName: 'Tidewater', createdAt: new Date().toISOString(), score: 72, topSignal: 'Long pauses' },
  { resultId: 'mock-result', companyName: 'Lumen Bank', createdAt: '2026-10-12T15:00:00Z', score: 63, topSignal: 'Filler words' },
  { resultId: 'mock-result', companyName: 'Orbit Health', createdAt: '2026-10-08T15:00:00Z', score: 66, topSignal: 'Off-topic answers' },
  { resultId: 'mock-result', companyName: 'Fernway', createdAt: '2026-10-03T15:00:00Z', score: 58, topSignal: 'Shaky voice' },
  { resultId: 'mock-result', companyName: 'Pebble Games', createdAt: '2026-09-27T15:00:00Z', score: 51, topSignal: 'Filler words' },
]

export const mockApi = {
  async signUp(name: string, email: string, _password: string) {
    await wait(400)
    user = { ...user, name, email, hasResume: false }
    return { token: 'mock-token', user }
  },
  async signIn(email: string, _password: string) {
    await wait(400)
    user = { ...user, email }
    return { token: 'mock-token', user }
  },
  async me() {
    return user
  },
  async uploadResume(file: File) {
    await wait(1200)
    user = { ...user, hasResume: true, resumeFileName: file.name, resumeSummary: '4 projects · 2 internships' }
    return user
  },
  async createInterview() {
    await wait(500)
    return interview
  },
  async uploadAnswer(_interviewId: string, _questionId: string, _wav: Blob) {
    await wait(300)
  },
  async result(_resultId: string) {
    await wait(300)
    return result
  },
  async history() {
    await wait(300)
    return history
  },
}

export function mockLive(onEvent: (event: LiveEvent) => void) {
  let step = 0
  let closed = false
  let bpm = 74
  const emit = (event: LiveEvent) => !closed && onEvent(event)

  const pulse = setInterval(() => {
    bpm = Math.max(64, Math.min(118, bpm + Math.round((Math.random() - 0.4) * 4)))
    emit({ type: 'heart_rate', bpm })
  }, 2000)

  const next = (delay: number) =>
    setTimeout(() => {
      const item = script[step++]
      if (!item) return finish()
      if (item === 'final_round') {
        emit({ type: 'final_round' })
        return next(2500)
      }
      emit({ type: 'question', question: item })
    }, delay)

  const finish = () => {
    emit({ type: 'analyzing' })
    setTimeout(() => emit({ type: 'completed', resultId: result.id }), 2500)
  }

  return {
    send(command: LiveCommand) {
      if (command.type === 'ready') next(2500)
      if (command.type === 'answer_uploaded') next(3000)
      if (command.type === 'finish') finish()
    },
    close() {
      closed = true
      clearInterval(pulse)
    },
  }
}
