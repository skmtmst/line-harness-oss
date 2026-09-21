/**
 * ダッシュボードのカード配置の正本。
 *
 * 画面側（apps/web の編集パネル）が送るIDと、保存API（apps/worker の
 * /api/dashboard/preferences）が受け付けるIDは必ずここを通す。
 * 以前は両者が別々の一覧を持ち、画面に存在する `support-mark-status` を
 * API が拒否して全保存が 400 になっていた（DASH-01）。
 *
 * 並び順は編集パネルの既定表示順であり、画面の初期配置にもそのまま使う。
 * 追加・削除・区分変更はここだけを直せば、検証・既定配置・既存データの
 * 読み直しがすべて追随する。
 */
export const DASHBOARD_CARD_GROUPS = {
  today: [
    'today-inbox',
    'today-photo-review',
    'today-bookings',
    'today-shipments',
  ],
  main: [
    'shipment',
    'pending-inbox',
    'friend-trend',
    'friend-add',
    'scenario-status',
    'uid-migration',
  ],
  right: [
    'send-quota',
    'operational-alerts',
    'connection-status',
    'support-mark-status',
    'friend-status',
    'upcoming',
    'monthly-delivery',
    'recent-results',
    'booking-status',
    'inflow-top',
    'funnel-alert',
    'automation-failures',
  ],
} as const;

export type DashboardCardGroup = keyof typeof DASHBOARD_CARD_GROUPS;

export type DashboardCardId =
  (typeof DASHBOARD_CARD_GROUPS)[DashboardCardGroup][number];

/** 「今日やること」に同時表示できる枚数。API検証・画面の自動OFFの両方が使う。 */
export const DASHBOARD_TODAY_VISIBLE_LIMIT = 4;

/** カードIDから所属区分を引く。知らないIDは null。 */
export function dashboardCardGroupOf(id: string): DashboardCardGroup | null {
  for (const group of Object.keys(DASHBOARD_CARD_GROUPS) as DashboardCardGroup[]) {
    if ((DASHBOARD_CARD_GROUPS[group] as readonly string[]).includes(id)) return group;
  }
  return null;
}
