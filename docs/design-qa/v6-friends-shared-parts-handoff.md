# V6 機能3 友だち一覧（`PhxG6`）・統合ユーザー（`r7eSi`）共通部品化 引き継ぎ

## 正本

- Node: `PhxG6`（`/friends`）／ `r7eSi`（`/friends?tab=merged` = `app/users/page.tsx`）
- 部品台帳: `apps/web/design/design-parts.json`（`search-field` / `select` / `summary-card` / `chip`）
- 契約試験: `apps/web/src/app/friends/friends-shared-parts-contract.test.ts`、
  `apps/web/src/components/friends/friend-row-shared-parts.test.tsx`

## この版でやったこと

- 検索欄・絞り込み4つ・保存条件の札を、手書きから共通部品へ載せ替えた。
- 絞り込みの幅を設計の実寸（タグ156 / 対応156 / 担当者176 / シナリオ184）へ直した。
- 行のアバターを真円から設計の `r=18` へ直し、担当者に丸アイコンを足した。
- 統合ユーザーの指標カードを共通 `SummaryCard` へ載せ替えた（値 24px → 22px）。
- 重複検出で、登録行数を「送った通数・使った金額」と言い切っていた表示をやめた。

## 未実測・要確認（Pencil MCP が応答しなかったぶん）

作業時、`mcp__pencil__execute` / `get_app_state` がいずれもタイムアウトし、
`PhxG6` / `r7eSi` の実ノードを直接測れなかった。寸法は
`apps/web/design/design-parts.json` の `declarations`（Pencil から写した台帳）と
依頼書に書かれた実測値を突き合わせて決めている。次に Pencil が使えるときに
以下を確認してほしい。

1. `r7eSi` の指標カードは共通 `SummaryCard` の `v5` / `v6` どちらの寸法か。
   - 依頼書の実測は「r=10 / pad16 / ラベル13・600 / 値22・700 / 注記12」。
   - 台帳の `v5` は pad `14px 16px` / ラベル13・600 / 値22・700 / 注記11。
   - 台帳の `v6` は pad16 / ラベル12 / 値22・700 / 注記11・500。
   - どちらとも一致しないので、いま `v5` を当てている（ラベル・値が一致するため）。
     注記の 11px / 12px の差は残っている。**共通部品側は触っていない。**
2. 検索行の「並び順」プルダウンの設計幅。実装の 210px をそのまま残した。
3. 検索行の副操作（詳細条件・保存した検索・検索）の文字サイズ。
   高さ38・幅110/130/70 は依頼書の実測に合わせ、文字は共通部品と同じ
   13px・600 にした。共通 `Button` は36pxなので当てていない。

## Codex 向け：口が要るもの

### 重複検出（`/friends?tab=duplicates`）の「重複による配信コスト」

いまは `—` と「まだ繋がっていません。配信実績が接続されると表示されます。」を出している。
`api.duplicates.stats` が返す `wastedPerBroadcastYen` / `msgUnitYen` は
`friendDups`（重複した**登録行数**）に単価を掛けただけの見積りで、
実際に送った通数でも請求額でもない。画面には出さない。

数字を出すには、次が必要。

- 必要な入力: 集計期間（`from` / `to`）、対象 `accountId`（省略時は担当分すべて）
- 必要な返り値:
  - `duplicateDeliveries`: 同一人物へ重複して**実際に送られた**通数
  - `duplicateDeliveryCostYen`: その通数にかかった**実費**
  - `unitPriceSource`: 単価の出どころ（契約プラン / 実請求 / 未設定）
  - `computedAt`: 集計時刻
  - いずれも取得できないときは `null` を返す。0 で埋めない。
- 状態番号:
  - 200 値あり / 200 かつ全項目 `null`（未接続）
  - 403 見る権限がない → 画面は「見る権限がありません」
  - 404 対象アカウントが担当外
  - 503 集計元（配信実績）が未接続 → 画面は `—` と未接続の説明
- 副作用: なし（読み取りのみ）。再計算は既存の `forceRefresh` に相乗りする。

画面側は、`null` を `—`、`503` を未接続の説明に割り当てるだけで出せる形にしてある。

## 触っていないもの

`apps/worker` / `packages/db` / migration / API契約 /
`apps/web/src/app/auto-replies/**` / `apps/web/src/app/tags/**` /
`apps/web/src/app/booking/**` / 共通 `Button`（36px・角丸8pxのまま）。
