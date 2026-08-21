import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '..', '..', 'app', 'friends', 'page.tsx'), 'utf8')
const TABLE = readFileSync(join(HERE, 'friend-list-table.tsx'), 'utf8')
const ROW = readFileSync(join(HERE, 'friend-list-row.tsx'), 'utf8')
const KPIS = readFileSync(join(HERE, 'friend-kpis.tsx'), 'utf8')
const DETAIL = readFileSync(join(HERE, '..', '..', 'app', 'friends', 'detail', 'page.tsx'), 'utf8')
const STRUCTURE = readFileSync(join(HERE, '..', '..', 'lib', 'design-structure.json'), 'utf8')

describe('友だちV4の画面契約', () => {
  it('V2の固定値ではなくV4を画面の正本にする', () => {
    expect(PAGE).toContain('data-friends-page="v4"')
    expect(PAGE).toContain('data-friends-design="v4"')
    expect(PAGE).not.toContain('V2 2-2')
    expect(TABLE).not.toContain('V2 2-2')
    expect(ROW).not.toContain('V2 2-2')
    expect(KPIS).not.toContain('V2 2-2')
    expect(DETAIL).not.toContain('V2 2-2')
    expect(DETAIL).toContain('data-friends-detail-design="v4"')
    expect(STRUCTURE).toContain('"node": "Wi50h"')
    expect(STRUCTURE).toContain('"node": "hsWaL"')
  })

  it('表示件数10〜50件と省略ページングを持つ', () => {
    expect(PAGE).toContain('const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50]')
    expect(PAGE).toContain('compactPages')
    expect(PAGE).toContain("result.push('ellipsis')")
    expect(PAGE).toContain('Math.ceil(total / pageSize)')
  })

  it('1440pxと1920pxで横スクロールを前提にしない', () => {
    expect(TABLE).not.toContain('overflow-x-auto')
    expect(TABLE).not.toContain('min-w-[')
    expect(ROW).toContain('minmax(0,1fr)')
    expect(TABLE).toContain('truncate')
  })

  it('V4のカード影と操作色を守る', () => {
    for (const source of [PAGE, TABLE, KPIS]) {
      expect(source).toContain('shadow-[1px_1px_2px_rgba(29,29,31,0.13)]')
    }
    expect(PAGE).toContain('#0067D9')
    expect(PAGE).toContain('#07C653')
  })

  it('ブラウザ標準アラートを使わず独自ダイアログを出す', () => {
    expect(PAGE).not.toContain('window.alert')
    expect(PAGE).not.toContain('window.confirm')
    expect(PAGE).toContain('role="dialog"')
    expect(PAGE).toContain('aria-modal="true"')
  })

  it('既存の検索・タグ・対応・詳細・受信箱への経路を残す', () => {
    for (const marker of [
      'api.friends.list',
      'api.tags.list',
      'AdvancedSearchDialog',
      'SingleFriendActions',
      '/friends/detail?id=',
      '/chats?friend=',
      '/accounts?tab=migration',
    ]) {
      expect(PAGE + ROW).toContain(marker)
    }
  })
})
