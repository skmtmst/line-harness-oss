# `ymXJK` NENコラム作成・画面引き継ぎ

対象は設計Node `ymXJK`（21-1-E「コラムを書く」）。この契約は、管理画面から**外部記事へのリンクを持つ下書き**を新規作成するためのものです。記事本文はLINE Harnessへ保存しません。

## 読み書きする口

- 作成：`POST /api/nen-campaigns/columns?lineAccountId=<選択中アカウント>`
- 一覧：既存の `GET /api/nen-campaigns/columns?lineAccountId=<選択中アカウント>`
- Web側：`api.nenCampaigns.createColumn(accountId, data)`

作成bodyは次の6項目だけです。

```ts
{
  title: string
  category?: string
  excerpt?: string
  articleUrl: string
  imageUrl?: string | null
  publishedAt?: string | null
}
```

`body`、`slug`、`externalId`、`lineAccountId` は送らないでください。含まれていると400 `request_invalid` です。内部slugは記事URLのpath末尾からWorkerが作り、画面には出しません。

## 画面で言い換えるエラー

| 状態 | code | 画面の言葉の例 |
|---|---|---|
| 入力 | `title_invalid` | 題名を1〜120文字で入力してください。 |
| 入力 | `article_url_invalid` | HTTPSの記事URLを入力してください。 |
| 入力 | `image_url_invalid` | 画像URLはHTTPSで入力してください。 |
| 入力 | `category_too_long` / `excerpt_too_long` | 分類／概要を指定の文字数以内にしてください。 |
| 入力 | `published_at_invalid` | 公開日時をタイムゾーン付きで入力してください。 |
| 超過 | `payload_too_large` | 入力内容が大きすぎます。本文は入力せず、外部記事のURLを指定してください。 |
| 重複 | `column_already_exists` | 同じ記事URLのコラムがすでにあります。一覧を読み直してください。 |
| 保存失敗 | `column_create_failed` | 下書きを保存できませんでした。状態を読み直してからお試しください。 |

409は、どのアカウントの記事と重なったかを返しません。別アカウントの存在を画面で推測して表示しないでください。

## 固定データ

`scripts/visual-qa/fixtures.mjs` の `NEN_COLUMN_CREATE` に、通常・入力エラー・重複・保存失敗を契約と同じstatus/bodyで置いてあります。通常保存だけは画面確認用モックが固定201を返します。DB更新は起きません。

## 画面の完了条件

- `data-qa-open="ymXJK"` を保存の押し口へ付ける。
- 通常・入力エラー・重複・保存失敗を画面の言葉で分ける。
- 保存成功後は返されたIDを内部で使い、slugやアカウントIDを表示しない。
- 本文の入力欄を作らない。「記事本文は外部サイトで管理します」と明記する。
- `publishedAt` が空なら今日の日付を補わない。下書きのまま保存する。
- 1440px・1920pxで横スクロール0、`undefined`・`NaN`・`Invalid Date`・内部IDを出さない。

## このPRで作っていないもの

DB migration、本文列、既存記事の更新、公開、配信予約、EC連携のHMAC・upsert変更はありません。
