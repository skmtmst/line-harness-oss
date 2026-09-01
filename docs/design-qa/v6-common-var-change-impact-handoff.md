# `uNBlA` 共通情報「変える前に影響を見る」：口の引き継ぎ

- 作成: 2026-09-02（@kenta）
- 正本: Pencil ★V6 `uNBlA`（14-1-B 変える前に影響を見る）
- ルート: `/contents/vars/edit?id=:id`
- 画面側の実装: `apps/web/src/app/contents/vars/edit/page.tsx`
  ／ `change-impact.ts` ／ `common-var-edit-v6.module.css`

## いまの状態

**設計の「影響の要約」4枚と「影響の一覧」は、節だけ置いて `—` にしてある。**
値を作っていないのは、取る口がまだ無いためです。押せない「CSVで書き出す」も
同じ理由で押せない形にし、理由を本文に出しています。

節ごと消さなかったのは、消すと「何の数が出るはずだったのか」が誰にも
読めなくなり、口が付いたときに気付かれないためです。

## `delete-impact` を使い回していない理由

いまある `GET /api/common-vars/:id/delete-impact` は **「消してよいか」を
判定する口** です。次の3つが揃わないので、変更の影響としては読めません。

| 設計が要求するもの | `delete-impact` が返すもの |
|---|---|
| 変えたあとの文（after） | `currentPreview`（いまの文）だけ |
| 文字数の上限を超えるか | 無し。カルーセル本文60字などの検査が要る |
| すぐ反映されるか（予約中の配信・公開中のフォーム） | `blocksDeletion`（削除を止めるか）だけ |

加えて、`delete-impact` は9種類を走査するので、**編集画面を開いただけで
毎回それが走ります**。削除確認（`yPkWe`）では、窓を開くまで走らせない形に
してあります（PR #611）。同じ走査を編集画面の読み込みに載せると、
消さない人・変えない人にも負荷がかかります。

## 要る口

```
GET /api/common-vars/:id/change-impact?accountId=:accountId&value=:nextValue
```

### 入力

| 名前 | 位置 | 必須 | 中身 |
|---|---|---|---|
| `id` | パス | ○ | 共通情報の内部ID |
| `accountId` | クエリ | ○ | 選択中のLINE公式アカウント。`delete-impact` と同じ絞り込み |
| `value` | クエリ | ○ | **これから入れる値**。空文字も送る（空にする操作があるため） |

`value` は打つたびに変わります。**画面側で打鍵ごとに投げません。**
押し口（「影響を見る」）か、値欄から離れたときに1回だけ投げる想定です。
口の側でも重い走査になるなら、`delete-impact` と同じく短い保持を検討してください。

### 返り値

```ts
interface CommonVarChangeImpact {
  variable: { id: string; name: string; varKey: string }
  /** 確かめた時刻。「いつ時点の話か」が無いと、変える判断ができない。 */
  checkedAt: string
  currentValue: string
  nextValue: string

  /** 差し込んでいる場所の総数。 */
  total: number
  /** 保存した瞬間に外へ出るもの（予約中の配信・公開中のフォーム）。 */
  immediateTotal: number
  /** 変えると文字数の上限を超えるもの。**これが出ないと事故る。** */
  overflowTotal: number
  /** 送信済みで、これから変わらないもの。 */
  sentTotal: number

  items: CommonVarChangeImpactItem[]
  /** 所属を確定できず、名前や本文を安全に見せられない使用先。件数は隠さない。 */
  unavailableReferences: { kind: string; kindLabel: string; count: number; reason: string }[]
}

interface CommonVarChangeImpactItem {
  kind: CommonVarUsageKind      // 既存の型をそのまま使う
  kindLabel: string
  name: string
  status: string
  href: string
  /** 保存した瞬間に外へ出るか。 */
  immediate: boolean
  /** 送信済みで変わらないか。 */
  sent: boolean
  /** いまの文。差し込みを当てたあとの本文。 */
  currentPreview: string
  /** 変えたあとの文。 */
  nextPreview: string
  /** 文字数の上限を持つ欄だけ入る。`limit` を超えていたら赤で止める。 */
  limit: { field: string; used: number; limit: number } | null
}
```

**内部IDは専用項目で返さないでください。** `delete-impact` と同じ約束です。

### 状態番号

| 番号 | とき | 画面の出しかた |
|---|---|---|
| 200 | 走査できた（0件でも200） | 数を出す。0件は `0件` と書く |
| 400 | `value` が無い／型に合わない | 入力の誤りとして値欄に出す |
| 403 | そのアカウントを見る権限が無い | 「見る権限がありません」 |
| 404 | その共通情報が無い | 「この共通情報は見つかりませんでした」 |
| 503 | 走査を最後まで読み切れなかった | **0件扱いにしない。**「読み込めませんでした」＋再読み込み |

**503 を0件にしないでください。** 「どこにも差し込まれていません」と読まれると、
15か所が同時に変わる保存を、確かめずに押させることになります。

### 副作用

**この口は何も書き換えません。** `value` を渡しても保存はしません。
`last_checked_at` のような記録も残さないでください。読んだだけで
「確認済み」になると、公開条件を満たしたことにできてしまいます
（友だち追加設定の下書き試験で同じ事故がありました）。

## CSVで書き出す

設計 `uNBlA` の右上にある「CSVで書き出す」は、上の `items` をそのまま
書き出すものです。**`items` の口が付くまでは押せません。**
別の口を足すなら次の形を想定しています。

```
GET /api/common-vars/:id/change-impact.csv?accountId=:accountId&value=:nextValue
```

列は 種別／名前／状態／いまの文／変えたあとの文／上限／すぐ反映されるか。

## 画面側で、口が付いたときに直すところ

1. `change-impact.ts` の `IMPACT_CARDS` に値を入れる（見出しはそのまま使えます）
2. `NOT_CONNECTED_REASON` を出している3か所（要約・一覧・CSV）を外す
3. `IMPACT_LIST_COUNT_TEXT` を実数へ差し替える。**0件は `0件` と書く**
4. 保存ボタンに「上限を超える場所があるあいだは押せない」を足す
5. `common-var-edit-v6-contract.test.ts` の「未接続」を見ている節を書き直す

## 設計との差、残っているもの

| ところ | 設計 | いまの実装 | 理由 |
|---|---|---|---|
| 戻る／保存 | h40 ／ 13・700 | h36 ／ 13・600 | 共通Button（`nBRKk` `uzNEC`）の寸法。V6専用のボタン部品が無いため、部品側に合わせた |
| 更新スケジュール表 | 無し | 有り | 口があり動いている機能。設計に無いからと消すと、予約が組めなくなる |
| 削除 | 無し | 無し（この版で外した） | 使用先を数えない `DELETE` を投げていた。確認は一覧（`yPkWe`）にある |
