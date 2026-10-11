/** D1 の一文100変数以内で、IDの表示ページをまとめて読む。 */
export function idChunks<T>(ids: readonly T[], reservedBindings = 0, copies = 1): T[][] {
  const size = Math.floor((100 - reservedBindings) / copies);
  if (!Number.isInteger(reservedBindings) || reservedBindings < 0
    || !Number.isInteger(copies) || copies < 1 || size < 1) {
    throw new Error('invalid D1 binding budget');
  }
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

/** ORや集計・ページ切替を含むID条件は1変数で渡し、DB内の意味を保つ。 */
export function sqlIdSet(ids: readonly string[]): { sql: string; binds: string[] } {
  if (ids.length === 0) return { sql: 'SELECT NULL AS value WHERE 0', binds: [] };
  return { sql: 'SELECT value FROM json_each(?)', binds: [JSON.stringify(ids)] };
}
