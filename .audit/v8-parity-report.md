# V8 見本比較（一括・報告だけ・落とさない）

- 実行日: 2026-10-03 23:33（日本時間・再確認）
- 枝: `codex/muse-v8-visual-parity`
- 土台: `origin/codex/development` e58eb9c71（取り込み済み・前回 392d94a735 から更新）
- 道具: `scripts/visual-qa/v8-parity-all.mjs`（対応表 `v8-design-map.json` 504板・再生成しても差分なし）

## 結論（drift の順位は付けられなかった）

この作業場所（Muse の砂場）では撮影ができなかったので、ずれの大きい順の
一覧は出せなかった。理由は2つ（どちらも道具ではなく場所の問題）。23:33 に再確認した。

1. 偽API・web が立てられない: `listen EPERM: operation not permitted 0.0.0.0:3101`
   （砂場が待ち受けを止めている。`require_escalated` は承認が切れていて使えない）
2. ブラウザが開けない: Chromium が `Target page, context or browser has been closed`
   で起動しない（砂場の制限）

動いた確認（ブラウザなしで済む範囲）は全部通した（下の表）。
撮影つきの実行は、手元の NodeTerm（砂場なし）の作業ツリーで下の手順で回せる。
出る一覧の形は `v8-parity-all.mjs` が決めていて、ずれの大きい順・上位30板の
内訳・撮れなかったもの・対象外の数が入る。

## 再確認で通したもの（2026-10-03 23:33）

- 契約5本（unsaved-guard・error-wording・design-debt・direct-values・design-impact）26試験ぜんぶ合格
- 道具の試験4本（v8-parity・v8-board-id-contract・pixel-diff・cited-shots）31試験ぜんぶ合格
- `npx tsc --noEmit` きれい
- 対応表の再生成：504板・場所つき384板で差分なし

## 見本の数の照合（文字で確認・撮影なし）

| 見る所 | 見本の板 | 見本の数 | 偽APIの数 | 状態 |
|---|---|---|---|---|
| 分析の友だち | ws9wt | 1,284人（1,237→1,284） | `/api/analytics/friends` の現在 1,284 | 前から一致 |
| この30日の広告費 | qSTVR | ¥86,000・友だち追加73人・つないだ広告2件・1人あたり¥1,178 | `/api/ad-costs` を新設。Google ¥54,000/45人＋Meta ¥32,000/28人＝¥86,000/73人（86,000÷73≒¥1,178） | 今回そろえた |
| 今月の報酬・成果 | nJlxX | 報酬¥70,400・成果38件・承認待ち5件（入っていない） | 締めの見込み合計 70,400（内訳30,000＋25,000＋15,400）・成果の合計38（16＋12＋6＋3＋1＋0）・承認待ち5件 | 今回そろえた |
| 今月認めた | OylSV | 33件 | 承認済み33件 | 今回そろえた（34→33） |
| 今月動いた | LWQXd | 2,988回・条件外1,240回・失敗6件 | 集計 2,988・1,240・6（合計4,234） | 今回そろえた |

変えた副作用：承認待ちは8→5件・承認済みは34→33件に減った（承認の一覧の絵が変わる）。
締めの内訳・振込の束・明細は触っていない（別の画面が読むため）。

## 再実行の手順（NodeTerm の作業ツリーで）

```sh
git fetch origin codex/development
node scripts/visual-qa/mock-api.mjs &
NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web exec next dev --port 3101 &
node scripts/visual-qa/v8-parity-all.mjs --out scripts/visual-qa/v8-parity-out
```

終わったら `scripts/visual-qa/v8-parity-out/v8-parity-report.md` がずれの大きい順になる。
このファイル（`/tmp/v8-parity-report.md`）と作業場所の `.audit/v8-parity-report.md` に上書きする。

## 対象の板（撮影する順・あいうえお順ではない）
対象 384 板（場所と幅つき 384 のうち page あり 383・なし 1）

| 板 | 文書 | 板の名前 | 開くURL | 幅 | 実装 |
|---|---|---|---|---|---|
| A0pDt | V8 | 自動応答 作る② どんなときに動くか V8 | /auto-replies/edit | 1440 | あり |
| A35Gh | V8 | 設定 ログインユーザー（閲覧のみ）V8 | /staff | 1440 | あり |
| A8jzaQ | V8 | 一覧の状態 | /broadcasts | 1440 | あり |
| AOWoJ | V8-B | 会員 一覧 V8（機能追加 F-19・API待ち） | /nen/members | 1440 | あり |
| ARuZ4 | V8 | シナリオ配信 編集（停止中） V8 | /scenarios/detail | 1440 | あり |
| AYc6O | V8 | 共通情報 編集（変える前に影響を見る） V8 | /contents/vars/edit | 1440 | あり |
| Al4Ek | V8 | シナリオ配信 複製のダイアログ V8 | /scenarios | 1440 | あり |
| AnwtH | V8-B | 統括 バナー生成（画像を取り込む）V8 | /hq | 1440 | あり |
| AqDWN | V8 | 友だち属性 保存した検索の編集 V8 | /tags/searches/edit | 1440 | あり |
| AsfFB | V8-B | 外部連携 一覧 1152 V8 | /webhooks | 1152 | あり |
| AzrZq | V8-B | 分析 成果地点ごとのレポート V8 | /analytics?view=conversion-report | 1440 | あり |
| B24oNg | V8-B | 統括 バナー生成（一覧から外す・確認）V8 | /hq | 1440 | あり |
| B9ZAr | V8-B | 統括 バナー生成（プロジェクト一覧）V8 | /hq | 1440 | あり |
| BERxg | V8-B | 座席・卓管理 V8 | /restaurant-test/tables | 1440 | あり |
| BHEl9 | V8-B | 統括 メンバー（権限を変更する）V8 | /hq | 1440 | あり |
| BOj1a | V8 | ★P6 ログイン・はじめの設定 2026-10-01 | /login | 1440 | あり |
| BVuYh | V8-B | 健康日記 30日のまとめ（引き出し）V8 | /nen/health | 1440 | あり |
| BeNtj | V8 | 一斉配信 予約を取り消す（確かめ）V8 | /broadcasts/reserved | 1440 | あり |
| BnrQp | V8-B | マイル たまる決めごとを作る（競合）V8 | /mileage | 1440 | あり |
| BxGhV | V8 | ★V8 シナリオ配信 一覧の状態 | /scenarios | 1440 | あり |
| BygrU | V8-B | コンバージョン 一覧 1152 V8 | /conversions | 1152 | あり |
| C0lfUP | V8 | 友だち追加時の配信 受け皿の「…」を開いた V8 | /friend-add-settings | 1440 | あり |
| C67dE | V8 | 共通情報 編集（1152）V8 | /contents/vars/edit | 1152 | あり |
| C9fv7A | V8 | 予約設定 メニュー（閲覧のみ）V8 | /booking/menus | 1440 | あり |
| CHz31 | V8-B | 店舗ダッシュボード V8 | /restaurant-test/dashboard | 1440 | あり |
| CJlf4 | V8-B | マイル 友だちの残高 V8 | /mileage | 1440 | あり |
| CVz5d | V8-B | 成果とアフィリエイト 銀行用 CSV（本人確認）V8 | /affiliates | 1440 | あり |
| CYJ0L | V8 | ★P1-2 友だち一覧から開くもの 2026-10-01（機能追加 F-1・API待ち） | /friends | 1440 | あり |
| CyW0E | V8-B | 運営 ダッシュボード V8 | /ops | 1440 | あり |
| D0AOyx | V8-B | プール管理 プールを作る V8 | /notifications | 1440 | あり |
| D6fh3 | V8-B | 統括 お問い合わせ（運営のLINEを登録）V8 | /hq | 1440 | あり |
| D9JALJ | V8-B | 運営 ログイン V8 | /ops | 1440 | あり |
| DA0Ag | V8-B | 外部連携 やり取りの中身 V8（機能追加 F-18・API待ち） | /webhooks | 1440 | あり |
| DkRDE | V8-B | 分析 ファネル V8 | /analytics | 1440 | あり |
| DrwMm | V8-B | LINE通知 送れなかったもの V8 | /notifications | 1440 | あり |
| DxAAA | V8-B | 外部連携 Google Sheets V8 | /webhooks | 1440 | あり |
| E2Any | V8-B | マイル たまる決めごと（閲覧のみ）V8 | /mileage | 1440 | あり |
| E2l8cw | V8-B | ★V8-B コンバージョン 一覧の状態 | /conversions | 1440 | あり |
| E7iAYs | V8-B | ウェビナー ④通知 V8 | /webinars | 1440 | あり |
| EFV8l | V8 | テンプレート リッチメッセージを作る V8（機能追加 F-4・API待ち） | /templates/edit | 1440 | あり |
| EMUl9 | V8-B | 流入と計測 一覧（閲覧のみ）V8 | /inflow-links | 1440 | あり |
| En14p | V8-B | オートメーション 一覧 1152 V8 | /automations | 1152 | あり |
| Eo56k | V8-B | 成果とアフィリエイト レポート V8 | /affiliates | 1440 | あり |
| EsYo4 | V8 | テンプレート リサーチを作る V8 | /templates/edit | 1440 | あり |
| F3X1Mo | V8 | 詳細（送った後） | /broadcasts/detail | 1440 | あり |
| F4gELj | V8 | リッチメニュー 作る④ 公開 V8 | /rich-menus/new | 1440 | あり |
| FDBsG | V8-B | 流入と計測 広告とのつなぎ V8（機能追加 F-21・API待ち） | /inflow-links | 1440 | あり |
| FM94M | V8 | 共通情報 一覧 V8 | /contents/vars | 1440 | あり |
| FU2aU | V8 | ★P3 一斉配信の作成 /broadcasts/new（5つの手順）2026-10-01 | /broadcasts/new | 1440 | あり |
| FvbHW | V8-B | 運営 メンバー管理 V8 | /ops | 1440 | あり |
| G4GejG | V8 | 自動応答 かんたんに作る（小窓 560）V8（機能追加 F-7・API待ち） | /auto-replies | 1440 | あり |
| G83vi | V8-B | 分析 レポートを作る（競合）V8 | /analytics | 1440 | あり |
| G8i4xP | V8 | ★V8 自動応答 一覧の状態 | /auto-replies | 1440 | あり |
| G9C4Uw | V8 | 友だち 重複検出（1152）V8 | /friends/identity-candidates | 1152 | あり |
| GVizd | V8 | 回答フォーム アーカイブ・削除 V8 | /form-submissions | 1440 | あり |
| GmVR5 | V8-B | 設定 EC連携 V8 | /notifications | 1440 | あり |
| GobMd | V8 | 友だち属性 友だち情報欄の移行 V8 | /tags/fields/migrate | 1440 | あり |
| Gqve5 | V8-B | 成果とアフィリエイト アフィリエイターを作る（競合）V8 | /affiliates | 1440 | あり |
| GrnO4 | V8 | 回答フォーム 一覧（1152）V8 | /form-submissions | 1152 | あり |
| GtI4Y | V8-B | 流入と計測 QR コードの小窓 V8 | /inflow-links | 1440 | あり |
| Guoye | V8 | 自動応答 作る④ 優先順位 V8 | /auto-replies/edit | 1440 | あり |
| GwKE2 | V8-B | 統括 LINEアカウントを登録 ③基本情報 V8 | /hq | 1440 | あり |
| H5UoIu | V8-B | 分析 レポートを作る V8 | /analytics | 1440 | あり |
| HMpVx | V8-B | 統括 アカウント（アカウントの設定）V8 | /hq | 1440 | あり |
| Hhl9M | V8 | 共通情報 止めるダイアログ V8 | /contents/vars | 1440 | あり |
| Hn9eE | V8 | 友だち 統合ユーザーの詳細 V8 | /friends/detail | 1440 | あり |
| I0w2e | V8-B | 統括 バナー生成（アーカイブ・確認）V8 | /hq | 1440 | あり |
| I1E7Bt | V8 | 友だち属性 タグ V8 | /tags | 1440 | あり |
| I2V65v | V8-B | 運用状態 更新履歴 V8 | /notifications | 1440 | あり |
| I3L41O | V8 | 回答フォーム 一覧 V8 | /form-submissions | 1440 | あり |
| IIesG | V8 | 自動応答 行の「…」を開いた V8 | /auto-replies | 1440 | あり |
| IRPw8 | V8-B | マイル 行動スコア V8 | /mileage | 1440 | あり |
| ITBAB | V8 | 回答フォーム 編集（1152）V8 | /form-submissions/edit | 1152 | あり |
| IWnYX | V8 | 友だち属性 保存した検索 V8 | /tags?tab=searches | 1440 | あり |
| If9Mh | V8 | ★P2-2 予約：電話の予約・予約の詳細 2026-10-01 | /booking/bookings/new | 1440 | あり |
| Iffil | V8 | リマインダ 一覧（1152）V8 | /reminders | 1152 | あり |
| IjVpM | V8 | 友だち属性 フォルダを追加（ダイアログ） V8 | /tags/folders/new | 1440 | あり |
| J1VA8 | V8-B | オートメーション 下書きを仕上げる V8（機能追加 F-15・API待ち） | /automations | 1440 | あり |
| J1pdB | V8 | 回答フォーム 編集（競合）V8 | /form-submissions/edit | 1440 | あり |
| J60utH | V8 | テンプレート カルーセルを作る V8 | /templates/carousel | 1440 | あり |
| JB8V1 | V8-B | 統括 請求 V8 | /hq | 1440 | あり |
| JKjsE | V8-B | 統括 アカウント（ホーム）V8 | /hq | 1440 | あり |
| JV2oR | V8 | 回答フォーム 一覧（閲覧のみ）V8 | /form-submissions | 1440 | あり |
| JYfda | V8-B | 統括 LINEアカウントを登録 ②チャネル設定 V8 | /hq | 1440 | あり |
| JeINq | V8 | リッチメニュー 作る① 形と画像 V8 | /rich-menus/new | 1440 | あり |
| Jn95h | V8-B | 投稿 写真の審査（閲覧のみ）V8 | /nen-members | 1440 | あり |
| Jxmqh | V8-B | NEN配信 コラム一覧 V8 | /nen-campaigns | 1440 | あり |
| K7HWG | V8 | 自動応答 作る① 基本設定 V8 | /auto-replies/edit | 1440 | あり |
| K7HYu | V8-B | 統括 統括の情報 V8 | /hq | 1440 | あり |
| KMaMk | V8-B | 流入と計測 作る V8 | /inflow-links | 1440 | あり |
| KdFRI | V8-B | 成果とアフィリエイト アフィリエイター 1152 V8 | /affiliates | 1152 | あり |
| L2Bzp | V8-B | マイル 使い道を作る V8 | /mileage | 1440 | あり |
| L48eY | V8 | 友だち UID移行（本移行と照合・完了） V8 | /friends/migrations | 1440 | あり |
| L4Uov | V8-B | 分析 友だちの増減（閲覧のみ）V8 | /analytics | 1440 | あり |
| L7zA7C | V8 | テンプレート 一覧（1152）V8 | /templates | 1152 | あり |
| LEwkJ | V8 | 友だち追加時の配信 一覧（閲覧のみ）V8 | /friend-add-settings | 1440 | あり |
| LPOe7 | V8-B | ウェビナー ②動画（日時指定・開催回）V8 | /webinars | 1440 | あり |
| LRc93 | V8-B | 統括 テンプレート（ひな形の一覧）V8 | /hq | 1440 | あり |
| LWQXd | V8-B | オートメーション 一覧 V8（機能追加 F-14・API待ち） | /automations | 1440 | あり |
| LnGNw | V8-B | オートメーション 共通アクション V8 | /automations | 1440 | あり |
| M0393 | V8 | ★P4 受信箱 /chats 2026-10-01 | /chats | 1440 | あり |
| M4torY | V8-B | オートメーション ルールを作る V8 | /automations | 1440 | あり |
| M8zhjL | V8-B | マイル マイルを手で増やす・減らす V8 | /mileage | 1440 | あり |
| MJoJR | V8-B | メニュー管理 V8 | /restaurant-test/menu | 1440 | あり |
| MKQyJ | V8 | 回答フォーム 集まった回答（1件ずつ） V8 | /form-submissions/responses | 1440 | あり |
| MRhef | V8 | 友だち追加時の配信 一覧（はじめての人） V8（機能追加 F-8・API待ち） | /friend-add-settings | 1440 | あり |
| Mu8qW | V8-B | イベント予約 申込者 V8 | /events | 1440 | あり |
| MuhWR | V8-B | NEN配信 一覧（自動配信）V8 | /nen-campaigns | 1440 | あり |
| MyJP7 | V8 | 友だち「…」から予約して送る（小窓）V8 | /friends | 1440 | あり |
| N1br7 | V8-B | 投稿 報酬の決まり 版の履歴 V8 | /nen-members | 1440 | あり |
| N43uVX | V8 | 友だち追加時の配信 実行の詳細（失敗あり） V8 | /friend-add-settings/runs/detail | 1440 | あり |
| N8ZrUl | V8-B | 分析 使われ方 V8 | /analytics | 1440 | あり |
| NCbYn | V8 | テンプレート 編集（競合）V8 | /templates/edit | 1440 | あり |
| NGh7b | V8-B | 外部連携 送り先を作る（競合）V8 | /webhooks | 1440 | あり |
| NtCE3 | V8 | 一斉配信 一覧（閲覧のみ）V8 | /broadcasts | 1440 | あり |
| Nv7An | V8-B | マイル 行動スコアを手で直す V8 | /mileage | 1440 | あり |
| O7hUt7 | V8-B | 登録メディア一覧 V8 | /contents | 1440 | あり |
| OC0gy | V8-B | マイル たまる決めごと V8 | /mileage | 1440 | あり |
| OHwbU | V8-B | 運用状態 緊急コントロール V8 | /notifications | 1440 | あり |
| OhguS | V8-B | 統括 お問い合わせ（やり取り）V8 | /hq | 1440 | あり |
| Omqd4 | V8-B | ウェビナー コメント演出 V8 | /webinars | 1440 | あり |
| Oub6x | V8-B | 運営 契約先の詳細 V8 | /ops | 1440 | あり |
| OxEMM | V8 | リッチメニュー 作る③ 誰に出すか V8 | /rich-menus/new | 1440 | あり |
| OxSw8 | V8 | 共通情報 一覧（閲覧のみ）V8 | /contents/vars | 1440 | あり |
| OylSV | V8-B | 成果とアフィリエイト 成果承認 V8 | /affiliates | 1440 | あり |
| P0jhqO | V8-B | 運営 お問い合わせ V8 | /ops | 1440 | あり |
| P20kYU | V8 | 友だち追加時 一覧（1152）V8 | /friend-add-settings | 1152 | あり |
| P6EdLW | V8 | 予約設定 メニュー（1152）V8 | /booking/menus | 1152 | あり |
| P6vbxn | V8 | 一斉配信 かんたんに送る（小窓 640）V8 | /broadcasts | 1440 | あり |
| PFe9c | V8-B | 分析 経路と成果 V8 | /analytics | 1440 | あり |
| PMLkX | V8 | シナリオ配信 編集（稼働中） V8 | /scenarios/detail | 1440 | あり |
| PZBVb | V8-B | LINE通知 記録 V8 | /notifications | 1440 | あり |
| PfA4o | V8 | 設定 ファイルの検査 V8 | /settings/file-scan | 1440 | あり |
| Q0Jrk | V8-B | ウェビナー ③CTA・フォーム V8 | /webinars | 1440 | あり |
| Q28Gb | V8 | 一斉配信 詳細（競合）V8 | /broadcasts/detail | 1440 | あり |
| Q5F2QE | V8 | ★P1-4 友だち詳細 /friends/detail 2026-10-01 | /friends/detail | 1440 | あり |
| Q5lOCc | V8 | 自動応答 一覧（閲覧のみ）V8 | /auto-replies | 1440 | あり |
| Q5le3 | V8-B | 流入と計測 詳細（新）V8 | /inflow-links | 1440 | あり |
| Qat9s | V8 | 友だち属性 タグの編集 V8 | /tags/edit | 1440 | あり |
| QqER7 | V8 | 予約設定 メニューを作る V8 | /booking/menus/new | 1440 | あり |
| R5ckwJ | V8-B | 運営 ナレッジの記事 V8 | /ops | 1440 | あり |
| R6kIG | V8-B | マイル 友だちのマイル詳細（新）V8 | /mileage | 1440 | あり |
| R8NNi | V8-B | マイル 点数の変化の明細 V8 | /mileage | 1440 | あり |
| R9XUMr | V8 | テンプレート 作る：種類を選ぶ V8（機能追加 F-5・API待ち） | /templates | 1440 | あり |
| REIxB | V8 | 友だち追加時の配信 実行結果 V8 | /friend-add-settings/runs | 1440 | あり |
| RaMf3 | V8-B | 成果とアフィリエイト アフィリエイターを作る V8 | /affiliates | 1440 | あり |
| RqO7O | V8 | ★V8 共通情報 状態 | /contents/vars | 1440 | あり |
| RrYYJ | V8 | ★V8 リマインダ 状態 | /reminders | 1440 | あり |
| RwVo5 | V8 | リマインダ 一時停止ダイアログ V8 | /reminders | 1440 | あり |
| S35pO | V8-B | マイル 使い道 V8 | /mileage | 1440 | あり |
| S3pdQ | V8-B | オートメーション 状態 V8 | /automations | 1440 | あり |
| S6FEuB | V8 | テンプレート クーポンを作る V8 | /templates/edit | 1440 | あり |
| SAUCs | V8-B | 外部連携 見本 V8 | /webhooks | 1440 | あり |
| SXCb3 | V8 | ★V8 友だちの残り 状態 | /friends | 1440 | あり |
| SkY9V | V8 | リマインダ 行の「…」を開いた V8 | /reminders | 1440 | あり |
| SyQA1 | V8-B | 投稿 公式サイト掲載 V8（機能追加 F-20・API待ち） | /nen-members | 1440 | あり |
| T0nis | V8 | リマインダ 作る④ 配信予定 V8 | /reminders/new | 1440 | あり |
| Td4TN | V8-B | 成果とアフィリエイト 案件を作る V8（機能追加 F-23・API待ち） | /affiliates | 1440 | あり |
| Tj7n4 | V8-B | NEN配信 送った履歴 V8 | /nen-campaigns | 1440 | あり |
| TkA4D | V8-B | 投稿 写真の審査 V8 | /nen-members | 1440 | あり |
| TvXII | V8-B | 統括 LINEアカウントを登録 ⑤完了 V8 | /hq | 1440 | あり |
| U0aKD | V8 | ★V8 友だち属性 一覧の状態 | /tags | 1440 | あり |
| U5rxyH | V8 | シナリオ 作る②（1152）V8 | /scenarios/first-step | 1152 | あり |
| U8Xm3X | V8 | 友だち追加時の配信 作る⑤ 確認 V8 | /friend-add-settings/publish | 1440 | あり |
| UGrd2 | V8 | 自動応答 編集（競合）V8 | /auto-replies/edit | 1440 | あり |
| URzvC | V8-B | ★V8-B 流入と計測 一覧の状態 | /inflow-links | 1440 | あり |
| UTbi1 | V8 | テンプレート 詳細（未公開の変更あり） V8 | /templates/detail | 1440 | あり |
| UcBQ5 | V8-B | 統括 バナー生成（参照画像を選ぶ）V8 | /hq | 1440 | あり |
| Uv9AA | V8-B | 外部連携 やり取りの記録 V8 | /webhooks | 1440 | あり |
| UyUMw | V8-B | ウェビナー 一覧 V8 | /webinars | 1440 | あり |
| V4LjH | V8 | 自動応答 作る 完了（有効にした） V8 | /auto-replies/publish | 1440 | あり |
| V6JFnd | V8 | テンプレート 削除（使っていない） V8 | /templates | 1440 | あり |
| V6xAo | V8 | シナリオ配信 作る②（1通目を設定） V8 | /scenarios/first-step | 1440 | あり |
| V7vn3 | V8-B | 設定 LINEアカウント V8 | /notifications | 1440 | あり |
| VE1u5 | V8 | リマインダ 作る① 基本設定 V8 | /reminders/new | 1440 | あり |
| VLEaj | V8 | 予約設定 担当スタッフ V8 | /booking/staff | 1440 | あり |
| VWNaA | V8-B | ウェビナー ②動画 V8 | /webinars | 1440 | あり |
| VXZ6T | V8-B | ウェビナー アーカイブの確認 V8 | /webinars | 1440 | あり |
| VdKOK | V8-B | 飲食店向け 利用規約 V8 | /restaurant-test/dashboard | 1440 | あり |
| VsSyu | V8 | リマインダ 削除ダイアログ V8 | /reminders | 1440 | あり |
| VtJQ6 | V8-B | 運営 代理ログイン中（閲覧のみ）V8 | /ops | 1440 | あり |
| W5Wxr | V8-B | 統括 バナー生成（画像ライブラリ）V8 | /hq | 1440 | あり |
| W7Z57 | V8-B | 統括 バナー生成（プロジェクトを作る）V8 | /hq | 1440 | あり |
| WPrd5 | V8 | 自動応答 一覧（1152）V8 | /auto-replies | 1152 | あり |
| WQmep | V8 | ダッシュボード V8 | / | 1440 | あり |
| WSGvo | V8-B | コンバージョン 一覧（閲覧のみ）V8 | /conversions | 1440 | あり |
| X0QrW0 | V8 | シナリオ配信 一覧（閲覧のみ）V8 | /scenarios | 1440 | あり |
| X4JcOf | V8-B | 統括 テンプレート（ひな形を作る）V8 | /hq | 1440 | あり |
| X4STXS | V8 | シナリオ配信 配信結果 V8 | /scenarios/results | 1440 | あり |
| XCUNf | V8-B | ウェビナー ⑤確認 V8 | /webinars | 1440 | あり |
| XIzkJ | V8 | 共通情報 一覧（1152）V8 | /contents/vars | 1152 | あり |
| XJUqs | V8 | 自動応答 作る⑤ 確認 V8 | /auto-replies/publish | 1440 | あり |
| XWtYC | V8-B | 運営 契約先アカウント V8 | /ops | 1440 | あり |
| XXFT4 | V8 | 回答フォーム 編集（答え終わったあと） V8 | /form-submissions/edit | 1440 | あり |
| XjOte | V8-B | 流入と計測 サイトスクリプト V8 | /inflow-links | 1440 | あり |
| Xr6eu | V8 | 一斉配信・自動応答 作るボタンの分け方 V8 | /broadcasts | 1440 | あり |
| Y4LkX1 | V8-B | 設定 運用状態 V8 | /notifications | 1440 | あり |
| Y8SjT2 | V8-B | 予約枠・在庫 V8 | /restaurant-test/inventory | 1440 | あり |
| Y9ASp | V8 | リッチメニュー 一覧（1152）V8 | /rich-menus | 1152 | あり |
| YChR6 | V8 | リマインダ 作る② 対象者と止める条件 V8 | /reminders/new | 1440 | あり |
| Z0g3si | V8 | テンプレート 削除（使っている所がある） V8 | /templates | 1440 | あり |
| Z0jHp | V8 | 友だち UID移行（要確認の判断） V8（機能追加 F-3・API待ち） | /friends/migrations | 1440 | あり |
| Z0uO6 | V8 | リッチメニュー 作る② ボタンの動き V8 | /rich-menus/new | 1440 | あり |
| Z2LIUx | V8 | 自動応答 作る②（1152）V8 | /auto-replies/edit | 1152 | あり |
| Z3FoM | V8-B | 予約台帳 一覧 V8 | /restaurant-test/reservations | 1440 | あり |
| Z9wXm | V8 | 回答フォーム この版を公開（確かめ） V8 | /form-submissions/edit | 1440 | あり |
| ZJIyl | V8-B | マイル たまる決めごと 1152 V8 | /mileage | 1152 | あり |
| ZSbFY | V8-B | 外部連携 一覧（こちらから送る）V8 | /webhooks | 1440 | あり |
| ZoKow | V8 | リッチメニュー 一覧（閲覧のみ）V8 | /rich-menus | 1440 | あり |
| a1k3d | V8 | テンプレート メッセージを作る（1152）V8 | /templates/edit | 1152 | あり |
| a5C1p | V8 | リマインダ 一覧（閲覧のみ）V8 | /reminders | 1440 | あり |
| aINnz | V8-B | 成果とアフィリエイト 支払い V8 | /affiliates | 1440 | あり |
| aPeD8 | V8 | 友だち属性 一覧（1152）V8 | /tags | 1152 | あり |
| acRIl | V8 | ★P2 予約 /booking/bookings（今日・今週・今月・一覧）2026-10-01 | /booking/bookings | 1440 | あり |
| ao15G | V8-B | 飲食店向け 店舗を追加 ①利用規約への同意 V8 | /restaurant-test/dashboard | 1440 | あり |
| apLqS | V8 | リマインダ 一覧 V8 | /reminders | 1440 | あり |
| axFrW | V8 | シナリオ配信 一覧 V8 | /scenarios | 1440 | あり |
| b8xBtZ | V8-B | 統括 お問い合わせ V8 | /hq | 1440 | あり |
| bKipf | V8 | 機能設定（1152）V8 | /settings | 1152 | あり |
| bR6a1 | V8 | ★V8 設定 状態 | /settings | 1440 | あり |
| bSp4h | V8-B | 組織・権限 V8 | /restaurant-test/organization | 1440 | あり |
| bglah | V8-B | 分析 保存した分析 V8 | /analytics | 1440 | あり |
| c7dxp | V8-B | オートメーション 見本 V8（機能追加 F-16・API待ち） | /automations | 1440 | あり |
| cFo2p | V8 | 友だち追加時の配信 受け皿は止められない（案内） V8 | /friend-add-settings | 1440 | あり |
| cIdA2 | V8 | 設定 マニュアルの正本表 V8 | /settings/manual-links | 1440 | あり |
| cXqlS | V8-B | コンバージョン 作る（競合）V8 | /conversions | 1440 | あり |
| cdZBf | V8 | 予約した後 | /broadcasts/reserved | 1440 | あり |
| cgiGB | V8 | 詳細（下書き） | /broadcasts/detail | 1440 | あり |
| cniyw | V8-B | 投稿 採用 V8 | /nen-members | 1440 | あり |
| ctLwT | V8-B | マイル たまる決めごとを作る V8 | /mileage | 1440 | あり |
| cuR8I | V8 | テンプレート 公開する（確かめ） V8 | /templates/detail | 1440 | あり |
| d4adD4 | V8-B | イベント予約 イベントを作る V8 | /events | 1440 | あり |
| d9xoI | V8 | 友だち属性 タグを作る V8 | /tags/new | 1440 | あり |
| dnzqC | V8 | シナリオ配信 作る①（シナリオ情報・配信方式） V8 | /scenarios/new | 1440 | なし |
| dzx5D | V8-B | 専用機能 状態 V8 | /nen/members | 1440 | あり |
| e0FD1J | V8 | 友だち追加時の配信 作る 完了（有効にした） V8 | /friend-add-settings/publish | 1440 | あり |
| e2ekFu | V8-B | イベント予約 一覧 V8 | /events | 1440 | あり |
| e5yBLx | V8-B | 会員 ランク設定（競合）V8 | /nen/members | 1440 | あり |
| e7ljE | V8-B | 運営 監査ログ V8 | /ops | 1440 | あり |
| eAQ3t | V8-B | ウェビナー 状態 V8 | /webinars | 1440 | あり |
| eEhYU | V8-B | 分析 友だちの増減 1152 V8 | /analytics | 1152 | あり |
| eLjeQ | V8-B | マイペット ペットの情報を直す V8 | /nen/pets | 1440 | あり |
| f3SoAm | V8 | ★V8 リッチメニュー 状態 | /rich-menus | 1440 | あり |
| faGn4 | V8-B | 飲食店向け 店舗を追加 ②店舗の基本情報 V8 | /restaurant-test/dashboard | 1440 | あり |
| fb9NJ | V8-B | 会員 ランク設定 V8 | /nen/members | 1440 | あり |
| fcg2D | V8 | 友だち 重複候補を比べて決める V8 | /friends/identity-candidates | 1440 | あり |
| fkGUR | V8 | 友だち属性 タグ（閲覧のみ）V8 | /tags | 1440 | あり |
| g3iDs | V8-B | LINE通知 V8 | /notifications | 1440 | あり |
| g98F9 | V8-B | オートメーション 動いた記録 V8 | /automations | 1440 | あり |
| gW0F2 | V8-B | 外部連携 こちらで受け取る V8 | /webhooks | 1440 | あり |
| gjUz3 | V8-B | LINE通知 運用者へのお知らせを作る V8 | /notifications | 1440 | あり |
| h114s | V8-B | 運営 ナレッジ V8 | /ops | 1440 | あり |
| h1G4d | V8-B | 分析 Search Console V8 | /analytics | 1440 | あり |
| h7A2F | V8-B | マイペット ごはんの目安 V8 | /nen/pets | 1440 | あり |
| h7dmB | V8-B | 成果とアフィリエイト 案件 V8 | /affiliates | 1440 | あり |
| hEDTK | V8 | テンプレート 一覧（閲覧のみ）V8 | /templates | 1440 | あり |
| hKr8f | V8 | リッチメニュー 公開した（公開の進み） V8 | /rich-menus/edit | 1440 | あり |
| hadfk | V8-B | 成果とアフィリエイト 成果をまとめて操作（操作を選ぶ）V8 | /affiliates | 1440 | あり |
| hjNpJ | V8 | リマインダ 作る 完了（有効にした） V8 | /reminders/new | 1440 | あり |
| hmr2P | V8-B | イベント予約 変更の確認 V8 | /events | 1440 | あり |
| hn6Y8 | V8 | 友だち 重複検出 V8（機能追加 F-2・API待ち） | /friends/identity-candidates | 1440 | あり |
| hsD8e | V8-B | 外部連携 送り先を作る V8 | /webhooks | 1440 | あり |
| i2ZAS | V8 | ★V8 回答フォーム 状態 | /form-submissions | 1440 | あり |
| i8F12 | V8 | 自動応答 止めるダイアログ V8 | /auto-replies | 1440 | あり |
| iK4cQ | V8-B | 分析 URLクリック V8 | /analytics | 1440 | あり |
| iLJmw | V8-B | EC連携 つなぎ先 V8 | /notifications | 1440 | あり |
| iMnph | V8-B | 統括 バナー生成（プロジェクトの中）V8 | /hq | 1440 | あり |
| ihjfd | V8-B | LINEアカウント 詳細 V8 | /notifications | 1440 | あり |
| ijxur | V8 | 回答フォーム 編集（予約を入れるブロック） V8 | /form-submissions/edit | 1440 | あり |
| j0Wcg | V8-B | Googleビジネス V8 | /restaurant-test/google | 1440 | あり |
| j2hfkS | V8-B | オートメーション 共通アクションを作る V8 | /automations | 1440 | あり |
| j7PP04 | V8-B | ウェビナー ①基本設定（作る）V8 | /webinars | 1440 | あり |
| j8p3yj | V8-B | コンバージョン 作る V8 | /conversions | 1440 | あり |
| jiNg0 | V8-B | ウェビナー 一覧（閲覧のみ）V8 | /webinars | 1440 | あり |
| jjFNi | V8 | 一覧（1152） | /broadcasts | 1152 | あり |
| k32cn | V8 | リマインダ 編集（競合）V8 | /reminders/edit | 1440 | あり |
| kFz4b | V8 | ★V8 友だち追加時の配信 状態 | /friend-add-settings | 1440 | あり |
| kmTab | V8 | リッチメニュー 作る②（1152）V8 | /rich-menus/new | 1152 | あり |
| kz2B6 | V8 | シナリオ配信 編集（競合）V8 | /scenarios/detail | 1440 | あり |
| l5SRfT | V8-B | 外部連携 一覧（閲覧のみ）V8 | /webhooks | 1440 | あり |
| l5V9a | V8 | 一覧 | /broadcasts | 1440 | あり |
| l87p1J | V8 | テンプレート 質問を作る V8 | /templates/questions/new | 1440 | あり |
| l9NlC0 | V8-B | 予約台帳 今日（時間×卓）V8 | /restaurant-test/reservations | 1440 | あり |
| loVfW | V8 | リマインダ 登録者を管理 V8 | /reminders/detail | 1440 | あり |
| ltAaq | V8 | リマインダ 作る⑤ 確認 V8（機能追加 F-10・API待ち） | /reminders/new | 1440 | あり |
| m1cWEy | V8 | 回答フォーム 編集（中身） V8（機能追加 F-11・API待ち） | /form-submissions/edit | 1440 | あり |
| mIwA4 | V8-B | 健康日記 一覧 V8 | /nen/health | 1440 | あり |
| meBRB | V8-B | 統括 テンプレート（アカウントへ配る）V8 | /hq | 1440 | あり |
| n4DT7 | V8-B | 承認ワークフロー（閲覧のみ）V8 | /restaurant-test/approvals | 1440 | あり |
| nAesv | V8-B | EC連携 注文の状況（引き出し）V8 | /notifications | 1440 | あり |
| nH9L8 | V8-B | オートメーション 一覧（閲覧のみ）V8 | /automations | 1440 | あり |
| nJlxX | V8-B | 成果とアフィリエイト アフィリエイター V8 | /affiliates | 1440 | あり |
| nMSiE | V8 | シナリオ配信 編集（配信を始めた直後） V8 | /scenarios/detail | 1440 | あり |
| nWmLg | V8 | 自動応答 実行結果 V8 | /auto-replies/runs | 1440 | あり |
| nku0f | V8 | 設定 ログインユーザー（管理者・権限） V8 | /staff | 1440 | あり |
| oRbJi | V8-B | マイル 履歴 V8 | /mileage | 1440 | あり |
| ooufy | V8 | 予約設定 担当メニューをまとめて決める V8 | /booking/menus/staff | 1440 | あり |
| oqSJP | V8-B | NEN配信 誕生日クーポンの決めごと（引き出し）V8 | /nen-campaigns | 1440 | あり |
| owaS3 | V8 | 予約設定 メニュー V8 | /booking/menus | 1440 | あり |
| p03ImY | V8-B | 統括 バナー生成（生成中）V8 | /hq | 1440 | あり |
| p0kA3 | V8-B | 流入と計測 広告への送信履歴 V8（機能追加 F-22・API待ち） | /inflow-links | 1440 | あり |
| p15At | V8 | 友だち 比べて決める（1152）V8 | /friends/identity-candidates | 1152 | あり |
| p5YuP | V8 | リマインダ 作る③ 通知の中身 V8（機能追加 F-10・API待ち） | /reminders/new | 1440 | あり |
| p82v9 | V8 | 共通情報 作る V8 | /contents/vars/new | 1440 | あり |
| pNiUk | V8 | 詳細（承認待ち） | /broadcasts/detail | 1440 | あり |
| piWhz | V8 | 共通情報 編集（競合）V8 | /contents/vars/edit | 1440 | あり |
| pvimJ | V8-B | ウェビナー ③CTA・フォーム（競合）V8 | /webinars | 1440 | あり |
| q5gbcM | V8 | 友だち属性 友だち情報欄 V8 | /tags?tab=fields | 1440 | あり |
| qSTVR | V8-B | 流入と計測 広告連携 V8 | /inflow-links | 1440 | あり |
| qf3ky | V8-B | 予約枠・在庫（競合）V8 | /restaurant-test/inventory | 1440 | あり |
| qod6X | V8-B | 運営 2要素認証を設定 V8 | /ops | 1440 | あり |
| r1l0bT | V8 | リマインダ 作る③（1152）V8 | /reminders/new | 1152 | あり |
| r4ARpV | V8-B | 統括 メンバー V8 | /hq | 1440 | あり |
| r6dJFy | V8-B | コンバージョン 一覧 V8 | /conversions | 1440 | あり |
| r8dGXT | V8 | リッチメニュー 編集（競合）V8 | /rich-menus/edit | 1440 | あり |
| rI5uh | V8-B | 統括 バナー生成（画像の詳細）V8 | /hq | 1440 | あり |
| rRk0C | V8-B | ★V8-B 成果とアフィリエイト 状態 | /affiliates | 1440 | あり |
| rZEGN | V8 | リッチメニュー 一覧 V8 | /rich-menus | 1440 | あり |
| ralAc | V8-B | 外部連携 API 接続 V8（機能追加 F-17・API待ち） | /webhooks | 1440 | あり |
| rbAig | V8 | リマインダ 詳細（概要） V8 | /reminders/detail | 1440 | あり |
| rfhIf | V8 | 自動応答 作る③ 何を返すか V8 | /auto-replies/edit | 1440 | あり |
| rm92Y | V8-B | 予約台帳 電話の予約を入れる V8 | /restaurant-test/reservations | 1440 | あり |
| susGP | V8 | ★V8 テンプレート 状態 | /templates | 1440 | あり |
| t2SMXX | V8-B | マイペット 一覧 1152 V8 | /nen/pets | 1152 | あり |
| t8WgD8 | V8-B | 承認ワークフロー V8 | /restaurant-test/approvals | 1440 | あり |
| tJqST | V8-B | オートメーション ルールを作る（競合）V8 | /automations | 1440 | あり |
| tQ2MJ | V8-B | 運営 お知らせ V8 | /ops | 1440 | あり |
| tVaUh | V8-B | 運営 メンバーの招待 V8 | /ops | 1440 | あり |
| tnTn9 | V8-B | 成果とアフィリエイト アフィリエイターの詳細（引き出し）V8 | /affiliates | 1440 | あり |
| tpRRT | V8 | 回答フォーム 編集（受付と見た目） V8 | /form-submissions/edit | 1440 | あり |
| u3iab3 | V8-B | 設定 プール管理 V8 | /notifications | 1440 | あり |
| u5CuB8 | V8-B | 分析 クロス分析 V8 | /analytics | 1440 | あり |
| u5YC6 | V8 | テンプレート メッセージを作る V8 | /templates/edit | 1440 | あり |
| u8sKN | V8 | 自動応答 削除ダイアログ V8 | /auto-replies | 1440 | あり |
| u8xibp | V8-B | LINE通知 運用者へのお知らせ V8 | /notifications | 1440 | あり |
| uBMuB | V8-B | ウェビナー 一覧 1152 V8 | /webinars | 1152 | あり |
| uE9gf | V8 | 自動応答 一覧 V8 | /auto-replies | 1440 | あり |
| uNsEy | V8-B | ウェビナー 参加者 V8 | /webinars | 1440 | あり |
| ujcar | V8-B | 投稿 この写真を見送る V8 | /nen-members | 1440 | あり |
| ulq9Y | V8 | 友だち属性 対応マークの編集 V8 | /tags/marks/edit | 1440 | あり |
| usDpO | V8-B | 成果とアフィリエイト 期間を締める（確かめ）V8 | /affiliates | 1440 | あり |
| v0SbYR | V8 | 回答フォーム 集まった回答（まとめて見る） V8 | /form-submissions/responses | 1440 | あり |
| v19Ivv | V8 | テンプレート 一覧（メッセージ） V8 | /templates | 1440 | あり |
| v2KMj | V8-B | 統括 LINEアカウントを登録 ④接続確認 V8 | /hq | 1440 | あり |
| v5L19Z | V8 | 予約設定 メニュー編集（競合）V8 | /booking/menus/new | 1440 | あり |
| v9JWQ | V8-B | 成果とアフィリエイト アフィリエイター（閲覧のみ）V8 | /affiliates | 1440 | あり |
| vKDj5 | V8 | 友だち属性 対応マーク V8 | /tags?tab=marks | 1440 | あり |
| vWJEm | V8-B | 流入と計測 作る（競合）V8 | /inflow-links | 1440 | あり |
| w1W8h | V8-B | EC連携 会員のつき合わせ V8 | /notifications | 1440 | あり |
| w5pwG | V8-B | NEN配信 配信を直す（口コミのお願い）V8 | /nen-campaigns | 1440 | あり |
| w9zY5 | V8 | 友だち属性 友だち情報欄を作る・編集 V8 | /tags/fields/edit | 1440 | あり |
| wTIej | V8-B | マイペット 一覧 V8 | /nen/pets | 1440 | あり |
| wWrpY | V8-B | 外部連携 状態 V8 | /webhooks | 1440 | あり |
| wbDHy | V8 | ログインユーザー（1152）V8 | /staff | 1152 | あり |
| wjfLe | V8 | シナリオ 一覧（1152）V8 | /scenarios | 1152 | あり |
| wqC8x | V8-B | EC連携 定期便 V8 | /notifications | 1440 | あり |
| ws9wt | V8-B | 分析 友だちの増減 V8 | /analytics | 1440 | あり |
| wxIQ7 | V8 | リッチメニュー 切替のつながり V8 | /rich-menus/connections | 1440 | あり |
| x2dSNv | V8-B | LINEアカウント 乗り換え V8 | /notifications | 1440 | あり |
| x6QsVz | V8 | 友だち一覧 V8（閲覧のみ） | /friends | 1440 | あり |
| xCoDe | V8 | ★V8 予約設定 状態 | /booking/menus | 1440 | あり |
| xLpnS | V8-B | LINE来店フォロー V8 | /restaurant-test/line-followup | 1440 | あり |
| xbHxg | V8-B | 流入と計測 一覧 V8 | /inflow-links | 1440 | あり |
| xj3zz | V8-B | 統括 LINEアカウントを登録 ①LINE準備 V8 | /hq | 1440 | あり |
| xn95q | V8 | 友だち属性 タグの編集（競合）V8 | /tags/edit | 1440 | あり |
| xuJ7D | V8-B | 設定 はじめの設定 V8 | /notifications | 1440 | あり |
| xxKtW | V8 | 共通情報 削除ダイアログ V8 | /contents/vars | 1440 | あり |
| xzCK6 | V8-B | 予約台帳 今日（1152）V8 | /restaurant-test/reservations | 1152 | あり |
| y1ztx | V8-B | 流入と計測 一覧 1152 V8 | /inflow-links | 1152 | あり |
| y8QQV | V8-B | 通知 V8 | /notifications | 1440 | あり |
| yLKwV | V8-B | 統括 メンバー（権限者を招待）V8 | /hq | 1440 | あり |
| yOyCg | V8 | リッチメニュー 削除できない理由 V8 | /rich-menus | 1440 | あり |
| yRDwW | V8-B | NEN配信 コラムを書く V8 | /nen-campaigns | 1440 | あり |
| yvOtn | V8-B | 分析 配信の反応 V8 | /analytics | 1440 | あり |
| ywFJT | V8 | 設定 機能設定 V8 | /settings | 1440 | あり |
| ywJ5H | V8 | ★P1 友だち一覧 /friends（個別設計・承認待ち）2026-10-01 | /friends | 1440 | あり |
| z2dgw | V8-B | ウェビナー 分析 V8 | /webinars | 1440 | あり |
| z2tvtX | V8-B | 健康日記 記録の項目 V8 | /nen/health | 1440 | あり |
| zOpMG | V8-B | 統括 バナー生成（上限に達した）V8 | /hq | 1440 | あり |
| zQ5vY | V8-B | 会員 ライフタイム V8 | /nen/members | 1440 | あり |
| zaqP9 | V8-B | マイル 状態 V8 | /mileage | 1440 | あり |
| ziSgL | V8-B | オートメーション 共通アクション 版と使われている場所 V8 | /automations | 1440 | あり |
| ziYCN | V8 | 設定 機能設定（競合）V8 | /settings | 1440 | あり |
| ztgRD | V8 | 設定 並びを変える V8 | /settings | 1440 | あり |
