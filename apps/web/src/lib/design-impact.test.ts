import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allFiles,
  createImportIndex,
  directImporters,
  routeEntryFiles,
} from '../../scripts/design-impact.mjs'
import {
  parseDesignImpactBaseline,
  readDesignImpactBaseline,
} from '../../scripts/design-impact-baseline.mjs'
import { SRC } from '../../scripts/design-debt.mjs'

describe('共通部品の影響範囲', () => {
  const files = allFiles()
  // 全ファイルの構文解析は1回だけ。各検査は同じ解決済み索引を共有する。
  const importIndex = createImportIndex(files)
  const button = join(SRC, 'components', 'shared', 'button.tsx')
  const buttonCss = join(SRC, 'components', 'shared', 'button.module.css')
  const pagination = join(SRC, 'components', 'shared', 'pagination.tsx')
  const paginationCss = join(SRC, 'components', 'shared', 'pagination.module.css')
  const baseline = readDesignImpactBaseline()

  it('共通Buttonの実利用先が一覧ファイルと一致する', () => {
    const actual = directImporters(files, button, importIndex).map((file) => relative(SRC, file)).sort()
    expect(
      actual,
      '件数を書き換えず、design-impact-baseline.txtへ利用先の行を追加・削除してください',
    ).toEqual(baseline.sharedButtonImporters)
  })

  it('並行PRが足した2画面を行として同時に保持できる', () => {
    const parsed = parseDesignImpactBaseline([
      'shared-button-importer app/example-a/page.tsx',
      'shared-button-importer app/example-b/page.tsx',
    ].join('\n'))
    expect(parsed.sharedButtonImporters).toEqual([
      'app/example-a/page.tsx',
      'app/example-b/page.tsx',
    ])

    const attributes = readFileSync(join(SRC, '..', '..', '..', '.gitattributes'), 'utf8')
    expect(attributes).toContain('apps/web/design/design-impact-baseline.txt merge=union')
  })

  it('import先が実ファイルと一致する場合は検知する', () => {
    expect(directImporters(files, buttonCss, importIndex)).toEqual([button])
    expect(directImporters(files, paginationCss, importIndex)).toEqual([pagination])
  })

  /*
   * 描かれるファイル：入口（app の page.tsx・layout.tsx）から import をたどって届くもの。
   * もう描かれない古い画面ファイル（入口が src/v8 の新しい画面を出すようになったもの）は、
   * 切り替えの日まで残っていても利用先に数えない（2026-10-06）。
   */
  const rendered = (() => {
    const seen = new Set<string>()
    const queue = files.filter((file) => /\/app\/(?:.*\/)?(?:page|layout)\.tsx$/.test(file))
    while (queue.length > 0) {
      const file = queue.pop()!
      if (seen.has(file)) continue
      seen.add(file)
      for (const next of importIndex.get(file) ?? []) if (!seen.has(next)) queue.push(next)
    }
    return seen
  })()

  it('共通Paginationを直接importする、描かれるファイルだけを利用先に数える', () => {
    // ダッシュボードの受信カードが自前の「前へ／次へ」をやめて共通へ寄せた。
    // 設計（`vUXKb` / `NjK9q`）は表の下にページ送りがあり、番号で飛べる。
    // 2026-09-02: 成果地点と流入経路の押せない「前へ／次へ」も共通へ寄せた。
    expect(directImporters(files, pagination, importIndex).filter((file) => rendered.has(file)).map((file) => relative(SRC, file)).sort()).toEqual([
      // m15c: 手書きのページ送りを共通 Pagination へ置き換えた10画面を足す。
      'app/accounts/migration.tsx',
      // ★V8 LINEユーザーIDの移行（Z0jHp）。判断一覧は50件ずつのページ送り。
      'app/accounts/uid-migration-v8.tsx',
      // 2026-09-04: 自動応答の実行結果が入った。表の下にページ送りがある。
      'app/auto-replies/runs/page.tsx',
      // ★V8 自動応答の実行結果（app/auto-replies/runs/runs-v8.tsx）は描かれなくなった。入口は src/v8/auto-replies/runs.tsx（下）。
      'app/automations/page.tsx',
      // 2026-09-27 R24: 実行記録が先頭20件に固定で21件目以降へ届かなかった。
      // 20件ずつのページ送りに寄せた。
      'app/automations/runs/page.tsx',
      'app/booking/bookings/page.tsx',
      // #370: 予約メニュー8件を設計どおり1ページ6件に区切る。
      'app/booking/menus/page.tsx',
      // #1145(★V8) の一斉配信の一覧（app/broadcasts/list-v8.tsx）は描かれなくなった。入口は src/v8/broadcasts/list.tsx（下）。
      'app/common-actions/page.tsx',
      // N-193/N-205: 登録メディア選択窓。20件ずつのページ送りを共通へ寄せた。
      'app/contents/media-picker-dialog.tsx',
      'app/contents/media-replacement-dialog.tsx',
      'app/contents/page.tsx',
      // #973: 共通情報の変更影響を1件ずつ確認する一覧にページ送りを追加した。
      'app/contents/vars/impact-review.tsx',
      'app/contents/vars/page.tsx',
      // ★V8-B コンバージョンの一覧（r6dJFy）。表の下にページ送りを置く。
      'app/conversions/conversion-points-v8.tsx',
      'app/conversions/page.tsx',
      // #1011 FRIEND-11: 重複候補が50件を超えると後ろの候補へ辿れなかった。
      // サーバが数えた総数でページ送りを出すため共通へ寄せた。
      // ★V8 重複しているかも（hn6Y8）。v7 と同じくサーバ総数でページ送り。
      'app/duplicates/duplicates-v8.tsx',
      'app/duplicates/page.tsx',
      // #572: EC連携の取り込み記録が先頭20件しか出ず、21件目以降の失敗に
      // 届かなかった。状態絞りをサーバへ移し、共通へ寄せた。
      'app/ec-commerce/page.tsx',
      // #731: 定期便の一覧が 100 件で頭打ちのまま、101件目から先へ行く手立てが
      // 無かった。サーバが数えた総数でページ送りを出すため共通へ寄せた。
      'app/ec-commerce/subscriptions-panel.tsx',
      // 2026-09-04: イベント一覧も自前のページ送りをやめて共通へ寄せた。
      // 取れていないときに「1 / 1」と出て、1ページぶんは取れたように見えていた。
      'app/events/bookings/page.tsx',
      'app/events/page.tsx',
      // #543: 一覧の到達不能な回答表（M2削除）と共に共通Paginationの利用を外した。
      'app/form-submissions/responses/page.tsx',
      'app/hq/account-browser-v8.tsx',
      // IDEA-18 (#1036): 経路別の注文明細が増えても画面を重くしないよう
      // サーバが数えた総数でページ送りを出すため共通へ寄せた。
      'app/inflow-links/_components/ref-orders.tsx',
      // ★V8-B 広告への送信履歴（p0kA3）。表の下にページ送りを置く。
      // #565: 送信履歴が増えても描画を際限なく重くしないよう、20件ずつのページ送りに寄せた。
      'app/inflow-links/ad-integration.tsx',
      // ★V8-B 流入と計測の詳細（Q5le3）。友だちの表の下にページ送りを置く。
      'app/inflow-links/detail/page.tsx',
      'app/inflow-links/page.tsx',
      // #291: 顧客へのお知らせ9種類を、設計どおり1ページ6件に区切る。
      'app/mileage/action-score-tab.tsx',
      'app/mileage/mileage-history-tab.tsx',
      // R365: 要対応の交換が21件以上あっても残りを出せるよう、20件ずつのページ送りに寄せた。
      'app/mileage/mileage-rewards-tab.tsx',
      'app/mileage/page.tsx',
      // 2026-09-18: NEN配信のコラム一覧（★V6 37-6-A）。8本ずつのページ送り。
      'app/nen-campaigns/nen-overview.tsx',
      // 2026-09-16 採用: 然の健康日記（★V6 37-4）とマイペット（★V6 37-3）。20頭ずつのページ送り。
      'app/nen/health/health-tab.tsx',
      // ★V8-B 健康日記一覧（mIwA4）の古い health-v8.tsx は描かれなくなった。入口は src/v8/nen-health（ページ送りは型が持つ）。
      // 2026-09-16: 然の会員一覧（★V6 37-1）。20人ずつのページ送り。
      'app/nen/members/members-tab.tsx',
      'app/nen/pets/pets-tab.tsx',
      // ★V8-B マイペット一覧（wTIej）の古い pets-v8.tsx は描かれなくなった。入口は src/v8/nen-pets（ページ送りは型が持つ）。
      'app/ops/audit/page.tsx',
      // 2026-09-04: 7-1-H 実行結果。友だち×通の実行が並ぶので、表の下にページ送りが要る。
      'app/reminders/detail/page.tsx',
      // ★V8 リマインダの登録者（担当 b の作り直し）。表の下に共通のページ送り。
      'app/reminders/detail/registrants-panel.tsx',
      // ★V8 リマインダ一覧（apLqS）。表の下にページ送りを置く。
      'app/reminders/list-v8.tsx',
      // 2026-09-23: Googleビジネスの口コミ一覧（★V6 GB-2）。20件ずつのページ送り。
      'app/restaurant-test/google/google-business.tsx',
      // Googleビジネス第3段: 投稿一覧（GB-4 MAozg）の表の下にページ送りがある。
      'app/restaurant-test/google/google-posts.tsx',
      // Googleビジネス第2段: 変更履歴（GB-17 w7ZTml）の表の下にページ送りがある。
      'app/restaurant-test/google/google-profile.tsx',
      // #919: 予約台帳が増えても消えないよう、期間・状態の絞り込みと20件ずつのページ送りに寄せた。
      'app/restaurant-test/restaurant-console.tsx',
      'app/rich-menus/page.tsx',
      'app/staff/page.tsx',
      // 友だち属性V8の4タブ（タグ・情報欄・対応マーク・保存した検索）。
      // 表の下にページ送りがあり、1ページごとの件数を選べる。
      // ★V8 統合ユーザーの一覧（ADjK8）。20件ずつのページ送り。
      'app/users/users-v8.tsx',
      'app/webhooks/webhook-interactions.tsx',
      'app/webhooks/webhook-overviews.tsx',
      // ★V8-B ウェビナー一覧（UyUMw）。表の下にページ送りを置く。
      'app/webinars/edit/participants-v8.tsx',
      'app/webinars/list-v8.tsx',
      'components/friend-attributes-v2/tag-list-v2.tsx',
      'components/friend-fields/tags-page-v4.tsx',
      'components/friends/friend-list-table.tsx',
      'components/line-notifications/notification-run-list.tsx',
      'components/ops/knowledge-list.tsx',
      'components/staff/login-audit.tsx',
      'components/support/pending-inbox-card.tsx',
      'components/users/users-table.tsx',
      /*
       * 2026-10-07: 入口が src/v8 の新しい画面を出すようになり、描かれなくなった古い画面ファイル
       * （成果とアフィリエイト・オートメーション・共通アクション・予約設定のタブ・登録メディア・共通情報・
       * イベント一覧・マイル・NEN配信・会員・リマインダ詳細・Googleビジネス・予約台帳・ファイルの検査・
       * タグ・テンプレート・外部連携）も外した。代わりは下の src/v8 の新しい画面。
       */
      /*
       * もう描かれない古い画面ファイル（自動応答・回答フォーム・流入の一覧・リッチメニュー・
       * シナリオ・外部連携のやり取りと送る・受信一覧の旧部品）は 2026-10-06 に外した。
       * 代わりは下の src/v8 の新しい画面。
       */
      // ★V8 友だち属性 タグの一覧（I1E7Bt）。一から書いた画面。表の下にページ送りを置く。
      'v8/tags/tags-tab.tsx',
      // ★V8 友だち属性 対応マーク（vKDj5）。src/v8 に一から書いた。2ページ以上のときだけページ送り。
      'v8/tags/marks-tab.tsx',
      // ★V8 友だち属性 保存した検索（IWnYX）。src/v8 に一から書いた。2ページ以上のときだけページ送り。
      'v8/tags/searches-tab.tsx',
      // ★V8 友だち属性 友だち情報欄（q5gbcM）。src/v8 に一から書いた。2ページ以上のときだけページ送り。
      'v8/tags/fields-tab.tsx',
      // ★V8 テンプレートの一覧（v19Ivv）。新しい置き場（src/v8）に一から書いた。
      'v8/templates/list.tsx',
      // ★V8 一斉配信の一覧（l5V9a）。新しい置き場（src/v8）に一から書いた。
      'v8/broadcasts/list.tsx',
      // ★V8 回答フォームの一覧（I3L41O）。新しい置き場（src/v8）に一から書いた。
      'v8/forms/list.tsx',
      // ★V8 回答フォームの編集（m1cWEy ほか）。登録メディアから選ぶ窓の写しにページ送り。
      'v8/form-edit/media-picker.tsx',
      // V8 のリッチメニュー一覧（src/v8 に一から書いた）。
      'v8/rich-menus/list.tsx',
      // ★V8 自動応答の一覧（uE9gf）。新しい置き場（src/v8）に一から書いた。
      'v8/auto-replies/list.tsx',
      // ★V8 共通情報の一覧（FM94M）。新しい置き場（src/v8）に一から書いた。
      'v8/common-vars/list.tsx',
      // ★V8-B 流入と計測の一覧（xbHxg）。新しい置き場（src/v8）に一から書いた。
      'v8/inflow-links/list.tsx',
      // ★V8 自動応答の実行結果（nWmLg）。表の下にページ送りを置く。
      'v8/auto-replies/runs.tsx',
      // ★V8 シナリオ配信の一覧（axFrW）を src/v8 に一から書いた。ページ送りは共通のまま。
      'v8/scenarios/list.tsx',
      // ★V8 ウェビナーの一覧（UyUMw）。新しい置き場（src/v8）に一から書いた。
      'v8/webinars/list.tsx',
      // ★V8 マイル（OC0gy・S35pO・CJlf4・oRbJi・IRPw8・R6kIG）。src/v8 に一から書いた。
      'v8/mileage/earning-rules.tsx',
      'v8/mileage/rewards.tsx',
      'v8/mileage/balances.tsx',
      'v8/mileage/history.tsx',
      'v8/mileage/score.tsx',
      'v8/mileage/friend-detail.tsx',
      // ★V8 予約設定のメニュー・担当スタッフのタブ（owaS3）。src/v8/booking-menus に書き直した。
      'v8/booking-menus/tabs/menus-tab.tsx',
      'v8/booking-menus/tabs/staff-tab.tsx',
      // ★V8 統括のアカウント（JKjsE）。新しい置き場（src/v8）に一から書いた。
      'v8/hq/home.tsx',
      // ★V8 成果とアフィリエイト（nJlxX・h7dmB・OylSV・aINnz）。src/v8 に一から書いた。
      'v8/affiliates/affiliators.tsx',
      'v8/affiliates/offers.tsx',
      'v8/affiliates/approvals.tsx',
      'v8/affiliates/payment.tsx',
      // ★V8-B NEN配信の一覧（MuhWR・Jxmqh・Tj7n4）。新しい置き場（src/v8）に一から書いた。表の下にページ送りを置く。
      'v8/nen-campaigns/list.tsx',
      // ★V8 外部連携の送る一覧（ZSbFY）。新しい置き場（src/v8）に一から書いた。
      'v8/webhooks/outgoing.tsx',
      // ★V8 外部連携のやり取りの記録（Uv9AA）。表の下にページ送りを置く。
      'v8/webhooks/interactions.tsx',
      // ★V8 会員一覧（AOWoJ）を src/v8 に一から書いた。ページ送りは共通のまま。
      'v8/nen-members/list.tsx',
      // ★V8 マイペット（wTIej）・健康日記（mIwA4）を src/v8 に一から書いた。ページ送りは共通のまま。
      'v8/nen-pets/list.tsx',
      'v8/nen-health/health.tsx',
      // ★V8 オートメーション（LWQXd・g98F9・LnGNw）。新しい置き場（src/v8）に一から書いた。
      'v8/automations/list.tsx',
      'v8/automations/runs.tsx',
      'v8/automations/common-actions.tsx',
      // ★V8 運営の監査ログ（e7ljE）・ナレッジ（h114s）。src/v8/ops に一から書いた。
      'v8/ops/audit.tsx',
      'v8/ops/knowledge.tsx',
      // ★V8 テンプレートのクーポンを作る（S6FEuB）。登録メディアの選ぶ窓を src/v8 に写した。
      'v8/template-edit/media-picker.tsx',
      // ★V8 リマインダの詳細（rbAig・loVfW）。配信予定・実行結果・登録者の表の下にページ送り。
      'v8/reminders/detail.tsx',
      // ★V8 ウェビナーの参加者（uNsEy）。表の下にページ送りを置く。
      'v8/webinar-edit/participants.tsx',
      // ★V8 Googleビジネスの口コミ・投稿（j0Wcg・Cfed0）。2ページ以上のときだけ表の下にページ送り。
      'v8/restaurant/google/reviews.tsx',
      'v8/restaurant/google/posts.tsx',
      // ★V8 予約台帳の一覧（Z3FoM）。src/v8/restaurant に一から書いた。表の下にページ送りを置く。
      'v8/restaurant/reservations/list.tsx',
      // ★V8 ログインユーザー（nku0f）。新しい置き場（src/v8/settings）に書いた。表の下にページ送りを置く。
      'v8/settings/staff/staff.tsx',
      // ★V8 設定のEC連携（GmVR5）・ファイルの検査（PfA4o）。src/v8/settings に一から書いた。表の下にページ送りを置く。
      'v8/settings/ec-commerce/screen.tsx',
      'v8/settings/file-scan/screen.tsx',
      // ★V8 友だち（x6QsVz 一覧・ADjK8 統合ユーザー・hn6Y8 重複検出・Z0jHp UID移行）を src/v8/friends に一から書いた。
      'v8/friends/list/list.tsx',
      'v8/friends/merged/merged.tsx',
      'v8/friends/duplicates/list.tsx',
      'v8/friends/migrations/uid.tsx',
      // ★V8 コンバージョンの一覧（r6dJFy）。新しい置き場（src/v8）に一から書いた。
      'v8/conversions/list.tsx',
      // ★V8 ダッシュボード（WQmep）。対応が必要な受信の表の下にページ送り（v7 と同じ）。
      'v8/dashboard/inbox.tsx',
      // ★V8 集まった回答の1件ずつ見る（MKQyJ）。表の下にページ送りを置く。
      'v8/form-responses/responses.tsx',
      // ★V8 イベント予約の一覧（e2ekFu）。新しい置き場（src/v8）に一から書いた。
      'v8/events/list.tsx',
      // ★V8 登録メディア一覧（O7hUt7）と、写した差し替えの窓（候補のページ送り）。
      'v8/contents/list.tsx',
      'v8/contents/media-replacement-dialog.tsx',
      // ★V8 流入と計測の詳細（Q5le3）。来た友だちの表と注文の明細（写し）の下にページ送り。
      'v8/inflow-links/detail.tsx',
      'v8/inflow-links/ref-orders.tsx',
      'v8/inflow-links/ad-history.tsx',
    ].sort())
  })

  it('全画面共通枠はpageだけでなく親layoutからの到達も調べる', () => {
    const friendsPage = join(SRC, 'app', 'friends', 'page.tsx')
    expect(routeEntryFiles(friendsPage).map((file) => relative(SRC, file))).toContain('app/layout.tsx')
  })
})
