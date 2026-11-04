
// ── Submissions ───────────────────────────────────────────────────────────────

/**
 * ページ分けなしの回答一覧（互換用）。
 *
 * **切る数は呼び出し側が渡す。**ここに数を直書きすると、呼び出し側の
 * 口の名乗る件数と食い違う。**数が2か所にあって食い違うと、
 * 利用先は上限を超えた分を黙って取り落とす。**名乗る側が渡せば、名乗りと
 * 実際は同じ数になる。
 *
 * `boundedListLimit` は残す。**渡し忘れ・渡しすぎのときの天井**で、
 * この現場の一覧ヘルパは全部これで `MAX_LIST_LIMIT` に抑えてある
 * （DB ヘルパを直接呼んでも一覧が無制限にならないようにするため）。
 */
export interface FormSubmissionPeriod { from?: string; until?: string }

/** SQLite defaults without an offset are UTC; compare all instants in JST. */
export function submissionPeriodSql(column: string, period: FormSubmissionPeriod = {}) {
  const date = `datetime(${column}, '+9 hours')`;
  return { sql: `${period.from ? ` AND ${date}>=datetime(?)` : ''}${period.until ? ` AND ${date}<datetime(?)` : ''}`, bindings: [...(period.from ? [period.from] : []), ...(period.until ? [period.until] : [])] };
}
