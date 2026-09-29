/*
 * 見せる範囲の下書き（R497）。
 *
 * 個別設定（custom）の人はプリセットに当てはまらない保存済みキーを持つ。
 * この単位の約束:
 * - 初期表示は保存済みキーを3択へ写したもの（プリセットの当てはめはしない）
 * - 行を触った保存は、触った行だけ保存済みキーへ適用する。
 *   触っていない行の部分設定（3択に写せない細かい差）は落とさない
 * - 何も触っていない保存は要求を送らない（呼び出し側の約束）
 *
 * page.tsx からも試験からもここを import する
 * （page.tsx は default 以外を export できないため）。
 */
import {
  BROADCAST_EDIT_OPERATION_KEYS,
  SCOPE_ITEMS,
  keysToScopeLevels,
  type EmailMaskLevel,
  type FeatureAccessLevel,
  type ScopeLevels,
} from '@line-crm/shared'

/** 保存済みの edit/view キーとメールの見せ方を3択の土台へ写す。 */
export function restoreSavedLevels(
  editKeys: string[],
  viewKeys: string[],
  emailMask: 'full' | 'masked' | 'none' | null | undefined,
): ScopeLevels {
  // 未設定は伏せて見せる。サーバー（serializeStaff）の既定と同じ写しにする。
  const pii: FeatureAccessLevel =
    emailMask === 'full' ? 'edit' : emailMask === 'none' ? 'none' : 'view'
  return { ...keysToScopeLevels(editKeys, viewKeys), pii }
}

/*
 * 触った1行だけ保存済みキーへ適用する。
 * 3択の展開（scopeLevelsToKeys）と同じ顔ぶれにする。
 * 配信を行き来するときは操作キー（下書き・テスト・送信・CSV）も組で付ける・外す。
 */
export function applyScopeRowChange(
  prevEditKeys: string[],
  prevViewKeys: string[],
  itemId: string,
  level: FeatureAccessLevel,
): { edit: string[]; view: string[] } {
  const item = SCOPE_ITEMS.find((candidate) => candidate.id === itemId)
  if (!item || item.kind !== 'feature') return { edit: [...prevEditKeys], view: [...prevViewKeys] }
  const rowKeys =
    item.id === 'delivery' ? [...item.keys, ...BROADCAST_EDIT_OPERATION_KEYS] : [...item.keys]
  const edit = prevEditKeys.filter((key) => !rowKeys.includes(key))
  const view = prevViewKeys.filter((key) => !rowKeys.includes(key))
  if (level === 'edit') edit.push(...rowKeys)
  else if (level === 'view') view.push(...rowKeys)
  return { edit: [...new Set(edit)], view: [...new Set(view)] }
}

/** 3択の個人情報行をメールの見せ方へ写す（保存送信用）。 */
export function scopePiiToEmailMask(pii: FeatureAccessLevel | undefined): EmailMaskLevel {
  return pii === 'edit' ? 'full' : pii === 'none' ? 'none' : 'masked'
}
