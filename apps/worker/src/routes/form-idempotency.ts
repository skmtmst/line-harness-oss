


/**
 * 回答内容を決まった形の文にする。再送の照合に使い、キーの順番が違っても
 * 同じ回答は同じ文になる。
 */
export function canonicalizeIdempotencyInput(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeIdempotencyInput).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeIdempotencyInput(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
