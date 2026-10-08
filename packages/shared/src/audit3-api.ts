/** Atomic menu ordering: send every affected row with its loaded revision. */
export interface BookingMenuOrderChange { id: string; expectedVersion: number; sortOrder: number }
export interface BookingMenuReorderRequest { changes: BookingMenuOrderChange[] }
export interface BookingMenuReorderResponse { ok: true; versions: Array<{ id: string; version: number }> }

export type MileageLedgerEntryType = 'grant' | 'reversal' | 'spend' | 'expiration' | 'adjustment';
export interface MileageHistoryTypeFilter { entryTypes?: MileageLedgerEntryType[] }
