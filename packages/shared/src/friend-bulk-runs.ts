import type { SavedSearchConditions } from './types';

/** 一括操作の対象。作成時にサーバで再計算し、実行前にIDを固定する。 */
export type FriendBulkSelection =
  | { kind: 'explicit'; friendIds: string[] }
  | { kind: 'saved_search'; savedSearchId: string; lineAccountId: string }
  | { kind: 'conditions'; conditions: SavedSearchConditions };

export type FriendBulkOperation =
  | { kind: 'add_tag'; tagId: string }
  | { kind: 'remove_tag'; tagId: string }
  | { kind: 'start_scenario'; scenarioId: string }
  | { kind: 'stop_scenario'; scenarioId: string }
  | { kind: 'assign_operator'; operatorId: string | null }
  | { kind: 'set_support'; status?: 'unread' | 'in_progress' | 'on_hold' | 'resolved'; markId?: string | null }
  | { kind: 'set_reminder'; reminderId: string; targetDate: string }
  | { kind: 'cancel_reminder'; reminderId: string }
  | { kind: 'send_message'; content?: string; messageType?: string; templateId?: string }
  | { kind: 'run_common_action'; commonActionId: string; commonActionVersionId?: string }
  | { kind: 'set_friend_fields'; values: Record<string, string | null> }
  | { kind: 'set_visibility'; hidden: boolean }
  | { kind: 'add_conversion'; conversionPointId: string }
  | { kind: 'remove_conversion'; conversionPointId: string };

export type FriendBulkRunStatus =
  | 'preparing'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'success'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type FriendBulkItemStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'success'
  | 'skipped'
  | 'temporary_failure'
  | 'permanent_failure';

export interface FriendBulkPreviewItem {
  friendId: string;
  displayName: string | null;
  pictureUrl: string | null;
  lineAccountId: string | null;
}

export interface FriendBulkPreview {
  selectedCount: number;
  targetCount: number;
  excludedCount: number;
  accountBreakdown: Array<{ lineAccountId: string | null; count: number }>;
  exclusions: Array<{ reason: string; count: number }>;
  sample: FriendBulkPreviewItem[];
  reversible: boolean;
}

export interface FriendBulkRunSummary {
  id: string;
  status: FriendBulkRunStatus;
  selection: FriendBulkSelection;
  operation: FriendBulkOperation;
  targetCount: number;
  excludedCount: number;
  successCount: number;
  skippedCount: number;
  temporaryFailureCount: number;
  permanentFailureCount: number;
  reversible: boolean;
  scheduledAt: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface FriendBulkRunItem {
  id: string;
  friendId: string;
  displayName: string | null;
  pictureUrl: string | null;
  lineAccountId: string | null;
  status: FriendBulkItemStatus;
  attemptCount: number;
  errorMessage: string | null;
  retryAt: string | null;
  completedAt: string | null;
}

export interface FriendBulkRunDetail extends FriendBulkRunSummary {
  items: FriendBulkRunItem[];
  page: number;
  limit: number;
  total: number;
}
