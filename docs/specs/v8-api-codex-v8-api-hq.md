# V8 統括のAPI接続契約（2026-10-04）

対象の枝: `codex/codex-v8-api-hq`。開始点: `22cf0869f2d62dccd18f606a25ec314927de7fe5`。
正本: `design/v8/html/<板ID>.html` と API-GAPS 2文書末尾のオーナー決定。LRc93・v2KMj・TvXII の指定HTMLは欠落し、代替資料の使用を確認中。
本枝だけに機能別コミット。push・PR・CI・配備・遠隔DB操作なし。例外5件・docs/brain・docs/v6-*は変更しない。

| 絵／機能 | 入力（既存の口は再利用） | 出力 | 権限／失敗時 |
|---|---|---|---|
| JKjsE・HMpVx・rI5uh アカウントタグ | GET/POST `/api/line-account-tags`、PATCH/DELETE `/:id`（name・color・displayOrder）、PUT `/api/line-accounts/:id/tags`（tagIds）。一覧のtagsで絞り・配布先検索 | タグ一覧、保存後のタグ。削除は所属だけを外しアカウントを残す | 既存owner/admin、書込は閲覧のみ不可。別統括は404、同名409、入力400、失敗500。新規表不要（既存544） |
| W5Wxr 画像全件検索 | GET `/api/hq/banners/images?q=&delivered=1\|0&favorite=1&preset=&shape=&before=&limit=`。全条件をSQLでページ分割前に適用 | 画像、nextBefore、検索全体のtotalと状態別counts | 統括管理者の既存境界を維持。入力400、失敗500。次ページも同条件 |
| LRc93 ひな形の分類・複製 | GET/POST `/api/hq/templates/folders`、PATCH/DELETE `/folders/:id`（name・expectedRevision）。POST `/:id/duplicate`（name・requestId）。保存にfolderId（nullは未分類）、一覧にfolderId | フォルダ、ひな形。削除時はひな形を未分類に戻す。複製は別ID、元は不変 | 既存DB本人確認済の統括owner/admin・全体範囲・閲覧のみ不可。別統括404、版違い409、入力422。570（分類表・列） |
| LRc93・X4JcOf シナリオひな形 | 種類scenarioを追加。definitionはschemaVersion=1、scenario（name・description）とsteps（順番・遅延・messageType・messageContent）。従来のcreate/edit/preflight/distributeを共用 | 保存された定義、配り先ごとの重複確認・結果。配布先は停止中の下書きで作成 | 未解決参照をそのまま配らない。入力422、重複・版409。571（種類制約） |
| X4JcOf 一段保存 | 既存POST/PATCHでname・definitionを一度に送る。タイトル・本文・ボタンを定義に組立てる。form/rich_menuは種類別の既存編集と検証を使う | 本文・ボタンを含む保存版とrevision | 失敗時は入力を残す。二重作成はrequestIdで既存の再実行保護 |
| meBRB 配り先ごとの本文 | preflightにaccountIdごとのtextOverrides。テキストひな形のみ。原本を変えず配り先の検証済定義に適用、確定内容をpreflightに保存 | 確認と結果。確定後の変更は再確認。再試行は同じ本文 | 異なる配り先・種類・不正本文422、期限・原本／配り先更新409。572（確認済本文保存） |
| GwKE2 登録の基本情報 | connectにtagIds・parentLineAccountId・staffIds・liffId。事前に同じ統括の親・タグ・担当を確認。LIFFは指定Loginチャネルに所属する既存アプリを確認 | 登録アカウント・取込み状態。秘密値は返さない | 既存owner＋本人確認。範囲違反403、入力400、重複409。既存の関係表を使う |
| TvXII 背景の取込み | 既存start/status/step。定期処理が永続状態からID／プロフィール取込みを再開。画面はstatus読取だけ | 取込みphase・件数・失敗状態。画面を閉じても継続 | 既存ロックで重複実行防止。停止／アーカイブは処理対象外。秘密値・友だち本文をログに出さない |
| v2KMj 同一提供元 | 現4入力だけではLINE公開APIで提供元を直接読めない。署名付きWebhookとLINE Loginの本人ID照合の追加を確認中 | 根拠がなければ未確認。接続成功を提供元一致として扱わない | 誤った一致表示をしない。方針決定までは当該照合を実装しない |

新表は保持台帳へ登録。570〜572はSQLファイルを作るだけ（遠隔反映はオーナー承認待ち）。Worker・DB・画面のvitest、shared/DB/Worker/webのtsc、差分検査をローカルで実施。V8だけの入力追加、v7の見た目を維持する。
