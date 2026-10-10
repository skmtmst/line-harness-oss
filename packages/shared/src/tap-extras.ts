/** ボタンを押したときの追加処理。スコアは友だちの合計点1つ。 */
export interface TapExtras {
  tagIds?: string[];
  scoreChange?: number | null;
}
export function tapExtrasError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return '押されたときの追加処理を確認してください';
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !['tagIds', 'scoreChange'].includes(key))) return '押されたときの追加処理を確認してください';
  if (v.tagIds !== undefined && (!Array.isArray(v.tagIds) || v.tagIds.length > 100 || v.tagIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)))) return '付けるタグを選び直してください';
  if (v.scoreChange != null && !Number.isSafeInteger(v.scoreChange)) return '足すスコアは整数で入力してください';
  return null;
}
export function hasTapExtras(value?: TapExtras | null): boolean {
  return Boolean(value?.tagIds?.length || value?.scoreChange);
}
/** JSONを歩いて追加処理だけを検査する。LINEへ送る前にWorkerが除く。 */
export function validateTapExtrasTree(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const child of value) { const error = validateTapExtrasTree(child); if (error) return error; }
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const error = key === 'tapExtras' ? tapExtrasError(child) : key === 'choiceTapExtras' ? !Array.isArray(child) || child.length > 100 ? '選択肢の追加処理を確認してください' : child.map(tapExtrasError).find(Boolean) ?? null : validateTapExtrasTree(child);
      if (error) return error;
    }
  }
  return null;
}
export function collectTapExtraTagIds(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (key === 'tapExtras' && child && typeof child === 'object') {
        for (const id of (child as TapExtras).tagIds ?? []) ids.add(id);
      } else if (key === 'choiceTapExtras' && Array.isArray(child)) { for (const extra of child) for (const id of (extra as TapExtras)?.tagIds ?? []) ids.add(id); }
      else visit(child);
    }
  };
  visit(value);
  return [...ids];
}

/** テスト送信はクリックの集計・追加処理を付けず、LINE独自項目を除く。 */
export function stripTapExtras(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTapExtras);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'tapExtras').map(([key, child]) => [key, stripTapExtras(child)]));
}
