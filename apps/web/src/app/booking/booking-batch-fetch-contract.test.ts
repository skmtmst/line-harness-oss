import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * #1060: 一覧のN+1解消の表示契約。
 *
 * - 予約カレンダー: メニュー数ぶん往復していた空き枠取得を一括口へ。
 * - 担当割り当て表: スタッフ数ぶん往復していた読み込みを一括口へ。
 * - 回答フォーム一覧: 全件を受け取って画面側で切っていたページ分けを、
 *   Worker のサーバーページングへ。
 *
 * 一括口をまだ持たない Worker との段階配備に備えて、画面は従来の
 * 個別取得を「失敗時の退避」として残す。契約は「一括口を先に使う」こと。
 */
const BOOKINGS = readFileSync(new URL('./bookings/page.tsx', import.meta.url), 'utf8')
const MATRIX = readFileSync(new URL('./menus/staff/page.tsx', import.meta.url), 'utf8')
const MENU_NEW = readFileSync(new URL('./menus/new/page.tsx', import.meta.url), 'utf8')
const FORMS = readFileSync(new URL('../form-submissions/page.tsx', import.meta.url), 'utf8')

describe('予約カレンダーの空き枠取得（#1060）', () => {
  it('一括口（menu_ids）で全メニュー分を1要求にまとめる', () => {
    expect(BOOKINGS).toContain('bookingApi.getAvailabilityBatch')
    expect(BOOKINGS).toContain('menuIds: activeMenus.map')
  })

  it('一括口が無い Worker では従来のメニューごと取得へ退く', () => {
    // 段階配備の互換。退避が消えると旧Workerで空き枠が出なくなる。
    expect(BOOKINGS).toContain('bookingApi.getAvailability(requestedAccountId')
  })
})

describe('担当割り当て表の読み込み（#1060）', () => {
  it('全スタッフ分の表を一括口で1回だけ読む', () => {
    expect(MATRIX).toContain('bookingApi.listStaffMenusBulk')
    // 一括口が先に来て、スタッフごとの取得は失敗時の退避に留まる。
    expect(MATRIX.indexOf('listStaffMenusBulk')).toBeLessThan(MATRIX.indexOf('bookingApi.getStaffMenus'))
  })

  it('メニュー作成時の割り当て読み込みも一括口を先に使う', () => {
    expect(MENU_NEW).toContain('bookingApi.listStaffMenusBulk')
    // 書き込みは従来どおり担当ごとのPUT（失敗した担当だけ再試行できる形）。
    expect(MENU_NEW).toContain('bookingApi.putStaffMenus')
  })
})

describe('回答フォーム一覧のサーバーページング（#1060）', () => {
  it('一覧取得にページ・件数・絞り込み・並びを渡す', () => {
    expect(FORMS).toContain('with_list_summary=1')
    expect(FORMS).toContain('&page=')
    expect(FORMS).toContain('&limit=')
    expect(FORMS).toContain('&filter=')
    expect(FORMS).toContain('&sort=')
  })

  it('ページ送りは応答の total（絞り込み後の総件数）を母数にする', () => {
    expect(FORMS).toContain('listTotal / pageSize')
  })
})
