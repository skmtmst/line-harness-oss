import { getAccountSetting, jstNow, setAccountSetting } from '@line-crm/db';

export const FOLLOWER_IMPORT_STATE_KEY = 'follower_import_v1';

export interface FollowerImportClient {
  getFollowerIds(limit: number, start?: string): Promise<{
    userIds: string[];
    next?: string;
  }>;
  getProfile(userId: string): Promise<{
    displayName?: string;
    pictureUrl?: string;
    statusMessage?: string;
  }>;
}

export type FollowerImportCapability = 'unknown' | 'available' | 'unavailable';
export type FollowerImportPhase =
  | 'not_started'
  | 'importing_ids'
  | 'hydrating_profiles'
  | 'completed';

export interface FollowerImportState {
  version: 1;
  capability: FollowerImportCapability;
  phase: FollowerImportPhase;
  eligibilityCheckedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  cursor: string | null;
  profileCursor: string | null;
  received: number;
  imported: number;
  reactivated: number;
  claimedUnassigned: number;
  alreadyPresent: number;
  conflicts: number;
  invalid: number;
  profilesProcessed: number;
  profilesUpdated: number;
  profileErrors: number;
  /** プロフィールを引き直した巡回の回数。0 なら 1 巡目。 */
  profileRetryPass: number;
  /** 今の巡回でプロフィールを引けなかった人数。次の巡回に入るかの判断に使う。 */
  profileFetchFailuresInPass: number;
  lastError: string | null;
  lockToken?: string | null;
  lockUntil?: string | null;
}

/**
 * 「この実行がまだロックを持っているときだけ書ける」を、書き込み文そのものの
 * 条件として持ち回る。事前に SELECT で持ち主を確かめる形だと、確かめてから
 * 書くまでの間に交代が入る隙が残る。SQLite は文を直列化し 1 文は不可分なので、
 * 交代（= 状態行の value の書き換え）が先に済んでいれば EXISTS が偽になり、
 * その文は 1 行も書けない。期限切れの旧実行が遅れて戻ってきても、
 * 友だちの新しい情報を古い値で上書きできない。
 */
export interface OwnershipGuard {
  /** 書き込み文の WHERE に足す条件。 */
  readonly sql: string;
  /** sql のプレースホルダへ渡す値。文の bind の末尾に足す。 */
  binds(): [string, string, string];
  /** 書けなかったのが交代のせいかを確かめる。 */
  stillOwned(): Promise<boolean>;
}

export function emptyFollowerImportState(): FollowerImportState {
  return {
    version: 1,
    capability: 'unknown',
    phase: 'not_started',
    eligibilityCheckedAt: null,
    startedAt: null,
    completedAt: null,
    updatedAt: jstNow(),
    cursor: null,
    profileCursor: null,
    received: 0,
    imported: 0,
    reactivated: 0,
    claimedUnassigned: 0,
    alreadyPresent: 0,
    conflicts: 0,
    invalid: 0,
    profilesProcessed: 0,
    profilesUpdated: 0,
    profileErrors: 0,
    profileRetryPass: 0,
    profileFetchFailuresInPass: 0,
    lastError: null,
  };
}

export async function getFollowerImportState(
  db: D1Database,
  lineAccountId: string,
): Promise<FollowerImportState> {
  const raw = await getAccountSetting(db, lineAccountId, FOLLOWER_IMPORT_STATE_KEY);
  if (!raw) return emptyFollowerImportState();
  try {
    return { ...emptyFollowerImportState(), ...JSON.parse(raw) } as FollowerImportState;
  } catch {
    return emptyFollowerImportState();
  }
}

export async function saveState(
  db: D1Database,
  lineAccountId: string,
  state: FollowerImportState,
): Promise<void> {
  state.updatedAt = jstNow();
  await setAccountSetting(
    db,
    lineAccountId,
    FOLLOWER_IMPORT_STATE_KEY,
    JSON.stringify(state),
  );
}

/**
 * LINE exposes no account-type field in /v2/bot/info. A one-item, read-only
 * followers request is therefore the authoritative capability probe.
 */
export async function detectFollowerImportCapability(
  db: D1Database,
  client: Pick<FollowerImportClient, 'getFollowerIds'>,
  lineAccountId: string,
): Promise<FollowerImportState> {
  const state = await getFollowerImportState(db, lineAccountId);
  try {
    await client.getFollowerIds(1);
    state.capability = 'available';
    state.lastError = null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/LINE API error:\s*403/i.test(message)) {
      state.capability = 'unavailable';
      state.lastError = null;
    } else {
      state.capability = 'unknown';
      state.lastError = '利用可否を確認できませんでした';
    }
  }
  state.eligibilityCheckedAt = jstNow();
  await saveState(db, lineAccountId, state);
  return state;
}

/** Start once or resume an interrupted migration. Completed jobs stay closed. */
export async function startFollowerImport(
  db: D1Database,
  lineAccountId: string,
): Promise<FollowerImportState> {
  const state = await getFollowerImportState(db, lineAccountId);
  if (state.capability !== 'available') {
    throw new Error('FOLLOWER_IMPORT_NOT_AVAILABLE');
  }
  if (state.phase === 'completed') return state;
  if (state.phase === 'not_started') {
    const capability = state.capability;
    const eligibilityCheckedAt = state.eligibilityCheckedAt;
    Object.assign(state, emptyFollowerImportState(), {
      capability,
      eligibilityCheckedAt,
      phase: 'importing_ids' as const,
      startedAt: jstNow(),
    });
  }
  state.lastError = null;
  await saveState(db, lineAccountId, state);
  return state;
}
