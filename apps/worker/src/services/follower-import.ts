import { getAccountSetting, jstNow, setAccountSetting } from '@line-crm/db';

const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/;
// `WHERE line_user_id IN (?, ?, ...)` の ? の数。D1 が 1 文に受け付ける
// バインド変数は 100 個までなので、他の条件を足す余地を見て 90 に抑えている。
// **この数はこの SQL 文の形に紐づく。** 文に条件を足すときは一緒に減らす。
const LOOKUP_CHUNK_SIZE = 90;
// db.batch() にまとめて渡す **文の数**。上の 90 とは別の理由で決まる。
// batch は文ごとに独立してバインドするので、変数 100 個の制限には当たらない。
// ここは 1 回のトランザクションをどこまで大きくするかの話で、
// 大きすぎると失敗したときに巻き戻る範囲が広くなる。
const WRITE_CHUNK_SIZE = 100;
// LINE のプロフィール取得は 1 人ずつしか引けない（まとめて引く API が無い）。
// 以下の 4 つは「1 回の実行でどこまで進めるか」を決める数で、
// 速さの上限は LINE 側ではなく Workers 側の制限で決まる。
// LINE の制限は 2,000 requests/秒（2026-10-15 時点の公式値）で、
// 下の並列数ではまったく届かない。
//
// D1 から 1 度に読み出す人数。この単位でプロフィールを引き、書き戻す。
const PROFILE_PAGE_SIZE = 200;
// 同時に走らせるプロフィール取得の本数。Workers が同時に持てる
// 「応答ヘッダ待ち」は 6 本までで、7 本目は待つだけでエラーにはならない。
// 本文の読み取りと書き戻しで手が空く分を見込んで 12 本を流し込む。
const PROFILE_CONCURRENCY = 12;
// 1 回の実行で引くプロフィールの上限。有料プランのサブリクエストは
// 1 invocation あたり 10,000 回までで、D1 の呼び出しもここに数えられる。
// 1 人 1 回の取得に加えてページ読み出しと書き戻しの分を空けて 9,000 人で切る。
const PROFILE_MAX_PER_RUN = 9_000;
// プロフィールを引けなかった人を何巡まで引き直すか。
// 取得が落ちる理由は一時的なもの（429 / 5xx）と、そもそも引けないもの
// （退会・ブロックで 404）が混ざる。落ちた人を飛ばしたまま完了にすると
// 取り残しに気づけないので、最後まで走ったあとカーソルを戻して
// 「まだ display_name が NULL の人」だけをもう一度引き直す。
// 引けた人は NULL でなくなるので、巡回のたびに対象は減る。
const PROFILE_MAX_PASSES = 3;
// 1 回の実行に使う時間の既定値。画面から呼ばれたときの応答がこの長さになる。
// 使い切っても D1 のカーソルが残るので、続きは次の実行が引き継ぐ。
const DEFAULT_RUN_BUDGET_MS = 20_000;
// 時間予算に上乗せしてロックを押さえておく余白。
// 実行中に別の経路が同じアカウントへ入ってこないようにするための余白で、
// 予算を使い切った直後に解放されるよう短くしてある。
// 予算の超過はページの途中でも時間を見るので、走っている途中の
// プロフィール取得 1 本とそのページの書き戻しの分だけ。この余白で収まる。
const LOCK_MARGIN_MS = 30_000;
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

interface ExistingFriend {
  line_user_id: string;
  line_account_id: string | null;
  is_following: number;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/**
 * 常に size 本を走らせたまま items を最後まで流す。
 * 固定の塊に切って待ち合わせる書き方だと、塊の中で 1 本だけ遅いときに
 * 残りの本数が空いたまま待つことになる。ここは空いた本数へ次の 1 件を
 * すぐ流し込むので、遅い応答が全体を止めない。
 */
async function runWithConcurrency<T>(
  items: T[],
  size: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await run(items[index]!);
    }
  });
  await Promise.all(lanes);
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

async function saveState(
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

/**
 * 「この実行がまだロックを持っているときだけ書ける」を、書き込み文そのものの
 * 条件として持ち回る。事前に SELECT で持ち主を確かめる形だと、確かめてから
 * 書くまでの間に交代が入る隙が残る。SQLite は文を直列化し 1 文は不可分なので、
 * 交代（= 状態行の value の書き換え）が先に済んでいれば EXISTS が偽になり、
 * その文は 1 行も書けない。期限切れの旧実行が遅れて戻ってきても、
 * 友だちの新しい情報を古い値で上書きできない。
 */
interface OwnershipGuard {
  /** 書き込み文の WHERE に足す条件。 */
  readonly sql: string;
  /** sql のプレースホルダへ渡す値。文の bind の末尾に足す。 */
  binds(): [string, string, string];
  /** 書けなかったのが交代のせいかを確かめる。 */
  stillOwned(): Promise<boolean>;
}

async function importIdPage(
  db: D1Database,
  client: Pick<FollowerImportClient, 'getFollowerIds'>,
  lineAccountId: string,
  state: FollowerImportState,
  guard: OwnershipGuard,
): Promise<void> {
  const page = await client.getFollowerIds(1000, state.cursor ?? undefined);
  const receivedIds = Array.isArray(page.userIds) ? page.userIds : [];
  const validIds = [...new Set(receivedIds.filter((id) => LINE_USER_ID_PATTERN.test(id)))];
  const invalid = receivedIds.filter((id) => !LINE_USER_ID_PATTERN.test(id)).length;

  const existingById = new Map<string, ExistingFriend>();
  for (const group of chunks(validIds, LOOKUP_CHUNK_SIZE)) {
    const placeholders = group.map(() => '?').join(',');
    const scopedRows = await db
      .prepare(
        `SELECT line_user_id, line_account_id, is_following
           FROM friends
          WHERE line_account_id = ?
            AND line_user_id IN (${placeholders})`,
      )
      .bind(lineAccountId, ...group)
      .all<ExistingFriend>();
    for (const row of scopedRows.results ?? []) existingById.set(row.line_user_id, row);

    // C-2bまでは、未割当行や別アカウント行を従来どおり競合として扱う。
    // 指定アカウントで見つからなかったIDだけ無指定検索へフォールバックする。
    const unresolved = group.filter((lineUserId) => !existingById.has(lineUserId));
    if (unresolved.length > 0) {
      const unresolvedPlaceholders = unresolved.map(() => '?').join(',');
      const fallbackRows = await db
        .prepare(
          `SELECT line_user_id, line_account_id, is_following
             FROM friends
            WHERE line_user_id IN (${unresolvedPlaceholders})`,
        )
        .bind(...unresolved)
        .all<ExistingFriend>();
      for (const row of fallbackRows.results ?? []) existingById.set(row.line_user_id, row);
    }
  }

  const writableIds: string[] = [];
  for (const lineUserId of validIds) {
    const existing = existingById.get(lineUserId);
    if (!existing) {
      state.imported += 1;
      writableIds.push(lineUserId);
    } else if (existing.line_account_id === null) {
      state.claimedUnassigned += 1;
      writableIds.push(lineUserId);
    } else if (existing.line_account_id !== lineAccountId) {
      // C-2b: 複合一意制約へ移行したら、競合ではなくこのアカウント用の行を取り込む。
      state.conflicts += 1;
    } else if (existing.is_following === 0) {
      state.reactivated += 1;
      writableIds.push(lineUserId);
    } else {
      state.alreadyPresent += 1;
    }
  }

  // ここも所有権を条件に入れる。この文が書くのはプロフィール NULL の新規行と
  // 「未割当だった行の割り当て」だけで、ON CONFLICT 側の WHERE が
  // 「すでにこのアカウントで is_following = 1」の行を弾くので、新しい表示名を
  // 壊すことはない。それでも条件を付けるのは「期限切れの旧実行は friends に
  // 何も書けない」という一本の約束にしておくため。
  // VALUES のままでは条件を足せないので SELECT ... WHERE EXISTS の形にする
  // （SQLite は upsert を付けるとき SELECT 側に WHERE を要求する）。
  const now = jstNow();
  for (const group of chunks(writableIds, WRITE_CHUNK_SIZE)) {
    await db.batch(group.map((lineUserId) =>
      db.prepare(
        `INSERT INTO friends
           (id, line_user_id, display_name, picture_url, status_message,
            is_following, line_account_id, created_at, updated_at)
         SELECT ?, ?, NULL, NULL, NULL, 1, ?, ?, ?
          WHERE ${guard.sql}
         ON CONFLICT(line_user_id) DO UPDATE SET
           line_account_id = COALESCE(friends.line_account_id, excluded.line_account_id),
           is_following = 1,
           updated_at = excluded.updated_at
         WHERE (friends.line_account_id IS NULL OR friends.line_account_id = excluded.line_account_id)
           AND (friends.line_account_id IS NULL OR friends.is_following != 1)`,
      ).bind(crypto.randomUUID(), lineUserId, lineAccountId, now, now, ...guard.binds()),
    ));
  }

  state.received += receivedIds.length;
  state.invalid += invalid;
  state.cursor = typeof page.next === 'string' && page.next ? page.next : null;
  if (!state.cursor) state.phase = 'hydrating_profiles';
}

interface HydratePageResult {
  /** プロフィール取得を実際に投げた人数。サブリクエストの消費数。 */
  attempted: number;
  /** カーソル・件数・phase のいずれかが進んだか。進まなければ呼び出し側が実行を切り上げる。 */
  progressed: boolean;
  /** 書き戻しが交代後で成立しなかったか。true ならこの実行は何も書かずに降りる。 */
  lockLost: boolean;
}

/**
 * 1 ページ分のプロフィールを引いて書き戻す。
 * 取得は PROFILE_CONCURRENCY 本の並列、書き戻しは 1 ページを数回の
 * db.batch にまとめる。1 人ごとに UPDATE を投げていたときに比べ、
 * D1 の呼び出し回数が人数分からページ単位へ下がるので、
 * 1 回の実行で引けるサブリクエストをプロフィール取得側に回せる。
 *
 * 進める範囲は「決着した人が先頭から何人続いたか」で決める。決着とは
 * 書き戻しが終わったか、取得が落ちた（この巡回では諦める）かのどちらか。
 * 書き戻しが落ちた人と、時間切れで取得を投げていない人は決着していないので、
 * そこでカーソルを止める。行は display_name が NULL のまま残るので、
 * 次の実行が同じ人をもう一度引く。
 */
async function hydrateProfilePage(
  db: D1Database,
  client: Pick<FollowerImportClient, 'getProfile'>,
  lineAccountId: string,
  state: FollowerImportState,
  limit: number,
  deadlineMs: number,
  guard: OwnershipGuard,
): Promise<HydratePageResult> {
  const take = Math.max(1, Math.min(PROFILE_PAGE_SIZE, limit));
  const rows = await db.prepare(
    `SELECT id, line_user_id
       FROM friends
      WHERE line_account_id = ?
        AND is_following = 1
        AND display_name IS NULL
        AND id > ?
      ORDER BY id
      LIMIT ?`,
  ).bind(lineAccountId, state.profileCursor ?? '', take)
    .all<{ id: string; line_user_id: string }>();
  const batch = rows.results ?? [];

  type FetchedProfile = {
    displayName: string | null;
    pictureUrl: string | null;
    statusMessage: string | null;
  };
  const fetchedById = new Map<string, FetchedProfile>();
  const failedIds = new Set<string>();
  let attempted = 0;
  await runWithConcurrency(batch, PROFILE_CONCURRENCY, async (row) => {
    // 時間予算はページの途中でも見る。ページ単位でしか見ないと、
    // 200 人を引き終わるまで止まれずロックの期限を越えることがある。
    // ここで投げるのをやめた人は決着していない扱いなので取り残されない。
    if (Date.now() >= deadlineMs) return;
    attempted += 1;
    try {
      const profile = await client.getProfile(row.line_user_id);
      fetchedById.set(row.id, {
        displayName: profile.displayName ?? null,
        pictureUrl: profile.pictureUrl ?? null,
        statusMessage: profile.statusMessage ?? null,
      });
    } catch {
      failedIds.add(row.id);
    }
  });

  // 書き戻しは塊ごとに数を加算する。最後にまとめて足すと、途中の塊で
  // 落ちたときに「DB には書けているのに進捗に出ない」ずれが残る。
  const now = jstNow();
  const written = new Set<string>();
  const fetchedRows = batch.filter((row) => fetchedById.has(row.id));
  let lockLost = false;
  for (const group of chunks(fetchedRows, WRITE_CHUNK_SIZE)) {
    let changed: number[];
    try {
      const results = await db.batch(group.map((row) => {
        const profile = fetchedById.get(row.id)!;
        return db.prepare(
          `UPDATE friends
              SET display_name = ?, picture_url = ?, status_message = ?, updated_at = ?
            WHERE id = ?
              AND ${guard.sql}`,
        ).bind(
          profile.displayName, profile.pictureUrl, profile.statusMessage, now, row.id,
          ...guard.binds(),
        );
      }));
      changed = group.map((_, index) => results[index]?.meta.changes ?? 0);
    } catch {
      // この塊から先は書けていない。ここまでの塊の分だけを数に入れる。
      break;
    }
    // 1 塊は D1 の 1 トランザクション。所有権の条件は塊の中で同じなので、
    // 交代が済んでいれば塊ごと 0 行になる。0 行が「交代された」のか
    // 「その行が消えていた」のかをここで見分ける。
    if (changed.every((rows) => rows === 0) && !(await guard.stillOwned())) {
      lockLost = true;
      break;
    }
    let appliedCount = 0;
    for (let index = 0; index < group.length; index += 1) {
      if ((changed[index] ?? 0) > 0) {
        written.add(group[index]!.id);
        appliedCount += 1;
      }
    }
    state.profilesUpdated += appliedCount;
  }
  // 1 件も書けないまま降りるときは、件数・カーソル・phase を触らずに返す。
  if (lockLost) return { attempted, progressed: false, lockLost: true };

  // 先頭から決着が続いた分だけカーソルを進める。間に未決着の人が
  // いたらそこで止める。飛ばすと display_name が NULL のまま
  // カーソルの後ろに取り残され、二度と引かれない。
  let resolved = 0;
  while (
    resolved < batch.length
    && (written.has(batch[resolved]!.id) || failedIds.has(batch[resolved]!.id))
  ) resolved += 1;

  let failuresResolved = 0;
  for (let i = 0; i < resolved; i += 1) {
    if (failedIds.has(batch[i]!.id)) failuresResolved += 1;
  }
  state.profileErrors += failuresResolved;
  state.profileFetchFailuresInPass += failuresResolved;
  state.profilesProcessed += resolved;
  if (resolved > 0) state.profileCursor = batch[resolved - 1]!.id;

  const leftover = batch.length - resolved;
  let progressed = resolved > 0;

  // 頼んだ数より少なく返ってきた = このカーソルの先に対象が残っていない。
  if (batch.length < take && leftover === 0) {
    if (
      state.profileFetchFailuresInPass > 0
      && state.profileRetryPass + 1 < PROFILE_MAX_PASSES
    ) {
      // 引けなかった人が残っている。カーソルを戻して、まだ display_name が
      // NULL の人だけをもう一度引く。引けた人は対象から外れているので
      // 二重取得にはならない。
      state.profileRetryPass += 1;
      state.profileFetchFailuresInPass = 0;
      state.profileCursor = null;
      progressed = true;
    } else {
      state.phase = 'completed';
      state.completedAt = jstNow();
      progressed = true;
    }
  }

  return { attempted, progressed, lockLost: false };
}

export interface FollowerImportStepResult {
  state: FollowerImportState;
  busy: boolean;
  /** この実行で読み出したプロフィールの人数。呼び出し側が残りの枠を引くのに使う。 */
  profilesFetched: number;
}

export interface FollowerImportStepOptions {
  /** この実行に使える時間。使い切ると途中で返し、続きは次の実行が引き継ぐ。 */
  budgetMs?: number;
  /** この実行で引けるプロフィールの上限。1 invocation のサブリクエスト枠を分け合うのに使う。 */
  maxProfiles?: number;
}

/**
 * Process as much as the given time/subrequest budget allows. State and cursors
 * live in D1, so closing the browser continues in the scheduled lane; requests
 * may also resume it under the same lock.
 */
export async function processFollowerImportStep(
  db: D1Database,
  client: FollowerImportClient,
  lineAccountId: string,
  options: FollowerImportStepOptions = {},
): Promise<FollowerImportStepResult> {
  let state = await getFollowerImportState(db, lineAccountId);
  if (state.phase === 'not_started' || state.phase === 'completed') {
    return { state, busy: false, profilesFetched: 0 };
  }

  const nowMs = Date.now();
  if (state.lockUntil && new Date(state.lockUntil).getTime() > nowMs) {
    return { state, busy: true, profilesFetched: 0 };
  }

  const budgetMs = Math.max(1_000, options.budgetMs ?? DEFAULT_RUN_BUDGET_MS);
  const maxProfiles = Math.max(1, options.maxProfiles ?? PROFILE_MAX_PER_RUN);
  const deadlineMs = nowMs + budgetMs;

  const lockToken = crypto.randomUUID();
  // ロックは時間予算より少しだけ長く押さえる。予算を使い切った直後に
  // 解放されるので、続きを次の実行がすぐ拾える。
  const lockUntil = new Date(deadlineMs + LOCK_MARGIN_MS).toISOString();
  const oldRaw = await getAccountSetting(db, lineAccountId, FOLLOWER_IMPORT_STATE_KEY);
  if (!oldRaw) return { state, busy: true, profilesFetched: 0 };
  const locked = { ...state, lockToken, lockUntil, updatedAt: jstNow() };
  const claim = await db.prepare(
    `UPDATE account_settings
        SET value = ?, updated_at = ?
      WHERE line_account_id = ? AND key = ? AND value = ?`,
  ).bind(
    JSON.stringify(locked), locked.updatedAt, lineAccountId,
    FOLLOWER_IMPORT_STATE_KEY, oldRaw,
  ).run();
  if ((claim.meta.changes ?? 0) === 0) return { state, busy: true, profilesFetched: 0 };
  state = locked;

  // 今 DB に入っている文字列を覚えておく。この実行の保存はすべて
  // 「自分が最後に書いた内容のまま」を条件にして書く。ロックの期限が
  // 切れたあとに別の実行が続きを引き継いでいた場合、ここが食い違うので
  // 書き込みは不成立になり、新しい進み具合を古い内容で巻き戻さない。
  let currentRaw = JSON.stringify(locked);
  let lockLost = false;

  const persist = async (): Promise<boolean> => {
    state.updatedAt = jstNow();
    const raw = JSON.stringify(state);
    const saved = await db.prepare(
      `UPDATE account_settings
          SET value = ?, updated_at = ?
        WHERE line_account_id = ? AND key = ? AND value = ?`,
    ).bind(
      raw, state.updatedAt, lineAccountId,
      FOLLOWER_IMPORT_STATE_KEY, currentRaw,
    ).run();
    if ((saved.meta.changes ?? 0) === 0) {
      lockLost = true;
      return false;
    }
    currentRaw = raw;
    return true;
  };

  // 友だち行への書き込みも同じ条件で守る。状態の保存だけを守っても、
  // 期限切れの旧実行が抱えている古いプロフィールが friends に入ってしまう。
  // currentRaw は保存のたびに進むので、条件の値は文を組むたびに読み直す。
  const guard: OwnershipGuard = {
    sql: `EXISTS (
            SELECT 1
              FROM account_settings
             WHERE line_account_id = ? AND key = ? AND value = ?
          )`,
    binds: () => [lineAccountId, FOLLOWER_IMPORT_STATE_KEY, currentRaw],
    stillOwned: async () => (
      await getAccountSetting(db, lineAccountId, FOLLOWER_IMPORT_STATE_KEY)
    ) === currentRaw,
  };

  let profilesFetched = 0;
  try {
    // 1 ページ終わるたびに予算を見て、残っていれば続けて次のページへ進む。
    // 以前は 1 回の実行で 1 ページだけ進めていたので、人数が多いと
    // 刻みの回数だけ待つことになっていた。
    while (state.phase === 'importing_ids' || state.phase === 'hydrating_profiles') {
      if (state.phase === 'importing_ids') {
        await importIdPage(db, client, lineAccountId, state, guard);
      } else {
        const page = await hydrateProfilePage(
          db, client, lineAccountId, state, maxProfiles - profilesFetched, deadlineMs, guard,
        );
        profilesFetched += page.attempted;
        // 書き戻しが交代後で成立しなかった。この実行は何も保存せず、
        // ロックも解除せずに降りる（解除すると引き継いだ側のロックを外す）。
        if (page.lockLost) {
          lockLost = true;
          break;
        }
        // 何も進まなかったページをもう一度引いても同じ結果になる。
        // D1 が落ちている・時間切れ・全員取得失敗のいずれかなので、
        // ここで切り上げて続きを次の実行へ渡す。
        if (!page.progressed) break;
      }
      // 1 ページ分の進み具合をここで保存する。最後の finally だけに任せると、
      // CPU 上限や立ち退きで実行が打ち切られたときに、DB には書けている
      // のに件数とカーソルが古いまま残る。ロックの項目はそのまま残すので
      // 他の実行は入ってこない。書き込みは 1 ページに 1 回だけ。
      // 書けなかったときは、ロックの期限切れで別の実行が続きを持っている。
      // 自分の手元の状態はもう古いので、何も書かずにここで降りる。
      if (!(await persist())) break;
      if (profilesFetched >= maxProfiles) break;
      if (Date.now() >= deadlineMs) break;
    }
    if (!lockLost) state.lastError = null;
  } catch (err) {
    state.lastError = '取り込みを再試行しています。しばらくして進み具合を確認してください。';
  } finally {
    // 続きを別の実行へ渡したあとに自分のロック解除を書くと、
    // 相手のロックまで外してしまう。持っているときだけ解放する。
    if (!lockLost) {
      state.lockToken = null;
      state.lockUntil = null;
      await persist();
    }
  }
  if (lockLost) {
    // 自分は追い抜かれた側。DB の最新を読み直して返す。
    const fresh = await getFollowerImportState(db, lineAccountId);
    return { state: fresh, busy: true, profilesFetched };
  }
  return { state, busy: false, profilesFetched };
}
