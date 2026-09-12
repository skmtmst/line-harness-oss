# 統括のひな形

`NEXT_PUBLIC_HQ_TEMPLATE_DISTRIBUTION_ENABLED=1` のとき、`/hq/templates?type=tag` から一覧、作成・編集、店舗選択、重複確認、配布結果を開く。この設定はWorkerの同一APIと結合テストが配備済みの場合だけ有効にする。既定値では画面を公開せず、既存の店舗別タグ管理へ案内する。
`template` / `rich_menu` / `form` は初期版では未対応（UNSUPPORTED）。既存の `/hq/open` 導線を維持し、作成・配布APIは呼ばない。`/accounts/new` の動作は変更しない。

- Pencil: `nen-order-inventory-fulfillment.pen` の rsyjI / ZsLly / E0CmCp / Uhd35 / FxHyL。
- 保存・削除は期待revision付き。共通fetchApiによるセッション・CSRF保護を利用する。
- 新規保存は8〜128文字のrequestId（UUID推奨）をbodyと`Idempotency-Key`へ同じ値で渡す。応答不明時は同じrequestIdと同じpayloadを再送し、サーバーの201再現を受ける。サーバー応答を受信済みなら次の操作は新しいrequestIdにする。同じrequestIdで異なるpayloadを送った409 `IDEMPOTENCY_CONFLICT` は最新版を再読込して解消する。
- 配布前確認は選択店舗との一致と有効期限を検査する。重複は未選択から開始し、allowedModes内だけ選べる。一括設定後も個別変更できる。
- preflightIdがrunIdになるAPI契約。POST応答不達はGETで復元し、自動再POSTしない。URLのhashにひな形IDと配布番号だけを残し、再読込でもGETで復元する。
- 完了が確定した失敗店舗だけ、新しい事前確認へ戻す。成功件数はsucceeded店舗の内訳から計算し、通信失敗や処理中を成功・失敗として数えない。
- 認証・店舗境界・競合・冪等性の最終判断はWorker側。画面の選択制御は認可の代用ではない。

## 表示と受け渡し

一覧の参照先・配布先件数は初期APIが未提供のため「—」。未提供の値を0や未配布に置き換えない。APIが任意のreference_summary/distributed_account_countを提供すれば表示できる。
タグ名は名前欄の編集で更新し、既存のフォルダ参照・色・親子関係は保持する。説明もタグ定義へ渡す。
結果のreasonはAPIが返す公開用の日本語理由を表示する。API通信失敗の内部メッセージは専用clientで安全な案内へ変換する。

## 検証範囲

React契約テストは作成・編集、版競合、店舗集合、期限切れ、未選択、上書き不可、一括＋個別選択、二重クリック、結果不達、再読込、失敗店舗だけの再確認、権限不足、未対応種別を扱う。
画面確認はローカルの静的ビルドに固定データを与え、1440/1920/390pxで行う。実API接続・検証DBへの配布の実証はバックエンド統合後に別途必要。
CSS Modulesは静的className解析では解決できないため、その利用数のみdesign-debt-baselineへ登録。表見出し・操作ボタン・削除確認は既存共通部品を使う。
既存の共通アプリ枠（サイドバー・トップバー・更新案内）は維持。PencilのEC側の共通枠との差を、この画面固有の変更で埋めない。
