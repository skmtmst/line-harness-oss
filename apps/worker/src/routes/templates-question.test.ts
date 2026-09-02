import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index.js'

const mocks = vi.hoisted(() => ({
  getTemplatesWithUsageCount: vi.fn(),
  getTemplateById: vi.fn(),
  getTemplateUsage: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  getCarouselTapTotals: vi.fn(),
}))

vi.mock('@line-crm/db', () => mocks)

// 統合時に、テンプレートの作成・更新はLINE公式アカウントの範囲で見るように
// なった（account_id_required と canAccessAllLineAccounts）。質問の契約を
// 見るためにここでは範囲の判定を通す。
const accountAccess = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
}))
vi.mock('../services/account-access.js', () => accountAccess)

import { templates } from './templates.js'

const question = {
  text: '続けますか？',
  tapMode: 'single' as const,
  choices: [
    { label: 'はい', behavior: 'none' as const },
    { label: 'いったん止めたい', behavior: 'form' as const, url: 'https://example.test/form' },
  ],
}

function app() {
  const hono = new Hono<Env>()
  hono.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false })
    await next()
  })
  hono.route('/', templates)
  return hono
}

const bindings = { DB: {} as D1Database } as Env['Bindings']

beforeEach(() => {
  vi.clearAllMocks()
  accountAccess.canAccessAllLineAccounts.mockResolvedValue(true)
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-1'],
    canSeeUnassigned: false,
  })
  mocks.getCarouselTapTotals.mockResolvedValue(new Map())
  mocks.createTemplate.mockImplementation(async (_db, input) => ({
    id: 'question-1',
    name: input.name,
    category: input.category,
    message_type: input.messageType,
    message_content: input.messageContent,
    question_json: input.questionJson,
    question_status: input.questionStatus,
    carousel_actions_json: null,
    carousel_tap_limit_mode: 'none',
    carousel_tap_limit_text: null,
    folder_id: null,
    created_at: '2026-08-29T12:00:00+09:00',
    updated_at: '2026-08-29T12:00:00+09:00',
  }))
})

describe('question templates', () => {
  it('stores the existing scenario question contract and keeps drafts out of accidental sending', async () => {
    const response = await app().request('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountId: 'account-1',
        name: '継続の意思をうかがう',
        category: '定期便',
        messageType: 'flex',
        messageContent: '壊れたFlexを送らない',
        question,
        questionStatus: 'draft',
      }),
    }, bindings)

    expect(response.status).toBe(201)
    expect(mocks.createTemplate).toHaveBeenCalledWith(bindings.DB, expect.objectContaining({
      messageType: 'text',
      messageContent: '続けますか？',
      questionJson: JSON.stringify(question),
      questionStatus: 'draft',
    }))
    expect(await response.json()).toMatchObject({
      success: true,
      data: { question, questionStatus: 'draft' },
    })
  })

  it('rejects a question whose choice has no label', async () => {
    const response = await app().request('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountId: 'account-1',
        name: '不完全な質問',
        category: '定期便',
        messageType: 'text',
        messageContent: '続けますか？',
        question: { ...question, choices: [{ label: '', behavior: 'none' }] },
        questionStatus: 'published',
      }),
    }, bindings)

    expect(response.status).toBe(422)
    expect(mocks.createTemplate).not.toHaveBeenCalled()
  })

  it('rejects a malformed choice as an input error instead of returning an internal error', async () => {
    const response = await app().request('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountId: 'account-1',
        name: '壊れた選択肢',
        category: '定期便',
        messageType: 'text',
        messageContent: '続けますか？',
        question: { ...question, choices: [{}] },
        questionStatus: 'published',
      }),
    }, bindings)

    expect(response.status).toBe(422)
    expect(mocks.createTemplate).not.toHaveBeenCalled()
  })

  it('returns question and publication state in the list contract', async () => {
    mocks.getTemplatesWithUsageCount.mockResolvedValue([{
      id: 'question-1',
      name: '継続の意思をうかがう',
      category: '定期便',
      message_type: 'text',
      message_content: '続けますか？',
      question_json: JSON.stringify(question),
      question_status: 'published',
      folder_id: null,
      usage_count: 0,
      created_at: '2026-08-29T12:00:00+09:00',
      updated_at: '2026-08-29T12:00:00+09:00',
    }])

    const response = await app().request('/api/templates', {}, bindings)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: [{ question, questionStatus: 'published' }],
    })
  })
})
