/*
 * 受信箱の右の列が API の想定外の形（一覧の形・null・項目の欠け）を受けても落ちないための読み方。
 */

/** 配列として読む値はここを通す。配列でなければ空として扱う。 */
export function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

/** 1人分の形（id を持つ1件）かどうか。一覧の形などは取得失敗として扱う。 */
export function isFriendDetailShape(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as { id?: unknown }).id === 'string'
}
