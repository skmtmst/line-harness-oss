/** 一覧画面の上部に出す数（タグ・テンプレート・シナリオ・リマインダ）。 */
export type ListStats = {
  tags: { total: number; unused: number; taggedFriends: number; assignedThisMonth: number }
  marks: {
    total: number
    inUse: number
    unanswered: number
    inProgress: number
    /** 受信箱の「保留」トーク数。未対応割合の母数に入れる（#1014 ATTR-21）。 */
    onHold: number
    resolved: number
    changedLast7: number
  }
  searches: { total: number; limit: number }
  templates: {
    total: number
    inUse: number
    sentThisMonth: number
    unused90d: number
    clickRate: number | null
  }
  scenarios: {

    total: number
    active: number
    subscribers: number
    completed: number
    sentThisWeek: number
  }
  reminders: { total: number; active: number; waiting: number; sentThisMonth: number; failed: number }
  /** ★V8 回答フォーム一覧の数の帯。古いWorkerの応答には無いので、画面は欠けたら「—」を出す。 */
  forms?: {
    total: number
    published: number
    draft: number
    monthlySubmits: number
    prevMonthSubmits: number
    monthlyCompletionRate: number | null
    pendingPostActions: number
  }
}

/** 一斉配信の一覧に出す数（設計 `V2 4-2 一斉配信`）。 */
export type BroadcastStats = {
  thisMonth: number
  scheduled: number
  /** 一覧の集計契約だけが返す。旧 stats 契約では未取得。 */
  drafts?: number
  delivered: number
  failed: number
  /** 過去28日の平均開封率（%）。20人未満の配信は平均から外している。 */
  openRate: number | null
}

/** LINEアカウントで絞った一斉配信一覧と同じ母集団の集計。 */
export type BroadcastListKpis = Pick<
  BroadcastStats,
  'thisMonth' | 'scheduled' | 'delivered' | 'openRate'
> & { drafts: number }

/** 友だち画面の上部に出す数（設計 `V2 2-2 友だち`）。 */
export type FriendStats = {
  activeLastMonth?: number | null
  activeMonthDelta?: number | null
  activeComparisonDate?: string
  active: number
  total: number
  blockedByThem: number
  hiddenByUs: number
  unanswered: number
  resolved: number
  addedThisMonth: number
  addedLastMonth: number
}

/** 受信箱の上部に出す数（設計 `V2 2-1 受信箱`）。 */
export type InboxStats = {
  waiting: number
  /** 返信を待っている会話のうち、最も長い待ち時間（分）。 */
  oldestWaitingMinutes: number | null
  /** 受信から初回返信までの平均（分）。記録が無ければ null。 */
  averageFirstReplyMinutes: number | null
  /** そのうち1時間以上待たせているもの。 */
  waitingOverAnHour: number
  mine: number
  todayInbound: number
  todayByChannel: { line: number; email: number }
  /** 担当未設定は operatorId/operatorName が null。0件の担当者は配列に含まれない。 */
  assigneeUnread: Array<{
    operatorId: string | null
    operatorName: string | null
    unread: number
  }>
}
