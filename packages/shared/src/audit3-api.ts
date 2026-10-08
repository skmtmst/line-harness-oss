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
