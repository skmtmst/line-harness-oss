/*
 * ★V8 友だちの段のタブ（Pencil x6QsVz・ADjK8・hn6Y8・T9gblG・L48eY）。
 *
 * 行き先は今の画面と同じ URL（app/friends/friends-tabs.ts と同じ名前・同じ順）。
 * 絵では「CSVで書き出す・取り込む」も同じタブの並びに入っているので足す
 * （今は「データ管理」メニューの中から行く /friends/migrations）。
 */
export type FriendsTabKey = 'list' | 'duplicates' | 'merged' | 'uid-migration' | 'csv'

export const FRIENDS_TABS: ReadonlyArray<{ key: FriendsTabKey; label: string; href: string }> = [
  { key: 'list', label: '友だち一覧', href: '/friends' },
  { key: 'duplicates', label: '重複検出', href: '/friends?tab=duplicates' },
  { key: 'merged', label: '統合ユーザー', href: '/friends?tab=merged' },
  { key: 'uid-migration', label: 'UID移行', href: '/accounts?tab=migration' },
  { key: 'csv', label: 'CSVで書き出す・取り込む', href: '/friends/migrations' },
]

/** タブの下に出す1行の説明（絵の「タブの説明」）。 */
export const FRIENDS_TAB_NOTES: Record<FriendsTabKey, string> = {
  list: '友だち一覧：LINE でつながっている人の一覧です。',
  duplicates: '重複検出：同じ人が2人に分かれていないかを探して、結び付けるか決めます。',
  merged: '統合ユーザー：結び付けた人の一覧です。間違えて結び付けたときは、ここで分けます。',
  'uid-migration': 'UID移行：別のLINEアカウントから友だちを引っ越します。照合してから本移行します。',
  csv: 'CSVで書き出す・取り込む：友だちの一覧を表計算のファイルで出し入れします。',
}

/**
 * 変えられるかの判定。役割はサーバ（`api.staff.me()`）の答えを使い、
 * 手元の保存値の役割（`lh_staff_role`）は見ない（古い値が残ることがある）。
 * 担当者（staff）でも、項目キーで友だち・受信箱の変更を任されていれば変えられる。
 */
export function hasEditKey(permission: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem('lh_staff_permissions')
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) && parsed.includes(permission)
  } catch {
    return false
  }
}
