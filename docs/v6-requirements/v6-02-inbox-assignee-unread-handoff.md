# V6 受信箱 担当者ごとの未読数 引き継ぎ

対象は Node `YZaDK`、ルート `/chats` の「担当者で絞り込む」です。

## 読む口

`GET /api/chats/stats`

既存の `InboxStats` に `assigneeUnread` を追加しました。

```ts
assigneeUnread: Array<{
  operatorId: string | null
  operatorName: string | null
  unread: number
}>
```

- 担当未設定は `operatorId: null` / `operatorName: null` です。
- 0件の担当者は配列に現れません。既存の `/api/operators` と結合し、見つからない担当者は実値 `0` として描いてください。
- 一覧はページ送りされるため、画面に見えている行から数えないでください。
- 選択中の担当者が0件でも、選択肢から消さないでください。

## 撮影用の3状態

通常:

```json
{
  "assigneeUnread": [
    { "operatorId": null, "operatorName": null, "unread": 2 },
    { "operatorId": "operator-kenta", "operatorName": "Kenta", "unread": 3 }
  ]
}
```

0件:

```json
{ "assigneeUnread": [] }
```

失敗は `GET /api/chats/stats` を 500 にし、以前の数を選択肢へ残さないでください。既存の担当者一覧そのものは `/api/operators` の取得結果を維持します。

## 画面側の受入条件

1. 「未割り当て 2」「Kenta 3」のように未読数を添える。
2. 0件の担当者は「Masato 0」と実値0を出す。
3. 集計失敗を0件と扱わず、数だけ `—` にする。
4. アカウント切替時に前の集計を残さない。
5. 1440px・1920pxで横スクロール0。
