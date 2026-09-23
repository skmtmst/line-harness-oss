import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 監査6 #667: 一覧の件数表示は ListRange（「N件中 X〜Y件を表示」）に統一する。
 *
 * 以前は「1件中1〜1件」「0〜0件 / 全0件」「N個中」「Nつのうち」
 * 「を表示しています」と画面ごとに7形以上に分かれていた。
 * 一覧のフッターで件数を出すファイルは、ローカルに書き方を持たず
 * ListRange を呼ぶことだけをここで縛る。
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/** 件数表示を ListRange へ寄せた一覧画面・部品。 */
const LIST_RANGE_USERS: Array<[string, string]> = [
  ['../../app/friends/page.tsx を使う友だち一覧', '../friends/friend-list-table.tsx'],
  ['友だち追加時の配信 一覧', '../../app/friend-add-settings/page.tsx'],
  ['友だち追加時の配信 実行結果', '../../app/friend-add-settings/runs/page.tsx'],
  ['リッチメニュー', '../../app/rich-menus/page.tsx'],
  ['回答フォーム 一覧', '../../app/form-submissions/page.tsx'],
  ['回答フォーム 回答一覧', '../../app/form-submissions/responses/page.tsx'],
  ['コンテンツ管理', '../../app/contents/page.tsx'],
  ['運営へのお知らせ', '../../app/line-notifications/operator-notification-rules.tsx'],
  ['NENキャンペーン 送った履歴', '../../app/nen-campaigns/nen-overview.tsx'],
  ['コンバージョン', '../../app/conversions/page.tsx'],
  ['EC連携 取り込みの記録', '../../app/ec-commerce/page.tsx'],
  ['EC連携 会員のつき合わせ', '../../app/ec-commerce/identity-candidates/page.tsx'],
  ['EC連携 定期便', '../../app/ec-commerce/subscriptions-panel.tsx'],
  ['予約メニュー', '../../app/booking/menus/page.tsx'],
  ['運営 監査ログ', '../../app/ops/audit/page.tsx'],
  ['運営 お問い合わせ', '../../app/ops/support/page.tsx'],
  ['自動化の実行記録', '../../app/automations/runs/page.tsx'],
  ['友だち詳細 回答一覧', '../../app/friends/detail/page.tsx'],
  ['Webhook のやり取り', '../../app/webhooks/webhook-interactions.tsx'],
  ['受信一覧（旧inbox部品）', '../inbox/inbox-list.tsx'],
  ['保留中の受信カード', '../support/pending-inbox-card.tsx'],
  ['タグ一覧', '../friend-attributes-v2/tag-list-v2.tsx'],
  ['スタッフの操作記録', '../staff/login-audit.tsx'],
]

/** 「N件中…」を手書きしていないことを確認する対象（差分の残骸探し）。 */
const RAW_PATTERNS = [
  /件 \/ 全/, // 「X〜Y件 / 全N件」
  /全\{[^}]+\}件中/, // 「全{n}件中…」
  /個中|個を表示|つのうち/, // 「個」「つ」の助数
]

describe('ListRange 統一（監査6 #667）', () => {
  it.each(LIST_RANGE_USERS.map(([name, path]) => ({ name, path })))(
    '$name は ListRange を呼ぶ',
    ({ path }) => {
      const source = read(path)
      expect(source, `${path} に ListRange がない`).toContain('ListRange')
    },
  )

  it.each(LIST_RANGE_USERS.map(([name, path]) => ({ name, path })))(
    '$name に旧い書き方の残骸がない',
    ({ path }) => {
      const source = read(path)
      for (const pattern of RAW_PATTERNS) {
        expect(source, `${path} が ${pattern} を含む`).not.toMatch(pattern)
      }
    },
  )

  it('ページ送りは1ページしかないとき隠す（友だち追加時の配信）', () => {
    const source = read('../../app/friend-add-settings/page.tsx')
    // 以前は1ページでも「前へ 1 次へ」が常に出ていた。
    expect(source).toContain('canPrev || data.nextCursor')
    expect(source).not.toContain('aria-current="page">{cursorPage}')
  })
})
