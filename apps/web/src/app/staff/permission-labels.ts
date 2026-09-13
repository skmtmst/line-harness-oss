/**
 * 権限の表示名の正本（一覧と追加の両画面で共有）。
 *
 * 以前は `staff/page.tsx` の `PERMISSIONS`（21件）と
 * `staff/new/page.tsx` の `PERMISSION_GROUPS`（28件）が別々に表示名を
 * 持っていて、追加側にしか無い7件（予約設定・ウェビナーなど）は一覧の
 * `permissionSummary` が名前を知らず「○機能」と件数表示に落ちていた。
 * どちらで付けた権限でも一覧で名前が出るよう、表示名だけはここに寄せる。
 * 載せる顔ぶれ（どの画面で何を選べるか）は画面ごとの仕様なので変えない。
 */
export const PERMISSION_LABELS: Record<string, string> = {
  '/': 'ダッシュボード',
  '/chats': '受信箱',
  '/friends': '友だち',
  '/tags': '友だち属性',
  '/scenarios': 'シナリオ配信',
  '/broadcasts': '一斉配信',
  '/reminders': 'リマインダ',
  '/auto-replies': '自動応答',
  '/friend-add-settings': '友だち追加時の配信',
  '/webinars': 'ウェビナー',
  '/templates': 'テンプレート',
  '/rich-menus': 'リッチメニュー',
  '/form-submissions': '回答フォーム',
  '/contents/vars': '共通情報',
  '/contents': '登録メディア一覧',
  '/conversions': '成果とアフィリエイト',
  '/mileage': 'マイル',
  '/inflow-links': '流入と計測',
  '/analytics': '分析',
  '/automations': 'オートメーション',
  '/webhooks': '外部連携',
  '/booking/bookings': '予約管理',
  '/booking/menus': '予約設定',
  '/events': 'イベント予約',
  '/ec-commerce': 'ECデータ連携',
  '/line-notifications': 'LINE通知',
  '/nen-campaigns': 'フォロー配信',
  '/nen-members': '投稿写真審査',
}

/** 知らない権限パスが来たら件数表示に落とす前の名前解決。 */
export function permissionLabel(path: string): string {
  return PERMISSION_LABELS[path] ?? ''
}
