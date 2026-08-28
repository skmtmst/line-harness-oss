# P0 2件（Codexへ渡すぶん）

**どちらも「失敗したのに、失敗したと分からない」形です。**

片方は保存が失敗しても「保存しました」と出ます。もう片方は読み込みが失敗
しても「まだありません」と出ます。**どちらも、人が気づけません。**

以下は画面確認のときに撮れた絵と、実際のコードから確かめたものです。
**実装は変更していません。**

---

## P0-1 保存に失敗しても「保存しました」と出る

| | |
|---|---|
| Node | `tBlkL` 2-15 保存した検索・保存完了 |
| 画面 | `/chats` の「保存した検索」→「この条件を保存」 |
| 直す場所 | `apps/web/src/components/chats/saved-view-dialog.tsx:76-77` |
| 一緒に見る場所 | `apps/web/src/app/chats/page.tsx:636-670`（`createSavedView`） |
| どの枝にあるか | この部品は **`codex/development` にありません。** 入れたのは `ce3a04d4`「保存した検索を、名前と条件を見せてから保存する形にする」（2026-08-27）で、V6の枝にだけ入っています |
| 撮った絵 | [tBlkL-1440](inbox-v6/tBlkL-1440.png) / [tBlkL-1920](inbox-v6/tBlkL-1920.png) |

### 何が起きるか

窓が「保存しました」「「保存した検索」から、いつでもこの条件を呼び出せます。」
と出します。**そのとき、後ろのパネルには「API error: 405」が出ています。**

窓は画面の真ん中にあり、後ろは暗くなっています。**窓を開けている人には、
後ろの赤い文字は見えません。**閉じてから一覧を見ると、保存したはずの検索が
ありません。

### なぜそうなるか

```tsx
// saved-view-dialog.tsx
    setError('')
    await onSave(trimmed)   // ← 成否を返さない
    setDone(true)           // ← 何があっても「保存しました」へ進む
```

`onSave` は親の `createSavedView` を呼びます。親は失敗を**自分で捕まえて**
`setSavedViewError(...)` に入れ、正常に返ります。

```tsx
// chats/page.tsx
    } catch (savedViewCreateError) {
      setSavedViewError(...)   // ← パネルに出る。窓には伝わらない
    } finally {
      setSavingView(false)
    }
```

投げ直さないので、窓から見ると成功と区別が付きません。

### 直す形（案）

`onSave` に成否を返させ、失敗なら窓の中に出す。

```tsx
const ok = await onSave(trimmed)
if (!ok) { setError('保存できませんでした。もう一度お試しください。'); return }
setDone(true)
```

親は `createSavedView` を `Promise<boolean>` にして、`setSavedViewError` の
かわり（または加えて）`false` を返します。**エラーの文は、操作した窓の中に
出してください。** 後ろのパネルに出しても読まれません。

### 再現の手順

1. `/chats` を開く
2. 「保存した検索」を押す
3. 「この条件を保存」を押す
4. 検索名に何か入れる
5. もう一度「この条件を保存」を押す
6. **保存の口が失敗を返す状態にする**（画面確認用のモックは書き込みを常に
   405 で返すので、そのままで再現します）

### いま出るもの / 出したいもの

| | |
|---|---|
| いま | 窓：「保存しました」 ／ 後ろ：「API error: 405」 |
| 出したい | 窓の中に「保存できませんでした。もう一度お試しください。」。窓は閉じない |

---

## P0-2 読み込みに失敗しても「フォームがまだありません」と出る

| | |
|---|---|
| Node | `ZOPyc` 13-1-F 一覧の状態（空・読込・エラー） |
| 画面 | `/form-submissions` |
| 直す場所 | `apps/web/src/app/form-submissions/page.tsx:123-130`（握りつぶし）と `:341-345`（空の枝しか無い） |
| どの枝にあるか | **`codex/development` `2e438929` にそのまま入っています。**（`origin/codex/development` で確認） |
| 撮った絵 | [ZOPyc-error-1440](forms-v6/ZOPyc-error-1440.png) / [ZOPyc-error-1920](forms-v6/ZOPyc-error-1920.png) |

### 何が起きるか

読み込みに失敗しても、**赤い帯すら出ません。** 本文は
「フォームがまだありません」だけで、**中身が空のときとまったく同じ絵**に
なります。持っているフォームが消えたように見えます。

### なぜそうなるか

失敗を明示的に握りつぶしています。

```tsx
  const loadForms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Form[] }>('/api/forms')
      if (res.success) setForms(res.data)
    } catch { /* silent */ }      // ← ここ
    setLoading(false)
  }, [])
```

`res.success` が `false` のときも何もしません。そして描くところに
**失敗の枝がありません。**

```tsx
  {loading ? (
    <div …>読み込み中...</div>
  ) : forms.length === 0 ? (
    <div …>フォームがまだありません</div>   // ← 失敗もここへ来る
  ) : ( …一覧… )}
```

このページで持っているエラーの状態は `renameError`（名前の変更用）だけです。

### 直す形（案）

**部品はもうあります。** `apps/web/src/components/shared/list-state.tsx`。
リマインダ（`dC0yg`）と一斉配信（`TmHjF`）が同じ形で使っていて、そちらは
正しく出ています。

```tsx
{loading ? <ListState kind="loading" />
 : error ? <ListState kind="error" title="回答フォームを読み込めませんでした" onRetry={loadForms} />
 : forms.length === 0 ? <ListState kind="empty" title="フォームがまだありません" action={…} />
 : …一覧…}
```

**失敗のときに `action`（作成の誘い）を渡さないでください。** 押すと同じ
ものをもう1つ作ります。**帯の数も `0件` ではなく `—` にしてください。**

### 再現の手順

1. `/api/forms` が失敗を返す状態にする
2. `/form-submissions` を開く
3. 「フォームがまだありません」だけが出る。赤い帯は出ない

### いま出るもの / 出したいもの

| | いま | 出したい |
|---|---|---|
| 帯 | 0件 / 0件 / — / — | **—** でそろえる |
| 本文 | フォームがまだありません | 読み込めなかった旨と、もう一度読み込む |
| 作成の誘い | 出る | **出さない** |

---

## この2件の関係

**同じ間違いです。** 「失敗を、静かに、空として出す」。

P0-2 と同じ形は、ほかにも残っています（登録メディア・オートメーション・
外部連携・予約設定・イベント予約・友だち・シナリオ）。まとめは
[要修正171枚の束](v6-needs-fix-bundles.md) を見てください。

**手本は `dC0yg`（リマインダ）と `TmHjF`（一斉配信）です。**
帯は `—`、一覧の中は空の文でなく「いまは読み込めていません。上の案内を
ご覧ください。」、作成の誘いを出さない。
