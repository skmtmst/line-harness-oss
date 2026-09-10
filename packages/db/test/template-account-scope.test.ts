import { describe, expect, it } from 'vitest'
import { getAssociableTemplate, isTemplateAssociable, isTemplateSendable } from '../src/templates.js'

/**
 * 結びつけ・送信の持ち主検査(#645・独立審査P2相当 指摘3)。
 * 公開版があり、相手と持ち主が完全一致するときだけ通す。
 * 持ち主不明(null)は結びも送信もしない(fail-close)。
 * 持ち主未定のシナリオに結ぶと、送る側で別アカウントの公開版が混ざる。
 */

function mockDb(row: Record<string, unknown> | null): D1Database {
  return {
    prepare: () => ({ bind: () => ({ first: async () => row }) }),
  } as unknown as D1Database
}

const publishedMine = {
  message_type: 'text', message_content: '本文',
  published_version: 1, line_account_id: 'account-1',
}

describe('isTemplateAssociable', () => {
  it('公開版の同一アカウントは結べる', () => {
    expect(isTemplateAssociable(publishedMine, 'account-1')).toBe(true)
  })

  it('別アカウントは結べない(越境)', () => {
    expect(isTemplateAssociable(publishedMine, 'account-2')).toBe(false)
  })

  it('結ぶ側の持ち主が不明なら結べない', () => {
    expect(isTemplateAssociable(publishedMine, null)).toBe(false)
    expect(isTemplateAssociable(publishedMine, undefined)).toBe(false)
  })

  it('結ばれる側の持ち主が不明なら結べない', () => {
    expect(isTemplateAssociable(
      { ...publishedMine, line_account_id: null }, 'account-1',
    )).toBe(false)
  })

  it('未公開は結べない', () => {
    expect(isTemplateAssociable(
      { ...publishedMine, published_version: 0 }, 'account-1',
    )).toBe(false)
  })
})

describe('isTemplateSendable', () => {
  it('公開版の同一アカウントだけ送れる', () => {
    expect(isTemplateSendable(publishedMine, 'account-1')).toBe(true)
    expect(isTemplateSendable(publishedMine, 'account-2')).toBe(false)
    expect(isTemplateSendable(publishedMine, null)).toBe(false)
    expect(isTemplateSendable({ ...publishedMine, line_account_id: null }, 'account-1')).toBe(false)
    expect(isTemplateSendable({ ...publishedMine, published_version: 0 }, 'account-1')).toBe(false)
  })
})

describe('getAssociableTemplate', () => {
  it('越境の結びつけは null を返す', async () => {
    expect(await getAssociableTemplate(mockDb(publishedMine), 'tpl-1', 'account-2')).toBeNull()
  })

  it('持ち主未定の結びつけは null を返す', async () => {
    expect(await getAssociableTemplate(mockDb(publishedMine), 'tpl-1', null)).toBeNull()
  })

  it('同一アカウントの公開版は行を返す', async () => {
    expect(await getAssociableTemplate(mockDb(publishedMine), 'tpl-1', 'account-1')).toEqual(publishedMine)
  })
})
