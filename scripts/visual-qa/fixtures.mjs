/**
 * 画面確認のための、固定の中身。
 *
 * **Pencil ★V6 の画面に描いてある値をそのまま写している。**
 * これが無いと、実装は空の表しか描けず、設計と画像で比べられない。
 * 「空の状態」だけを見て「一致した」と言えてしまうのが、いちばん危ない。
 *
 * 守ること
 * - **実在の顧客・秘密値を使わない。** 名前も数字も設計の絵の値そのもの
 * - **乱数と時刻を使わない。** 毎回まったく同じ絵になる
 * - **設計を変えたらここも変える。** 合わなくなったら、どちらが正かを決める
 *
 * 出どころ: Pencil `★ V6 4-1 友だち属性・タグ（1920）` `hqrOv`
 */

/**
 * 設計の左パネル（`DgeL8`）の並びと件数。
 * `count` は絵に書いてある数。タグはこの数だけ作る。
 */
export const FOLDER_COUNTS = [
  ['g-vip', 'VIP', 14],
  ['g-pet', 'ペット', 12],
  ['g-member', '会員', 18],
  ['g-health', '健康', 16],
  ['g-purchase', '購入', 21],
  ['', '未分類', 20],
]

/** フォルダ。 */
export const TAG_GROUPS = [
  { id: 'g-vip', name: 'VIP', sortOrder: 0, color: '#F59E0B', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'g-pet', name: 'ペット', sortOrder: 1, color: '#EC4899', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'g-member', name: '会員', sortOrder: 2, color: '#10B981', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'g-health', name: '健康', sortOrder: 3, color: '#0EA5E9', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'g-purchase', name: '購入', sortOrder: 4, color: '#3B82F6', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
]

/**
 * タグ6件。設計の表（`HrwyW`）の6行そのまま。
 *
 * `mileageMultiplierBps` は 10000 で 1.0倍。設計の「1.2倍」は 12000。
 */
const DESIGN_ROWS = [
  ['EC顧客連携済み', 'g-purchase', 64, 10, 0, 12000, true, '2026-01-11T00:00:00.000Z'],
  ['LINEログイン連携済み', 'g-member', 198, 0, 0, null, true, '2026-01-13T00:00:00.000Z'],
  ['NEN会員', 'g-member', 128, 10, 5, 15000, false, '2026-01-13T00:00:00.000Z'],
  ['商品到着確認対象', 'g-purchase', 41, 3, 0, null, false, '2026-01-13T00:00:00.000Z'],
  ['未契約', '', 37, 0, 0, null, false, '2026-01-13T00:00:00.000Z'],
  ['誕生日クーポン対象', 'g-vip', 0, 20, 0, null, false, '2026-01-13T00:00:00.000Z'],
].map(([name, groupId, friendCount, mileageReward, referralMileageReward, mileageMultiplierBps, isStarred, createdAt], index) => ({
  id: `tag-${index}`,
  name: String(name),
  color: '#8b938d',
  groupId: String(groupId),
  friendCount: Number(friendCount),
  mileageReward: Number(mileageReward),
  referralMileageReward: Number(referralMileageReward),
  mileageMultiplierBps: mileageMultiplierBps == null ? null : Number(mileageMultiplierBps),
  mileageMultiplierPriority: 0,
  isStarred: Boolean(isStarred),
  displayOrder: index,
  createdAt: String(createdAt),
}))

/**
 * タグ101件。設計の「1〜20 / 101件」に合わせる。
 *
 * 先頭6件は絵に描いてある行そのまま。残り95件は、フォルダごとの件数が
 * 絵の数（VIP 14／ペット 12／会員 18／健康 16／購入 21／未分類 20）に
 * ちょうど収まるように足した埋め草。
 *
 * **6件だけで比べない。** 桁あふれも折り返しもページ送りも出ないので、
 * 「一致した」と言えてしまう。設計は101件あるときの絵として描いてある。
 */
export const TAGS = (() => {
  const rows = [...DESIGN_ROWS]
  const used = new Map()
  for (const row of rows) used.set(row.groupId, (used.get(row.groupId) ?? 0) + 1)

  let n = rows.length
  for (const [groupId, label, count] of FOLDER_COUNTS) {
    const rest = count - (used.get(groupId) ?? 0)
    for (let i = 0; i < rest; i += 1) {
      rows.push({
        id: `tag-${n}`,
        name: `${label}タグ ${i + 1}`,
        color: '#8b938d',
        groupId,
        // 埋め草にも人数を入れる。0 にすると「整理候補」が跳ね上がる。
        friendCount: 3 + ((n * 7) % 40),
        mileageReward: 0,
        referralMileageReward: 0,
        mileageMultiplierBps: null,
        mileageMultiplierPriority: 0,
        isStarred: false,
        displayOrder: n,
        createdAt: '2026-01-13T00:00:00.000Z',
      })
      n += 1
    }
  }
  return rows
})()

/**
 * 一覧の数。設計の4枚（`mfmn3`）に書いてある値そのまま。
 *
 * **タグ一覧から計算しない。** 「付与済み友だち」は人の数で、
 * タグごとの人数を足した数ではない（2つタグが付いた人を2人と数えてしまう）。
 * サーバーが数えて返すもの（`/api/list-stats`）。
 */
export const LIST_STATS = {
  tags: { total: 101, unused: 24, taggedFriends: 186, assignedThisMonth: 214 },
  marks: { total: 0, inUse: 0, unanswered: 0, inProgress: 0, resolved: 0, changedLast7: 0 },
  searches: { total: 0, limit: 5 },
  templates: { total: 0, inUse: 0, sentThisMonth: 0, unused90d: 0, clickRate: null },
  scenarios: { total: 0, active: 0, subscribers: 0, completed: 0, sentThisWeek: 0 },
  reminders: { total: 0, active: 0, waiting: 0, sentThisMonth: 0 },
}
