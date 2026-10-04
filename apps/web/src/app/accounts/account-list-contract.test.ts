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
 * LINEアカウントの一覧（設計板 `V7vn3`）。
 *
 * 板の言葉が正本。接続は「正常／確認停止中／アーカイブ」、
 * Webhook は「正常／未確認」の2択で出す。
 */
describe('V7vn3 LINEアカウント一覧', () => {
  it('板 V7vn3 の骨組みで作る', () => {
    expect(PAGE).toContain('ReadonlyDesignNode node="V7vn3"')
    expect(PAGE).not.toContain('data-design-node="QT91v"')
  })

  it('接続状態を、色だけでなく文字で言う', () => {
    expect(connectionLabel(account({ isActive: true })).label).toBe('正常')
    expect(connectionLabel(account({ isActive: false })).label).toBe('確認停止中')
    expect(connectionLabel(account({ archivedAt: '2026-09-01T00:00:00Z' })).label).toBe('アーカイブ')
  })

  it('Webhook は「正常／未確認」の2択にする', () => {
    /*
      板 V7vn3 の Webhook 欄は2択。合っていない・登録が無い・
      まだ確かめていないは、どれも「未確認」にまとめる。
      直し方は詳しい画面で言い分ける。
    */
    const w = (status: NonNullable<LineAccount['webhook']>['status']) =>
      webhookLabel(account({ webhook: { expectedUrl: '', actualUrl: null, active: null, status } })).label
    expect(w('matched')).toBe('正常')
    expect(w('mismatched')).toBe('未確認')
    expect(w('unconfigured')).toBe('未確認')
    expect(w('unknown')).toBe('未確認')
    // `webhook` そのものが付いてこないときも「未確認」。
    expect(webhookLabel(account()).label).toBe('未確認')
  })

  it('接続に問題があるのは、止まっているか確かめた上で合っていないとき', () => {
    const w = (status: NonNullable<LineAccount['webhook']>['status']) =>
      account({ webhook: { expectedUrl: '', actualUrl: null, active: null, status } })
    expect(hasConnectionProblem(w('mismatched'))).toBe(true)
    expect(hasConnectionProblem(w('unconfigured'))).toBe(true)
    // **確かめていないだけのものを「問題あり」に数えない。**
    expect(hasConnectionProblem(w('unknown'))).toBe(false)
    expect(hasConnectionProblem(w('matched'))).toBe(false)
  })

  it('絞り込みは板と同じ並び', () => {
    expect(matchesFilter(account({ isActive: true }), 'active')).toBe(true)
    expect(matchesFilter(account({ isActive: true }), 'inactive')).toBe(false)
    expect(matchesFilter(account({ isActive: false }), 'inactive')).toBe(true)
    expect(matchesFilter(account({ archivedAt: '2026-09-01T00:00:00Z' }), 'archived')).toBe(true)
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

  it('数は稼働中・停止中・アーカイブの3枚だけ', () => {
    // 板に無い「接続に問題」の4枚目は置かない。
    expect(PAGE).toContain('title="稼働中"')
    expect(PAGE).toContain('title="停止中"')
    expect(PAGE).toContain('title="アーカイブ"')
    expect(PAGE).not.toContain('title="接続に問題"')
  })

  it('絵に無い塊は出さない（友だち列・既定列・並び順・締めの一言）', () => {
    expect(PAGE).not.toContain('account.stats.friendCount')
    expect(PAGE).not.toContain('account.isDefault')
    expect(PAGE).not.toContain('AccountOrdering')
    expect(PAGE).not.toContain('ここで見えること')
  })

  it('行の操作は「⋯」にまとめ、4項目を置く', () => {
    expect(PAGE).toContain('の操作')
    expect(PAGE).toContain("label: '詳細'")
    expect(PAGE).toContain("label: '接続をもう一度確かめる'")
    expect(PAGE).toContain("label: '引き継ぎ'")
    expect(PAGE).toContain("label: 'アーカイブ'")
    expect(PAGE).toContain("label: 'アーカイブから戻す'")
  })

  it('失敗したときに、運用者ができることを置く', () => {
    expect(PAGE).toContain('再読み込み')
  })
})
