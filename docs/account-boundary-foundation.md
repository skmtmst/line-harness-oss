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

| N/E-ID | route | permission key | resource account解決元 |
| --- | --- | --- | --- |
| N-032 | 友だち集計4口(apps/worker/src/routes/friends.ts:819-941周辺) | /friends 系(STAFF_API_PERMISSIONSで /api/friends→/friends) | 明示IDは resolveRequestBoundary の単票判定、一覧は scope.allowedAccountIds。後続票で接続 |
| N-136 | 選択画面(apps/web/src/components/broadcasts/broadcast-form.tsx:616-617)が読む文面API | /broadcasts 系 | 読む側APIの一覧へ scope.allowedAccountIds を適用する設計は後続票で確定 |
| N-175 | フォルダ絞り込み(apps/web/src/app/form-submissions/page.tsx:263-274。worker側folders口なし) | /form-submissions 系 | 単票判定+一覧絞り込み。worker側の口新設は後続票の設計 |
| N-171/N-179 | 回答検索・CSV(apps/worker/src/routes/forms.ts submissions。PR #88) | /form-submissions 系 | 参考実装(対応済み)。土台への寄せは後続で判断 |
| N-423 | auth.tsの対応表 | — | 対象外(auth.tsは本票の禁止領域) |

- E-IDに境界ものは現在ない(docs/audit-status.mdで確認)。
- N-043(友だち属性の一括更新)は本流統合済みのため表に入れない。
