/** フォルダ選択欄で選べる6色。APIと画面で同じ値を使う。 */
export const FOLDER_SELECT_COLORS = [
  { value: '#3b82f6', name: '青' },
  { value: '#16a34a', name: '緑' },
  { value: '#f97316', name: '橙' },
  { value: '#ef4444', name: '赤' },
  { value: '#8b5cf6', name: '紫' },
  { value: '#64748b', name: '灰' },
] as const;
export function isFolderSelectColor(value: unknown): value is string | null {
  return value === null || FOLDER_SELECT_COLORS.some(color => color.value === value);
}
export interface ColoredFolder { id: string; name: string; color?: string | null }
export interface HqBroadcastFolder extends ColoredFolder { revision: number; item_count?: number }
export interface FriendAddRuleFolder extends ColoredFolder { createdAt?: string | null }
