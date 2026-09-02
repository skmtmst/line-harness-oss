# 自動応答 `/auto-replies` の言い換え — Codex への引き継ぎ

機能8（Pencil `q8wSqO` / `Gy9OK`）の内部語を運用者の言葉へ直した。
画面側だけで直せなかったもの、または API を触らないと直しきれないものを書く。

画面側の言い換え表は `apps/web/src/app/auto-replies/auto-reply-words.ts`。
契約試験は `apps/web/src/app/auto-replies/auto-reply-words-contract.test.ts`。

---

## 1. 一覧の返事にテンプレート名が無い

**いま:** `GET /api/auto-replies` は `templateId` だけを返す。画面は
`GET /api/templates` を別に読み、クライアント側で突き合わせて名前を出している。

**困ること:** テンプレート一覧の読み込みが失敗すると、**テンプレートを
使っている行が全部**「テンプレートを表示できません」になる。参照先が本当に
消えているのか、こちらが名前を引けていないだけなのかを、画面から区別できない。
（以前はここに `(未知 a1b2c3)` と ID の頭6文字が出ていた。ID の断片は
運用の役に立たないうえ、画面写真に載って外へ出るので消した。）

**ほしいもの**

- 入力: `GET /api/auto-replies`（引数の追加は不要）
- 返り値: 各行に `templateName: string | null` を足す。
  参照先が消えているときだけ `null`。
- 状態番号: 変更なし（200）
- 副作用: なし（読み取りのみ）

これが入ったら、画面は `templateWord(templateId, templateName)` に
その値を渡すだけでよい。関数の形は変えなくて済む。

---

## 2. 一覧の取得に閲覧権限のガードが無い

**いま:** `apps/worker/src/routes/auto-replies.ts` で `requireRole` が付いて
いるのは POST / PUT / DELETE だけ。`GET /api/auto-replies` は誰でも読める。

**画面側の用意:** 一覧は 403 を受けたら「見る権限がありません」を出す形に
してある（`LOAD_STATE_WORDS.forbidden`）。**いまは 403 が返らないので、この
枝には入らない。** ガードを足すときに画面を直す必要はない。

**ほしいもの（足すなら）**

- 入力: `GET /api/auto-replies`
- 返り値: 権限が無いとき `{ success: false, error: '...' }`
- 状態番号: `403`（401 は「ログインが切れている」で別扱い。画面は
  `fetchApi` の共通処理で受けている）
- 副作用: なし

---

## 3. `responseType` が自由な文字列のまま

**いま:** API の型は `responseType: string`。実際に入るのは
`silent` / `text` / `image` / `flex` の4つ。

**画面側の扱い:** 知らない値が来たら「未対応の返し方」と出し、**保存して
ある値は画面に出さない**。運用者にとって `imagemap` は情報ではないため。

**お願い:** 種類を増やすときは、この4つの列挙を共有の型へ上げてほしい。
上がれば、画面側の言い換え表に取りこぼしがあると型で落ちる。
（`messageKinds` は worker 側に `MESSAGE_KINDS` の列挙があるが、これも
共有されていないので、画面は同じ並びを持ち直している。）

- 入力/返り値: 変更なし
- ほしいのは `packages/shared` に置いた
  `type AutoReplyResponseType = 'silent' | 'text' | 'image' | 'flex'` と
  `type AutoReplyMessageKind = ...`（worker の `MESSAGE_KINDS` と同じ8つ）

---

## 4. 触っていないもの

`apps/worker` / `packages/db` / migration / `apps/web/src/app/booking/**` は
このPRでは触っていない。上の3件はいずれもそこが要るため、実装はしていない。
