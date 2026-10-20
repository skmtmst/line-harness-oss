> 文書：B-244〜B-247 適用の点検表（2026-10-12）｜区分：今の正本｜最終確認：2026-10-19（日本時間）

# B-244〜B-247 適用の点検表（2026-10-12）

対象は現在のV8と、入口から使用する app のV8。残るコピー元もソースの見張りで確認する。入力欄の件数は定義箇所で数え、繰り返し行は1箇所。条件付きの必須も1箇所。共通の包み自体は数えない。

開始HEAD：`40c1a88dba`。試験前に取得した統合先：`d5deaebec39819a933b58179a9b0dd67c745e9ba`。revfix-b の `97e3161f5e` は開始HEADへ取り込み済み。Pen・DB・APIは変更しない。

## 必須の札と欄のエラー

① 任意だった必須欄：98箇所。② 必須の札が無かった欄：9箇所。③ 上のまとめだけだったエラー：10箇所（①②と重複）。以前から必須だった19箇所も保存検査の定義を共有する形へそろえた。任意のままの欄は必須へ変えない。

| 分類 | 画面の実装 | 欄 |
| --- | --- | --- |
| ① | `apps/web/src/v8/rich-menus/new/create.tsx` | メニュー名（友だちには見えません） |
| ① | `apps/web/src/v8/rich-menus/new/create.tsx` | トーク画面の下の文言（14文字まで） |
| ① | `apps/web/src/v8/affiliate-offer-new/create.tsx` | 案件名 |
| ① | `apps/web/src/v8/affiliate-offer-new/create.tsx` | 報酬額（円） |
| ① | `apps/web/src/v8/affiliates/create.tsx` | 名前（表示名） |
| ① | `apps/web/src/v8/analytics/funnel-form.tsx` | 名前 |
| ① | `apps/web/src/v8/analytics/funnel-form.tsx` | {`段${i + 1}の名前`} |
| ① | `apps/web/src/v8/automations/common-action-new.tsx` | 名前 |
| ① | `apps/web/src/v8/automations/create/create.tsx` | {isDraft ? 'ルール名' : '名前'} |
| ① | `apps/web/src/v8/automations/create/create.tsx` | 送る文面 |
| ① | `apps/web/src/v8/booking-menus/tabs/holidays-tab.tsx` | 開始日 |
| ① | `apps/web/src/v8/booking-menus/tabs/holidays-tab.tsx` | 終了日 |
| ① | `apps/web/src/v8/common-vars-edit/edit.tsx` | 変える理由（記録に残ります） |
| ① | `apps/web/src/v8/common-vars-edit/edit.tsx` | 開始日 |
| ① | `apps/web/src/v8/common-vars/list.tsx` | 止める／再開する理由（記録に残ります） |
| ① | `apps/web/src/v8/common-vars/list.tsx` | 消した理由（記録に残ります） |
| ① | `apps/web/src/v8/common-vars/list.tsx` | 削除する場合は、差し込みキーを入力してください |
| ① | `apps/web/src/v8/contents/media-detail-dialog.tsx` | 変更理由 |
| ① | `apps/web/src/v8/conversions/create.tsx` | 名前 |
| ① | `apps/web/src/v8/conversions/create.tsx` | 数えてよいページ |
| ① | `apps/web/src/v8/events/create.tsx` | 日付 |
| ② | `apps/web/src/v8/events/create.tsx` | 開始と終了 |
| ① | `apps/web/src/v8/events/create.tsx` | 定員 |
| ① | `apps/web/src/v8/form-edit/appearance-tab.tsx` | フォーム名 |
| ① | `apps/web/src/v8/friend-add/editor.tsx` | 設定名（60文字まで） |
| ① | `apps/web/src/v8/hq-banners/dialogs.tsx` | プロジェクト名 |
| ② | `apps/web/src/v8/hq-broadcasts/create.tsx` | 含めるタグ |
| ① | `apps/web/src/v8/hq-broadcasts/create.tsx` | 送る日 |
| ① | `apps/web/src/v8/hq-broadcasts/create.tsx` | 時刻（日本時間） |
| ① | `apps/web/src/v8/hq-templates/message-form.tsx` | ひな形の名前 |
| ① | `apps/web/src/v8/hq-templates/message-form.tsx` | 本文 |
| ① | `apps/web/src/v8/hq-templates/message-form.tsx` | ボタンの文字 |
| ① | `apps/web/src/v8/hq/account-dialogs.tsx` | 名前 |
| ① | `apps/web/src/v8/inflow-links/ads.tsx` | 流入元の名前 |
| ① | `apps/web/src/v8/inflow-links/ads.tsx` | 費用（円） |
| ① | `apps/web/src/v8/inflow-links/edit-route-dialog.tsx` | 流入元の名前 |
| ① | `apps/web/src/v8/inflow-links/new/create.tsx` | 名前 |
| ① | `apps/web/src/v8/inflow-links/site-script.tsx` | サイトの名前 |
| ① | `apps/web/src/v8/mileage/earning-rule-new/create.tsx` | 名前 |
| ① | `apps/web/src/v8/mileage/reward-edit.tsx` | 名前 |
| ① | `apps/web/src/v8/mileage/reward-edit.tsx` | 必要マイル |
| ① | `apps/web/src/v8/mileage/score.tsx` | 点数 |
| ① | `apps/web/src/v8/nen-members/lifetime.tsx` | 称号 |
| ① | `apps/web/src/v8/nen-pets/editor.tsx` | ペットの名前 |
| ① | `apps/web/src/v8/ops/announcements.tsx` | 件名 |
| ① | `apps/web/src/v8/ops/announcements.tsx` | 本文 |
| ① | `apps/web/src/v8/ops/knowledge-article.tsx` | 題名 |
| ① | `apps/web/src/v8/ops/knowledge-article.tsx` | 質問 |
| ① | `apps/web/src/v8/ops/knowledge-article.tsx` | 答え |
| ② | `apps/web/src/v8/ops/members.tsx` | 招待する人のメールアドレス |
| ① | `apps/web/src/v8/ops/support.tsx` | 件名 |
| ① | `apps/web/src/v8/ops/support.tsx` | 内容 |
| ① | `apps/web/src/v8/restaurant/closures/closure-dialog.tsx` | はじめの日 |
| ① | `apps/web/src/v8/restaurant/closures/closure-dialog.tsx` | おわりの日 |
| ① | `apps/web/src/v8/restaurant/front-desk/phone-drawer.tsx` | お名前 |
| ① | `apps/web/src/v8/restaurant/google/posts.tsx` | タイトル（特典・イベントのとき） |
| ① | `apps/web/src/v8/restaurant/google/posts.tsx` | 期間 はじめ |
| ① | `apps/web/src/v8/restaurant/google/posts.tsx` | 期間 おわり |
| ① | `apps/web/src/v8/restaurant/google/posts.tsx` | 本文 |
| ① | `apps/web/src/v8/restaurant/reservations/phone.tsx` | 仮押さえの期限（分） |
| ② | `apps/web/src/v8/restaurant/reservations/phone.tsx` | 名前・電話番号で探す |
| ① | `apps/web/src/v8/restaurant/reservations/phone.tsx` | お名前 |
| ① | `apps/web/src/v8/restaurant/reservations/phone.tsx` | 日付 |
| ① | `apps/web/src/v8/restaurant/reservations/phone.tsx` | 時間 |
| ① | `apps/web/src/v8/restaurant/tables/tables.tsx` | 卓番 |
| ① | `apps/web/src/v8/restaurant/tables/tables.tsx` | 表示名 |
| ① | `apps/web/src/v8/settings/file-scan/screen.tsx` | 提供元 |
| ① | `apps/web/src/v8/settings/file-scan/screen.tsx` | 送り先（https） |
| ① | `apps/web/src/v8/settings/line-notifications/operator-tab.tsx` | 書き出す理由 |
| ① | `apps/web/src/v8/settings/line-notifications/screen.tsx` | 通知の見出し |
| ① | `apps/web/src/v8/settings/pools/create.tsx` | プール名 |
| ① | `apps/web/src/v8/tags/field-editor.tsx` | EC側の項目名 |
| ① | `apps/web/src/v8/tags/mark-basic-fields.tsx` | マーク名 |
| ① | `apps/web/src/v8/template-edit/asset.tsx` | テンプレート名 |
| ① | `apps/web/src/v8/template-edit/asset.tsx` | 当たる確率（%） |
| ① | `apps/web/src/v8/template-edit/asset.tsx` | 当選人数の上限（人） |
| ① | `apps/web/src/v8/template-edit/asset.tsx` | 質問文 |
| ① | `apps/web/src/v8/template-edit/message.tsx` | テンプレート名 |
| ① | `apps/web/src/v8/template-edit/rich.tsx` | テンプレート名 |
| ① | `apps/web/src/v8/templates/carousel.tsx` | テンプレート名 |
| ① | `apps/web/src/v8/templates/question-new.tsx` | テンプレート名 |
| ① | `apps/web/src/v8/templates/question-new.tsx` | 質問文（160文字まで） |
| ① | `apps/web/src/v8/templates/question-new.tsx` | ボタンの文字（20文字まで） |
| ① | `apps/web/src/v8/webhooks/incoming.tsx` | 名前 |
| ① | `apps/web/src/v8/webinar-edit/cta.tsx` | 見出し |
| ① | `apps/web/src/v8/webinar-edit/cta.tsx` | 出す時刻（分:秒） |
| ① | `apps/web/src/v8/webinar-edit/cta.tsx` | ボタンの言葉 |
| ② | `apps/web/src/v8/webinar-edit/cta.tsx` | 押したら |
| ① | `apps/web/src/v8/webinar-edit/video.tsx` | 始まり |
| ① | `apps/web/src/v8/webinar-edit/video.tsx` | 終わり |
| ① | `apps/web/src/v8/visit-stamps/dialogs.tsx` | 特典の名前 |
| ① | `apps/web/src/v8/visit-stamps/dialogs.tsx` | 何個で使えるか |
| ① | `apps/web/src/v8/visit-stamps/dialogs.tsx` | 倍率 |
| ① | `apps/web/src/v8/visit-stamps/dialogs.tsx` | 時間の始まり（終わりを選んだとき） |
| ① | `apps/web/src/v8/visit-stamps/dialogs.tsx` | 時間の終わり（始まりを選んだとき） |
| ① | `apps/web/src/v8/visit-stamps/dialogs.tsx` | はじめての来店で足す個数 |
| ① | `apps/web/src/v8/visit-stamps/dialogs.tsx` | ランクの倍率（タグを選んだとき） |
| ① | `apps/web/src/v8/visit-stamps/dialogs.tsx` | 理由 |
| ① | `apps/web/src/v8/visit-stamps/dialogs.tsx` | 店員 |
| ① | `apps/web/src/v8/visit-stamps/dialogs.tsx` | 暗証番号（4桁） |
| ① | `apps/web/src/v8/mileage/reward-edit.tsx` | 交換後に渡すもの（共通アクションのとき） |
| ② | `apps/web/src/v8/tags/field-editor.tsx` | 差し込みの名前（英字） |
| ② | `apps/web/src/v8/hq-broadcasts/create.tsx` | 送るアカウント |
| ② | `apps/web/src/v8/hq-broadcasts/create.tsx` | 配信対象の条件 |
| ② | `apps/web/src/v8/common-vars/list.tsx` | 差し替え・停止の理由（確認窓の下） |
| ① | `apps/web/src/v8/booking-menus/tabs/rules-tab.tsx` | 予約枠の間隔 |
| ① | `apps/web/src/v8/booking-menus/tabs/rules-tab.tsx` | 仮押さえの保持時間 |

| ③ の画面 | 欄 | 直したこと |
| --- | --- | --- |
| 予約設定・休業日 Q01 | 開始日・終了日（2） | 空欄と逆順を欄下へ。必須の札、赤枠、読み上げの理由を接続。理由は任意。入力を残す。 |
| イベント作成 | 開始と終了（1） | それぞれの空欄・時間の逆順を日時の欄下へ。入力を残す。 |
| 運用・メンバー | 招待メール（1） | 空欄を入力窓の下へ。入力は残し、APIを呼ばない。 |
| 共通情報 | 止める／再開する理由・消した理由（2） | 空欄の理由を該当欄の下へ。確認の窓のまとめも残す。 |
| バナーのプロジェクト | プロジェクト名（1） | 文字数の検査など窓の上だけだった理由を欄下へ接続。 |
| 予約のルール | 当日のお知らせ・予約枠の間隔・仮押さえの保持時間（3） | APIの検査と同じ範囲・候補で保存前に確かめ、理由を欄下へ。入力を残す。当日のお知らせは未指定を許すため任意のまま。 |

CTA の「押したら」は既存の欄下エラーを残し、枠と読み上げも同じ欄へ接続した（③の新規件数には数えない）。

## 行メニューの言葉

「見る→変える・整理する→止める・消す」は共通部品で全利用先に適用する。元配列は変更せず、権限・実行処理・hrefを保つ。組の見出しは5項目以上だけ。各項目にアイコンを補う。

| 画面 | 前 | 後 |
| --- | --- | --- |
| `apps/web/src/v8/reminders/list.tsx` | 詳細を見る | リマインダの詳細を見る |
| `apps/web/src/v8/automations/runs.tsx` | 中身を見る | 実行の記録を見る |
| `apps/web/src/v8/broadcasts/list.tsx` | 見る | 配信の詳細を見る |
| `apps/web/src/v8/conversions/list.tsx` | 中身を見る | 成果地点の詳細を見る |
| `apps/web/src/v8/events/list.tsx` | 中身を見る | イベントの設定を見る |
| `apps/web/src/v8/friend-detail/detail.tsx` | リマインダ一覧を見る | この友だちのリマインダを見る |
| `apps/web/src/v8/friends/merged/merged.tsx` | 詳細を見る | 友だちの詳細を見る |
| `apps/web/src/v8/nen-campaigns/list.tsx` | 中身を見る | 配信の文面を見る |
| `apps/web/src/v8/settings/ec-commerce/screen.tsx` | 中身を見る | 友だちの詳細を見る |
| `apps/web/src/v8/webhooks/outgoing.tsx` | 中身を見る | 送信の記録を見る |

## いつも出ていた案内

26箇所の常設の青い説明を、型の「この画面の説明」へ移した（NEN配信の3タブは各1箇所）。画面全体の説明は型の explanation、短い言葉の説明は help に分ける（列車26bの取り込みで、全画面の短い説明まで常時開く退行を防止）。人のIDと画面のパス・tab/view/paneで開閉をブラウザに保存し、名前や説明文は保存しない。

| 画面 | 移した文 | 行き先 |
| --- | --- | --- |
| `apps/web/src/v8/auto-replies/list.tsx` | 上のルールから順に見て、最初に当たった1つだけが動きます。順番は行の左のつまみで入れ替えます。 | 題の下の開閉する説明 |
| `apps/web/src/v8/automations/common-actions.tsx` | 共通アクションは、ルール・シナリオ・自動応答・回答フォーム・リッチメニューから呼び出せる「処理のまとまり」です。公開しても、使っている所は今の版のまま。使う所ごとに新しい版へ切り替えます。 | 題の下の開閉する説明 |
| `apps/web/src/v8/automations/list.tsx` | ルールは1人で試してから動かすと、まちがいを防げます。動いた結果は「動いた記録」で見られます。 | 題の下の開閉する説明 |
| `apps/web/src/v8/automations/runs.tsx` | 「もう一度やる」は、やり直せる失敗（一時的な送信の失敗など）だけに出ます。ブロック中など原因を直す必要があるものには出ません。条件に外れたものは、ルールの「だれに」に当てはまらなかった人です。 | 題の下の開閉する説明 |
| `apps/web/src/v8/contents/list.tsx` | 使っているメディアは消せません。いらなくなったら「アーカイブ」にすると一覧と新規選択から外れます（使っている場所や過去の配信はそのまま動きます）。 | 題の下の開閉する説明 |
| `apps/web/src/v8/conversions/list.tsx` | 成果地点は、配信・流入リンク・アフィリエイトの成果を数えるときに使います。止めると、使っている所でも数えなくなります。 | 題の下の開閉する説明 |
| `apps/web/src/v8/events/list.tsx` | 定員に達すると、お客さまの画面では自動で「満席」になります。キャンセルが出たら、キャンセル待ちの人に自動で順番が回ります。 | 題の下の開閉する説明 |
| `apps/web/src/v8/friend-add/list.tsx` | 経路が分かるのは「流入リンク」から来た人だけです。素のQR・検索から来た人には、いちばん下の「経路が分からなかった人」が動きます。 | 題の下の開閉する説明 |
| `apps/web/src/v8/mileage/balances.tsx` | 残高は数分ごとに計算し直します。「残高を再読み込み」で今すぐ計算し直せます。 | 題の下の開閉する説明 |
| `apps/web/src/v8/mileage/earning-rules.tsx` | 決めごとを変えると、変えたあとの行動から新しい数で付きます。前に付いたマイルは変わりません。 | 題の下の開閉する説明 |
| `apps/web/src/v8/nen-campaigns/list.tsx` | 自動配信は、注文・発送・誕生日などのきっかけで送ります。止めると、そのあとのきっかけでは送りません。 | 題の下の開閉する説明 |
| `apps/web/src/v8/nen-campaigns/list.tsx` | コラムは外部サイトの記事へつなぐカードです。書いたあと、一覧の「この内容で予約する」で LINE に配信します。 | 題の下の開閉する説明 |
| `apps/web/src/v8/nen-campaigns/list.tsx` | いつ・だれに・何を送ったかの記録です。届かなかったものも、ここで理由が分かります。 | 題の下の開閉する説明 |
| `apps/web/src/v8/nen-health/health.tsx` | 「気になる変化」は、体重が8週で±10%以上変わった・便の異常が3回続いた・食いつき不良が3回続いた、のどれかに当てはまるペットです。行の「…」から 30日のまとめ を開けます。 | 題の下の開閉する説明 |
| `apps/web/src/v8/nen-pets/list.tsx` | 体重が90日更新されていないペットは、マイページで更新をお願いできます（行の「…」→マイページで更新を促す）。 | 題の下の開閉する説明 |
| `apps/web/src/v8/restaurant/inventory/stock.tsx` | ここは「席（卓）」に対して受ける予約の枠です。担当スタッフなど「人」に対して受ける予約は、予約設定（メニュー・受付枠・担当スタッフ）で決めます。 | 題の下の開閉する説明 |
| `apps/web/src/v8/rich-menus/list.tsx` | 上のメニューが優先されます。同じ友だちが複数の条件に当てはまるときは、いちばん上の1つだけが出ます。順番は行の左のつまみで入れ替えます。 | 題の下の開閉する説明 |
| `apps/web/src/v8/scenarios/list.tsx` | 作っただけでは送られません。「開始のきっかけ」を決めて、テストを送ってから配信を始めます（配信を始める方法・3手順）。 | 題の下の開閉する説明 |
| `apps/web/src/v8/settings/booking-media/screen.tsx` | 他の予約サイトの空き枠は自動で変更しません。LINE や電話で予約が入ったら、他のサイトの同じ時刻の枠を閉じる知らせを出します。 | 題の下の開閉する説明 |
| `apps/web/src/v8/settings/features/screen.tsx` | 公開中のページや動いている配信・予約は、それぞれの画面で止めてからオフにしてください。並び順は「並びを変える」から入れ替えます。 | 題の下の開閉する説明 |
| `apps/web/src/v8/settings/file-scan/screen.tsx` | 確かめ終わるまで、上げたファイルは配信・公開・審査に出せません。 | 題の下の開閉する説明 |
| `apps/web/src/v8/settings/line-notifications/operator-tab.tsx` | この画面の宛先はお店の人だけです。お客様へ送るものは「顧客へのお知らせ」で設定します。 | 題の下の開閉する説明 |
| `apps/web/src/v8/webhooks/interactions.tsx` | 失敗したものは「もう一度送る」でやり直せます。相手が止まっていたときは、自動で3回までやり直します。 | 題の下の開閉する説明 |
| `apps/web/src/v8/webhooks/outgoing.tsx` | 友だちの動きを、決めたタイミングでほかのシステムへ送ります。送るときは秘密の鍵を付けます。鍵は「…」から作り直せます。 | 題の下の開閉する説明 |
| `apps/web/src/v8/webinar-edit/participants.tsx` | 「見ていない」は申込だけで入場の記録がない人です。「入場のみ」は入場したが再生を確かめられなかった人です。 | 題の下の開閉する説明 |
| `apps/web/src/v8/webinars/list.tsx` | 公開すると、申込ページとLINEの案内が使えるようになります。申込から相談までの流れは、各ウェビナーの「分析」で見られます。 | 題の下の開閉する説明 |

| 残した帯 | 残す理由・例 |
| --- | --- |
| 未設定・候補が読めない | アカウント未選択、LINE未接続、公開版・配信先候補が取得できない等、今の状態の知らせ。 |
| 保存・読み込み・送信の失敗 | 入力・取得済みデータを残し、同じ処理をやり直せる。集計の失敗は共通の状態へ。 |
| 期限・要対応・処理中 | 有効期限、承認待ち、集計の待ち順、処理が続いている知らせ。 |
| 閲覧のみ・編集競合 | 権限と版の不一致を知らせる。押せない編集操作は隠す。 |
| 確認の窓の注意 | 削除・停止・公開で起きる影響。成果地点の停止とNEN自動配信の停止には不足していた影響を追加。 |

## 保存と集計

| 対象 | 当てはめた動き | 確認の試験 |
| --- | --- | --- |
| 予約ルール＋担当 | 完了したルール・担当を記録し、残りの担当だけ再試行。入力が変われば保存済みの版から最新の入力を保存。 | `rules-partial-save.test.tsx` |
| イベント本体＋最初の枠 | 本体を二重に作らず、枠の再試行は同じclient keyを使う。入力が変われば本体を更新。応答喪失で既存枠が返ったときは返された版で日時・定員を更新し、更新応答も失ったら次の再試行で先に読み直す。 | `create-recovery.test.tsx`・`save-initial-slot.test.ts` |
| マイルの特典の下書き＋公開 | 下書き完了と公開失敗を分ける。変更なしなら公開だけ、入力変更後は新しい下書きの版で公開。 | `reward-partial-save.test.tsx` |
| ファネル・クロス分析・成果レポート | 未集計・開始時刻付きの集計中・理由付きの失敗・データの時点付きの完成。404を未集計へ。即時の連打をrefで防ぐ。 | `funnel-read-failure.test.tsx`・`cross-result.react.test.tsx`・`conversion-report-state.test.tsx` |

成果レポートの既存APIはデータの時点を返さないため「未取得」と表示する。取得した時刻をデータの時点と偽らず、APIの追加はしない。

## お客さまで絞る一覧・機能待ち

| 一覧 | 既存APIの確認 | 今回 |
| --- | --- | --- |
| リマインダ | `/api/friends/:id/reminders` が登録IDを返す。管理一覧は全ページを読んでIDで絞り、その後ページを切る。 | 適用済み。詳細・リマインダタブ・タイムラインからIDだけ渡す。共通の帯・全員へ戻す・詳細へ戻る。 |
| 予約 | 管理台帳の一覧の絞り込みは状態・名前等。友だちIDの口なし。customer-contextは個別情報で台帳の全一覧ではない。 | 機能待ち。名前で検索するURLへ置き換えない。 |
| シナリオ | シナリオ定義の一覧に友だちIDの絞り込みなし。個人の登録・解除のAPIは一覧を返さない。 | 機能待ち。 |
| 回答 | フォームごとの回答一覧に友だちIDの絞り込みなし。友だち詳細の回答データを全員の回答一覧へ結び付ける口なし。 | 機能待ち。 |
| 注文 | 友だち詳細は元の注文のリンク。顧客IDで絞る管理一覧とAPIの口なし。 | 機能待ち。 |

## 見張りと検証

- `verify:design`：必須/任意の矛盾・保存検査の必須定義抜け・一覧の常設の案内をソースで検出。状態の知らせ・確認の窓は残す。故障注入の試験を追加。
- V8の既存CIブラウザ検査：必須/任意の矛盾・欄のエラーの理由不足・メニューの順序/アイコン不足・狭い板の件数位置・無名の省略メニューを追加。新規の6種類は比較元に同じ違反があっても除外しない。6種類の故障注入と修正後0の試験を必須ゲートに追加。件数は道具自身の内側余白を差し引いて測り、検索欄が無くても左へ回った場合は必ず止める。字ラベルを省いた件数部品も部品の型で判定し、断片で渡された道具も共通の器へまとめ、フォーム送信と既存の幅の値を保つ。板の下余白は題で同じ板と照合し、説明を移しても実寸の悪化は止める（元の検出条件・許可の上限は変えない）。
- 説明の人別・画面別保存、残りだけの保存、友だち別の全ページ絞り込み、404と失敗の区別を動作の試験で確認。古い文字・順序・黒い説明の開閉を固定していた試験だけ新しい決まりへ更新し、権限・保存・送信・失敗・入力保持の試験は残す。
- 型の頭・道具・表の既存の寸法・変数は変更せず、新しい口とその役目の配置だけを追加。match2が値の照合を担当する。

最終コミット前の検証結果は、末尾の「最終検証」に記録した。

実装コミット：`42d32d2ec1`。統合先が `7157d834fbac028f35f3b660b85bae4fb1d27636` へ更新されたため、競合の無いことを取り込み前の木で確認し、この版を取り込んで再検証する。

取り込み前の検証：Web全試験2,159ファイル・12,584件成功（1件skip・1件todo）、型検査成功。Impeccableの部品検査は指摘0。取り込み後の型検査は成功。取り込み直後の全試験でマイルの3件が古い共通ライブラリの出力により失敗したが、最新の出力を作り直した後、同じ3件は成功。最新の出力で全試験を再実行し、2,159ファイル・12,584件成功（1件skip・1件todo）。同じ状態でWebビルドも成功。幅別の最終結果は末尾の表のとおり。

画面検査の条件：指定の検証API URLでビルドし、通信はCIの画面見張り用データに置き換える。飲食店テスト画面はCIと同じ `NEXT_PUBLIC_RESTAURANT_TEST_ENABLED=true` をビルド時だけ指定する。設定ファイル・サーバー・DBは変更しない。初回のレポート作成画面の下余白は比較元も同じ24px不足（題・対象・実寸が同一）。説明の文章による別箇所扱いを修正し、増えた不足を見逃さない故障注入で再確認した。

幅検査の追加点検：検索欄のない道具にも件数位置の見張りを当てたところ、タグ一覧の字ラベルを省いた件数が左へ寄っていた。画面側では直さず、共通の役目の判定と断片の道具を受ける口で修正。`00a3227dd3` で修正。再ビルド後、タグ一覧は1152・1440・1920すべて新規0（`/tmp/b244-tags-final.json`）。この修正を含む全Web試験2,159ファイル・12,586件（1件skip・1件todo）と型検査は成功。全画面も再確認し、末尾の表のとおり合格。

全画面の比較で、流入リンクの既存の道具が入れ子の断片にあると共通の器で二重に包まれ、1152で文字の切れ2件を検出。`43267a9896` で既存の型は通し、型のないRowだけをまとめるよう修正。70件の関連試験と型検査は成功。値の変更・許可の追加はせず、全Web試験2,159ファイル・12,587件（1件skip・1件todo）、最終ビルド、verify:design、設計の負債検査も成功。幅検査の最終結果は下に記録する。

## 最終検証（コード `43267a9896`）

| 検査 | 結果 | 証拠 |
| --- | --- | --- |
| 全Web試験（最大4並列） | 2,159ファイル・12,587件成功、1件skip・1件todo | `/tmp/b244-web-verified.log` |
| 関連試験（断片の道具・必須等） | 70件成功 | `/tmp/b244-toolbar-nesting-test.log` |
| 型検査 | 成功 | `/tmp/b244-typecheck-nesting.log` |
| Webビルド | 成功 | `/tmp/b244-build-verified.log` |
| 補助スクリプトの全試験（最大4並列） | 105ファイル・949件成功 | `/tmp/b244-scripts-shipping.log` |
| 持ち主の見張りの故障注入 | 27件成功。6種類＋検索欄なし・余白・比較元の同一性を検査 | `/tmp/b244-guards-final.log` |
| verify:design・設計の負債検査 | 合格。ソース506ファイルの違反0。既知25件の値の許可は変更せず維持 | `/tmp/b244-design-verified.log`・`/tmp/b244-debt-verified.log` |
| 幅別の全画面見張り | 66画面×3幅＝198ケース。1152・1440・1920の新規は各0 | `/tmp/b244-defects-verified.json` |
| 横方向のはみ出し・省略の全文確認 | 12経路×3幅×既存2モード＝72ケース、違反0 | `/tmp/b244-overflow-verified.json` |

比較元は `7157d834fbac028f35f3b660b85bae4fb1d27636`。同じ検出器・データ・幅で照合した。既存の表示・既知の許可は残し、新規6種類は比較元にあっても免除しない。許可の上限は増やしていない。

★V8との±4pxの文字位置・画像を重ねた照合は、この作業の合格として記録していない。見本の書き出しと画素照合は司令塔・match2の担当。Penは未変更。友だちで絞れない4一覧と成果レポートのデータ時点は、上の機能待ち・制限の表のとおり。

完了範囲：実装・試験・文書・反映履歴をローカルの専用枝へコミット。完了時の作業ツリーを確認し、クリーンにした。push・PR・D1・配備は実施していない。司令塔は★V8の画素照合と通常の統合経路で検収する。
