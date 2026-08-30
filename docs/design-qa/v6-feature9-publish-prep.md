# 機能9「友だち追加時の配信」公開の段：先回りの準備

**日付**：2026-08-30 ／ 対象：`ec9vg`（9-1-F 最終確認）・`quhg6`（9-1-G 有効化完了）
**この文書はアプリを変更しない。** APIのheadが届く前に、撮る道具だけ用意する。

> **`screens.mjs` の `ec9vg` `quhg6` は `unimplemented` のままにしてある。**
> API head が届くまで、実装済み扱いにも画像合格にもしない。

## いま止まっている理由

| Node | 足りないもの |
|---|---|
| `ec9vg` | 現行はアカウント単位のJSONを「保存」で**即時反映**する。対象見込み・二重経路・テスト完了・公開版を保証する口が無い |
| `quhg6` | 現行のPUTは**公開結果も版も返さない**。`ec9vg` の draft/validate/publish が前提 |

## 想定ルートと操作手順

**どちらも「想定」で正本ではない。** head が届いたら実装のコードで確かめる。

- 想定ルート：**`/friend-add-settings/publish`**（4段を1画面にまとめる。機能8の `/auto-replies/publish` と同じ形）
- 想定の口：`/api/friend-add-rules/:id/{draft,validate,conflicts,test,publish}`

**段の並び**（機能8と揃える）

1. **二重経路を確認**（`ec9vg` の前半）— 同じ人が2つの入口から入らないか
2. **実際に試す** — どの枝に入り、何が動くかを見る。送信・状態更新はしない
3. **最後の確認**（`ec9vg`）— 対象見込み・二重経路・テスト完了・入力の不足
4. **公開しました**（`quhg6`）— 公開版・監視先

**押し口**：`data-qa-open="ec9vg"` / `data-qa-open="quhg6"`。
**文言で探さない。** 言葉を変えたときに撮影が黙って空振りする。

## 固定データ案（`fixtures.mjs` に入れてある）

`FRIEND_ADD_DRAFT` / `_UNTESTED` / `_CONFLICTS` / `_VALIDATION` / `_VALIDATION_OK` / `_DRY_RUN` / `_PUBLISHED`。

**形は機能8（#595）に合わせた。** 同じ「下書き → 確認 → 試験 → 公開」なので、
**別々の形にすると画面も試験も二重に持つことになる。**
設定の中身だけ `FriendAddRouting`（`packages/shared/src/types.ts:1719`）。

**機能9にだけある確認**

- **二重経路** — 流入リンク側にもシナリオが付いていると、同じ人に2回届く
- **流入条件** — どの流入リンクから来た人か
- **初回案内** — はじめての人へ最初に送るもの

**5状態の出し分け**（機能8と同じ器で）

| 状態 | 出し方 | 見どころ |
|---|---|---|
| 通常 | そのまま | 二重経路2件・対象見込み116人 |
| 読込 | 返事を遅らせる | 「読み込んでいます」 |
| 空 | `conflicts: []` | **「二重経路はありません」**。0件と読めなかったを混ぜない |
| 失敗 | 500 | 「**保存した下書きは消えていません。**」 |
| 権限不足 | 403 | **「読めなかった」と混ぜない。** 下書きの中身も出さない |

**取得元が無い値は `null` で返す。** `estimatedTargets.returning: null` と
`monitoring.slackChannel: null` を入れてあるので、**画面が `—（未取得）` と
書くか**をこの1枚で確かめられる。**0人と混ぜない。**

## `screens.mjs` の候補設定

head が届いたら、この形へ差し替える。**いまは入れない。**

```js
{
  ...FRIEND_ADD, node: 'ec9vg', name: '9-1-F 最終確認',
  route: '/friend-add-settings/publish?id=far-1', mode: 'page',
  states: {
    apis: ['**/api/friend-add-rules/*/draft*', '**/api/friend-add-rules/*/conflicts*'],
    kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'],
  },
  steps: [
    { click: '夏のInstagram投稿（流入リンク）の重なりを確認した', role: 'checkbox', after: 250 },
    { click: '友だち追加の自動応答の重なりを確認した', role: 'checkbox', after: 250 },
    { qaOpen: 'ec9vg', after: 900 },
  ],
}
{
  ...FRIEND_ADD, node: 'quhg6', name: '9-1-G 有効化完了',
  route: '/friend-add-settings/publish?id=far-1', mode: 'page',
  steps: [ /* ec9vg と同じ段 + */ { click: 'この内容で公開する', after: 1200 } ],
}
```

## 撮影の順番

1. head を取得し、**SHA一致を確かめる**
2. 実装のコードで**ルートと口と型を確かめる**（想定のままにしない）
3. 固定データを実装の型へ合わせ直す（**差があればこちらを直す。実装の不具合として報告しない**）
4. `--only ec9vg,quhg6` で 1440・1920 を撮る
5. 5状態を撮る
6. **画像比較が終わってから** `screens.mjs` と台帳を更新する

## 必ず見ること

- 公開するまで**いまの配信が変わらない**ことを画面に書く
- **二重経路を全件確認するまで公開させない**
- **試験で送信・タグ・状態を変えない**と明記する
- 公開は**冪等キー**を使い、押し直しても版が増えない
- **対象見込みが取れないときは `—（未取得）`。0人と混ぜない**
- 権限不足を「読めなかった」と混ぜない
- 1440px・1920pxで横スクロール0
- `undefined` / `NaN` / `Invalid Date` / 内部ID を出さない
