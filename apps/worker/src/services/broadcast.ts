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
import { calculateStaggerDelay, sleep } from './stealth.js';
import {
  type BroadcastRenderContext,
} from './render-message.js';
import { aggregationUnitFor, aggregationUnits } from './broadcast-aggregation.js';
import { resolveInterpolationExtra } from './interpolation-context.js';
import { createBroadcastRetryKey } from './broadcast-retry-key.js';
import { evaluateQuota, fetchQuota, shortfallMessage } from './broadcast-quota-guard.js';
import { recordLineTokenDefaultFallback } from './line-token.js';
import {
  assertMessagePartsResolved,
  autoTrackMessageParts,
  buildMessages,
  combinedMessageContent,
  hasRecipientVariablesInParts,
  parseBroadcastMessageParts,
  renderMessageParts,
  unsupportedMessageVariables,
  varyTextMessages,
} from './broadcast-message-set.js';

// LINE の multicast は 1 リクエストで最大 500 人まで宛先に取れる（LINE の仕様）。
// これ以上に増やすことはできない。
const MULTICAST_BATCH_SIZE = 500;
// 差し込み（{{name}} など）があると本文が人ごとに変わるので multicast が使えず、
// push を 1 人ずつ送る。この数はレート制限ではなく **区切りの単位**で、
// 「ここまで送ったら時間を見る／少し待つ」という判断をこの粒度で行う。
// 小さいほど中断したときの取りこぼしが減り、大きいほど待ちの回数が減る。
const PERSONALIZED_PUSH_BATCH_SIZE = 10;

/**
 * 1人ずつ送る配信で、**1回のcronで何人まで送るか**。
 *
 * 差し込みのある配信は multicast が使えないので、1人ずつ push する。
 * 以前はここに上限が無く、10人送るたびに `return` していた。cron は5分刻み
 * なので、**1時間に120人**しか送れない計算になる。友だち5,000人なら41時間。
 * 途中で止まっているように見えるが、**エラーは出ない**。「送信中」のまま
 * 何日も残る。
 *
 * 上限を置く理由は Workers の subrequest（1回の実行で出せる問い合わせの数、
 * 1,000）。1人あたり最大4つ使う。
 *
 *   照合1（送信済みか） + 友だち情報1 + LINEへの送信1 + 記録1 = 4
 *
 * 150人で600。10人ごとに `batch_offset` を書いているので、上限に当たって
 * 実行が切れても**次のcronで続きから再開する**。送信済みの照合があるので
 * 二重送信にもならない。
 */
const PERSONALIZED_PUSH_PER_TICK = 150;

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
    context.vars = await getCommonVarMap(db, accountId);
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

  const storedParts = parseBroadcastMessageParts({
    messageType: broadcast.message_type,
    messageContent: broadcast.message_content,
    messageBubblesJson: broadcast.message_bubbles_json,
    altText: broadcast.alt_text,
  });

  const unsupportedVariables = unsupportedMessageVariables(storedParts);
  if (unsupportedVariables.length > 0) {
    throw new Error(
      `Unsupported broadcast variables: ${unsupportedVariables.map((v) => `{{${v}}}`).join(', ')}`,
    );
  }

  // A recipient variable cannot be delivered through LINE broadcast or
  // multicast because those endpoints accept one shared Message object.
  // Convert scheduled/direct sends into the resumable queue path.
  if (hasRecipientVariablesInParts(storedParts)
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
    if (hasRecipientVariablesInParts(storedParts)) {
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
  let finalParts = await autoTrackMessageParts(
    db,
    storedParts,
    workerUrl,
    broadcastAccountId,
    broadcast.track_links !== 0,
  );
  /*
   * 配信全体で決まる差し込みを、ここで置き換える。
   *   {{liff_id}} … この配信のアカウントの LIFF ID
   *   {{var.…}}   … 共通情報
   *   {{date…}}   … 配信日・目標日までの日数
   * ここは tag / all 系の単一 account 経路のみ (multi-account-dedup は冒頭で
   * queue に委譲済みで到達しない。dedup の置換は dedup-broadcast.ts 側で
   * per-account に行う)。
   */
  const wideContext = await broadcastWideContext(db, broadcastAccountId, combinedMessageContent(finalParts));
  finalParts = renderMessageParts(finalParts, wideContext);
  assertMessagePartsResolved(finalParts);
  const messages = buildMessages(finalParts);
  let totalCount = 0;
  let successCount = 0;

  try {
    if (broadcast.target_type === 'all') {
      // Use LINE broadcast API (sends to all followers)
      const retryKey = await createBroadcastRetryKey(
        broadcast.id,
        'broadcast',
        JSON.stringify(messages),
      );
      const { requestId } = await lineClient.broadcast(messages, retryKey);
      await updateBroadcastLineRequestId(db, broadcast.id, requestId, null);
      if (broadcastAccountId) {
        try {
          const { recordUnknownAnalyticsUrlExposures } = await import('@line-crm/db');
          for (const [index, part] of finalParts.entries()) {
            await recordUnknownAnalyticsUrlExposures(db, {
              lineAccountId: broadcastAccountId,
              messageId: `line-broadcast:${broadcast.id}:${index + 1}`,
              content: part.messageContent,
              sourceKind: 'broadcast_all',
              sourceId: broadcast.id,
              sentAt: jstNow(),
            });
          }
        } catch (error) {
          console.error('analytics URL exposure record failed:', error);
        }
      }
      // We don't have exact count for broadcast API, set as 0 (unknown)
      totalCount = 0;
      successCount = 0;
    } else if (broadcast.target_type === 'tag') {
      if (!broadcast.target_tag_id) {
        throw new Error('target_tag_id is required for tag-targeted broadcasts');
      }

      const friends = await getFriendsByTag(db, broadcast.target_tag_id, broadcastAccountId);
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
          const delay = calculateStaggerDelay(followingFriends.length, batchIndex, MULTICAST_BATCH_SIZE);
          await sleep(delay);
        }

        // Stealth: add slight variation to text messages
        const batchMessages = varyTextMessages(messages, batchIndex, totalBatches);

        try {
          const retryKey = await createBroadcastRetryKey(
            broadcast.id,
            'multicast',
            ...batch.map((f) => f.id),
            JSON.stringify(batchMessages),
          );
          await lineClient.multicast(lineUserIds, batchMessages, aggregationUnits(unit), retryKey);
          successCount += batch.length;

          // Log only successfully sent messages (batch insert for performance)
          // line_account_id は broadcast 設定時のアカウントを記録 (送信時点の固定値)。
          // friends.line_account_id は webhook で書き換わる mutable なので使わない。
          const broadcastAccount = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
          const logStmts = batch.flatMap(friend => finalParts.map(part =>
            db.prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ?)`,
            ).bind(crypto.randomUUID(), friend.id, part.messageType, part.messageContent, broadcastId, broadcastAccount, now),
          ));
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

/**
 * 予約配信を送る直前に、残りの送信枠を確かめる（設計 `Bw0zt`、台帳 #120）。
 *
 * **止めるのは「足りないと分かったとき」だけ。** 枠が読めないときは通す
 * ——LINE の口が落ちているだけで予約を潰すと、送れるはずの配信が届かない。
 *
 * 止めたときは通知センターへ理由を残す。**運用者が結果画面で読める**
 * ようにするため（何通足りないか、次に何をすればよいか）。
 */
async function guardScheduledBroadcastQuota(
  db: D1Database,
  broadcast: Broadcast,
  accountId: string | null,
): Promise<{ blocked: boolean }> {
  if (!accountId) return { blocked: false };

  const { getLineAccountById } = await import('@line-crm/db');
  const account = await getLineAccountById(db, accountId);
  if (!account) return { blocked: false };

  /*
    これから送る通数。**下書きに数えた `total_count` ではなく、いま数え直す。**
    予約してから友だちが増減するので、古い数で枠を見ても意味がない。
  */
  const planned = await countScheduledRecipients(db, broadcast, accountId);
  if (planned === null || planned === 0) return { blocked: false };

  const check = evaluateQuota(await fetchQuota(account.channel_access_token), planned);
  if (check.state !== 'short') return { blocked: false };

  const { createNotification } = await import('@line-crm/db');
  await createNotification(db, {
    eventType: 'broadcast.quota_short',
    title: `「${broadcast.title}」を送れませんでした`,
    body: shortfallMessage(check, planned),
    channel: 'center',
    category: 'error',
    lineAccountId: accountId,
    metadata: JSON.stringify({
      broadcastId: broadcast.id,
      planned,
      remaining: check.remaining,
      shortfall: check.shortfall,
    }),
  });
  return { blocked: true };
}

/** いま同じ条件で数え直した宛先の数。数えられなければ `null`（止めない）。 */
async function countScheduledRecipients(
  db: D1Database,
  broadcast: Broadcast,
  accountId: string,
): Promise<number | null> {
  try {
    const where: string[] = ['f.is_following = 1', 'f.line_account_id = ?'];
    const binds: unknown[] = [accountId];
    if (broadcast.target_type === 'tag' && broadcast.target_tag_id) {
      where.push('EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)');
      binds.push(broadcast.target_tag_id);
    }
    const row = await db
      .prepare(`SELECT COUNT(*) AS total FROM friends f WHERE ${where.join(' AND ')}`)
      .bind(...binds)
      .first<{ total: number }>();
    const total = Number(row?.total ?? 0);
    return Number.isFinite(total) ? total : null;
  } catch {
    // 数えられないことを 0 と読まない。**分からないものは止める理由にしない。**
    return null;
  }
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
        } else {
          recordLineTokenDefaultFallback({ accountId, context: 'broadcast.scheduled' });
        }
      } else {
        recordLineTokenDefaultFallback({ accountId: null, context: 'broadcast.scheduled' });
      }

      /*
        **送る直前に、残りの送信枠を確かめる**（設計 `Bw0zt`、台帳 #120）。
        予約したあとに枠を使い切ると、**予約は実行されるが途中で失敗する**。
        送った人と送れなかった人が混ざり、運用者は結果を見るまで気づけない。

        **取れないときは止めない。** LINE の口が落ちているだけで予約を潰すと、
        送れるはずの配信が届かなくなる。
      */
      const guard = await guardScheduledBroadcastQuota(db, broadcast, accountId);
      if (guard.blocked) {
        // 下書きへ戻す。**内容は消さない**ので、相手を減らして予約し直せる。
        await db.prepare(
          `UPDATE broadcasts SET status = 'draft', scheduled_at = NULL WHERE id = ? AND status = 'sending'`,
        ).bind(broadcast.id).run();
        continue;
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
      else recordLineTokenDefaultFallback({ accountId, context: 'broadcast.queued' });
    } else {
      recordLineTokenDefaultFallback({ accountId: null, context: 'broadcast.queued' });
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
  const storedParts = parseBroadcastMessageParts({
    messageType: broadcast.message_type,
    messageContent: broadcast.message_content,
    messageBubblesJson: broadcast.message_bubbles_json,
    altText: broadcast.alt_text,
  });

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

  // 旧1通では初回の追跡結果を message_content へ保存する。複数通は画面が編集に使う
  // message_bubbles_json を上書きせず、各tickで変換する。autoTrackContent はURLと
  // アカウントが同じなら同じ追跡リンクを再利用するため、再開してもリンクは増えない。
  const isDedupContinuation =
    broadcast.target_type === 'multi-account-dedup' && !!broadcast.dedup_progress;
  let finalParts = await autoTrackMessageParts(
    db,
    storedParts,
    workerUrl,
    (raw.line_account_id as string | null) ?? null,
    broadcast.track_links !== 0,
  );
  // 旧1通だけは従来どおり追跡後の中身を保存する。複数通は編集用の
  // message_bubbles_json を保ち、各tickで既存の追跡リンクを再利用する。
  if (!broadcast.message_bubbles_json && batchOffset === 0 && !isDedupContinuation) {
    const tracked = finalParts[0];
    if (tracked.messageType !== broadcast.message_type || tracked.messageContent !== broadcast.message_content) {
      await db.prepare('UPDATE broadcasts SET message_type = ?, message_content = ? WHERE id = ?')
        .bind(tracked.messageType, tracked.messageContent, broadcast.id).run();
    }
  }

  // 配信全体で決まる差し込み（{{liff_id}} / {{var.…}} / {{date…}}）を先に置き換える。
  // single account 経路のみ; multi は dedup 側で per-account に置換する。
  const queuedAccountId = raw.line_account_id as string | null;
  if (broadcast.target_type !== 'multi-account-dedup') {
    const wide = await broadcastWideContext(db, queuedAccountId, combinedMessageContent(finalParts));
    finalParts = renderMessageParts(finalParts, wide);
  }
  const messages = buildMessages(finalParts);

  // multi-account-dedup: delegate to processMultiAccountDedupBroadcast.
  // dedup ループは内部で per-account に {{liff_id}} 置換 + buildMessage する。
  // auto-track で計算された finalType / finalContent を反映した broadcast を
  // 渡す (broadcast 引数の message_content をそのまま使うと auto-track 結果が
  // 落ちる)。
  if (broadcast.target_type === 'multi-account-dedup') {
    const { processMultiAccountDedupBroadcast } = await import('./dedup-broadcast.js');
    const broadcastForDedup = { ...broadcast, messageParts: finalParts };
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
    const tagFriends = await getFriendsByTag(db, broadcast.target_tag_id, accountId);
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
      JSON.stringify(messages),
    );
    const { requestId } = await lineClient.broadcast(messages, retryKey);
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
  const tickStartOffset = batchOffset;
  const personalized = hasRecipientVariablesInParts(finalParts);
  const unsupportedVariables = unsupportedMessageVariables(finalParts);
  if (unsupportedVariables.length > 0) {
    await updateBroadcastBatchProgress(db, broadcast.id, batchOffset, 0);
    throw new Error(
      `Unsupported broadcast variables: ${unsupportedVariables.map((v) => `{{${v}}}`).join(', ')}`,
    );
  }
  if (!personalized) {
    try {
      assertMessagePartsResolved(finalParts);
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
          const extra = await resolveInterpolationExtra(db, friend.id, combinedMessageContent(finalParts));
          const renderedParts = renderMessageParts(finalParts, {
            displayName: friend.display_name,
            fields: extra.fields,
          });
          assertMessagePartsResolved(renderedParts);
          const personalizedMessages = buildMessages(renderedParts);
          const retryKey = await createBroadcastRetryKey(
            broadcast.id,
            'personalized-push',
            friend.id,
            JSON.stringify(personalizedMessages),
          );
          await lineClient.pushMessage(friend.line_user_id, personalizedMessages, retryKey, aggregationUnits(unit));

          await db.batch(renderedParts.map((part) => db.prepare(
            `INSERT INTO messages_log
              (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
             VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            friend.id,
            part.messageType,
            part.messageContent,
            broadcast.id,
            accountId,
            now,
          )));
          currentOffset++;
        } catch (err) {
          console.error(`Personalized broadcast recipient ${friend.id} failed:`, err);
          await db.prepare(
            `UPDATE broadcasts
                SET batch_offset = ?, batch_lock_at = NULL,
                    success_count = (
                      SELECT COUNT(DISTINCT friend_id) FROM messages_log
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
                  SELECT COUNT(DISTINCT friend_id) FROM messages_log
                   WHERE broadcast_id = ? AND direction = 'outgoing'
                     AND COALESCE(delivery_type, '') != 'test'
                )
          WHERE id = ?`,
      ).bind(currentOffset, broadcast.id, broadcast.id).run();
      if (currentOffset >= friends.length) break;
      // subrequest を使い切る手前で切り上げる。次の cron が続きから再開する。
      if (currentOffset - tickStartOffset >= PERSONALIZED_PUSH_PER_TICK) return;
      continue;
    }

    // ステルス遅延（最初のバッチ以外）
    if (batchIndex > 0) {
      const delay = calculateStaggerDelay(friends.length, batchIndex, deliveryBatchSize);
      await sleep(delay);
    }

    // テキストメッセージのバリエーションは先頭のテキスト1通だけに付ける。
    const batchMessages = varyTextMessages(messages, batchIndex, totalBatches);

    try {
      const retryKey = await createBroadcastRetryKey(
        broadcast.id,
        'queued-multicast',
        ...batch.map((f) => f.id),
        JSON.stringify(batchMessages),
      );
      await lineClient.multicast(lineUserIds, batchMessages, aggregationUnits(unit), retryKey);
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
      const stmts = batch.flatMap(friend => finalParts.map(part =>
        db.prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
           VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ?)`,
        ).bind(crypto.randomUUID(), friend.id, part.messageType, part.messageContent, broadcast.id, queuedBroadcastAccount, now),
      ));
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
