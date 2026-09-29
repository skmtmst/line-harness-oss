# 機能6（一斉配信）で、口が無くて画面に出せていないもの

`codex/kenta-v6-feature6-design-fit` で設計へ寄せたときに、**画面側だけでは
出せなかった**もの。どれも「数を作らない」ために出していない。API 側の口が
できたら、画面はすぐ足せる。

対象は設計の5枚（`q76C35` `zZ9fA` `cPk8A` `XQfMD` `Bw0zt`）。

## 1. 送信枠（`Bw0zt`・設計右下「送信枠」）

設計は「使用予定 1,213 / 5,000通・残り 3,787通」と帯で出す。

- `quotaLimit` / `quotaUsed` は **`/api/dashboard/overview` の中にしかない**。
  作成画面の読み込みでダッシュボードの重い集計を叩くのは割に合わない。
- **いまは出していない。** 半端に「残り —通」と書くと、単位のせいで数に見える。
- 予約の注意書きにも書いていない。「送信枠も再確認します」と書くと、
  読めない数を約束することになる。

**欲しい口**：`GET /api/broadcasts/quota?accountId=` が `{ quotaLimit, quotaUsed }`
だけを返す軽い口。ダッシュボードの集計とは別経路にしてほしい。

## 2. 配信スケジュール（`Bw0zt`・前後の配信と重ならないか）

設計は予約日の前後4日を並べ、同じ日に他の配信があれば
「8/24 は 09:00 にも配信があります」と注意を出す。

- 一覧の口（`GET /api/broadcasts`）は全件返るので**日付で絞れない**。
  作成画面から全件取ると、件数が増えたときに作成画面が重くなる。

**欲しい口**：`GET /api/broadcasts?scheduledFrom=&scheduledTo=` の絞り込み。
返すのは id・title・scheduled_at だけでよい。

## 3. 重複時の送信・配信優先度（`Bw0zt`・計測と配信制御）

設計は「1人1通にまとめる」「配信優先度：通常」を選ばせる。

- `broadcasts.create` に**受け取る項目が無い**。画面に選び口だけ置くと、
  選んだのに保存されない（＝送信時に効かない）ものになる。

**欲しい口**：`broadcasts.create` に `dedupPerPerson` / `priority` を追加。
受けたあと `services/broadcast.ts` の送信経路で効かせるところまで。

## 4. ボタンの編集・URLの扱い（`XQfMD`）

設計は本文の下に「ボタン（最大4つ・ラベルと押したときの動作）」と
「URLの扱い（サイト名・URL・計測）」の表を置く。

- `BroadcastBubble` の `content` に**ボタンの項目が無い**。
  Flex を手で書けば出せるが、それは設計の形ではない。

**欲しい口**：`messageBubbles[].content.buttons`（`{ label, action, url }` の配列、
最大4）を受け、`line-message.ts` の組み立てで template/Flex の action へ落とす。

## 5. 保存してテンプレート化・配信後のアクション（`XQfMD`）

- テンプレート化は `templates.create` に本文を渡せば作れそうに見えるが、
  **配信の吹き出しの形とテンプレートの形が同じである保証が無い**。
  往復して壊れないことを確かめてから足す。
- 配信後のアクション（タグ「配信済み」を追加など）は
  `broadcasts.create` に受け口が無い。

## 6. 社内メモ（`zZ9fA`）

設計は「社内メモ（任意）・友だちには表示されません」を持つ。
`broadcasts.create` に保存先が無いので置いていない。置くと、書いたのに
消えるものになる。

**欲しい口**：`broadcasts` に `internal_note`（本文とは別に保存し、
LINE へは絶対に渡さない）。

## 7. 帯の「下書き」「今日の予約」（`q76C35`・#602 の判定を引き継ぐ）

`getBroadcastStats` はテナント全体を数え、一覧は LINE アカウントで絞れる。
**基準の違う数を同じ帯に並べると、足しても合わない4枚になる。**

**欲しい口**：`/api/broadcasts/stats` に `accountId` を渡せるようにし、
`draft` と `scheduledToday`（JSTの今日）を返す。
`scheduledToday` は **JST で日を切る**こと。`toISOString()` は UTC なので、
JST で日が変わってから9時間ぶん数え落とす。

## 8. 対象の内訳（`cPk8A`・条件一致 / 送信可能 / 除外）

設計は3つの数を並べる。いま数えられるのは**送信可能の1つだけ**
（`/api/segments/count` は `is_following = true` を必ず含めた条件で数える）。

- 「条件一致」＝除外前の数、「除外」＝その差、を返す口が無い。
- **2つを `—` で並べるより、1つだけ正しく出すほうを選んだ。**
  同じ帯に取れない数を並べると、どれが実値か読めなくなる。

**欲しい口**：`/api/segments/count` が `{ matched, sendable, excluded }` を返す。
`matched` は `is_following` を外した数、`excluded` はその差。

## 触っていないもの

`h0kahp` `vW4Es` `u6gHt` `sqFXf` の4枚は今回の担当外。
`test-send-section.tsx` `segment-preset-controls.tsx` は変更禁止のため、
`cPk8A` の「保存済み条件を窓の外（面の中）へ出す」は手を付けていない。
