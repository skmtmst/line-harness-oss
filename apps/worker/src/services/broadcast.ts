import { buildMessage } from './line-message.js';
import {
  getBroadcastById,
  getBroadcasts,
  getQueuedBroadcasts,
  updateBroadcastStatus,
  updateBroadcastBatchProgress,
  getFriendsByTag,
  jstNow,
  updateBroadcastLineRequestId,
  createBroadcastInsight,
} from '@line-crm/db';
import type { Broadcast } from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { calculateStaggerDelay, sleep, addMessageVariation } from './stealth.js';
import {
  assertNoUnresolvedBroadcastVariables,
  getUnsupportedBroadcastVariables,
  hasRecipientVariables,
  renderBroadcastMessageContent,
  type BroadcastRenderContext,
} from './render-message.js';
import { aggregationUnitFor, aggregationUnits } from './broadcast-aggregation.js';
import { resolveInterpolationExtra } from './interpolation-context.js';
import { createBroadcastRetryKey } from './broadcast-retry-key.js';

const MULTICAST_BATCH_SIZE = 500;
const PERSONALIZED_PUSH_BATCH_SIZE = 10;

/**
 * 配信全体で1つに決まる差し込みの値。
 *
 * 共通情報（営業時間など）と配信日は、誰に送っても同じ値になる。
 * 1人ずつ引くと人数分クエリが増えるので、送る前に1回だけ用意する。
 *
 * 配信日の起点は**実際に送る時刻**。予約時刻ではない。cron は5分刻みで
 * 動くので、深夜0時前後の配信では予約時刻と実際の日付が割れる。
 * 相手が受け取った日と、本文に書かれた日が食い違うのがいちばん困る。
 */
async function broadcastWideContext(
  db: D1Database,
  accountId: string | null,
  content: string,
): Promise<BroadcastRenderContext> {
  const context: BroadcastRenderContext = { deliveredAt: new Date() };
  if (accountId) {
    const { getLineAccountById: getLA } = await import('@line-crm/db');
    const acct = await getLA(db, accountId);
    context.liffId = (acct as unknown as { liff_id?: string | null } | null)?.liff_id ?? null;
  }
  // 共通情報は本文で使っているときだけ引く。使わない配信で毎回1クエリ増やさない。
  if (/\{\{\s*var\./.test(content)) {
    const { getCommonVarMap } = await import('@line-crm/db');
    context.vars = await getCommonVarMap(db);
  }
  return context;
}

export async function processBroadcastSend(
  db: D1Database,
  lineClient: LineClient,
  broadcastId: string,
  workerUrl?: string,
): Promise<Broadcast> {
  // Mark as sending
  await updateBroadcastStatus(db, broadcastId, 'sending');

  const broadcast = await getBroadcastById(db, broadcastId);
  if (!broadcast) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }

  const unsupportedVariables = getUnsupportedBroadcastVariables(broadcast.message_content);
  if (unsupportedVariables.length > 0) {
    throw new Error(
      `Unsupported broadcast variables: ${unsupportedVariables.map((v) => `{{${v}}}`).join(', ')}`,
    );
  }

  // A recipient variable cannot be delivered through LINE broadcast or
  // multicast because those endpoints accept one shared Message object.
  // Convert scheduled/direct sends into the resumable queue path.
  if (hasRecipientVariables(broadcast.message_content)
    && broadcast.target_type !== 'multi-account-dedup') {
    const raw = broadcast as unknown as Record<string, unknown>;
    const accountId = raw.line_account_id as string | null;
    const where: string[] = ['f.is_following = 1'];
    const binds: unknown[] = [];
    if (accountId) {
      where.push('f.line_account_id = ?');
      binds.push(accountId);
    }
    if (broadcast.target_type === 'tag') {
      if (!broadcast.target_tag_id) throw new Error('target_tag_id is required for personalized tag broadcast');
      where.push('EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)');
      binds.push(broadcast.target_tag_id);
    }
    const audience = await db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN f.display_name IS NULL OR trim(f.display_name) = '' THEN 1 ELSE 0 END) AS missing_name
         FROM friends f WHERE ${where.join(' AND ')}`,
    ).bind(...binds).first<{ total: number; missing_name: number | null }>();
    if (Number(audience?.missing_name ?? 0) > 0) {
      throw new Error(`Cannot personalize broadcast: ${audience!.missing_name} recipient(s) have no display name`);
    }
    const conditions = broadcast.target_type === 'tag'
      ? { operator: 'AND', rules: [
          { type: 'is_following', value: true },
          { type: 'tag_exists', value: broadcast.target_tag_id },
        ] }
      : { operator: 'AND', rules: [{ type: 'is_following', value: true }] };
    await db.prepare(
      `UPDATE broadcasts
          SET status = 'sending', batch_offset = 0, total_count = ?, segment_conditions = ?
        WHERE id = ?`,
    ).bind(Number(audience?.total ?? 0), JSON.stringify(conditions), broadcast.id).run();
    return (await getBroadcastById(db, broadcastId))!;
  }

  /*
   * 絞り込み配信は、この関数では送らずキューへ渡す。
   *
   * ここを通さないと、下のふつうの経路（LINE の broadcast/multicast）へ
   * 落ちて**全員に届く**。予約した絞り込み配信が全員に飛ぶ形で表に出る。
   * 条件は下書きの segment_conditions に入っているので、
   * status='sending' に移せば processQueuedBroadcasts が拾う。
   */
  if (broadcast.target_type === 'segment') {
    const raw = broadcast as unknown as Record<string, unknown>;
    const stored = raw.segment_conditions as string | null;
    if (!stored) {
      throw new Error('segment_conditions is required for segment broadcast');
    }
    const conditions = JSON.parse(stored) as { operator: 'AND' | 'OR'; rules: unknown[] };
    if (!conditions || !Array.isArray(conditions.rules)) {
      throw new Error('segment_conditions is malformed');
    }
    const { buildSegmentQuery } = await import('./segment-query.js');
    const { sql, bindings } = buildSegmentQuery(conditions as Parameters<typeof buildSegmentQuery>[0]);
    const accountId = raw.line_account_id as string | null;
    const countSql = accountId
      ? `SELECT COUNT(*) AS cnt FROM (${sql.replace('WHERE', 'WHERE f.line_account_id = ? AND')}) q`
      : `SELECT COUNT(*) AS cnt FROM (${sql}) q`;
    const binds = accountId ? [accountId, ...bindings] : bindings;
    const row = await db.prepare(countSql).bind(...binds).first<{ cnt: number }>();

    // 名前を差し込む本文は、名前の無い人がいると差し込めない。送る前に止める。
    if (hasRecipientVariables(broadcast.message_content)) {
      const nameSql = accountId
        ? `SELECT SUM(CASE WHEN q.display_name IS NULL OR trim(q.display_name) = '' THEN 1 ELSE 0 END) AS missing_name
             FROM (${sql.replace('WHERE', 'WHERE f.line_account_id = ? AND')}) q`
        : `SELECT SUM(CASE WHEN q.display_name IS NULL OR trim(q.display_name) = '' THEN 1 ELSE 0 END) AS missing_name
             FROM (${sql}) q`;
      const missing = await db.prepare(nameSql).bind(...binds).first<{ missing_name: number | null }>();
      if (Number(missing?.missing_name ?? 0) > 0) {
        throw new Error(`Cannot personalize broadcast: ${missing!.missing_name} recipient(s) have no display name`);
      }
    }

    await db
      .prepare(`UPDATE broadcasts SET status = 'sending', batch_offset = 0, total_count = ? WHERE id = ?`)
      .bind(Number(row?.cnt ?? 0), broadcast.id)
      .run();
    return (await getBroadcastById(db, broadcastId))!;
  }

  // multi-account-dedup は inline 送信せず cron queue (processQueuedBroadcasts) に委譲する。
  // この関数は scheduled / 即時の単一 account 経路用で、毎回 auto-track を実行する。dedup を
  // ここで送ると (1) auto-track がここと queue 側で二重実行されて tracked link が重複し、
  // (2) 分割送信 (chunking) の継続が queue 側にあるため partial-sent のまま sent 扱いになる。
  // よって total_count だけ確定して status='sending', batch_offset=0 にし、queue に渡す。
  // total_count は executor が inactive を skip するのに合わせ、active アカウントの当選者数で
  // 計算する (routes 即時送信パスと同じロジック)。
  if (broadcast.target_type === 'multi-account-dedup') {
    const { computeDedupBroadcastPreview } = await import('./dedup-broadcast.js');
    const accountIds = (broadcast.account_ids ? JSON.parse(broadcast.account_ids) : []) as string[];
    const dedupPriority = (broadcast.dedup_priority ? JSON.parse(broadcast.dedup_priority) : []) as string[];
    const preview = await computeDedupBroadcastPreview(db, accountIds, dedupPriority, broadcast.target_tag_id ?? null);
    let projectedTotal = 0;
    const { getLineAccountById } = await import('@line-crm/db');
    for (const a of preview.perAccount) {
      const account = await getLineAccountById(db, a.accountId);
      if (account && account.is_active) projectedTotal += a.recipients.length;
    }
    await db
      .prepare(`UPDATE broadcasts SET status = 'sending', batch_offset = 0, total_count = ? WHERE id = ?`)
      .bind(projectedTotal, broadcast.id)
      .run();
    return (await getBroadcastById(db, broadcastId))!;
  }

  // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
  // track_links=0 の broadcast は明示的に短縮 OFF (URL をそのまま送る)。
  const broadcastAccountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
  let finalType: string = broadcast.message_type;
  let finalContent = broadcast.message_content;
  if (workerUrl && broadcast.track_links !== 0) {
    const { autoTrackContent } = await import('./auto-track.js');
    const tracked = await autoTrackContent(db, broadcast.message_type, broadcast.message_content, workerUrl, {
      lineAccountId: broadcastAccountId,
    });
    finalType = tracked.messageType;
    finalContent = tracked.content;
  }
  /*
   * 配信全体で決まる差し込みを、ここで置き換える。
   *   {{liff_id}} … この配信のアカウントの LIFF ID
   *   {{var.…}}   … 共通情報
   *   {{date…}}   … 配信日・目標日までの日数
   * ここは tag / all 系の単一 account 経路のみ (multi-account-dedup は冒頭で
   * queue に委譲済みで到達しない。dedup の置換は dedup-broadcast.ts 側で
   * per-account に行う)。
   */
  const wideContext = await broadcastWideContext(db, broadcastAccountId, finalContent);
  finalContent = renderBroadcastMessageContent(finalType, finalContent, wideContext);
  assertNoUnresolvedBroadcastVariables(finalContent);
  const altText = (broadcast as unknown as Record<string, unknown>).alt_text as string | undefined;
  const message = buildMessage(finalType, finalContent, altText || undefined);
  let totalCount = 0;
  let successCount = 0;

  try {
    if (broadcast.target_type === 'all') {
      // Use LINE broadcast API (sends to all followers)
      const retryKey = await createBroadcastRetryKey(
        broadcast.id,
        'broadcast',
        finalType,
        finalContent,
      );
      const { requestId } = await lineClient.broadcast([message], retryKey);
      await updateBroadcastLineRequestId(db, broadcast.id, requestId, null);
      // We don't have exact count for broadcast API, set as 0 (unknown)
      totalCount = 0;
      successCount = 0;
    } else if (broadcast.target_type === 'tag') {
      if (!broadcast.target_tag_id) {
        throw new Error('target_tag_id is required for tag-targeted broadcasts');
      }

      const friends = await getFriendsByTag(db, broadcast.target_tag_id);
      const followingFriends = friends.filter((f) => f.is_following);
      totalCount = followingFriends.length;

      // Send in batches with stealth delays to mimic human patterns
      const now = jstNow();
      const totalBatches = Math.ceil(followingFriends.length / MULTICAST_BATCH_SIZE);
      // 開封数を取らない配信では null。集計ユニットは月1,000の上限がある。
      const unit = aggregationUnitFor(broadcast);
      for (let i = 0; i < followingFriends.length; i += MULTICAST_BATCH_SIZE) {
        const batchIndex = Math.floor(i / MULTICAST_BATCH_SIZE);
        const batch = followingFriends.slice(i, i + MULTICAST_BATCH_SIZE);
        const lineUserIds = batch.map((f) => f.line_user_id);

        // Stealth: add staggered delay between batches
        if (batchIndex > 0) {
          const delay = calculateStaggerDelay(followingFriends.length, batchIndex);
          await sleep(delay);
        }

        // Stealth: add slight variation to text messages
        let batchMessage = message;
        if (message.type === 'text' && totalBatches > 1) {
          batchMessage = { ...message, text: addMessageVariation(message.text, batchIndex) };
        }

        try {
          const retryKey = await createBroadcastRetryKey(
            broadcast.id,
            'multicast',
            ...batch.map((f) => f.id),
            JSON.stringify(batchMessage),
          );
          await lineClient.multicast(lineUserIds, [batchMessage], aggregationUnits(unit), retryKey);
          successCount += batch.length;

          // Log only successfully sent messages (batch insert for performance)
          // line_account_id は broadcast 設定時のアカウントを記録 (送信時点の固定値)。
          // friends.line_account_id は webhook で書き換わる mutable なので使わない。
          const broadcastAccount = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
          const logStmts = batch.map(friend =>
            db.prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ?)`,
            ).bind(crypto.randomUUID(), friend.id, broadcast.message_type, broadcast.message_content, broadcastId, broadcastAccount, now),
          );
          await db.batch(logStmts);
        } catch (err) {
          console.error(`Multicast batch ${i / MULTICAST_BATCH_SIZE} failed:`, err);
          // Continue with next batch; failed batch is not logged
        }
      }
      await updateBroadcastLineRequestId(db, broadcast.id, null, unit);
    }
    // multi-account-dedup はこの関数の冒頭で queue に委譲済み (ここには到達しない)。

    await createBroadcastInsight(db, broadcast.id);
    await updateBroadcastStatus(db, broadcastId, 'sent', { totalCount, successCount });
  } catch (err) {
    // On failure, reset to draft so it can be retried
    await updateBroadcastStatus(db, broadcastId, 'draft');
    throw err;
  }

  return (await getBroadcastById(db, broadcastId))!;
}

export async function processScheduledBroadcasts(
  db: D1Database,
  lineClient: LineClient,
  workerUrl?: string,
): Promise<void> {
  const allBroadcasts = await getBroadcasts(db);

  const nowMs = Date.now();
  const scheduled = allBroadcasts.filter(
    (b) =>
      b.status === 'scheduled' &&
      b.scheduled_at !== null &&
      new Date(b.scheduled_at).getTime() <= nowMs,
  );

  for (const broadcast of scheduled) {
    try {
      // Optimistic lock: claim this broadcast (scheduled → sending)
      const lockResult = await db
        .prepare(`UPDATE broadcasts SET status = 'sending' WHERE id = ? AND status = 'scheduled'`)
        .bind(broadcast.id)
        .run();
      if (!lockResult.meta.changes || lockResult.meta.changes === 0) continue;

      // Resolve correct lineClient for this broadcast's account
      let deliveryClient = lineClient;
      const accountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
      if (accountId) {
        const { getLineAccountById } = await import('@line-crm/db');
        const account = await getLineAccountById(db, accountId);
        if (account) {
          const { LineClient: LC } = await import('@line-crm/line-sdk');
          deliveryClient = new LC(account.channel_access_token);
        }
      }

      await processBroadcastSend(db, deliveryClient, broadcast.id, workerUrl);
    } catch (err) {
      console.error(`Failed to send scheduled broadcast ${broadcast.id}:`, err);
      // Reset to scheduled so it can be retried next cron
      try {
        await db.prepare(`UPDATE broadcasts SET status = 'scheduled' WHERE id = ? AND status = 'sending'`)
          .bind(broadcast.id).run();
      } catch (resetErr) {
        console.error(`Failed to reset broadcast ${broadcast.id} status:`, resetErr);
      }
    }
  }
}


/**
 * 1回のCron実行で送る人数の上限。
 *
 * stealth_spread_minutes は「何分かけて配りきるか」。既定の 0 は
 * 一気に送る（従来どおり）。
 *
 * Cron は1分ごとなので、全体を分数で割った人数を1回ぶんにする。
 * 途中で止めても batch_offset がそこに残り、次の tick が続きから送る。
 * この再開のしくみは元からあるもので、新しく二重送信の危険は増えない。
 *
 * 下限を1バッチにしているのは、0人になると永久に進まなくなるため。
 */
export function stealthChunkSize(
  total: number,
  spreadMinutes: number,
  batchSize: number,
): number {
  if (spreadMinutes <= 0) return total;
  const perMinute = Math.ceil(total / spreadMinutes);
  return Math.max(batchSize, perMinute);
}

/**
 * Cronから呼ばれるキュー処理。status='queued' のブロードキャストを
 * batch_offset から500人ずつ処理する。1回のCron実行で全バッチを処理可能。
 */
export async function processQueuedBroadcasts(
  db: D1Database,
  lineClient: LineClient,
  workerUrl?: string,
): Promise<void> {
  const queued = await getQueuedBroadcasts(db);
  for (const broadcast of queued) {
    // アカウント別のlineClientを解決
    const accountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
    let client = lineClient;
    if (accountId) {
      const { getLineAccountById } = await import('@line-crm/db');
      const account = await getLineAccountById(db, accountId);
      if (account) client = new (await import('@line-crm/line-sdk')).LineClient(account.channel_access_token);
    }

    try {
      await processQueuedBroadcastBatches(db, client, broadcast, workerUrl);
    } catch (err) {
      console.error(`Failed to process queued broadcast ${broadcast.id}:`, err);
    }
  }
}

async function processQueuedBroadcastBatches(
  db: D1Database,
  lineClient: LineClient,
  broadcast: import('@line-crm/db').Broadcast,
  workerUrl?: string,
): Promise<void> {
  const raw = broadcast as unknown as Record<string, unknown>;
  const segmentConditionsStr = raw.segment_conditions as string | null;
  const batchOffset = (raw.batch_offset as number) || 0;

  // 排他ロック: batch_offset を -1 に設定して他のCronが拾わないようにする
  // WHERE batch_offset = ? で楽観ロック（既に他が処理中なら更新0行→スキップ）
  // batch_lock_at は recoverStalledBroadcasts が「ロック取得後 N 分経過」を判定する
  // ためのタイムスタンプ。created_at だと draft 作成時刻基準で本物の lock age と
  // ずれて Worker 並走 race を引き起こすため別カラムで管理する。
  // 重要: 値は SQL の strftime で生成する。jstNow() の '+09:00' suffix は SQLite で
  // UTC 正規化されて見かけ 9 時間古くなり、recover 側 (julianday('now','+9 hours'))
  // と比較すると即座に「stale」扱いされて lock 取得直後に解除される。created_at
  // 列の DEFAULT と同じ式を使って naive JST に揃える。
  const lockResult = await db.prepare(
    `UPDATE broadcasts SET batch_offset = -1, batch_lock_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE id = ? AND batch_offset = ?`,
  ).bind(broadcast.id, batchOffset).run();
  if (!lockResult.meta.changes || lockResult.meta.changes === 0) {
    // 他のCron実行が既に処理中 → スキップ
    return;
  }

  // auto-track（初回のみ）。auto-track は冪等でない (呼ぶたび新 tracked link を作る) ため
  // 「1 broadcast につき 1 回」に厳密化する。non-dedup は batch_offset が 0→N と進むので
  // `batchOffset === 0` が初回判定になる。dedup は分割送信で毎 tick batch_offset=0 から
  // 再入するため、それだけだと毎 tick auto-track が走って tracked link が二重生成される。
  // dedup の初回は dedup_progress=NULL なので、その条件を足して継続 tick では再実行しない
  // (初回に変換結果を message_content へ persist 済みなので、継続 tick はそれを使う)。
  const isDedupContinuation =
    broadcast.target_type === 'multi-account-dedup' && !!broadcast.dedup_progress;
  let finalType: string = broadcast.message_type;
  let finalContent = broadcast.message_content;
  if (workerUrl && batchOffset === 0 && !isDedupContinuation && broadcast.track_links !== 0) {
    const { autoTrackContent } = await import('./auto-track.js');
    // dedup broadcast は複数アカウントから送るためリンクの所有アカウントを一意に
    // 決められない → line_account_id は null のまま (env.LIFF_URL フォールバック)。
    const tracked = await autoTrackContent(db, broadcast.message_type, broadcast.message_content, workerUrl, {
      lineAccountId: (raw.line_account_id as string | null) ?? null,
    });
    finalType = tracked.messageType;
    finalContent = tracked.content;
    // 変換後のコンテンツを保存（次バッチ以降で使えるように）
    if (finalType !== broadcast.message_type || finalContent !== broadcast.message_content) {
      await db.prepare('UPDATE broadcasts SET message_type = ?, message_content = ? WHERE id = ?')
        .bind(finalType, finalContent, broadcast.id).run();
    }
  }

  // 配信全体で決まる差し込み（{{liff_id}} / {{var.…}} / {{date…}}）を先に置き換える。
  // single account 経路のみ; multi は dedup 側で per-account に置換する。
  const queuedAccountId = raw.line_account_id as string | null;
  if (broadcast.target_type !== 'multi-account-dedup') {
    const wide = await broadcastWideContext(db, queuedAccountId, finalContent);
    finalContent = renderBroadcastMessageContent(finalType, finalContent, wide);
  }
  const altText = raw.alt_text as string | undefined;
  const message = buildMessage(finalType, finalContent, altText || undefined);

  // multi-account-dedup: delegate to processMultiAccountDedupBroadcast.
  // dedup ループは内部で per-account に {{liff_id}} 置換 + buildMessage する。
  // auto-track で計算された finalType / finalContent を反映した broadcast を
  // 渡す (broadcast 引数の message_content をそのまま使うと auto-track 結果が
  // 落ちる)。
  if (broadcast.target_type === 'multi-account-dedup') {
    const { processMultiAccountDedupBroadcast } = await import('./dedup-broadcast.js');
    const broadcastForDedup = { ...broadcast, message_type: finalType, message_content: finalContent };
    const result = await processMultiAccountDedupBroadcast(db, broadcastForDedup);
    if (!result.complete) {
      // 時間バジェットに達して途中で yield した。status='sending' のまま batch_offset を
      // -1(ロック) → 0 に戻し、次の cron tick が getQueuedBroadcasts で拾って続きを送る。
      // 進捗 (dedup_progress / success_count) は batch ごとに永続化済みなので、
      // success_count は加算しない (第4引数 0)。これで 5000 人配信でも 1 実行が短く終わり、
      // Worker 時間制限に当たって stall することが無くなる (= 分割送信)。
      await updateBroadcastBatchProgress(db, broadcast.id, 0, 0);
      return;
    }
    await createBroadcastInsight(db, broadcast.id);
    await updateBroadcastStatus(db, broadcast.id, 'sent', {
      totalCount: result.totalCount,
      successCount: result.successCount,
    });
    return;
  }

  // 対象ユーザーリストを取得（アカウントで絞り込む）
  const accountId = raw.line_account_id as string | null;
  let friends: Array<{ id: string; line_user_id: string; display_name: string | null }>;
  if (segmentConditionsStr) {
    const { buildSegmentQuery } = await import('./segment-query.js');
    const condition = JSON.parse(segmentConditionsStr);
    const { sql, bindings } = buildSegmentQuery(condition);
    // アカウントフィルタを追加（line_account_idで絞り込み）
    let accountSql = sql;
    const accountBindings = [...bindings];
    if (accountId) {
      accountSql = sql.replace('WHERE', 'WHERE f.line_account_id = ? AND');
      accountBindings.unshift(accountId);
    }
    const result = await db.prepare(accountSql).bind(...accountBindings).all<{
      id: string;
      line_user_id: string;
      display_name: string | null;
    }>();
    friends = result.results ?? [];
  } else if (broadcast.target_tag_id) {
    const { getFriendsByTag } = await import('@line-crm/db');
    const tagFriends = await getFriendsByTag(db, broadcast.target_tag_id);
    friends = tagFriends.filter(f => f.is_following).map(f => ({
      id: f.id,
      line_user_id: f.line_user_id,
      display_name: f.display_name,
    }));
  } else {
    // target_type='all' でキューに入ることはないが、念のため
    const retryKey = await createBroadcastRetryKey(
      broadcast.id,
      'queued-broadcast',
      finalType,
      finalContent,
    );
    const { requestId } = await lineClient.broadcast([message], retryKey);
    await updateBroadcastLineRequestId(db, broadcast.id, requestId, null);
    await createBroadcastInsight(db, broadcast.id);
    await updateBroadcastStatus(db, broadcast.id, 'sent', { totalCount: 0, successCount: 0 });
    return;
  }

  // 初回: total_count を設定
  if (batchOffset === 0) {
    await db.prepare('UPDATE broadcasts SET total_count = ? WHERE id = ?')
      .bind(friends.length, broadcast.id).run();
  }

  const now = jstNow();
  // 開封数を取らない配信では null。集計ユニットは月1,000の上限がある。
  const unit = aggregationUnitFor(broadcast);
  let currentOffset = batchOffset;
  const personalized = hasRecipientVariables(finalContent);
  const unsupportedVariables = getUnsupportedBroadcastVariables(finalContent);
  if (unsupportedVariables.length > 0) {
    await updateBroadcastBatchProgress(db, broadcast.id, batchOffset, 0);
    throw new Error(
      `Unsupported broadcast variables: ${unsupportedVariables.map((v) => `{{${v}}}`).join(', ')}`,
    );
  }
  if (!personalized) {
    try {
      assertNoUnresolvedBroadcastVariables(finalContent);
    } catch (err) {
      await updateBroadcastBatchProgress(db, broadcast.id, batchOffset, 0);
      throw err;
    }
  }
  const deliveryBatchSize = personalized ? PERSONALIZED_PUSH_BATCH_SIZE : MULTICAST_BATCH_SIZE;
  const totalBatches = Math.ceil(friends.length / deliveryBatchSize);

  // 時間をかけて配る設定。0（既定）なら一気に送る。
  const spreadMinutes = Number(raw.stealth_spread_minutes ?? 0) || 0;
  const chunkLimit = stealthChunkSize(friends.length, spreadMinutes, deliveryBatchSize);
  const stopAt = Math.min(friends.length, currentOffset + chunkLimit);

  // 1回のCron実行で、上限まで処理する（タイムアウトしない範囲で）
  while (currentOffset < stopAt) {
    const batch = friends.slice(currentOffset, currentOffset + deliveryBatchSize);
    const lineUserIds = batch.map(f => f.line_user_id);
    const batchIndex = Math.floor(currentOffset / deliveryBatchSize);

    if (personalized) {
      for (const friend of batch) {
        const alreadyLogged = await db.prepare(
          `SELECT 1 FROM messages_log
            WHERE broadcast_id = ? AND friend_id = ? AND direction = 'outgoing'
              AND COALESCE(delivery_type, '') != 'test'
            LIMIT 1`,
        ).bind(broadcast.id, friend.id).first();
        if (alreadyLogged) {
          currentOffset++;
          continue;
        }

        try {
          // 友だち情報欄は人ごとに違うので、ここで引く。本文で使っていなければ
          // 引かない（resolveInterpolationExtra が中で判断する）。
          const extra = await resolveInterpolationExtra(db, friend.id, finalContent);
          const renderedContent = renderBroadcastMessageContent(finalType, finalContent, {
            displayName: friend.display_name,
            fields: extra.fields,
          });
          assertNoUnresolvedBroadcastVariables(renderedContent);
          const personalizedMessage = buildMessage(finalType, renderedContent, altText || undefined);
          const retryKey = await createBroadcastRetryKey(
            broadcast.id,
            'personalized-push',
            friend.id,
            finalType,
            renderedContent,
          );
          await lineClient.pushMessage(friend.line_user_id, [personalizedMessage], retryKey, aggregationUnits(unit));

          await db.prepare(
            `INSERT INTO messages_log
              (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
             VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            friend.id,
            finalType,
            renderedContent,
            broadcast.id,
            accountId,
            now,
          ).run();
          currentOffset++;
        } catch (err) {
          console.error(`Personalized broadcast recipient ${friend.id} failed:`, err);
          await db.prepare(
            `UPDATE broadcasts
                SET batch_offset = ?, batch_lock_at = NULL,
                    success_count = (
                      SELECT COUNT(*) FROM messages_log
                       WHERE broadcast_id = ? AND direction = 'outgoing'
                         AND COALESCE(delivery_type, '') != 'test'
                    )
              WHERE id = ?`,
          ).bind(currentOffset, broadcast.id, broadcast.id).run();
          return;
        }
      }

      await db.prepare(
        `UPDATE broadcasts
            SET batch_offset = ?, batch_lock_at = NULL,
                success_count = (
                  SELECT COUNT(*) FROM messages_log
                   WHERE broadcast_id = ? AND direction = 'outgoing'
                     AND COALESCE(delivery_type, '') != 'test'
                )
          WHERE id = ?`,
      ).bind(currentOffset, broadcast.id, broadcast.id).run();
      if (currentOffset < friends.length) return;
      break;
    }

    // ステルス遅延（最初のバッチ以外）
    if (batchIndex > 0) {
      const delay = calculateStaggerDelay(friends.length, batchIndex);
      await sleep(delay);
    }

    // テキストメッセージのバリエーション
    let batchMessage = message;
    if (message.type === 'text' && totalBatches > 1) {
      batchMessage = { ...message, text: addMessageVariation((message as { text: string }).text, batchIndex) };
    }

    try {
      const retryKey = await createBroadcastRetryKey(
        broadcast.id,
        'queued-multicast',
        ...batch.map((f) => f.id),
        JSON.stringify(batchMessage),
      );
      await lineClient.multicast(lineUserIds, [batchMessage], aggregationUnits(unit), retryKey);
    } catch (err) {
      console.error(`Queued broadcast batch ${batchIndex} send failed:`, err);
      // 送信失敗: ロック解除 + offsetを保存して次のCronで再開
      await updateBroadcastBatchProgress(db, broadcast.id, currentOffset, 0);
      return; // batch_offset が currentOffset に戻り、次の cron で再開可能
    }

    // 送信成功後のログ・進捗更新（失敗しても再送しない）
    // line_account_id は queue path lock 時の broadcast.line_account_id を使う
    // (friends.line_account_id ではなく送信元アカウントを固定で記録)。
    const queuedBroadcastAccount = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
    try {
      const stmts = batch.map(friend =>
        db.prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
           VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ?)`,
        ).bind(crypto.randomUUID(), friend.id, finalType, finalContent, broadcast.id, queuedBroadcastAccount, now),
      );
      await db.batch(stmts);
    } catch (logErr) {
      console.error(`Queued broadcast batch ${batchIndex} log failed (messages already sent):`, logErr);
    }

    currentOffset += batch.length;
    // Update success_count but keep batch_offset=-1 (locked) during processing
    await db.prepare(
      `UPDATE broadcasts SET success_count = success_count + ? WHERE id = ?`,
    ).bind(batch.length, broadcast.id).run();
  }

  // まだ残っている（時間をかけて配る設定で途中まで送った）。
  // ロックだけ外して、次の tick が続きから送る。完了にはしない。
  if (currentOffset < friends.length) {
    await updateBroadcastBatchProgress(db, broadcast.id, currentOffset, 0);
    return;
  }

  // 全バッチ完了 — ロック解除 + 完了マーク
  await updateBroadcastLineRequestId(db, broadcast.id, null, unit);
  await createBroadcastInsight(db, broadcast.id);
  await updateBroadcastStatus(db, broadcast.id, 'sent');
}

/*
 * メッセージの組み立ては、シナリオと同じものを使う。
 *
 * ここに別実装を持っていたときは、text / image / flex の3つしか
 * 組み立てられなかった。それ以外の種別を渡すと「テキストに JSON を
 * 入れたもの」に落ちるので、**中身の JSON がそのまま相手のトークに届く**。
 * 呼び出し側が多いので、ここからも取れるようにしておく。
 */
export { buildMessage };
