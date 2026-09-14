# 権限・tenant・LINEアカウント境界の土台と後続接続表(board #800)

## 土台の使い方

- 2つの関数だけ使う(apps/worker/src/services/request-boundary.ts):
  `resolveRequestBoundary(db, staff, requestedAccountId, options?)` と
  `resolveRequestBoundaries(db, staff, requestedAccountIds, options?)`。
- 中身の判定は既存関数の再利用だけ。tenantの壁→個別範囲→機能範囲の順序は
  変えない。複数IDは既存 `canAccessAllLineAccounts` へ委譲する。
- `options.requiredPermissionKey`: 必須の個別権限キー。完全一致で比べる
  (部分一致は許可しない)。指定時は readOnly を必ず拒否する。
- 使い分け:
  - 単票・単操作(指定IDあり): 戻りの `allowed` が false なら止める。
    `reason` が `unauthenticated` なら401、`outside-scope` なら404扱いを推奨
    (存在の有無を漏らさない)。`forbidden` は403。
  - 一覧(指定なし): `allowed` は true 固定。`scope.allowedAccountIds` で絞り込む。
    未割当行を読むときだけ `scope.canSeeUnassigned` を見る。
  - 複数ID(付属先・一括先など): `resolveRequestBoundaries` を使う。1件でも
    範囲外なら全体を不許可にする(fail-closed)。
- 今回は各機能routeへ配線していない。下の表の後続票がこの関数を呼ぶ。

## 後続N/E-ID接続表

| ID | 内容 | 使う口 | 状態 |
| --- | --- | --- | --- |
| N-032 | 友だち集計4口が明示アカウント指定の権限確認をしていない | 単票の指定ID判定 | 未着手。後続票で接続 |
| N-136 | 一斉配信・個別トークの選択画面が別アカウントの文を読む | 一覧の範囲絞り込み | 未着手。後続票で接続 |
| N-175 | フォームのフォルダ絞り込み・権限が未接続 | 単票の指定ID判定+一覧の範囲絞り込み | 未着手。後続票で接続 |
| N-171/N-179 | フォーム回答の検索・CSVが全件条件(PR #88) | 参考実装(手書き境界)。土台への寄せは後続で判断 | 対応済み |
| N-423 | 対応表に無いAPIはスタッフ権限で通る | auth.tsの対応表。土台の範囲外 | 対象外(auth.tsは本票の禁止領域) |

- E-IDに境界ものは現在ない(docs/audit-status.mdで確認)。
- N-043(友だち属性の一括更新)は本流統合済みのため表に入れない。
