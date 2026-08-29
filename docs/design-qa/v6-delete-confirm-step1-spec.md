# 削除確認の段1 ― Codex 向けの作り方

**書いた日**：2026-08-30 ／ **調べた木**：#572 head `e4ab641f`（`codex/development` 直結）

対象は5画面。**新しいAPI・DB・migration は要りません。** 削除の口はもう在ります。

`szXsT`（12 リッチメニュー）／`yPkWe`（14 共通情報）／`YfTfJ`（15 メディア）／`gBp2J`（13 フォーム）／`UIaM7`（18 流入リンク）

**段2（使用先の台帳・差し替え・アーカイブ）は別です。** 段1が入っても判定は `needs_fix` のままで、設計どおりにはなりません。**いまの危うさ（標準の窓・内部の文字・二重押し）を消すのが段1です。**

---

## 手本は #554（`EGMb1`）

そのまま写せます。`apps/web/src/app/broadcasts/page.tsx` と、同じ場所の契約テストを見てください。

```tsx
const [deleteTarget, setDeleteTarget] = useState<T | null>(null)
const [deletingId, setDeletingId] = useState<string | null>(null)
const [deleteError, setDeleteError] = useState('')

const handleDelete = async () => {
  if (!deleteTarget) return
  setDeletingId(deleteTarget.id)
  setDeleteError('')
  try {
    const result = await api.xxx.delete(deleteTarget.id)
    if (!result.success) throw new Error(result.error)   // ← 成否を必ず見る
    setDeleteTarget(null)
    await load()
  } catch {
    setDeleteError('◯◯を削除できませんでした。状態を読み直してから、もう一度お試しください。')
  } finally {
    setDeletingId(null)
  }
}

<ConfirmDialog
  open={deleteTarget !== null}
  title={`「${deleteTarget?.name ?? ''}」を削除しますか？`}
  description="…何が消え、何が残り、戻せないこと…"
  confirmLabel="削除する"
  destructive
  busy={deletingId !== null}
  error={deleteError}
  onConfirm={() => void handleDelete()}
  onCancel={() => { if (deletingId !== null) return; setDeleteError(''); setDeleteTarget(null) }}
/>
```

**`if (!result.success) throw` を落とさないでください。** これが無いと、保存に失敗しても成功に見えます（`tBlkL` のP0がまさにそれでした）。

---

## 受入条件（6項目・全画面共通）

1. ブラウザ標準の `confirm` を使わない
2. **対象の名前**を題に入れる
3. 本文に**何が消え・何が残り・戻せない**の3つを書く
4. `busy` で二重押しを止め、実行中は窓を閉じさせない
5. APIの成否を見る（`if (!result.success) throw`）。失敗しても**窓を閉じず**、窓の中に画面の言葉で出す
6. 1440・1920で横スクロール0

---

## 画面ごとに決めること

### `szXsT` リッチメニュー（`app/rich-menus/page.tsx`）

**確認の場所が3つあります。うち2つが削除です。**

| 行 | 何をする | 段1でどうする |
|---|---|---|
| `:193` | 管理画面のメニューを削除 | 窓へ。本文に「切替の設定と、このメニューを指していた出し分けも一緒に消えます。適用中の友だちには次のメニューが出ます。」 |
| `:206` | **LINE上の外部メニューを削除** | 窓へ。**`richMenuId: ${...slice(0,14)}...` を本文から外す**（束3。内部IDは運用の人に読めません） |
| `:224` | 管理画面へ取り込む | **削除ではないので、この段では触らない** |

### `yPkWe` 共通情報（`app/contents/vars/page.tsx:150`）

一括削除です。いまの本文「テンプレートに差し込みが残っていると、その部分が空になります。」は**中身が良いので活かしてください**。窓に移し、件数と、消えないもの（テンプレート本体）を書き足します。

### `YfTfJ` メディア（`app/contents/page.tsx:175` `:183`）

**ここだけ判断が要ります。**

- `:175` 一括削除 → 窓へ
- `:183` **409 が返ったあと「それでも削除しますか？」で `force: true` で消せます。** しかも `e.message`（APIの生文）をそのまま本文に出しています

設計は「**使われているあいだは削除できません。先にこの3か所から外してください。**」です。実装は使用中でも消せます（`voJtX` に記録済みのP1）。

**段1では `force` の道を窓へ移さないでください。** どちらが正しいかは決めごとで、私からは決められません。**いまは409のときに「使用先から外してから消してください」と出して止める**のが設計に近いです。`force` を残すなら、それは設計変更なので別に合意が要ります。

`e.message` の素通しは、どちらに決めても直してください（束2）。

### `gBp2J` フォーム（`app/form-submissions/page.tsx`）

このファイルは **#436 → #556 が積み重なっています。** 段1は**その2本が入ってから**にしてください。同じファイルの取り合いになります。

### `UIaM7` 流入リンク（`app/entry-routes/page.tsx`）

**重なる open PR が1本もありません。ここから始めるのがいちばん安全です。**

---

## 契約テストの形

#554 と同じ形で、ファイルを読んで文字列を確かめるだけです。ブラウザは要りません。

```ts
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

it('ブラウザ標準の確認ではなく共通ダイアログを使う', () => {
  expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
  expect(PAGE).not.toContain("confirm(`「${group.name}」を削除します")
})
it('APIが失敗を返したら成功扱いにしない', () => {
  expect(PAGE).toContain('if (!result.success) throw new Error(result.error)')
})
it('失敗しても窓を閉じず、内部用のエラー文を出さない', () => {
  expect(PAGE).toContain('◯◯を削除できませんでした。状態を読み直してから、もう一度お試しください。')
  expect(PAGE).toContain('error={deleteError}')
})
```

**`not.toContain` に、いま在る `confirm(...)` の文字列をそのまま書いてください。** 消し忘れがそのまま試験に出ます。

---

## 作る順

| 順 | Node | 待つもの |
|---|---|---|
| 1 | `UIaM7` | **なし** |
| 2 | `szXsT` | なし（#523 は帯の直しで、削除の行とは別の場所） |
| 3 | `yPkWe` | #437 |
| 4 | `gBp2J` | #436 → #556 |
| 5 | `YfTfJ` | #438 → #559 → #560、**および `force` の決めごと** |

**1本のPRに1画面**にしてください。5画面をまとめると、同じファイルを触る別PRとぶつかったときに全部が止まります。
