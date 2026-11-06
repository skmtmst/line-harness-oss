/** 日本時間の暦日。終端は翌日0時（排他的）。 */
export interface ExecutionDateRange { from?: string; to?: string }
export function parseExecutionDateRange(input: ExecutionDateRange): { from?: string; until?: string } {
  for (const day of [input.from, input.to]) {
    if (day === undefined || day === '') continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
      throw new Error('期間は実在する日付（YYYY-MM-DD）で指定してください');
    }
  }
  if (input.from && input.to && input.from > input.to) throw new Error('終了日は開始日以降にしてください');
  const next = input.to ? new Date(Date.parse(`${input.to}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : undefined;
  return { from: input.from ? `${input.from}T00:00:00+09:00` : undefined, until: next ? `${next}T00:00:00+09:00` : undefined };
}
