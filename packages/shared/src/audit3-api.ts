/** Atomic menu ordering: send every affected row with its loaded revision. */
export interface BookingMenuOrderChange { id: string; expectedVersion: number; sortOrder: number }
export interface BookingMenuReorderRequest { changes: BookingMenuOrderChange[] }
export interface BookingMenuReorderResponse { ok: true; versions: Array<{ id: string; version: number }> }

export type MileageLedgerEntryType = 'grant' | 'reversal' | 'spend' | 'expiration' | 'adjustment';
export interface MileageHistoryTypeFilter { entryTypes?: MileageLedgerEntryType[] }

export type MileageHistoryKind = 'earned' | 'spent' | 'voided';
export interface MileageFriendHistorySummary {
  /** Metrics cover this person's ledger in the operator's visible accounts, independent of page/search. */
  scope: 'visible_accounts';
  counts: { all: number; earned: number; spent: number; voided: number };
  pendingCount: number;
  monthFrom: string;
  earnedThisMonth: number;
  earnedCountThisMonth: number;
}

export interface ReminderRunReadOptions {
  order?: 'scheduled_asc' | 'recent_desc';
  /** Excludes queued/claimed before pagination; retry_wait remains an executed failed attempt. */
  executedOnly?: boolean;
}
export interface ReminderScheduleMetrics { scheduledNext24Hours: number }

/** Explicit creation state; omit for legacy active creation, false for a draft. */
export interface WebhookCreateState { isActive?: boolean }

export interface EcIdentityDuplicateSignal {
  /** Opaque key for an external customer inside this tenant/account; does not reveal the customer ID. */
  duplicateGroupKey: string | null;
  duplicateCandidateCount: number;
  /** Pending pairs > 1, matching summary.duplicateSuspicions (customers, not pairs). */
  isDuplicateSuspicion: boolean;
}

export interface CustomerNotificationFailureCounts {
  /** Current unresolved live customer deliveries, all time; not EC processing events or attempts. */
  scope: 'all_time_unresolved';
  total: number;
  failed: number;
  retryWaiting: number;
}
