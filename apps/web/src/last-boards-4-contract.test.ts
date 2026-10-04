import { readUiSource as readFileSync } from '../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (p: string) => readFileSync(join(HERE, p), 'utf8')

const FRIENDS_PAGE = read('app/friends/page.tsx')
const ADV_SEARCH = read('components/friends/advanced-search-dialog.tsx')
const SAVED_SEARCH = read('components/friends/saved-search-dialog.tsx')
const SINGLE_ACTIONS = read('components/friends/single-friend-actions.tsx')
const FRIEND_TABLE = read('components/friends/friend-list-table.tsx')
const BOOKINGS = read('app/booking/bookings/page.tsx')
const BOOKING_NEW = read('app/booking/bookings/new/page.tsx')
const BOOKING_DETAIL = read('app/booking/bookings/detail/page.tsx')
const CHATS = read('app/chats/page.tsx')
const DASHBOARD_EDITOR = read('components/dashboard/dashboard-editor.tsx')
const DASHBOARD = read('app/page.tsx')
const TEMPLATE_EDIT = read('app/templates/edit-v8.tsx')
const REMINDER_EDIT = read('app/reminders/edit/edit-v8.tsx')
const STAFF = read('app/staff/page.tsx')
const FRIEND_ADD_EDITOR = read('app/friend-add-settings/editor-v8.tsx')

/*
 * V8 の最後の細かい板（last-boards-4）。作ってある画面には板IDを付け、
 * 無いものだけ作る。中身の数値は API の実データを出す。
 */
describe('最後の細かい板の印', () => {
  it('友だち一覧にywJ5H・x6QsVzを付ける', () => {
    expect(FRIENDS_PAGE).toContain('sdbsQ ywJ5H x6QsVz')
  })

  it('一覧から開く窓にCYJ0Lを付ける', () => {
    expect(ADV_SEARCH).toContain('data-design-node="CYJ0L"')
    expect(SAVED_SEARCH).toContain('data-design-node="CYJ0L"')
    expect(SINGLE_ACTIONS).toContain('data-design-node="CYJ0L"')
    expect(FRIEND_TABLE).toContain('data-design-node="CYJ0L"')
  })

  it('予約にacRIl・If9Mhを付ける', () => {
    expect(BOOKINGS).toContain('data-design-node="acRIl"')
    expect(BOOKING_NEW).toContain('If9Mh')
    expect(BOOKING_DETAIL).toContain('data-design-node="If9Mh"')
  })

  it('受信箱にM0393・ダッシュボードにd8X09・mcOqKを付ける', () => {
    expect(CHATS).toContain('data-design-node="M0393"')
    expect(DASHBOARD).toContain('data-design-node="d8X09"')
    expect(DASHBOARD_EDITOR).toContain('data-design-node="mcOqK"')
  })

  it('1152の幅違いに印を付ける（a1k3d・r1l0bT・wbDHy・xHpkS）', () => {
    expect(TEMPLATE_EDIT).toContain('u5YC6 a1k3d')
    expect(REMINDER_EDIT).toContain('p5YuP r1l0bT')
    expect(STAFF).toContain('wbDHy')
    expect(FRIEND_ADD_EDITOR).toContain('h8uNW xHpkS')
  })

  it('予約して送る小窓にMyJP7を付ける', () => {
    expect(SINGLE_ACTIONS).toContain('designNode="MyJP7"')
    expect(SINGLE_ACTIONS).toContain('予約して送る')
    expect(SINGLE_ACTIONS).toContain('api.chats.schedule')
  })
})
