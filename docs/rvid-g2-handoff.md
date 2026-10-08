# リッチビデオ G-2 引き継ぎ（2026-10-08）

店舗側の API・Worker・V8 画面を実装した。見た目の正式な合格はまだ記録していない。push・PR・統合・DB更新・配備は行っていない。

## 板ごとの結果

| 板ID | 名前 | 直す前 % | 直した後 % | 左右で見比べた結果 |
| --- | --- | --- | --- | --- |
| I4jUUW | 種類を選ぶ窓 | 未測定 | 未測定 | 1060幅・4列×2段・7種類・リッチビデオは右上。絵のカードは約204px、実装は約184px。2段目以降が絵より上で、できないことの文が一部切れる。tmpl担当の一覧変更との調整が必要。 |
| oIFk7 | リッチビデオを作る | 未測定 | 未測定 | 題・説明・4枚の入力カード・動画選択・スイッチ・通知文・右のスマホ・中央の下の帯を比較。入力カードは絵から約1〜2px下。共通Cardの影、動画選択枠の地の色・動画アイコン色、ヘルプの間隔・閉じるボタンの形に違いが残る。 |
| RHvRP | 付箋の決まり | 対象外 | 対象外 | 画面ではない。7種類、動画と画像の違い、ボタンの設定、送信形を実装へ反映。 |

`measure.sh rvid I4jUUW,oIFk7` を実行したが、正本の `html/<板>.html`・`pencil-texts/<板>.tsv` がなく、数値照合と重ね画像は作れなかった。実画面の撮影はできた。未測定を合格や0%として扱っていない。Pencilは変更していない。

撮影はローカルの見本APIと実際のV8画面。1440・1152・1920幅でページの横幅と表示中の要素を確認し、作成画面の右端越えは0件。1152幅では既存の型に従いスマホを畳み、［LINEでの見え方を見る］から窓に出す。種類選択は1440・1152の両方で4列で、リッチビデオを押すと `/templates/edit?kind=rich_video` に進む。

証拠（このPCのローカルファイル）：
- [種類選択 1440](/tmp/rvid-evidence/I4jUUW-1440.png) / [1152](/tmp/rvid-evidence/I4jUUW-1152.png)
- [作成画面 1440](/tmp/rvid-evidence/oIFk7-1440.png) / [1152](/tmp/rvid-evidence/oIFk7-1152.png) / [1920](/tmp/rvid-evidence/oIFk7-1920.png)
- [表示寸法と入口の確認](/tmp/rvid-evidence/metrics.json)
- 比較した絵：`~/lh-work/design/v8/proposals-g/I4jUUW.png`・`oIFk7.png`・`RHvRP.png`

ブラウザ拡張の新規タブ作成が `Owl extension-created tabs must be active` で失敗したため、指定の測定道具と同じPlaywright・初期状態で撮影した。共通メニューの「友だち属性」など外側の違いは専用担当が作業中のため変更していない。既存の共通部品の見た目全体は変更せず、FileDropzoneに動画用・入力エラー用の口だけを足した。

## 保存と使い方

1. テンプレートを作る → リッチビデオ。名前・フォルダ・MP4（200MBまで）・再生後のボタン・通知文を入れる。
2. 動画から同じ縦横比のプレビュー画像を作る。作れなければJPEG・PNG（1MBまで）を追加する。
3. ［保存する］は既存のテンプレートの下書き保存。一覧から詳細を開いて公開すると配信で選べる。更新も公開前には送信中の版を変えない。
4. 一斉配信の［テンプレートから選ぶ］、シナリオ、自動応答から引用する。

保存は既存の `templates.message_type=imagemap` と `message_content` の `video`。表・列・migrationは追加していない。既存のMP4直接アップロード、`broadcast-message-assets`・`imagemap-images` の5サイズ画像生成を使う。

保存口で動画の所属アカウント、動画・画像の実際の容量・MIME、安全性検査を確認する。動画・画像はアップロードしたファイルだけ。動画・画像のURLはHTTPS・2,000文字まで、ボタンのリンクはHTTPS・1,000文字まで、通知文は1〜1,500文字。ボタンを出さない場合は `externalLink` を保存・送信しない。

入力不足は該当欄の赤枠・理由・focus。通信や保存失敗だけ上の帯に出す。閲覧のみには保存・アップロード・フォルダ選択・ボタン選択・スイッチを出さず、APIも403で断る。読み込み失敗・所属の不一致では保存しない。

## 統括と必要なAPI

店舗側は既存のAPIの拡張だけで実装済み。DB変更は不要。

統括は今回対応しない。配布契約のメッセージ種類が `text/image/flex/carousel` に限られ、動画付きImagemapを保持・配布する契約がない。さらに既存のメディア配布は1ファイル8MB・全体16MB。店舗のアップロード動画には所属アカウントの検査もあるため、現在の配布口にURLをそのまま写すだけでは成立しない。未完成の種類は統括の一覧に追加していない（依頼の「できなければ店だけ」を採用）。

## 検証

土台はテスト前に取得・取り込んだ `origin/codex/development` の `fde2122a22b454b7bb6545514dd9e463d2cb0016`。共有ブランチは作業中に更新されたので、司令塔の統合時には最新を取り込んで再確認する。

| 検証 | 結果 |
| --- | --- |
| DOCTOR_LOCAL=1 doctor | 合格 |
| Worker typecheck / build | 合格 |
| web tsc / build | 合格 |
| Worker 関連試験 | 6ファイル54件合格 |
| web テンプレート・共通部品・引用・設計の関連試験 | 54ファイル333件合格 |
| web 既存の動画・配信・入力検査・V8境界の回帰試験 | 5ファイル19件合格 |
| verify:design | 456/456一致、合格（画素一致の判定ではない） |
| git diff --check | 合格 |
| 新しい送信試験の不具合検知確認 | videoを一時的に送信形から外すと2件が失敗。復元後16件すべて合格 |

実SQLiteで保存→GET→更新→公開→一斉配信・シナリオ・自動応答の送信組み立てを確認。ボタン有り／無し、通知文、URL不正、再生範囲、ボタン文字超過、200MB・1MB超、検査未完了、別アカウント、閲覧のみを検査した。LINEへの実送信はしていない。既存の動きの試験は削除していない。

## コミットと変更ファイル

API・Worker：`cd1877e89c`（7ファイル）
- `apps/worker/src/routes/templates.ts`
- `apps/worker/src/routes/templates-rich-video.test.ts`
- `apps/worker/src/services/rich-video-template.ts`
- `apps/worker/src/services/broadcast-message-set.ts`
- `apps/worker/src/services/line-message.ts`
- `packages/line-sdk/src/types.ts`
- `packages/shared/src/line-message-limits.ts`

画面：`1d9dd5ad46`（16ファイル）
- `apps/web/src/v8/template-edit/{edit.tsx,rich-video.tsx,rich-video-core.ts,rich-video.module.css,rich-video.test.tsx}`
- `apps/web/src/v8/templates/{list.tsx,list.module.css}`（種類・列数・必要なタブ/数/編集入口だけ）
- `apps/web/src/v8/template-detail/detail.tsx`（編集入口だけ）
- `apps/web/src/lib/broadcast-template.ts`
- `apps/web/src/components/broadcasts/{broadcast-form.tsx,broadcast-template-picker-react.test.tsx}`
- `apps/web/src/components/auto-replies/edit-dialog.tsx`
- `apps/web/src/components/shared/{file-drop.tsx,file-drop.module.css}`
- `apps/web/src/app/globals.css`（リッチビデオ用の寸法トークンだけ）
- `apps/web/design/design-impact-baseline.txt`（新画面の共通Button利用を記録）

文書：この引き継ぎ書、`apps/web/src/v8/template-edit/BEHAVIOR.md`、`docs/release-log/pending/kenta-rich-video.md`。末尾に `Co-Authored-By: Codex <noreply@openai.com>`。

PRは作らない指示なので履歴は未採番の原稿として `pending/` に保存した。司令塔がPR番号を入れ、`unreleased/<番号>-kenta-rich-video.md` へ移す。既存の `unreleased.md` には追記していない。

## LINEへ渡す形の例

[LINE公式のImagemap仕様](https://developers.line.biz/en/reference/messaging-api/nojs/#imagemap-message)に従う。下のURLは説明用。

```json
{
  "type": "imagemap",
  "baseUrl": "https://worker.example/images/imagemaps/00000000-0000-4000-8000-000000000000",
  "baseSize": { "width": 1040, "height": 520 },
  "altText": "新商品の紹介動画が届きました",
  "actions": [],
  "video": {
    "originalContentUrl": "https://worker.example/images/broadcast-media/11111111-1111-4111-8111-111111111111.mp4",
    "previewImageUrl": "https://worker.example/images/broadcast-media/22222222-2222-4222-8222-222222222222.jpg",
    "area": { "x": 0, "y": 0, "width": 1040, "height": 520 },
    "externalLink": { "linkUri": "https://example.com/products", "label": "詳しく見る" }
  }
}
```

ボタン無しでは `video.externalLink` 自体を付けない。

次のタスクはこれ：司令塔がtmpl側との窓の差分を調整し、HTML・TSVを用意して90%照合と重ね画像の目視を行う。その後、最新の開発ブランチへ取り込んでPR・検証環境への手動配備を進める。
