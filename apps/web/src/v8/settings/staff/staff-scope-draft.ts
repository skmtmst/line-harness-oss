/* ★V8 ログインユーザー：app/staff/staff-scope-draft.ts の写し（src/v8 は @/app を読めない）。直すときは両方を直す。 */
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

/*
 * 3択では表せない「一部だけ許可」の行を見つける（R497b）。
 *
 * 例：分析の7キーのうち `/analytics` だけ許可されていると、
 * keysToScopeLevels はその行を `none`（出さない）と写す。
 * 実際には `/analytics` が使えるので、そのまま「出さない」と出すのは
 * 保存内容と違う。該当行は3択のどれも押さず、内訳を別に示す。
 *
 * 判定は表のキー（SCOPE_ITEMS の keys）だけを見る。
 * 配信の操作キー（下書き・テスト・送信・CSV）は有無を問わない
 * （古い保存行は操作キーなしでも配信editとして読む既存の約束どおり）。
 * 混ざり（edit と view に分かれて全部ある）も一部扱いにする。
 * 全部が view にあるときだけ view、全部が edit にあるときだけ edit。
 */
export interface PartialScopeRow {
  itemId: string
  allowedEditKeys: string[]
  allowedViewKeys: string[]
  allowedKeys: string[]
}

export function findPartialScopeRows(
  editKeys: string[],
  viewKeys: string[],
): PartialScopeRow[] {
  const rows: PartialScopeRow[] = []
  for (const item of SCOPE_ITEMS) {
    if (item.kind !== 'feature') continue
    const editInRow = item.keys.filter((key) => editKeys.includes(key))
    const viewInRow = item.keys.filter((key) => !editKeys.includes(key) && viewKeys.includes(key))
    const allowed = [...editInRow, ...viewInRow]
    if (allowed.length === 0) continue
    if (editInRow.length === item.keys.length) continue
    if (viewInRow.length === item.keys.length) continue
    rows.push({
      itemId: item.id,
      allowedEditKeys: editInRow,
      allowedViewKeys: viewInRow,
      allowedKeys: allowed,
    })
  }
  return rows
}
