# LINE Harness V6 指示書(第 3 版・2026-09-03 夕)

第 2 版からの変更: 要件見直し #690、Pencil 修正第 1 ラウンド #692、棚卸し第 1 弾 #700 がすべて codex/development に入った。Codex の #696〜#699 も入った。残りは「PNG を版から外す(進行中)」「第 2 ラウンドの実装画像比較」「棚卸しで見送った 8 件」。

## 0. いま codex/development に入っているもの

| PR | 内容 |
|---|---|
| #690 | 要件定義 34 本の見直し。横断契約の 1 本化、01・25 書き直し、33・34 新規、古い要件の archive |
| #692 | Pencil 修正第 1 ラウンド。全 32 機能の設計画像撮り直し、文字の機械照合、文言そろえ、用語表 |
| #696〜#699 | Codex: cron 整合、AGENTS.md 同期、生成物の差分除外、シナリオ配信の取得 40 件制限 |
| #700 | 棚卸し第 1 弾。通知ルール API の mount、リリース検査の停止解消、ビルド順、壊れた参照 19 箇所、未使用部品 9 本削除、生成物の追跡解除、.env.example |

## 1. 共通の前提

- 正本の順位: Pencil ★V6 → docs/v6-common-rules.md → 要件書(索引 §5 の横断契約が優先) → 共通部品 → 契約テスト。
- 進捗の正本は docs/design-qa/v6-progress-ledger.md(機械生成)。
- **作業を始める前に必ず最新の codex/development を取り込む。** #700 で部品 9 本が消え、基準値(任意値 1192、直書き th 223)が締まっている。古い木で作業すると基準テストで落ちる。
- 反映履歴は docs/release-log/unreleased/<PR番号>-<担当>-<内容>.md。**PR 番号は採番してから書く。先取りしない**(#692 で 693〜701 を先取りし、他人の PR 番号と衝突した)。
- 1 PR = 1 話題。10 話題を 1 ブランチに積まない。
- ファイル所有: Claude(撮影・画面側)は docs/design-qa、docs/design-reference、scripts/visual-qa、apps/web、docs/v6-requirements、Pencil。Codex は apps/worker、packages/db、.github、ツール設定(ESLint など)。相手の領域は Slack で宣言してから。

## 2. 撮影側の Claude へ

> 2026-09-03 追記: 撮影側は 4 セッション並列(S0 共通部品 + S1〜S3 機能担当、Opus 5)に分ける。担当分けと各セッションに貼る指示は `docs/v6-parallel-plan.md`、Pencil の AI に貼る修正指示は `docs/v6-pencil-fix-prompt.md`。以下の単独セッション向けの指示は、並列計画に置き換わる。

```
目的: Pencil ★V6 と実装を一致させる第 2 ラウンド。担当は「PNG の整理 → 実装画像の比較 → 画面側の直し」。
所有: docs/design-qa、docs/design-reference、scripts/visual-qa、apps/web(画面と共通部品)、Pencil。apps/worker と packages/db は Codex。

最初に:
- git pull で最新の codex/development を取り込む(#700 が入っている)。手元の未コミットの撮影結果(PNG 260 枚、txt 85 枚)は pull 後にコミットする。
- 手元で web テストを回すときは NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 を付ける(CI と同じ)。付けないと api.ts の import で 6 ファイル落ちる。

順番:
1. PNG を版から外す(進行中の作業を完了させる)。
   - .gitignore で docs/design-qa と docs/design-reference の PNG を外し、台帳が名指しする分だけ残す(screens.mjs と docs が名指しする PNG は 58 件、うち今も追跡中は 42 件。「49 枚」の一覧を持っているならそちらを正とし、差分の理由を PR に書く)。
   - 名指しされているのに木に無い 16 件(broadcasts-v6/cPk8A-1440、sqFXf-1440、common-vars-v6/uNBlA-1920 など)は、台帳の出典を直すか撮り直す。
   - operations-v6/UhC2O の 2 枚(9 MB ずつ、高さ 19,629px)は異常。撮影ハーネスに高さの上限を入れて撮り直す。
   - Playwright の基準画像 44 枚(scripts/visual-qa/capture.spec.mjs-snapshots、8.4 MB)は決定済み: 版から外す(.gitignore)。
   - .txt は残す(判定の出典 237 箇所、機械照合の入力)。
2. 第 2 ラウンド: 実装画像を撮り、compare-text で文字を照合し、設計と並べて判定する。機能ごとに 1 PR。「一致」は文言一致 + 寸法一致 + 全状態撮影済みのときだけ。judgment を書き換えたら v6-progress-ledger.md を再生成して同じ PR に入れる。
3. 画面側の直し(部品から先に):
   - list-toolbar.tsx の「準備中」を全廃(動くまで描かない)。全体で 128 箇所。契約テストで「page.tsx が準備中を含まない」を機械で禁止する。
   - 素の confirm() / alert() 51 箇所(booking 配下 6、rich-menus/edit 16 ほか)を components/shared/confirm-dialog.tsx へ寄せ、禁止の契約テストを全画面に広げる。
   - 1440px の折り返し規則を admin-ui-design-guidelines.md に足し(名前列は省略しない、重要度の低い列を先に隠す)、シナリオ一覧 TC1b1 の省略を直す。
   - 色トークンの 3 系統(緑 2 色、赤 3 色)を 1 本に。--color-v6-ink-faint(3.16:1)は捨てて #6e7781 側へ。角丸の同値別名(10px×3、8px×3、3px×2)も削る。
   - PageHeader と StickyBar を 130 ページへ、素の select 222 行を shared/select へ。1 部品 1 PR。
   - V2/V3 の検証島(tags-v2、tags-v3、visual-qa 4 画面、components/friend-attributes-v2 と -v3 の 10 本、sidebar.tsx の /tags-v2 分岐、globals.css の .friend-attributes-v2-shell)を消す。route-integrity.test.ts の必須ルート一覧から /tags-v2 を外すのを忘れない。
   - /updates を消して /emergency の履歴パネルに一本化(同じ取得を 2 回書いている)。_redirects の /updates 転送は残す。
   - /hq に「プール」タブを足し、既存の /pools 画面へつなぐ(決定済み。33 アカウント設定の新規画面に吸収するまでの導線)。
4. Pencil 側: 横断レビュー §7 の 50 件のうち未反映分を反映し、反映した行に日付を書く。設計画像が無い機能(4、9〜32)を書き出す。主ボタンは背景 #068a3c + 白文字に変える(決定済み)。LINE の緑 #06c755 は選択状態・チップ・有効表示に残す。

守ること: 古い木で作業しない。PR 番号を先取りしない。設計を変えるときは Pencil が先。
```

## 3. Codex へ

```
目的: API・性能・段取り。画面の見た目と要件書は Claude の領域。
所有: apps/worker、packages/db、.github、ツール設定(ESLint、vitest、tsconfig)。screens.mjs、components/shared、docs/v6-requirements は触らない。
読むもの: docs/v6-requirements/v6-25-automation-action-contract.md、v6-shared-platform-requirements.md §6-2 / §9 / §10、v6-30 §7〜§8。

最初に:
- codex/development をステージングへ配備し、次の 3 つを動作確認する。
  a. シナリオ配信の取得が 40 件で止まり、2 回目の cron で残りが送られる(41 件以上のデータで)。
  b. migration 267 の時刻正規化後、next_delivery_at の形式が混在していない。
  c. 運用者通知ルールの保存と一覧(/api/notifications/rules)。#700 で mount したので初めて動く。2026-05 に外された経緯があるため、DB の notification_rules に古い行が残っていないかも見る。

順番:
1. 手元の検査環境: ESLint 設定が無く next lint が対話で止まる。eslint.config.mjs を置き、eslint-disable 44 件を棚卸しする(効いていないコメント)。apps/liff に typecheck を足して required-pr-gate に入れる。
2. CI の重複: deploy-scripts-ci と worker-ci の内容は required-pr-gate に丸ごと含まれている。push トリガーだけ残して PR では 1 回にする。deploy-pages.yml は gh-pages ブランチが無く永久に発火しないので消す。labeler.yml は使う workflow が無いので消す(上流同期で戻る可能性があるので理由を書いておく)。
3. release-log: 旧 docs/release-log/unreleased.md(1 ファイル方式)をゲートで受け付けないようにし、per-PR ファイルだけにする。ゲートで「見出しは 追加 / 変更 / 修正 だけ」も検査する(#692 で 改善 / 不具合修正 が通った)。
4. migration の採番: 重複 11 組と欠番 4 箇所がある。check-migrations.ts の比較を辞書順から数値に直し(4 桁になると黙って外れる)、`_next` 接尾辞の作り直しも通す。採番は「取ってから書く」を AGENTS.md に足す。
5. 緊急停止のスナップショット(apps/web/src/app/emergency/page.tsx)が localStorage。サーバ側の保存 API を作る(画面側の差し替えは Claude)。localStorage の値で権限を出し分けている 4 箇所は、実際の可否を必ず worker 側で再判定する。
6. 一覧 API の limit を共通ミドルウェアで上限 200 にクランプ(routes/friends.ts:151 など)。
7. deny-by-default: route metadata の無い管理 API を CI で落とす(v6-30 §8)。
8. 未実装 28 画面のうち API 待ち 8 件とルート不在 8 件のバックエンドを、接続契約のカタログ名で実装する。
9. wrangler.toml の直書き(CF_ACCOUNT_ID、XSERVER_MAIL_HOST / USER / RELAY_URL)を secret へ移す。RAW_MAIL は本番に束縛が無いので、飲食店機能を本番で使うなら束縛を足す(使わないなら現状の任意のまま)。

守ること: 1 PR 中央値 10 ファイル以内。再試行回数を独自に決めない(§6-2)。未取得を 0 と返さない(§9)。本番 DB・本番コードは対象外。ステージング配備は作業ツリーがクリーンで HEAD がリモートと一致してから。
```

## 4. 決定済み(2026-09-03、利用者の委任により決定)

| 判断 | 決定 | 理由 |
|---|---|---|
| Lステップ検証用アカウント | 契約しない(不可) | 未確認前提(docs/lstep-unverified-assumptions.md)は公開マニュアルと既存の実機調査記録の範囲で潰し、確認できないものは「未確認」のまま要件に残す |
| Playwright 基準画像 44 枚 | 版から外す | CI で一度も走っていない。撮影側 Claude の PNG 除外に含める |
| /pools | 畳まず /hq にタブを足す | BAN 検知と自動アカウント切替の入口。33 アカウント設定の新規画面に吸収する |
| docs/manual と apps/docs | apps/docs が正本。docs/manual は docs/archive/manual へ | placeholder で参照 0 |
| README 4 言語版 | 凍結し「日本語版が正本」を先頭に明記 | 4 本とも v0.13.2 で停止 |
| tags のテナント分離 | 当面 1 デプロイ = 1 組織。S5 のコードは書かない | docs/organization-account-access-policy.md に追記 |
| 主ボタンの文字色 | 背景 #068a3c + 白文字(4.46:1) | #06a94a(3.10:1)では 14px 太字に要る 4.5:1 に届かない。LINE の緑 #06c755 は選択状態・チップ・有効表示に残す。Pencil を先に直し、その後 globals.css で主ボタン用トークンを分ける |
| git 履歴 632 MB の書き換え | 今はやらない | オープン PR 93 本と全クローンが壊れる。PNG 除外で増加を止め、オープン PR が 10 本以下になった時点で push 停止日を決めて一度だけ実施する |

## 5. まだ人が決めること

- なし(上の 8 件で出尽くし)。新たに出たら PR 本文の「人の判断が要る点」に書く。
