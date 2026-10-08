# 対応状況の札をそろえる（2026-10-08 夜）

オーナーの今回の指示が、CODEX-SCREEN-BRIEF / SONNET-BRIEF にある従来の保留指示を上書きする。
Pencil は変更していない。tagp 枝の TagPill の白地・薄い枠・色の点・墨色の文字・丸い形を参照した。

## 実装

共通部品 `components/shared/status-pill.tsx` と CSS に外形と色の点を集約した。
表示用は高さ22px。枠を加えた分だけ内側の余白を減らし、友だち一覧の行の高さと文字位置を維持した。
Select の `treatment="pill"` も同じ CSS を使い、単一選択・キーボード操作・保存処理は従来の Select に任せる。
未対応＝赤、対応中＝橙、保留＝灰、対応済み＝緑。問い合わせの独自段階は従来の意味の色を保つ。

## 差し替えた画面

- 受信箱：LINE・メールの会話上部の対応状況、右欄の選択と閲覧のみの表示。
- 共通の問い合わせ受信一覧：V8 の行の対応状況（V7 の札を保持）。
- 友だち一覧：対応・担当の列。
- 友だち詳細：頭の札、概要タブの「対応と担当」の状況。
- ダッシュボード：右欄の「現在の対応状況」の4状態。リンクと件数は保持。
- 統括のお問い合わせ一覧、やり取り画面の状態と過去の問い合わせ。
- 運営のお問い合わせ：一覧と詳細の対応段階。

`rg` で `未対応|対応中|対応済み|保留`、`chatStatus`、`SUPPORT_LABELS`、`SUPPORT_STATUS_WORDS` と利用先を確認した。
受信箱の通常のLINE・MAIL一覧は元から行ごとの状態札を出していない（赤い点・太字と上部の状態フィルター）。新しい札は追加していない。
検索条件、選択タブ、集計数、説明文、操作ボタンは状態の札ではないためそのまま。
設定可能な対応マークは固定4状態とは別の印なので変更しない。

## 1440px の比較

| 板 | 画面 | 変更前 | 変更後 | 目視 |
| --- | --- | --- | --- | --- |
| eovoG | 受信箱 | 撮影失敗 | 61% | 会話上部の白い丸札・赤い点・墨色の文字を確認。今回変更していない会話本文、右欄、時刻等に差が残る |
| WQmep | ダッシュボード | 44% | 44% | 右欄4状態を同じ形に統一。表の列、段の高さ等の差が残る |
| x6QsVz | 友だち一覧 | 97% | 97% | 白い丸札・薄い枠・状態色の点・墨色の文字。行の高さを維持し、切れ・重なりなし |

画像と delta は `~/lh-work/design/v8/overlay/pages-pill/` にある。
全画面の合格宣言や PASSED.tsv の更新はしていない。1152px の合格判定は今回行っていない。

受信箱の初回撮影は「Kyohei Yamamoto」がボタンとテキストに重複して撮影道具の strict mode で止まった。
本物の対応表は変更せず `/tmp/lh-pill-map.json` のコピーで eovoG のクリックだけ `Kyohei Yamamoto 8月19日` にした。
URL は従来どおり `/chats?status=unread`。友だちIDによる直接指定は見本のアカウント整合の確認で拒否されたため使用していない。

## 絵との差と対象外

html と設計画像には x6QsVz の色付きの状態札、WQmep の点＋文字が残っている。今回は最新のオーナー決定の形を実装した。
eovoG の会話上部は丸い白い選択札で、今回の形と一致する。
送信済み・予約中・失敗・下書き・未確認・有効/無効など、対応状況以外の札は変更していない。
代表3枚にこれらをすべて同じ白い札にする根拠はない。右欄320px・左メニューの名前変更などは別担当に残した。
API・DB変更は不要。push・PR・DB更新・配備なし。

## 検証

- doctor：`DOCTOR_LOCAL=1`、合格。
- テスト前に取得・取り込んだ `origin/codex/development`：`18f4b9333eed572668ee269110eac06d2f4f4213`（取り込み時点で更新なし）。
- tsc：最終版で成功。
- 関係する試験と設計の見張り：39ファイル・213試験、すべて成功。対象は inbox-chat / friend-detail / friends/list / dashboard、統括問い合わせ、運営問い合わせ、右欄の編集、Select、メール・問い合わせの再取得、direct-values / screen-css-budget / design-debt / size-scale / design-impact / V8境界。
- build：最終版で成功（197ページ生成）。
- verify:design：456件一致・不一致0、合格。
- git diff --check：成功。
- 自分の measure サーバーは `measure.sh --stop pill` で停止。

ダッシュボードの既存試験は共通札の中の色の点を確認するよう更新した。削除した試験はない。
問い合わせの再取得試験は、テーマ取得をモックし、従来の再取得・順序逆転・失敗時の試験を保持した。

反映履歴の文案は `docs/release-log/drafts/kenta-status-pill-2026-10-08.md`。
司令塔が PR を採番したら `unreleased/<PR番号>-kenta-status-pill.md` へ移し、本文にその PR 番号を付ける。番号の先取りはしない。

## 変更ファイル

- `apps/web/src/components/chats/friend-info-sidebar.tsx`
- `apps/web/src/components/shared/select.tsx`
- `apps/web/src/components/shared/status-pill.module.css`
- `apps/web/src/components/shared/status-pill.tsx`
- `apps/web/src/components/support/support-inbox-polling-boundary.test.tsx`
- `apps/web/src/components/support/support-inbox.tsx`
- `apps/web/src/v8/dashboard/dashboard-align.test.tsx`
- `apps/web/src/v8/dashboard/sections.tsx`
- `apps/web/src/v8/friend-detail/detail.tsx`
- `apps/web/src/v8/friend-detail/overview-tab.tsx`
- `apps/web/src/v8/friends/list/list.module.css`
- `apps/web/src/v8/friends/list/list.tsx`
- `apps/web/src/v8/hq/support-detail.module.css`
- `apps/web/src/v8/hq/support-detail.tsx`
- `apps/web/src/v8/hq/support.module.css`
- `apps/web/src/v8/hq/support.tsx`
- `apps/web/src/v8/inbox-chat/head-menus.tsx`
- `apps/web/src/v8/ops/support.tsx`
- `docs/implementation-reports/status-pill-2026-10-08.md`
- `docs/release-log/drafts/kenta-status-pill-2026-10-08.md`
