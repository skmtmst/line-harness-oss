import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL("./../../v8/rich-menus/list.tsx", import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

describe('リッチメニューの共通一覧契約', () => {
  it('画面のページ・件数・絞り込み・並び順をWorkerへ渡す', () => {
    expect(PAGE).toContain('api.richMenuGroups.listPage(accountId')
    expect(PAGE).toContain('page,')
    expect(PAGE).toContain('limit: pageSize,')
    expect(PAGE).toContain('setGroupTotal(groupsRes.data.total)')
    expect(API).toContain('ApiResponse<RichMenuGroupListPage>')
  })
})
