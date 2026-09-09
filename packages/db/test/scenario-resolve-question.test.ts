import { describe, expect, it } from 'vitest'
import { resolveStepContent } from '../src/scenario-resolve.js'

function mockDb(row: Record<string, unknown> | null): D1Database {
  return {
    prepare: () => ({
      bind: () => ({ first: async () => row }),
    }),
  } as unknown as D1Database
}

describe('resolveStepContent question template', () => {
  it('uses the latest template question while preserving the step copy as fallback', async () => {
    const latest = JSON.stringify({
      text: '続けますか？',
      tapMode: 'single',
      choices: [{ label: 'はい', behavior: 'none' }],
    })
    const result = await resolveStepContent(
      mockDb({ message_type: 'text', message_content: '続けますか？', question_json: latest }),
      {
        template_id: 'question-template-1',
        message_type: 'text',
        message_content: '古い質問',
        question_json: JSON.stringify({
          text: '古い質問',
          tapMode: 'single',
          choices: [{ label: 'はい', behavior: 'none' }],
        }),
      },
    )

    expect(result.questionJson).toBe(latest)
    expect(result.templateIdAtSend).toBe('question-template-1')
  })
})
