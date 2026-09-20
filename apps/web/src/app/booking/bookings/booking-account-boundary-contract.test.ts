import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 予約管理のアカウント切替で別アカウントの予約が出ないことの契約試験(#963)。
 *
 * 対象は `apps/web/src/app/booking/bookings/page.tsx`。
 * 一覧・集計・候補(メニュー棚/担当)・カレンダーの読み込みと、確定操作の
 * 結果表示は、いずれも「要求が向かったアカウント」を固定し、応答時に
 * 現在のアカウントと照合しなければならない。切替時には前のアカウントの
 * 行・詳細・候補・確認窓を残さない。
 */

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')

describe('予約管理のアカウント境界(#963)', () => {
  it('一覧取得は要求時のアカウントを固定し、応答時に現在値と照合する', () => {
    expect(PAGE).toContain('const requestedAccountId = selectedAccountId')
    expect(PAGE).toContain('const requestId = ++listRequestRef.current')
    expect(PAGE).toContain('bookingApi.listRequests(requestedAccountId, tab')
    expect(PAGE).toContain('if (requestId !== listRequestRef.current || listAccountRef.current !== requestedAccountId) return')
  })

  it('読み込み中フラグも古い要求では戻さない', () => {
    expect(PAGE).toContain('if (requestId === listRequestRef.current && listAccountRef.current === requestedAccountId) setLoading(false)')
  })

  it('条件が変わった時点で走っている要求を無効化する', () => {
    expect(PAGE).toContain('listRequestRef.current += 1')
    expect(PAGE).toContain('listAccountRef.current = selectedAccountId')
  })

  it('アカウント切替時に前のアカウントの行・詳細・候補・確認窓を消す', () => {
    const clearEffect = PAGE.match(/useEffect\(\(\) => \{\s+setItems\(\[\]\)[\s\S]*?\}, \[selectedAccountId\]\)/)
    expect(clearEffect).not.toBeNull()
    const body = clearEffect![0]
    for (const call of [
      'setItems([])',
      'setCalendarItems([])',
      'setDetailId(null)',
      'setDecideTarget(null)',
      'setDecideError(',
      'setMenus([])',
      'setStaffList([])',
      'setCopiedUrl(null)',
      'setSummaryError(false)',
    ]) {
      expect(body).toContain(call)
    }
  })

  it('集計・メニュー棚・担当の候補もアカウント一致のときだけ反映する', () => {
    expect(PAGE).toContain('bookingApi.requestsSummary(requestedAccountId')
    expect(PAGE).toContain('bookingApi.listMenus(requestedAccountId)')
    expect(PAGE).toContain('bookingApi.listStaff(requestedAccountId)')
    expect(PAGE).toContain('if (!alive || listAccountRef.current !== requestedAccountId) return')
  })

  it('カレンダーのページまたぎ取得もアカウントが変わったら止める', () => {
    expect(PAGE).toContain('while (alive && listAccountRef.current === requestedAccountId)')
    expect(PAGE).toContain('if (alive && listAccountRef.current === requestedAccountId) setCalendarItems(collected)')
  })

  it('確定操作の結果表示は操作時のアカウントと一致するときだけ触る', () => {
    expect(PAGE).toContain('const decideAccountId = selectedAccountId')
    expect(PAGE).toContain('bookingApi.decideRequest(decideAccountId, id, action)')
    expect(PAGE).toContain('if (listAccountRef.current === decideAccountId) {')
  })

  it('確定後の再読み込みも同じアカウントのときだけ呼ぶ(#979 A27-03)', () => {
    /*
     * `load` は操作開始時のアカウントを掴んだ古い実体。切替後に呼ぶと
     * 新しいアカウントの一覧を空にしたまま読み込み状態が残る。
     * 確認窓を閉じるのと同じガードの中でだけ呼ばなければならない。
     */
    const runDecide = PAGE.match(/async function runDecide[\s\S]*?\n  \}\n/)
    expect(runDecide).not.toBeNull()
    const body = runDecide![0]
    const guarded = body.match(/if \(listAccountRef\.current === decideAccountId\) \{([\s\S]*?)\n      \}/)
    expect(guarded).not.toBeNull()
    expect(guarded![1]).toContain('setDecideTarget(null)')
    expect(guarded![1]).toContain('await load()')
    // ガードの外で一覧の再読み込みを呼ばない。
    expect(body.replace(guarded![0], '')).not.toContain('await load()')
  })
})
