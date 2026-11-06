import fs from 'node:fs'

import { describe, expect, it } from 'vitest'
import { routingLabel, routingAction } from '@/v8/friend-add-runs/status'
import type { FriendAddEventRoutingStatus } from '@line-crm/shared'

/*
 * 実行結果の動き（URL の絞り込み・読み直し・古い応答・数の帯・停止・CSV・詳細への引き継ぎ）は
 * src/v8/friend-add-runs/runs-flow-react.test.tsx と同じフォルダの描画試験が画面を動かして見る。
 * ここには状態の言葉の関数と、戻してはいけない書き方の禁止の見張りだけを残す。
 */
const PAGE = fs.readFileSync(new URL('../../../v8/friend-add-runs/runs.tsx', import.meta.url), 'utf8')
const DETAIL = fs.readFileSync(new URL('../../../v8/friend-add-runs/detail.tsx', import.meta.url), 'utf8')

describe("管理画面 友だち追加時配信・実行結果の契約", () => {
  it('古い見出し・取得済みだけの絞り込み・先頭アカウントの決め打ちに戻さない', () => {
    expect(PAGE).not.toContain('<Header')
    // 種類・経路の絞り込みはサーバ側へ送る。取得済み20件への表示絞りでは2ページ目以降が漏れる。
    expect(PAGE).not.toContain("kind === 'all' || item.friendKind === kind")
    expect(PAGE).not.toContain("attribution === 'all' || item.attribution.status === attribution")
    expect(PAGE).not.toContain('accounts[0]')
    // 絞りの変更で2回読み直す依存の書き方に戻さない。
    expect(PAGE).not.toContain('}, [attribution, kind, routing, selectedAccountId])')
    // 未取得の経路を推測した経路として出さない。
    expect(PAGE).not.toContain('entryRouteId}')
  })

  it('5つの処理状態を利用者の言葉で表示する', () => {
    // 状態の言葉は一覧と詳細で共有する
    const states: FriendAddEventRoutingStatus[] = ['pending', 'completed', 'failed', 'suppressed', 'partial_failed']
    const labels = states.map((status) => routingLabel(status, null).label)
    expect(new Set(labels).size).toBe(5)
    states.forEach((status, index) => {
      expect(labels[index].length).toBeGreaterThan(0)
      expect(labels[index]).not.toBe(status)
    })
    expect(routingLabel('failed', null).tone).toBe('danger')
  })

  it('送達不明は「再送待ち」と別に見せる（自動では送り直さない）', () => {
    expect(routingLabel('partial_failed', 'delivery_unknown')).toMatchObject({ label: '送達不明', tone: 'danger' })
    expect(routingLabel('partial_failed', 'delivery_unknown')).not.toEqual(routingLabel('partial_failed', null))
    expect(routingAction('partial_failed', 'delivery_unknown')).toContain('自動では送り直しません')
    // 一覧は表の言葉を直接引かず、送達不明を見分ける関数を通す。
    expect(PAGE).not.toContain('ROUTING_LABELS[item.status] ??')
    expect(PAGE).not.toContain('ROUTING_ACTIONS[item.status] ??')
  })

  it('将来の状態が来ても描画を落とさない', () => {
    const future = 'future_state' as FriendAddEventRoutingStatus
    expect(routingLabel(future, null)).toMatchObject({ tone: 'neutral' })
    expect(routingLabel(future, null).label.length).toBeGreaterThan(0)
    expect(routingAction(future, null).length).toBeGreaterThan(0)
    expect(routingAction(future, 'delivery_unknown')).toContain('自動では送り直しません')
  })

  it('固定ID・記録の総数・先頭行の時刻を表示の元に戻さない', () => {
    // fixture の ID が無い環境で404・空画面になる。
    expect(PAGE).not.toContain('rule-referral')
    // 直近28日の追加は記録の総数ではなく、人数と回数を分けて出す。
    expect(PAGE).not.toContain('summary?.totalRuns')
    // 最終配信は先頭行の処理時刻を時刻だけで出さない。
    expect(PAGE).not.toContain('latestProcessedAt')
    expect(PAGE).not.toContain('formatJstTime')
  })

  it('詳細の戻り先を絞り込みの無い一覧に決め打ちしない', () => {
    expect(DETAIL).not.toContain('href="/friend-add-settings/runs"')
  })
})
