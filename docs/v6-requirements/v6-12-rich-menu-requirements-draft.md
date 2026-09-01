# V6 12 リッチメニュー 要件定義（実装照合版・下書き）

作成日: 2026-08-25

## 0. 実装照合メモ（2026-08-27）

今回接続したもの:

- 全ページの画像を確認してからLINE側の新メニューを作る
- 全ページの作成・画像送信が終わるまでaliasを切り替えない
- aliasは削除・再作成せず、LINE公式のalias更新APIを使う
- alias更新またはデフォルト設定の途中失敗時は旧IDへ戻す
- 一覧の画面名は共通トップバーだけに置き、動かないマニュアルを出さない

まだP0として残るもの:

- 公開版と編集用下書きを別の版として保持する
- 公開実行台帳とページ単位の成功・失敗・再試行を保持する
- LINE・DB・R2・alias・デフォルトの照合と修復

したがって、機能12は「一部実装」であり、V6完了ではない。
対象: V6「12 リッチメニュー」

## 0. 結論と採点

V6を採用する。形とボタン、誰に出すか、公開方法を3段階に分け、優先順位の重複人数、切替の行き止まり、管理画面外メニューの取り込み、取り下げてから削除を見せる設計は、Lステップ相当を満たし、事故防止では上回る。

現行には複数ページ、画像保管、タップ領域、URL・電話・テキスト・テンプレート・回答フォーム・切替・postback、タグ・スコア、出し分け、LINE公開・取り下げ、外部メニュー取り込み、タップ集計がある。土台は強い。

P0は公開処理である。現行はページごとに新メニュー作成→画像送信→alias削除→alias再作成→旧メニュー削除を行う。途中のページで失敗すると、先に終わったページだけLINE側が新しくなり、DBは旧IDのまま残り得る。また公開中の定義を同じ行へ保存できるため、管理画面の内容とLINE上の内容がずれる。版・公開実行台帳・照合修復を追加する。

| 評価軸 | 現在 | 実装後 |
|---|---:|---:|
| V6 UI・UX | 97 | 99 |
| Lステップ競争力 | 96 | 100 |
| 現行実装 | 90 | 98 |
| データ安全性 | 61 | 97 |
| 要件確定度 | 96 | 99 |

## 1. 監査範囲と証拠制限

確認したV6実Node 9画面:

| 画面 | V6実Node ID | 構造確認 |
|---|---|---|
| 一覧 | `GO8RQ` | 問題なし |
| 形とボタン | `XtfO3` | 問題なし |
| 誰に出すか | `kQ1bs` | 問題なし |
| 切替メニューのつながり | `DIUbO` | 問題なし |
| つながりなし | `NXdDk` | 問題なし |
| 公開のしかた | `UMiJ9` | 問題なし |
| 管理画面外メニューの取り込み | `TL7tp` | 問題なし |
| 削除確認 | `szXsT` | 問題なし |
| 一覧の空・読込・エラー | `RW5Tb` | 問題なし |

実装PRでは上記V6実Node IDを設計画像・実装画像へ固定する。

Pencilの現在の画像書き出しはノイズ画像になり、見た目の比較証拠として採用できなかった。この文書ではNode構造、全文言、はみ出し情報、コード・DB・APIを照合した。色、コントラスト、ピクセル位置、フォーカス表示は実装PRの正常な画像書き出しで再確認する。

## 2. 達成すること

> LINEトーク下部のメニューを、対象ごとに1つだけ安全に表示し、タップ後の動作、切替、公開結果を運用者が追跡できる。

- 画像とタップ領域を作る
- 各領域の動作とアクセシビリティ用ラベルを設定する
- 複数ページの切替と戻り道を確認する
- 対象条件と優先順位を決める
- 重複する人数と実際に勝つメニューを確認する
- 自分のLINEで公開前テストする
- 下書き版を公開する
- 日時・期間を指定して公開・復元する
- LINE側とDBの公開状態を照合する
- 外部作成メニューを安全に取り込む
- 取り下げ後に削除する

## 3. LINE仕様として固定すること

- リッチメニューはLINE PC版では表示されない
- 全員向けデフォルトより、友だち個別に紐付けたメニューが優先される
- 切替にはrich menu aliasと`richmenuswitch`を使う
- aliasは削除・再作成せず、LINEのalias更新APIを使う
- `chatBarText`は14文字以内
- 1メニューのタップ領域は最大20
- action labelは20文字以内とし、端末のアクセシビリティ機能向けに必須化する
- LINEのValidate rich menu object APIも公開前検査に使う
- LINE側の反映にはキャッシュ遅延があり、即時表示を保証しない

固定2サイズ（2500×1686、2500×843）は現行互換として維持する。LINE APIが許す任意サイズ対応は初期版から除外する。

## 4. 画面とルート

| 画面 | ルート |
|---|---|
| リッチメニュー一覧 | `/rich-menus` |
| メニューを作る・形とボタン | `/rich-menus/new` |
| メニューを編集 | `/rich-menus/{id}/edit` |
| 誰に出すか | `/rich-menus/{id}/targeting` |
| 切替メニューのつながり | `/rich-menus/{id}/connections` |
| 公開のしかた | `/rich-menus/{id}/publish` |
| 管理画面外のメニュー | `/rich-menus/external` |
| 公開・割当結果 | `/rich-menus/{id}/runs` |
| 削除確認 | `/rich-menus/{id}/delete` |

実装時に既存`/rich-menus/edit?id=`との互換リダイレクトを置く。

## 5. 画面要件

### 5-1. 一覧

KPI:

- 公開中
- 条件で出し分け
- LINE側だけにあるもの
- 要対応の公開・割当失敗

一覧:

- メニュー名と画像
- フォルダ
- 対象条件
- 優先順位
- 現在表示対象
- 今月の表示・タップ
- 公開版
- LINE照合状態
- 公開期間・次回変更

操作:

- `メニューを作る`
- `出す順番を変える`
- `メニューの設定を編集`
- `切替のつながりを見る`
- `公開結果を見る`
- `LINEから取り下げる`
- `リッチメニューを削除`

「上にあるものが優先され、最初の1つだけが出る」を常設する。「すべての友だち」は最下段の受け皿として1件だけにする。

### 5-2. 形とボタン

- 管理名、フォルダ
- トーク下部に出す14文字以内の文
- 大・小サイズ
- 開いた状態／閉じた状態
- 1、2、3、4、6面テンプレート
- 最大10ページの切替
- 登録メディアまたは新規画像
- 実画像上のタップ領域編集

各領域:

- 運用者向け名前
- 端末読み上げ用ラベル20文字以内
- URLを開く
- 電話をかける
- テキストを送る
- テンプレートを送る
- 回答フォームを開く
- メニューを切り替える
- postback
- 日時を選ぶ
- 文字をクリップボードへコピー
- タグ、スコア、共通アクション

カメラ・カメラロールはLINEのリッチメニューで利用できないため表示しない。

公開前に確認する:

- 未設定領域
- 領域の重なり・画像外・0サイズ
- 画像寸法・形式・容量
- URL、電話、フォーム、テンプレートの参照先
- action label
- LINE文字数と領域数

### 5-3. 誰に出すか

- すべての友だち
- 共通条件ビルダー
- 現在当てはまる人数
- 上位メニューとの重複人数
- 実際にこのメニューが出る人数
- 保存検索
- 優先順位

条件で使える項目ごとに、再評価を起こすイベントを登録する。タグだけでなく友だち情報、スコア、予約、購入、成果、回答などの変更へ追従する。

### 5-4. 切替メニューのつながり

- ページをノード、切替を矢印として表示
- 各ページからトップへ戻れるか
- 下書き・削除済みの切替先
- 条件が異なる切替先
- 自分自身だけを回る行き止まり
- 参照されているページの削除防止

循環自体はタブ切替では正常である。禁止するのは「入口から到達できない」「安全な戻り先がない」「未公開へ切り替える」である。

### 5-5. 公開のしかた

- いますぐ
- 公開日時を予約
- 開始・終了期間
- 終了後に戻すメニュー
- 対象人数、重複除外人数
- 変更されるデフォルト・個別割当
- LINE反映遅延の注意
- 公開前エラー

公開予約では対象者スナップショットを固定しない。実行時に最新版の友だち状態で条件を再評価する。ただし公開するメニュー版は予約時に固定する。

### 5-6. 自分のLINEで確かめる

- テスト担当者のLINE user IDを事前登録
- 下書き版をテスト専用メニューとして作成
- テスト担当者だけへ紐付け
- 各領域、切替、フォーム、テンプレートを実機確認
- テスト終了時に元の個別メニューへ復元
- 復元失敗を要対応として残す

管理画面プレビューだけで公開可にしない。PCではリッチメニューが出ないため、スマートフォン実機確認を完了条件にする。

### 5-7. 外部メニューの取り込み

- LINE APIで管理画面外メニューを一覧取得
- 画像、領域、動作、現在のデフォルト、作成元を表示
- 対応できないactionを明示
- 取り込み前後でLINE上の表示を変えない
- D1、R2、alias、参照元を記録

現行同様、切替actionを含む外部メニューは自動取り込みせず、ページ対応を運用者に確認させる。

### 5-8. 公開・割当結果

状態:

- queued / validating / creating
- image_uploaded / aliases_switching
- assigning / published
- partial_failed / reconciliation_required
- unpublishing / unpublished / failed

表示:

- 使用版
- LINEメニューID・alias
- ページごとの段階
- デフォルト変更結果
- 個別割当の成功・失敗人数
- LINE要求ID、エラーコード
- 再試行・照合結果

### 5-9. 削除

- 現在表示中の人数
- 次に表示されるメニュー
- 切替元
- 自動応答・オートメーションなどの参照元
- `LINEから取り下げる`
- 取り下げ完了後だけ`リッチメニューを削除`

LINE残骸を許す`force=true`は管理画面へ出さない。修復専用APIとしてownerかつ監査理由必須にする。

## 6. データ要件

維持:

- `rich_menu_groups`
- `rich_menu_pages`
- `rich_menu_areas`
- `rich_menu_area_taps`
- R2画像
- 現行のLINEメニューID・alias規則

追加:

`rich_menu_versions`:

- `group_id`, `version_number`, `definition_snapshot`
- `status`: draft / published / archived
- `created_by_staff_id`, `published_at`

`rich_menu_publish_runs`:

- `group_id`, `version_id`, `idempotency_key`
- `mode`: publish / unpublish / scheduled_restore / reconcile
- `status`, `started_at`, `completed_at`
- `requested_by_staff_id`, `last_error_code`

`rich_menu_publish_run_pages`:

- `run_id`, `version_page_id`
- `old_line_richmenu_id`, `new_line_richmenu_id`, `alias_id`
- `create_status`, `image_status`, `alias_status`, `cleanup_status`
- `line_request_ids_json`, `last_error_code`

`rich_menu_assignments`:

- `friend_id`, `line_account_id`
- `group_id`, `version_id`, `line_richmenu_id`
- `reason_kind`, `reason_event_id`, `assigned_at`
- 現在値を一意に保持

`rich_menu_assignment_runs`:

- `version_id`, `friend_id`, `source_event_id`
- `idempotency_key`, `previous_assignment_id`
- `status`, `attempt_count`, `next_retry_at`, `last_error_code`

`rich_menu_action_runs`:

- `tap_id`, `version_area_id`, `action_stable_id`
- `idempotency_key`, `status`, `attempt_count`, `last_error_code`

`rich_menu_schedules`:

- `version_id`, `starts_at`, `ends_at`, `restore_group_id`
- `status`, `started_run_id`, `ended_run_id`

グループには`current_published_version_id`と`current_draft_version_id`を持つ。公開中の定義行を直接更新しない。

## 7. 公開処理

### 7-1. 公開前

1. 版を固定
2. 自前検査
3. LINE Validate rich menu object APIで全ページ検査
4. 画像と参照先の存在確認
5. 切替グラフ確認
6. 公開実行行を原子的に確保

### 7-2. LINE反映

1. 全ページの新rich menuを作る
2. 全画像を送信
3. ここまで全ページ成功した後にaliasを更新
4. LINEのalias更新APIで既存aliasを新IDへ付け替える
5. デフォルトまたは個別割当を更新
6. DBの公開版・LINE IDを確定
7. 旧rich menuを非同期で削除

途中失敗時は新規に作った未使用メニューを削除し、aliasと公開版を旧状態に維持する。alias切替後に失敗した場合は照合・修復状態へ送り、自動で旧・新どちらかに揃える。

### 7-3. 出し分け

1. イベントIDで割当実行を確保
2. 公開中候補を優先順位順に評価
3. 最初に一致した1件を固定
4. 現在割当と同じならLINE APIを呼ばず成功
5. 異なる場合だけlink/unlink
6. 失敗を再試行台帳へ残す

## 8. API要件

- `GET /api/rich-menu-groups?account_id=&status=&folder_id=&cursor=`
- `POST /api/rich-menu-groups/drafts`
- `PUT /api/rich-menu-groups/{id}/draft`
- `POST /api/rich-menu-groups/{id}/validate`
- `POST /api/rich-menu-groups/{id}/preview-targets`
- `POST /api/rich-menu-groups/{id}/publish`
- `POST /api/rich-menu-groups/{id}/schedule`
- `POST /api/rich-menu-groups/{id}/test-link`
- `POST /api/rich-menu-groups/{id}/unpublish`
- `GET /api/rich-menu-groups/{id}/runs`
- `POST /api/rich-menu-publish-runs/{id}/retry`
- `POST /api/rich-menu-publish-runs/{id}/reconcile`
- `GET /api/rich-menu-groups/external`
- `POST /api/rich-menu-groups/external/{lineRichMenuId}/import`
- `GET /api/rich-menu-groups/{id}/usages`
- `DELETE /api/rich-menu-groups/{id}`

公開、取り下げ、予約、テスト紐付け、割当、再試行は冪等キー必須。

## 9. 権限

- owner/admin: 作成、公開、取り下げ、削除、外部取り込み、照合修復
- staff: 許可アカウント・フォルダの閲覧とテスト
- 公開予約、全員デフォルト変更、外部LINEメニュー削除はadmin以上
- 秘密のLINE user ID、LINE要求詳細は権限に応じてマスク
- 他LINEアカウントの画像、メニュー、友だちへ到達不可

## 10. 移行

1. DB・LINE一覧・alias・デフォルト・R2をバックアップ
2. 現行定義を公開版1または下書き版1へ変換
3. DBのline_richmenu_idとLINE実在を照合
4. LINE側だけのメニューを外部一覧へ出す
5. DB側だけの公開中メニューを`reconciliation_required`にする
6. 現在の個別割当は取得可能範囲だけ記録し、推測しない
7. 既存priorityと作成日時の順序を維持
8. 新旧targetingを同じイベントで二重実行しない
9. 新publisherを1アカウントで試験後に段階切替
10. 公開数、デフォルト、alias、対象人数、タップ数を照合

## 11. Lステップ・Linyとの差

同等:

- 画像テンプレートとタップ領域
- URL、テキスト、postback、切替
- 友だち条件による出し分け
- タップ計測

上回る:

- 上位ルールとの重複人数
- 切替の行き止まり検出
- 外部作成メニューの取り込み
- 取り下げと削除の分離
- 公開版、ページ別実行、LINE照合・修復
- 予約終了後の安全な復元

## 12. 除外

- LINE PC版でのリッチメニュー表示
- 1人へ同時に複数メニューを表示
- LINE側の反映時刻を秒単位で保証
- 任意画像サイズ対応
- カメラ・カメラロールaction
- 公開中定義の直接上書き
- aliasの削除・再作成による切替
- 公開中メニューの強制削除
- LINE側に存在しない個別割当の推測
- 取得できない個人単位の表示・既読

## 13. 完了条件

- V6実Node ID、1920px設計画像、同幅の実装画像をPR固定
- 7画面と空・読込・エラー・権限不足・部分失敗を実装
- 1440/1920で管理画面に横スクロールなし
- スマートフォン実機で大・小・切替を確認
- action labelを端末読み上げで確認
- 公開途中失敗で旧メニューを壊さない
- alias更新中の空白時間を作らない
- DBとLINEの不一致を検出・修復可能
- 条件変更イベント後に正しい1件へ切り替わる
- 一括割当の部分成功・再試行を追跡可能
- 期間終了後に指定メニューへ復元
- 外部取り込みでLINE表示を変えない
- `準備中`操作なし

## 14. 実装順

1. 版、公開実行、ページ実行台帳
2. alias更新APIを使う公開saga
3. LINE照合・修復
4. 出し分け実行台帳と再評価イベント拡張
5. 公開予約・終了後復元
6. action label、日時選択、クリップボード
7. V6一覧・3段階作成・つながり・履歴
8. 外部取り込み、削除、権限、障害E2E

## 15. 実装前判断

| 項目 | 推奨 |
|---|---|
| 同時に当てはまる場合 | 優先順位が最小の1件 |
| 同順位 | 一覧の手動順。移行時だけ作成日時順 |
| すべての友だち | 最下段に必須の受け皿1件 |
| 公開予約の対象 | 実行時に条件を再評価 |
| 公開する内容 | 予約時の版を固定 |
| 期間終了後 | 指定した安定メニューへ復元 |
| 旧LINEメニュー削除 | 新公開確定後の非同期処理 |
| 外部切替メニュー | 自動取り込みせずページ対応を確認 |

## 16. 公式根拠

- LINE Messaging APIのリッチメニュー構造、Validate API、領域数・文字数制約
- rich menu aliasの作成・更新・削除
- タブ切替、デフォルトと個別メニューの優先順位
- LINE PC版では表示されないこと

参照:

- https://developers.line.biz/en/reference/messaging-api/#rich-menu
- https://developers.line.biz/en/docs/messaging-api/switch-rich-menus/
- https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/
