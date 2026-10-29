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
} from '@/v8/settings/accounts/view'
import type { LineAccount } from '@line-crm/shared'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '../../v8/settings/accounts/accounts.tsx'), 'utf8')

const account = (over: Partial<LineAccount> = {}): LineAccount => ({
  id: 'a1', channelId: '2007123456', name: '然-NEN- TEST',
  loginChannelId: null, liffId: null, isActive: true,
  createdAt: '', updatedAt: '', country: null, role: null, displayOrder: 0,
  ogSiteName: null, ogDefaultDescription: null, ogDefaultImageUrl: null,
  parentLineAccountId: null,
  ...over,
})

/**
 * LINEアカウントの一覧（設計板 ）。
 *
 * 板の言葉が正本。接続は「正常／確認停止中／アーカイブ」、
 * Webhook は「正常／未確認」の2択で出す。
 */
describe('V7vn3 LINEアカウント一覧', () => {
  it('古い板 QT91v の骨組みへ戻さない', () => {
    // 板 V7vn3 の枠・数の4枚・表・行の操作は accounts-row-actions-react.test.tsx が描いて確かめる。
    expect(PAGE).not.toContain('data-design-node="QT91v"')
  })

  it('接続状態を、色だけでなく文字で言う', () => {
    expect(connectionLabel(account({ isActive: true, connection: { status: 'ok' } })).label).toBe('正常')
    expect(connectionLabel(account({ isActive: false })).label).toBe('停止中')
    expect(connectionLabel(account({ archivedAt: '2026-09-01T00:00:00Z' })).label).toBe('アーカイブ')
  })

  it('Webhook は「正常／未確認」の2択にする', () => {
    /*
      板  の Webhook 欄は2択。合っていない・登録が無い・
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

  it('保存した接続の問題だけを数え、未確認・停止・保管を分ける', () => {
    expect(connectionLabel(account()).label).toBe('未確認')
    expect(hasConnectionProblem(account({ connection: { status: 'warn' } }))).toBe(true)
    expect(hasConnectionProblem(account({ connection: { status: 'unknown' } }))).toBe(false)
    expect(hasConnectionProblem(account({ isActive: false, connection: { status: 'warn' } }))).toBe(false)
    expect(hasConnectionProblem(account({ archivedAt: '2026-10-01', connection: { status: 'warn' } }))).toBe(false)
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

  it('一覧に「ここで見えること」の説明の塊を置かない', () => {
    expect(PAGE).not.toContain('ここで見えること')
  })
})
