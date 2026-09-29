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
      mockDb({
        message_type: 'text', message_content: '続けますか？', question_json: latest,
        // 独立審査(指摘3): 公開済みかつ送り先と同じ持ち主だけ送る。
        // 持ち主不明は送らない(fail-close)。
        published_version: 1, line_account_id: 'account-1',
      }),
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
      'account-1',
    )

    expect(result.questionJson).toBe(latest)
    expect(result.templateIdAtSend).toBe('question-template-1')
  })
})
