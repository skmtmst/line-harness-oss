export type Step = 'choose' | 'create' | 'api' | 'credentials' | 'verify' | 'done'
export type Choice = 'existing' | 'new' | null

export function resolveStep(requested: Step, state: { choice: Choice; createdOfficial: boolean; apiEnabled: boolean; channelId: string; channelSecret: string; connected: unknown }): Step {
  if (requested === 'create' && state.choice !== 'new') return 'choose'
  if (requested === 'api' && !state.choice) return 'choose'
  if (requested === 'api' && state.choice === 'new' && !state.createdOfficial) return 'create'
  if (requested === 'credentials' && !state.apiEnabled) return 'api'
  if (requested === 'verify' && (!state.channelId.trim() || !state.channelSecret.trim())) return 'credentials'
  if (requested === 'done' && !state.connected) return 'choose'
  return requested
}
