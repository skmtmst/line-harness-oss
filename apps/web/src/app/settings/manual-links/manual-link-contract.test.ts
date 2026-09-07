import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LINK_STATUS_LABEL,
  MISSING_SCREENS_NOTE,
  STATUS_FILTERS,
  VERIFY_SCHEDULE_NOTE,
  VERIFY_UNAVAILABLE_NOTE,
  type ManualLinkRow,
  brokenNotice,
  canEditTable,
  checkedLabel,
  localRows,
  manualLinkRow,
  matchesQuery,
  matchesStatus,
  statusOf,
  urlLabel,
} from './manual-link-view'

/**
 * 設計 ★V6 34-4「マニュアルの正本表」（`f9oUm`）。
 *
 * 守りたいのは 2 点——**出せない行を 0 件と書かない**ことと、
 * **「決めていない」と「開けない」を混ぜない**こと。
 */

function row(over: Partial<ManualLinkRow> = {}): ManualLinkRow {
  return {
    screenId: '2-1',
    taskId: null,
    name: '受信箱',
    url: 'https://help.line-harness.example/inbox',
    checkedAt: '8/28 04:00',
    status: 'ok',
    ...over,
  }
}

describe('リンクの状態', () => {
  it('設計の3つを、色ではなく文字で持つ', () => {
    expect(LINK_STATUS_LABEL).toEqual({
      ok: '開けます',
      broken: '開けません',
      unset: 'まだ決めていません',
    })
  })

  /*
    **確かめていない URL を「開けます」と言わない。**
    URL が入っているだけでは、開けるかどうかは分からない。
  */
  it('URL があっても、確かめていなければ「開けます」にしない', () => {
    expect(statusOf('https://example.com', null)).toBe('unset')
    expect(statusOf('https://example.com', '8/28 04:00')).toBe('ok')
  })

  it('URL が空なら「まだ決めていません」', () => {
    expect(statusOf('', '8/28 04:00')).toBe('unset')
    expect(statusOf('   ', null)).toBe('unset')
  })
})

describe('出せないものを出せるように見せない', () => {
  it('決めていない URL を URL の形に見せない', () => {
    expect(urlLabel('')).toBe('（まだ決めていません）')
    expect(urlLabel('https://example.com')).toBe('https://example.com')
  })

  it('確かめていない日は `—`', () => {
    expect(checkedLabel(null)).toBe('—')
    expect(checkedLabel('8/28 04:00')).toBe('8/28 04:00')
  })

  it('画面ごとの対応表が無いことを、行が無いのではなく口が無いと言う', () => {
    expect(MISSING_SCREENS_NOTE).toContain('まだ保存する口がありません')
    expect(MISSING_SCREENS_NOTE).not.toContain('0件')
  })

  it('確かめる仕組みが無いことに「準備中」と書かない', () => {
    expect(VERIFY_UNAVAILABLE_NOTE).not.toContain('準備中')
    expect(VERIFY_UNAVAILABLE_NOTE).toContain('まだ入っていません')
  })

  it('確かめる時刻は設計どおり毎日 04:00', () => {
    expect(VERIFY_SCHEDULE_NOTE).toContain('毎日 04:00')
  })
})

describe('いま出せる行', () => {
  it('APIの画面ID・状態・確認日時を一覧の行へ変える', () => {
    const row = manualLinkRow({
      key: '2-1', keyKind: 'screen', name: '受信箱', url: 'https://example.com/inbox',
      status: 'ok', lastCheckedAt: '2026-08-27T19:00:00.000Z', lastHttpStatus: 200,
      lastError: null, version: 2,
    })
    expect(row).toMatchObject({ screenId: '2-1', taskId: null, status: 'ok' })
    expect(checkedLabel(row.checkedAt)).toBe('8/28 04:00')
  })

  it('手元にあるのは作業ID 4件だけで、どれも未設定', () => {
    const rows = localRows()
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.taskId)).toEqual([
      'createOfficialAccount',
      'enableMessagingApi',
      'findChannelCredentials',
      'createLiffApp',
    ])
    expect(rows.every((r) => r.status === 'unset')).toBe(true)
    // 画面に結び付いていないので画面IDは持たない。
    expect(rows.every((r) => r.screenId === '—')).toBe(true)
  })
})

describe('絞り込みと検索', () => {
  it('区分は設計の4つ', () => {
    expect(STATUS_FILTERS.map((f) => f.label)).toEqual([
      'すべて',
      '開けます',
      '開けません',
      'まだ決めていません',
    ])
  })

  it('状態で絞れる', () => {
    expect(matchesStatus(row(), 'all')).toBe(true)
    expect(matchesStatus(row(), 'ok')).toBe(true)
    expect(matchesStatus(row({ status: 'broken' }), 'ok')).toBe(false)
  })

  it('画面ID・画面名・作業IDのどれでも引ける', () => {
    expect(matchesQuery(row(), '2-1')).toBe(true)
    expect(matchesQuery(row(), '受信箱')).toBe(true)
    expect(matchesQuery(row({ taskId: 'createLiffApp' }), 'liff')).toBe(true)
    expect(matchesQuery(row(), '友だち')).toBe(false)
    expect(matchesQuery(row(), '  ')).toBe(true)
  })
})

describe('開けないリンクの知らせ', () => {
  /* **0 件のときは何も言わない。**「0件あります」は読み手の仕事を増やすだけ。 */
  it('0件なら帯を出さない', () => {
    expect(brokenNotice([row(), row({ status: 'unset' })])).toBeNull()
  })

  it('あるときは件数と、そのとき何が起きるかを言う', () => {
    expect(brokenNotice([row({ status: 'broken' }), row({ status: 'broken' }), row()])).toBe(
      '開けないリンクが2件あります。直すまで、その画面の「マニュアル」は押しても何も出ません。',
    )
  })
})

describe('触れる人', () => {
  it('運営の代表・権限保持者・代表者は表を見られる', () => {
    expect(canEditTable({ id: 'env-owner', role: 'staff', permissionKeys: [] })).toBe(true)
    expect(canEditTable({ id: 'other', role: 'staff', permissionKeys: ['manual.link.edit'] })).toBe(true)
    expect(canEditTable({ id: 'other', role: 'owner', permissionKeys: [] })).toBe(true)
  })

  it('権限のない人・未ログインは表を見られない', () => {
    expect(canEditTable({ id: 'other', role: 'staff', permissionKeys: [] })).toBe(false)
    expect(canEditTable({ id: 'other', role: 'admin', permissionKeys: [] })).toBe(false)
    expect(canEditTable(null)).toBe(false)
  })
})

describe('失敗の表示', () => {
  const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

  it('「確かめる」と「保存」の失敗を無言にしない', () => {
    expect(page).toContain('actionError')
    expect(page).toContain('role="alert"')
    expect(page).toContain('確かめられませんでした')
    expect(page).toContain('保存できませんでした')
  })

  it('競合は読み直し、権限不足は依頼先を出す', () => {
    expect(page).toContain('ほかの人が先に変更しました')
    expect(page).toContain('運営に依頼してください')
    expect(page).toContain('error.status === 409')
    expect(page).toContain('error.status === 403')
  })
})
