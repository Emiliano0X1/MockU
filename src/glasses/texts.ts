import type { GlassesView } from './bridge'

// Every view the glasses can show during the app, in flow order.
// Kept deliberately short: no question counts, no timers.
export const glassesTexts = {
  idle: (): GlassesView => ({ mocky: false, label: 'MockU', text: 'Ready when you are. Start on your phone.' }),
  briefing: (company: string): GlassesView => ({
    mocky: false,
    label: 'Briefing',
    text: `Read about ${company} on your phone. Mocky will be here when you're ready.`,
  }),
  starting: (): GlassesView => ({ mocky: false, label: '', text: 'Get comfortable. The first question is coming.' }),
  question: (text: string): GlassesView => ({ mocky: true, label: 'Mocky asks', text }),
  followUp: (text: string): GlassesView => ({ mocky: true, label: 'Follow-up', text }),
  finalRound: (): GlassesView => ({ mocky: true, label: 'Final round', text: "Mocky stays with you until the end." }),
  finalQuestion: (text: string): GlassesView => ({ mocky: true, label: 'Final round', text }),
  answerReceived: (): GlassesView => ({ mocky: false, label: '', text: 'Got it. Take a breath.' }),
  finalAnswerReceived: (): GlassesView => ({ mocky: true, label: 'Final round', text: 'Got it.' }),
  analyzing: (): GlassesView => ({ mocky: true, label: "That's the interview", text: 'Mocky is reviewing your answers.' }),
  done: (): GlassesView => ({ mocky: false, label: 'Done', text: 'Your results are on your phone.' }),
}

// Sample content for the glasses test screen.
export const glassesTestCases: { name: string; view: GlassesView }[] = [
  { name: 'Idle', view: glassesTexts.idle() },
  { name: 'Briefing', view: glassesTexts.briefing('Tidewater') },
  { name: 'Interview starting', view: glassesTexts.starting() },
  { name: 'Question', view: glassesTexts.question('Tell me about a time you disagreed with a teammate.') },
  { name: 'Follow-up', view: glassesTexts.followUp('What did you decide yourself in that situation?') },
  { name: 'Answer received', view: glassesTexts.answerReceived() },
  { name: 'Final round starts', view: glassesTexts.finalRound() },
  { name: 'Final round question', view: glassesTexts.finalQuestion('What is your biggest professional failure?') },
  { name: 'Final answer received', view: glassesTexts.finalAnswerReceived() },
  { name: 'Reviewing', view: glassesTexts.analyzing() },
  { name: 'Done', view: glassesTexts.done() },
]
