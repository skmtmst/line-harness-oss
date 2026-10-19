import { jstNow } from '@line-crm/db';

import type {
  FollowerImportClient,
  FollowerImportState,
  OwnershipGuard,
} from './follower-import-state.js';

const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/;
// `WHERE line_user_id IN (?, ?, ...)` の ? の数。D1 が 1 文に受け付ける
// バインド変数は 100 個までなので、他の条件を足す余地を見て 90 に抑えている。
// **この数はこの SQL 文の形に紐づく。** 文に条件を足すときは一緒に減らす。
const LOOKUP_CHUNK_SIZE = 90;
// db.batch にまとめて渡す **文の数**。上の 90 とは別の理由で決まる。
// batch は文ごとに独立してバインドするので、変数 100 個の制限には当たらない。
// ここは 1 回のトランザクションをどこまで大きくするかの話で、
// 大きすぎると失敗したときに巻き戻る範囲が広くなる。
const WRITE_CHUNK_SIZE = 100;
// LINE のプロフィール取得は 1 人ずつしか引けない（まとめて引く API が無い）。
// 以下の 2 つは「1 回の実行でどこまで進めるか」を決める数で、
// 速さの上限は LINE 側ではなく Workers 側の制限で決まる。
// LINE の制限は 2,000 requests/秒（2026-10-15 時点の公式値）で、
// 下の並列数ではまったく届かない。
//
// D1 から 1 度に読み出す人数。この単位でプロフィールを引き、書き戻す。
export const PROFILE_PAGE_SIZE = 200;
// 同時に走らせるプロフィール取得の本数。Workers が同時に持てる
// 「応答ヘッダ待ち」は 6 本までで、7 本目は待つだけでエラーにはならない。
// 本文の読み取りと書き戻しで手が空く分を見込んで 12 本を流し込む。
const PROFILE_CONCURRENCY = 12;
// プロフィールを引けなかった人を何巡まで引き直すか。
// 取得が落ちる理由は一時的なもの（429 / 5xx）と、そもそも引けないもの
// （退会・ブロックで 404）が混ざる。落ちた人を飛ばしたまま完了にすると
// 取り残しに気づけないので、最後まで走ったあとカーソルを戻して
// 「まだ display_name が NULL の人」だけをもう一度引き直す。
// 引けた人は NULL でなくなるので、巡回のたびに対象は減る。
const PROFILE_MAX_PASSES = 3;

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

export async function importIdPage(
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

export interface HydratePageResult {
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
export async function hydrateProfilePage(
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
