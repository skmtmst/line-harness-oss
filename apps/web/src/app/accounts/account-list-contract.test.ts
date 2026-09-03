import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  connectionLabel,
  hasConnectionProblem,
  matchesFilter,
  matchesQuery,
  parentName,
  webhookLabel,
} from './account-list-view'
import type { LineAccount } from '@line-crm/shared'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

const account = (over: Partial<LineAccount> = {}): LineAccount => ({
  id: 'a1', channelId: '2007123456', name: '然-NEN- TEST',
  loginChannelId: null, liffId: null, isActive: true,
  createdAt: '', updatedAt: '', country: null, role: null, displayOrder: 0,
  ogSiteName: null, ogDefaultDescription: null, ogDefaultImageUrl: null,
  parentLineAccountId: null,
  ...over,
})

/**
 * LINEアカウントの一覧（設計 ★V6 33-1 `QT91v`）。
 *
 * **これまでここは `/hq` への転送だった。** 統括の店舗管理と、LINE公式
 * アカウントの設定は別のもの（要件 §5-3）。
 */
describe('V6 33-1 LINEアカウント一覧', () => {
  it('転送をやめて画面にする', () => {
    expect(PAGE).not.toContain("redirect('/hq')")
    expect(PAGE).toContain('data-design-node="QT91v"')
  })

  it('接続状態を、色だけでなく文字で言う', () => {
    expect(connectionLabel(account({ isActive: true })).label).toBe('稼働中')
    expect(connectionLabel(account({ isActive: false })).label).toBe('停止中')
  })

  it('「確認していません」と「合っていません」を言い分ける', () => {
    /*
      どちらも「届かないかもしれない」だが、運用者のやることが違う——
      前者は確かめる、後者は直す。同じ言葉にすると、直す手が分からない。
    */
    const w = (status: NonNullable<LineAccount['webhook']>['status']) =>
      webhookLabel(account({ webhook: { expectedUrl: '', actualUrl: null, active: null, status } })).label
    expect(w('matched')).toBe('一致・利用中')
    expect(w('mismatched')).toBe('URLが違います')
    expect(w('unconfigured')).toBe('登録されていません')
    expect(w('unknown')).toBe('確認していません')
    // `webhook` そのものが付いてこないときも「確認していません」。
    expect(webhookLabel(account()).label).toBe('確認していません')
  })

  it('接続に問題があるのは、合っていないか登録が無いとき', () => {
    const w = (status: NonNullable<LineAccount['webhook']>['status']) =>
      account({ webhook: { expectedUrl: '', actualUrl: null, active: null, status } })
    expect(hasConnectionProblem(w('mismatched'))).toBe(true)
    expect(hasConnectionProblem(w('unconfigured'))).toBe(true)
    // **確かめていないだけのものを「問題あり」に数えない。**
    expect(hasConnectionProblem(w('unknown'))).toBe(false)
    expect(hasConnectionProblem(w('matched'))).toBe(false)
  })

  it('絞り込みは設計のタブと同じ', () => {
    expect(matchesFilter(account({ isActive: true }), 'active')).toBe(true)
    expect(matchesFilter(account({ isActive: true }), 'inactive')).toBe(false)
    expect(matchesFilter(account({ isActive: false }), 'inactive')).toBe(true)
    expect(matchesFilter(account(), 'all')).toBe(true)
  })

  it('名前とチャネルIDの両方で探せる', () => {
    expect(matchesQuery(account(), 'NEN')).toBe(true)
    expect(matchesQuery(account(), '2007123')).toBe(true)
    expect(matchesQuery(account(), 'ちがう')).toBe(false)
    expect(matchesQuery(account(), '   ')).toBe(true)
  })

  it('親アカウントは名前で出す。IDを画面に出さない', () => {
    const parent = account({ id: 'p1', name: '然-NEN- 本番' })
    const child = account({ id: 'c1', parentLineAccountId: 'p1' })
    expect(parentName(child, [parent, child])).toBe('然-NEN- 本番')
    // 親が消えていたら `—`。IDをそのまま出さない。
    expect(parentName(account({ parentLineAccountId: 'nope' }), [])).toBe('—')
    expect(parentName(account(), [])).toBe('—')
  })

  it('取れない数を 0 と書かない', () => {
    /*
      友だち数を返す口がこの一覧に無い。アーカイブは `archived_at` が
      まだ無い（台帳 #128）。**0 と書くと「1件も無い」と読まれる。**
    */
    expect(PAGE).toContain('title="アーカイブ" value={null}')
    expect(PAGE).not.toContain('friendCount')
  })

  it('まだ動かない操作は、押し口を置かず理由を書く', () => {
    // `v6-common-rules.md` §7-10「出す＝使える」。
    expect(PAGE).toContain('既定アカウントの指定、アーカイブ、並び順と親子の変更は、まだ繋がっていません。')
  })

  it('失敗したときに、運用者ができることを置く', () => {
    expect(PAGE).toContain('再読み込み')
  })
})
