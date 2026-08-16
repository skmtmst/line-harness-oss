# v0.24.0 実装前に決めたこと

要件定義書（`docs/requirements-v0.24.md` §6-6）で「実装前に決める」としていた3点と、
着手して分かった番号のずれの扱い。**後から変えられる形で決めている**ので、
違っていれば言ってほしい。

- 決めた日: 2026-08-16
- 決めた人: kenta（マサトさんの「最善の方法で」に基づく）

---

## 1. `tag_groups` を `folders` へ移送するか → **移送する**

**決定**: `folders(kind='tag')` を正とし、`tags.folder_id` を新設する。
`tag_groups` と `tags.group_id` は消さずに残すが、**以後どこからも読まない・書かない**。

**理由**: 二重管理を避けるのが最優先。フォルダは13画面すべてに出るので、
タグだけ別テーブルという状態は「タグの分類を直したのにフォルダ一覧に出ない」
という形で必ず表面化する。

**既存データの扱い**: マイグレーションの中で `tag_groups` の行を `folders` へ写し、
`tags.group_id` の値から `tags.folder_id` を埋める。移送は追加のみで、
元の行はそのまま残る。切り戻すときは `folders` の行を消すだけでよい。

**画面とAPIへの影響**: `/api/tag-groups` の経路とレスポンスの形は変えない。
中で見るテーブルだけ差し替える。画面は書き換えない。

> 0.23.0 の #34 で `tag_groups` を入れた直後の移送になる。順番としては悪いが、
> 二重管理を残したまま13画面ぶんのフォルダを作る方が後戻りが大きい。

---

## 2. `/nen-members` の行き先 → **そのまま残す（統合しない）**

**決定**: 統合対象から外す。要件定義書 §2-3 の「要確認」は取り下げる。

**理由**: 中身を見たところ、`/nen-members` は**写真審査そのもの**だった
（`apps/web/src/app/nen-members/page.tsx` の実体は `PhotoReviewsPage`）。
V2 の 9-2 写真審査に対応する画面が、既にこの名前で存在している。

**要件定義書の訂正**: §2-2 の表で「9-2 写真審査 → `/health`」としているのは誤り。

| V2 | 正しいルート | 補足 |
|---|---|---|
| 9-2 写真審査 | `/nen-members` | サイドバーでも「EC > 写真審査」として出ている |
| 10-4 運用状態 | `/health` を `/emergency?tab=ban` へ統合 | `/health` はアカウントのBANリスク監視で、写真審査ではない |

**残る作業**: ルート名が中身と合っていない（`/nen-members` なのに写真審査）。
名前を変えるなら旧URLの308リダイレクトが要るので、v0.24.0 では**名前を変えない**。
サイドバーの表示名は既に「写真審査」なので、運用上は困らない。

---

## 3. 自動応答の優先順位 → **一覧の並び順＝評価順、最初に一致した1件だけ実行**

**決定**: 要件定義書 §6-6 の案をそのまま確定させる。`auto_replies.priority ASC, created_at ASC`
で並べ、上から評価して最初に条件まで通った1件を実行し、そこで打ち切る。

**理由**: 0.23.0 の #36 で既にこの形になっている（キーワードが一致しても時間帯・
連投抑制・有人対応で見送ることがあるため、「条件まで通る最初の1件」を探す実装）。
`priority` を足すのは並び順を人が決められるようにするだけで、評価の仕方は変わらない。

**画面に書くこと**: 「上にあるルールから順に見て、最初に当てはまった1つだけが動きます」
を一覧に明記する。複数一致したときの挙動は、書いていないと必ず問い合わせになる。

---

## 4. マイグレーション番号のずれ → **099〜103 にする**

要件定義書 §3 は `098`〜`102` を指定しているが、**`098_event_waitlist.sql` を
0.23.0 側で使ってしまった**（イベントのキャンセル待ち。`event_bookings.status` の
CHECK 制約を増やせないため、別テーブルが必要だった）。

そのため v0.24.0 の5件は1つずつ後ろへずらす。

| 要件定義書 | 実際 | 中身 |
|---|---|---|
| 098 | **099** | `folders` / `friend_fields` / `friend_field_values` |
| 099 | **100** | `support_marks` / `saved_searches` ＋ `friends` の列 |
| 100 | **101** | `media` / `media_usages` / `common_vars` / `common_var_schedules` |
| 101 | **102** | `site_visitors` / `site_events` / `funnels` / `funnel_steps` |
| 102 | **103** | `login_audit` ＋ 4テーブルへの列追加 |

番号以外は要件定義書のDDLに従う。

---

## 5. `scenarios.allow_concurrent` → **実装した**（当初は保留にしていた）

**決定**: 「**他のシナリオが動いている人は登録しない**」という意味で実装した。
画面はシナリオ詳細のチェックボックス。

**保留にしていた理由と、その解き方**:

`friend_scenarios` には既に部分UNIQUE索引がある。

```sql
CREATE UNIQUE INDEX idx_friend_scenarios_unique
  ON friend_scenarios (friend_id, scenario_id) WHERE status != 'completed';
```

つまり**同じ友だちが同じシナリオに二重登録されることは、いまも起きない**。
なので「1人1シナリオ」を*同じシナリオの重複*と読むと、この列は何もすることが無い。
索引を落とせば重ねられるが、追加のみポリシー（`CONTRIBUTING.md §Migration Policy`）で
索引の削除は禁じている。

そこで*シナリオをまたぐ排他*と読んだ。こちらは実装できる。
問題は**列の既定が 0** で、そのまま入れると全シナリオが排他になり、
「昨日まで届いていた配信が届かない」形で表に出ることだった。

これを 104 で解いた。

```sql
-- 104_scenario_concurrency_default.sql
UPDATE scenarios SET allow_concurrent = 1 WHERE allow_concurrent = 0;
```

既存の行を全部「並行を許す」に倒すので、**入れても今日の挙動は1つも変わらない**。
`createScenario` も既定で 1 を入れる（`allowConcurrent === false` のときだけ 0）。
排他にしたい人が画面で明示的に切り替えたときだけ効く。

**あとから来たシナリオの扱い**: 「登録しない」。前のシナリオは止めない。
止める側にすると、配信中のシナリオが外から消える事故が起きる。
`enrollFriendInScenario` は例外ではなく `null` を返す —— 呼び出し口が
友だち追加などの副作用の中にあり、`throw` すると本来の処理まで巻き添えになる。

検証は `packages/db/test/scenario-concurrency.test.ts`（7件）。

## 6. `broadcasts.stealth_spread_minutes` → **実装した**（当初は保留にしていた）

**決定**: 分数で割った人数だけを1回の cron で送り、残りは次の tick に回す。

**保留にしていた理由**: 分割送信は二重送信の危険に直に触れる。

**その解き方**: 新しい仕組みを足さず、**既にある `batch_offset` の再開経路に乗せた**。

```ts
const chunkLimit = stealthChunkSize(friends.length, spreadMinutes, deliveryBatchSize);
const stopAt = Math.min(friends.length, currentOffset + chunkLimit);
// ...送信ループ...
if (currentOffset < friends.length) {
  await updateBroadcastBatchProgress(db, broadcast.id, currentOffset, 0);
  return;   // 次の cron で続きから
}
```

`batch_offset` はもともと「1回で送りきれなかったとき」に使っていて、
二重送信を防ぐ仕掛けはそこに入っている。上限を下げているだけなので、
新しい危険は増えていない。0分（既定）なら `stealthChunkSize` が全員を返すので、
従来どおり一気に送る。

検証は `apps/worker/src/services/stealth-spread.test.ts`（7件）と、
既存の `broadcasts-idempotency.test.ts`。
