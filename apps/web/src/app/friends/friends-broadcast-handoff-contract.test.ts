import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * IDEA-03「検索から配信等へ進むときは対象条件を引き継ぐ」
 * 「3ページ以上の移動と戻る操作で条件・位置を保持」の画面契約。
 * 友だち一覧 → 配信作成の引き継ぎと、一覧状態の保存・復元を固定する。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST_PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const LIST_STATE = readFileSync(join(HERE, 'list-state.ts'), 'utf8')
const BROADCAST_NEW = readFileSync(join(HERE, '..', 'broadcasts', 'new', 'page.tsx'), 'utf8')
const DETAIL_PAGE = readFileSync(join(HERE, 'detail', 'page.tsx'), 'utf8')

describe('一覧 → 配信作成の条件引き継ぎ', () => {
  it('絞り込み条件をJSONでシリアライズして配信作成へ渡す（ID一覧は渡さない）', () => {
    expect(LIST_PAGE).toContain('buildBroadcastHandoff')
    expect(LIST_PAGE).toContain('/broadcasts/new?condition=')
    // 表示中ページの友だちIDを対象にしない決めごと。friend_id_in は使わない。
    expect(LIST_PAGE).not.toContain('friend_id_in')
  })

  it('配信リンクは権限のある人だけに出す（canRunBulk と同じ線引き）', () => {
    expect(LIST_PAGE).toContain('canRunBulk(selectedAccount?.role)')
    expect(LIST_PAGE).toContain('data-broadcast-handoff')
  })

  it('配信作成は condition を形チェックし、壊れた値は採用せず警告を出す', () => {
    expect(BROADCAST_NEW).toContain("params.get('condition')")
    expect(BROADCAST_NEW).toContain('isSegmentConditionShape')
    expect(BROADCAST_NEW).toContain('引き継がれた絞り込み条件を読めませんでした')
    // 空の条件（全員一致に展開される）は採用しない。
    expect(BROADCAST_NEW).toContain('condition.rules.length === 0')
  })

  it('audienceId・スコア帯の既存導線は残す', () => {
    expect(BROADCAST_NEW).toContain('analytics_audience')
    expect(BROADCAST_NEW).toContain('scoreRangeCondition')
  })
})

describe('一覧状態の保存・復元', () => {
  it('絞り込みとページ・並び順をアカウント別に sessionStorage へ写す', () => {
    expect(LIST_PAGE).toContain('readFriendsListSnapshot')
    expect(LIST_PAGE).toContain('writeFriendsListSnapshot')
    expect(LIST_STATE).toContain('sessionStorage')
    expect(LIST_STATE).toContain('KEY_PREFIX + accountId')
    for (const key of ['searchSubmitted', 'selectedTagId', 'operatorId', 'page', 'pageSize', 'sortMode', 'advanced']) {
      expect(LIST_STATE).toContain(key)
    }
  })

  it('URL直指定の絞り込み（スコア帯・対象者・保存検索）を保存値で上書きしない', () => {
    expect(LIST_PAGE).toContain('hasExplicitUrlFilters')
    expect(LIST_PAGE).toContain('hasScoreRange')
    expect(LIST_PAGE).toContain('directSavedSearchId')
  })

  it('復元を評価するまで一覧を読まない（既定条件で二重取得しない）', () => {
    expect(LIST_PAGE).toContain('if (!restored) return')
  })
})

describe('友だち詳細の履歴', () => {
  it('種類・状態・元情報リンクを出す（リンクは接続先がある種類だけ）', () => {
    expect(DETAIL_PAGE).toContain('timelineStatusLabel')
    expect(DETAIL_PAGE).toContain('timelineSourceHref')
    expect(DETAIL_PAGE).toContain("ec_order: '注文'")
    expect(DETAIL_PAGE).toContain('写真投稿')
    // 遷移先が無い種類へ黙ってリンクを付けない。
    expect(DETAIL_PAGE).toContain('return null')
  })

  it('追加読み込みの重複行を source で照合して足さない', () => {
    expect(DETAIL_PAGE).toContain('item.source?.kind ?? item.type')
  })

  it('アカウント・友だち切替後の遅い応答を捨てる仕組みを保つ', () => {
    expect(DETAIL_PAGE).toContain('isStaleResponse')
    expect(DETAIL_PAGE).toContain('historyReqRef')
  })
})
