import type { GlassesView } from './bridge'

// Every view the glasses can show during the app, in flow order.
// Kept deliberately short: no question counts, no timers.
export const glassesTexts = {
  idle: (): GlassesView => ({ mocky: false, label: 'MockU', text: 'Ready when you are. Start on your phone.' }),
  welcome: (name: string): GlassesView => ({
    mocky: true,
    label: `Welcome, ${name}`,
    text: '< Behavioral       System design >\nTilt your head and hold to choose.',
  }),
  welcomeNeedsResume: (name: string): GlassesView => ({
    mocky: true,
    label: `Welcome, ${name}`,
    text: 'Upload your resume on your phone first.',
  }),
  systemDesignSoon: (): GlassesView => ({ mocky: true, label: 'System design', text: 'Coming soon. Tilt left for Behavioral.' }),
  briefing: (company: string): GlassesView => ({
    mocky: false,
    label: 'Briefing',
    text: `Read about ${company} on your phone. Mocky will be here when you're ready.`,
  }),
  starting: (): GlassesView => ({ mocky: false, label: '', text: 'Get comfortable. The first question is coming.' }),
  question: (text: string): GlassesView => ({ mocky: true, label: 'Mocky asks', text }),
  answerReceived: (): GlassesView => ({ mocky: false, label: '', text: 'Got it. Take a breath.' }),
  analyzing: (): GlassesView => ({ mocky: true, label: "That's the interview", text: 'Mocky is reviewing your answers.' }),
  done: (): GlassesView => ({ mocky: false, label: 'Done', text: 'Your results are on your phone.' }),
}

// Label line while the server's heart-rate tip is showing, e.g. "<3 Take a slow breath".
export function tipLabel(text: string) {
  return `<3 ${text}`
}

// Sample content for the glasses test screen.
export const glassesTestCases: { name: string; view: GlassesView }[] = [
  { name: 'Idle', view: glassesTexts.idle() },
  { name: 'Welcome (no resume)', view: glassesTexts.welcomeNeedsResume('Alex') },
  { name: 'Welcome', view: glassesTexts.welcome('Alex') },
  { name: 'Welcome, holding left', view: { ...glassesTexts.welcome('Alex'), label: tiltLabel('left', 0.6) } },
  { name: 'System design tilt', view: glassesTexts.systemDesignSoon() },
  { name: 'Briefing', view: glassesTexts.briefing('Tidewater') },
  { name: 'Interview starting', view: glassesTexts.starting() },
  { name: 'Question', view: glassesTexts.question('Tell me about a time you disagreed with a teammate.') },
  { name: 'Countdown', view: { ...glassesTexts.question('Tell me about a time you disagreed with a teammate.'), label: countdownLabel(3) } },
  { name: 'Countdown GO', view: { ...glassesTexts.question('Tell me about a time you disagreed with a teammate.'), label: countdownLabel(0) } },
  { name: 'Heart-rate tip', view: { ...glassesTexts.question('Tell me about a time you disagreed with a teammate.'), label: tipLabel('Take a slow breath') } },
  { name: 'Answer received', view: glassesTexts.answerReceived() },
  { name: 'Reviewing', view: glassesTexts.analyzing() },
  { name: 'Done', view: glassesTexts.done() },
]

// Label line while a tilt is held: "Behavioral  [###--]".
export function tiltLabel(side: 'left' | 'right', progress: number) {
  const filled = Math.round(progress * 5)
  const name = side === 'left' ? 'Behavioral' : 'System design'
  return `${name}  [${'#'.repeat(filled)}${'-'.repeat(5 - filled)}]`
}

// Label line during the countdown before an answer: 5, 4, 3, 2, 1, GO.
export function countdownLabel(secondsLeft: number) {
  return secondsLeft > 0 ? `Answer in ${secondsLeft}` : 'GO'
}
