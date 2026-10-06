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

  it('共通Paginationを直接importする60ファイルだけを利用先に数える', () => {
    // ダッシュボードの受信カードが自前の「前へ／次へ」をやめて共通へ寄せた。
    // 設計（`vUXKb` / `NjK9q`）は表の下にページ送りがあり、番号で飛べる。
    // 2026-09-02: 成果地点と流入経路の押せない「前へ／次へ」も共通へ寄せた。
    expect(directImporters(files, pagination, importIndex).map((file) => relative(SRC, file)).sort()).toEqual([
      // m15c: 手書きのページ送りを共通 Pagination へ置き換えた10画面を足す。
      'app/accounts/migration.tsx',
      // ★V8 LINEユーザーIDの移行（Z0jHp）。判断一覧は50件ずつのページ送り。
      'app/accounts/uid-migration-v8.tsx',
      // 2026-09-02: 案件一覧が自前のページ送りを持たないまま全件を出していた。
      // 設計 `GH8VL` は表の下にページ送りがある。共通へ寄せた。
      'app/affiliates/tabs.tsx',
      // ★V8-B 成果とアフィリエイト（OylSV 成果承認・h7dmB 案件・aINnz 支払い）。
      // parity-D: アフィリエイター一覧に表の下のページ送りを足した。
      'app/affiliates/v8-affiliates-tab.tsx',
      'app/affiliates/v8-approvals-tab.tsx',
      'app/affiliates/v8-offers-tab.tsx',
      'app/affiliates/v8-payment-tab.tsx',
      // ★V8 自動応答一覧（uE9gf）。表の下にページ送りを置く。
      'app/auto-replies/list-v8.tsx',
      // 2026-09-04: 自動応答の実行結果が入った。表の下にページ送りがある。
      'app/auto-replies/runs/page.tsx',
      // ★V8 自動応答の実行結果（nWmLg）。表の下にページ送りを置く。
      'app/auto-replies/runs/runs-v8.tsx',
      // ★V8 オートメーション一覧（LWQXd）。表の下にページ送りを置く。
      'app/automations/list-v8.tsx',
      'app/automations/page.tsx',
      // ★V8-B オートメーション（g98F9 動いた記録）。一覧は #1297 が正本。
      // 札・表の下にページ送りを置く。
      'app/automations/runs-v8.tsx',
      // 2026-09-27 R24: 実行記録が先頭20件に固定で21件目以降へ届かなかった。
      // 20件ずつのページ送りに寄せた。
      'app/automations/runs/page.tsx',
      'app/booking/bookings/page.tsx',
      // #370: 予約メニュー8件を設計どおり1ページ6件に区切る。
      'app/booking/menus/page.tsx',
      // 予約設定V8（owaS3）のメニュー表も1ページ6件で区切る。
      // タブ分割で settings-v8.tsx から移った。
      'app/booking/menus/settings-tabs/menus-tab.tsx',
      'app/booking/menus/settings-tabs/staff-tab.tsx',
      // #1145(★V8): 一斉配信の一覧。20件ずつのページ送りを共通へ寄せた。
      'app/broadcasts/list-v8.tsx',
      // ★V8-B 共通アクション（LnGNw）。表の下にページ送りを置く。
      'app/common-actions/common-actions-v8.tsx',
      'app/common-actions/page.tsx',
      // N-193/N-205: 登録メディア選択窓。20件ずつのページ送りを共通へ寄せた。
      // ★V8 登録メディア一覧（O7hUt7）。表の下に表示範囲と10/20/50のページ送りを置く。
      'app/contents/list-v8.tsx',
      'app/contents/media-picker-dialog.tsx',
      'app/contents/media-replacement-dialog.tsx',
      'app/contents/page.tsx',
      // #973: 共通情報の変更影響を1件ずつ確認する一覧にページ送りを追加した。
      'app/contents/vars/impact-review.tsx',
      // ★V8 共通情報の一覧（FM94M）。表の下にページ送りを置く。
      'app/contents/vars/list-v8.tsx',
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
      // ★V8-B イベント一覧（Ih3xS）。表の下にページ送りを置く。
      'app/events/events-list-v8.tsx',
      'app/events/page.tsx',
      // 2026-09-24(★V7 #701): 回答フォーム一覧の自前の「前へ／次へ」を共通へ寄せた。1ページだけのときは出さない。
      // ★V8 回答フォーム一覧（I3L41O）。表の下にページ送りを置く。
      'app/form-submissions/list-v8.tsx',
      // #543: 一覧の到達不能な回答表（M2削除）と共に共通Paginationの利用を外した。
      'app/form-submissions/responses/page.tsx',
      'app/hq/account-browser-v8.tsx',
      // IDEA-18 (#1036): 経路別の注文明細が増えても画面を重くしないよう
      // サーバが数えた総数でページ送りを出すため共通へ寄せた。
      'app/inflow-links/_components/ref-orders.tsx',
      // ★V8-B 広告への送信履歴（p0kA3）。表の下にページ送りを置く。
      'app/inflow-links/ad-integration-v8.tsx',
      // #565: 送信履歴が増えても描画を際限なく重くしないよう、20件ずつのページ送りに寄せた。
      'app/inflow-links/ad-integration.tsx',
      // ★V8-B 流入と計測の詳細（Q5le3）。友だちの表の下にページ送りを置く。
      // ★V8-B 流入と計測の一覧（xbHxg）。表の下にページ送りを置く。
      'app/inflow-links/detail/page.tsx',
      'app/inflow-links/inflow-list-v8.tsx',
      'app/inflow-links/page.tsx',
      // #291: 顧客へのお知らせ9種類を、設計どおり1ページ6件に区切る。
      'app/mileage/action-score-tab.tsx',
      // ★V8-B マイルの友だち詳細（R6kIG）。表の下にページ送りを置く。
      'app/mileage/friends/detail/v8-friend-detail.tsx',
      'app/mileage/mileage-history-tab.tsx',
      // R365: 要対応の交換が21件以上あっても残りを出せるよう、20件ずつのページ送りに寄せた。
      'app/mileage/mileage-rewards-tab.tsx',
      'app/mileage/page.tsx',
      // ★V8-B マイル5タブ（OC0gy・S35pO・CJlf4・oRbJi・IRPw8）。表の下にページ送りを置く。
      'app/mileage/v8-balances-tab.tsx',
      'app/mileage/v8-earning-rules-tab.tsx',
      'app/mileage/v8-history-tab.tsx',
      'app/mileage/v8-rewards-tab.tsx',
      'app/mileage/v8-score-tab.tsx',
      // 2026-09-18: NEN配信のコラム一覧（★V6 37-6-A）。8本ずつのページ送り。
      'app/nen-campaigns/nen-campaigns-v8.tsx',
      'app/nen-campaigns/nen-overview.tsx',
      // 2026-09-16 採用: 然の健康日記（★V6 37-4）とマイペット（★V6 37-3）。20頭ずつのページ送り。
      'app/nen/health/health-tab.tsx',
      // ★V8-B 健康日記一覧（mIwA4）。表の下にページ送りを置く。
      'app/nen/health/health-v8.tsx',
      // 2026-09-16: 然の会員一覧（★V6 37-1）。20人ずつのページ送り。
      'app/nen/members/members-tab.tsx',
      // ★V8-B 会員一覧（AOWoJ）。表の下にページ送りを置く。
      'app/nen/members/members-v8.tsx',
      'app/nen/pets/pets-tab.tsx',
      // ★V8-B マイペット一覧（wTIej）。表の下にページ送りを置く。
      'app/nen/pets/pets-v8.tsx',
      'app/ops/audit/page.tsx',
      // 2026-09-04: 7-1-H 実行結果。友だち×通の実行が並ぶので、表の下にページ送りが要る。
      'app/reminders/detail/detail-v8.tsx',
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
      // ★V8-B Googleビジネス（j0Wcg）。口コミ一覧の表の下にページ送りを置く。
      'app/restaurant-test/v8/google.tsx',
      // ★V8-B 予約台帳 一覧（Z3FoM）。表の下にページ送りを置く。
      'app/restaurant-test/v8/reservations.tsx',
      // ★V8 リッチメニュー一覧（rZEGN）。表の下にページ送りを置く。
      'app/rich-menus/list-v8.tsx',
      'app/rich-menus/page.tsx',
      // ★V8 シナリオ一覧（axFrW）。表の下にページ送りを置く。
      'app/scenarios/list-v8.tsx',
      // 監査 R132: ファイル検査の一覧が先頭50件固定で検索・ページ送りが
      // なかった。サーバが数えた総数でページ送りを出すため共通へ寄せた。
      // ★V8 ファイルの検査（PfA4o）。表の下にページ送りを置く。
      'app/settings/file-scan/file-scan-v8.tsx',
      'app/staff/page.tsx',
      // 友だち属性V8の4タブ（タグ・情報欄・対応マーク・保存した検索）。
      // 表の下にページ送りがあり、1ページごとの件数を選べる。
      'app/tags/fields-tab-v8.tsx',
      'app/tags/marks-v8.tsx',
      'app/tags/searches-v8.tsx',
      'app/tags/tags-tab-v8.tsx',
      // ★V8 テンプレート一覧（v19Ivv）。表の下にページ送りがあり、
      // 1ページごとの件数を選べる。
      'app/templates/list-v8.tsx',
      // ★V8 統合ユーザーの一覧（ADjK8）。20件ずつのページ送り。
      'app/users/users-v8.tsx',
      // ★V8-B 外部連携・やり取りの記録（Uv9AA）。表の下にページ送りを置く。
      'app/webhooks/_components/webhooks-v8-interactions.tsx',
      // ★V8-B 外部連携・こちらから送る（ZSbFY）。表の下にページ送りを置く。
      'app/webhooks/_components/webhooks-v8-outgoing.tsx',
      // ★V8-B 外部連携のやり取りの記録（Uv9AA）。表の下にページ送りがある。
      'app/webhooks/interactions-v8.tsx',
      // ★V8-B 外部連携の一覧（ZSbFY）。表の下にページ送りがある。
      'app/webhooks/outgoing-v8.tsx',
      'app/webhooks/webhook-interactions.tsx',
      'app/webhooks/webhook-overviews.tsx',
      // ★V8-B ウェビナー一覧（UyUMw）。表の下にページ送りを置く。
      'app/webinars/edit/participants-v8.tsx',
      'app/webinars/list-v8.tsx',
      'components/friend-attributes-v2/tag-list-v2.tsx',
      'components/friend-fields/tags-page-v4.tsx',
      'components/friends/friend-list-table.tsx',
      'components/inbox/inbox-list.tsx',
      'components/line-notifications/notification-run-list.tsx',
      'components/ops/knowledge-list.tsx',
      'components/staff/login-audit.tsx',
      'components/support/pending-inbox-card.tsx',
      'components/users/users-table.tsx',
      // ★V8 自動応答の一覧（uE9gf）。新しい置き場（src/v8）に一から書いた。
      'v8/auto-replies/list.tsx',
    ].sort())
  })

  it('全画面共通枠はpageだけでなく親layoutからの到達も調べる', () => {
    const friendsPage = join(SRC, 'app', 'friends', 'page.tsx')
    expect(routeEntryFiles(friendsPage).map((file) => relative(SRC, file))).toContain('app/layout.tsx')
  })
})
