# V6 テンプレート本文上限 契約引き継ぎ

対象: 機能11 `GFlD7`（メッセージを作る）

## 正本の契約

- 対象の保存口は既存の `POST /api/templates` と `PUT /api/templates/:id`。
- `messageType: "text"` の `messageContent` は5,000文字まで。
- 文字数はUnicodeコードポイントで数える。絵文字 `🌿` は1文字。
- 5,001文字以上は保存せず、HTTP 422を返す。
- Flex・画像・カルーセルは、それぞれの検査へ渡し、テキストの上限へ混ぜない。
- 画面とWorkerは `@line-crm/shared` の `TEMPLATE_TEXT_MAX_CHARACTERS` と
  `countTemplateTextCharacters()` を使い、上限と絵文字の数え方を二重に持たない。

## 上限超過の返事

```json
{
  "success": false,
  "code": "TEMPLATE_TEXT_TOO_LONG",
  "error": "本文は5,000文字までです。いまは5,001文字です。",
  "field": "messageContent",
  "maxCharacters": 5000,
  "actualCharacters": 5001
}
```

## 画面側の受入条件

1. テキスト選択時だけ `現在の文字数 / 5,000文字` を表示する。
2. 5,001文字以上では保存ボタンを押せない形にする。ただしWorkerの422も同じ日本語で表示する。
3. Flex・画像の内容に「5,000文字まで」を表示しない。
4. 既存の約4,500文字で分割される案内は、保存上限とは別の意味だと分かるようにする。
5. 5,000文字ちょうど、5,001文字、絵文字を含む本文、新規作成、編集の全部を試す。

画面の入力制限だけを正本にしない。別クライアントや古い画面から保存しても、Workerが同じ上限で止める。
