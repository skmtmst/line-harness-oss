import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

describe('リッチメニューの共通一覧契約', () => {
  it('画面のページ・件数・絞り込み・並び順をWorkerへ渡す', () => {
    expect(PAGE).toContain('api.richMenuGroups.listPage(accountId')
    expect(PAGE).toContain('page: reordering ? 1 : page')
    expect(PAGE).toContain('limit: reordering ? 200 : pageSize')
    expect(PAGE).toContain('setGroupTotal(groupsRes.value.data.total)')
    expect(API).toContain('ApiResponse<RichMenuGroupListPage>')
  })
})
