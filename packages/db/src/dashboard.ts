// Public entry point. Implementation is organized by responsibility.
export {
  type DashboardPeriod,
  type DashboardSectionState,
  type DashboardFreshness,
  type DashboardSectionStatus,
  type DashboardMetricState,
  type DashboardMetricReason,
  type DashboardMetric,
  type DashboardFriendTrendPoint,
  type DashboardOverview,
  type AccountStatsScope,
  type InboxStatusBreakdown,
  type InboxStatusCounts,
  type FriendDailySnapshot,
  type InboxStats,
  type FriendStats,
  type BroadcastStats,
  type ListStats,
} from './dashboard-types.js';
export {
  dashboardFreshness,
  summarizeDashboardFreshness,
  periodStart,
  monthStart,
  periodDays,
} from './dashboard-freshness.js';
export {
  getInboxStatusCounts,
} from './dashboard-inbox.js';
export {
  recordFriendSnapshot,
} from './dashboard-snapshots.js';
export {
  getDashboardOverview,
} from './dashboard-overview.js';
export {
  getInboxStats,
  getFriendActiveMonthComparison,
  getFriendStats,
  getBroadcastStats,
} from './dashboard-stats.js';
export {
  getListStats,
} from './dashboard-list-stats.js';
