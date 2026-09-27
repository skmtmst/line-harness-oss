/**
 * #838 第2段: Google Sheets 連携の出入り口の形。
 *
 * Worker（返す側）と管理画面（読む側）でこの1つの型を使う。
 * 「読み込み中」のまま止まる事故は、返す形（包みなし）と
 * 読む形（`data` の包みを想定）のずれが原因だった。
 * 応答は `{ success: true, data: <ここ> }` の包みでそろえる。
 */
export type GoogleSheetsConnectionStatus =
  | 'disconnected'
  | 'pending_target'
  | 'connected'
  | 'expired';

export type GoogleSheetsLastSyncStatus = 'ok' | 'partial' | 'error';

/** 接続1件の見せ方。トークン類はここに乗せない。 */
export interface GoogleSheetsConnection {
  status: GoogleSheetsConnectionStatus;
  googleAccountEmail?: string | null;
  spreadsheetId?: string | null;
  spreadsheetTitle?: string | null;
  spreadsheetUrl?: string | null;
  lastSyncedAt?: string | null;
  lastSyncStatus?: GoogleSheetsLastSyncStatus | null;
  lastSyncError?: string | null;
  consecutiveFailures?: number;
  connectedAt?: string | null;
}

export type GoogleSheetsSyncRunKind = 'manual' | 'scheduled';
export type GoogleSheetsSyncRunDataType = 'friends' | 'form_answers';
export type GoogleSheetsSyncRunStatus = 'running' | 'ok' | 'partial' | 'error';

export interface GoogleSheetsSyncRun {
  id: string;
  kind: GoogleSheetsSyncRunKind;
  dataType: GoogleSheetsSyncRunDataType;
  status: GoogleSheetsSyncRunStatus;
  rowsWritten: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** GET connection の `data` の中身。 */
export interface GoogleSheetsConnectionPayload {
  connection: GoogleSheetsConnection;
  oauthConfigured: boolean;
  syncRunning: boolean;
  canManage: boolean;
}

/** GET runs の `data` の中身。 */
export interface GoogleSheetsRunsPayload {
  runs: GoogleSheetsSyncRun[];
}

/** POST connect/start の `data` の中身。 */
export interface GoogleSheetsConnectStartPayload {
  mode: 'connect' | 'reconnect';
  authorizeUrl: string;
}

/** POST disconnect の `data` の中身。 */
export interface GoogleSheetsDisconnectPayload {
  revoked: boolean;
  connection: GoogleSheetsConnection;
}

/** PUT target の `data` の中身。 */
export interface GoogleSheetsTargetPayload {
  connection: GoogleSheetsConnection;
}

export type GoogleSheetsSyncStatus = 'ok' | 'partial' | 'already_running' | 'error';

export interface GoogleSheetsSyncResult {
  dataType: string;
  status: string;
  rowsWritten: number;
  error?: string | null;
}

/** POST sync の `data` の中身。 */
export interface GoogleSheetsSyncPayload {
  status: GoogleSheetsSyncStatus;
  results: GoogleSheetsSyncResult[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const CONNECTION_STATUSES: readonly string[] = [
  'disconnected',
  'pending_target',
  'connected',
  'expired',
];

function isConnection(value: unknown): value is GoogleSheetsConnection {
  if (!isRecord(value)) return false;
  return typeof value.status === 'string' && CONNECTION_STATUSES.includes(value.status);
}

/**
 * connection 口の `data` が読める形かを確かめる。
 * 形が違う応答（包みなしの古い形など）は false になり、
 * 画面は「読み込めなかった」表示へ逃がす（読み込み中のままにしない）。
 */
export function isGoogleSheetsConnectionPayload(
  value: unknown,
): value is GoogleSheetsConnectionPayload {
  if (!isRecord(value)) return false;
  return (
    isConnection(value.connection)
    && typeof value.oauthConfigured === 'boolean'
    && typeof value.syncRunning === 'boolean'
    && typeof value.canManage === 'boolean'
  );
}

function isSyncRun(value: unknown): value is GoogleSheetsSyncRun {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string'
    && typeof value.kind === 'string'
    && typeof value.dataType === 'string'
    && typeof value.status === 'string'
    && typeof value.startedAt === 'string'
  );
}

/** runs 口の `data` が読める形かを確かめる（connection と同じ逃がし方）。 */
export function isGoogleSheetsRunsPayload(value: unknown): value is GoogleSheetsRunsPayload {
  if (!isRecord(value)) return false;
  return Array.isArray(value.runs) && value.runs.every(isSyncRun);
}
