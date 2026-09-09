import { Hono } from 'hono';
import { verifySignature, LineClient } from '@line-crm/line-sdk';
import { parseTapPostbackData } from '../lib/rich-menu-tap.js';
import { parseCarouselPostbackData } from '../lib/carousel-tap.js';
import { handleCarouselTap } from '../services/carousel-tap.js';
import { handleRichMenuTap } from '../services/rich-menu-tap.js';
import type { WebhookRequestBody, WebhookEvent, TextEventMessage } from '@line-crm/line-sdk';
import { createStickerMessageContent } from '@line-crm/shared';
import {
  upsertFriend,
  updateFriendFollowStatus,
  getFriendByLineUserIdForAccount,
  getScenarios,
  enrollFriendInScenario,
  upsertChatOnMessage,
  getLineAccounts,
  jstNow,
  getEntryRouteByRefCode,
  getMessageTemplateById,
  getFriendAddScenarioIds,
  resolveLineCredential,
  recordFriendAddEvent,
  captureFriendAddEventAttribution,
  markFriendAddEventRouting,
  claimFriendAddSendRight,
  touchFriendAddSendClaim,
  releaseFriendAddSendRight,
  toJstString,
  recordAnalyticsEvent,
} from '@line-crm/db';
import type { EntryRoute, Friend } from '@line-crm/db';
import { applyFriendAddRouting } from '../services/friend-add-routing.js';
import { fireEvent } from '../services/event-bus.js';
import { matchAndReply } from '../services/auto-reply.js';
import { buildMessage } from '../services/step-delivery.js';
import { pushImmediateFirstStep } from '../services/immediate-first-step.js';
import { parseQuestionPostback } from '../services/scenario-question.js';
import { handleQuestionAnswer } from '../services/scenario-question-answer.js';
import type { Env } from '../index.js';
import { awardActivityMileage } from '../services/activity-mileage.js';
import { createEccubeCoupon } from '../services/eccube-coupon.js';
import { issueFriendAddCoupon } from '../services/friend-add-coupon.js';
import {
  classifyLineWebhookError,
  processLineWebhookEvents,
} from '../services/line-webhook-events.js';

const webhook = new Hono<Env>();

// LINE webhook bodies are small (events array). Cap defends against unauthenticated
// large-payload DoS before signature verification (#104). 1 MiB leaves room for
// bursty batched deliveries (~100 events × ~5 KB) while still well below the
// 128 MB Cloudflare Workers memory ceiling.
const MAX_WEBHOOK_BODY_SIZE = 1024 * 1024; // 1 MiB

function logWebhookStepFailure(
  stage: string,
  error: unknown,
  lineAccountId: string | null,
  event?: WebhookEvent,
): void {
  console.error({
    event: 'line_webhook_step_failed',
    stage,
    webhook_event_id: event?.webhookEventId ?? null,
    line_account_id: lineAccountId,
    event_type: event?.type ?? null,
    reason: classifyLineWebhookError(error),
  });
}

async function recordWebhookAnalyticsEvent(
  db: D1Database,
  lineAccountId: string | null,
  event: WebhookEvent,
  input: {
    friendId?: string | null;
    eventType: string;
    dimensions?: Record<string, unknown>;
  },
): Promise<void> {
  if (!lineAccountId) return;
  try {
    await recordAnalyticsEvent(db, {
      lineAccountId,
      friendId: input.friendId,
      eventType: input.eventType,
      sourceKind: 'line_webhook',
      sourceId: event.webhookEventId,
      occurredAt: new Date(event.timestamp).toISOString(),
      dimensions: input.dimensions,
    });
  } catch (error) {
    logWebhookStepFailure('analytics_event_record', error, lineAccountId, event);
  }
}

async function ensureFriendFromWebhookUser(
  db: D1Database,
  lineClient: LineClient,
  userId: string,
  lineAccountId: string | null,
): Promise<Friend | null> {
  let friend = await getFriendByLineUserIdForAccount(db, userId, lineAccountId);

  if (!friend) {
    let profile: Awaited<ReturnType<LineClient['getProfile']>> | null = null;
    try {
      profile = await lineClient.getProfile(userId);
    } catch (err) {
      // A signed webhook already proves this user interacted with the bot.
      // If profile lookup is temporarily unavailable, keep the event processable
      // by creating the friend with the LINE userId and filling profile later.
      logWebhookStepFailure('unknown_user_profile', err, lineAccountId);
    }

    friend = await upsertFriend(db, {
      lineUserId: userId,
      lineAccountId,
      displayName: profile?.displayName ?? null,
      pictureUrl: profile?.pictureUrl ?? null,
      statusMessage: profile?.statusMessage ?? null,
    });
    console.log({ event: 'line_webhook_friend_registered', line_account_id: lineAccountId });
  }

  if (lineAccountId && friend.line_account_id !== lineAccountId) {
    // C-2b: UNIQUE(line_account_id, line_user_id) へ移行したら、別アカウントの
    // 行を「移動」せず、このアカウント用のfriend行を新規作成する。
    const now = jstNow();
    await db
      .prepare('UPDATE friends SET line_account_id = ?, is_following = 1, updated_at = ? WHERE id = ?')
      .bind(lineAccountId, now, friend.id)
      .run();
    friend = { ...friend, line_account_id: lineAccountId, is_following: 1, updated_at: now };
  }

  return friend;
}

webhook.post('/webhook', async (c) => {
  // Pre-read size guard: reject before reading the body if Content-Length is oversized.
  const contentLengthHeader = c.req.header('Content-Length');
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_SIZE) {
      return c.json({ status: 'too_large' }, 413);
    }
  }

  const rawBody = await c.req.text();

  // Post-read size guard for the case where Content-Length was absent or untrustworthy.
  // Use UTF-8 byte count: `rawBody.length` counts UTF-16 code units, so multibyte
  // payloads (Japanese/emoji) would otherwise bypass the cap.
  const rawBodyByteLength = new TextEncoder().encode(rawBody).byteLength;
  if (rawBodyByteLength > MAX_WEBHOOK_BODY_SIZE) {
    return c.json({ status: 'too_large' }, 413);
  }

  const signature = c.req.header('X-Line-Signature') ?? '';
  const db = c.env.DB;

  // Cheap pre-reject for unsigned / malformed-signature requests. LINE signatures
  // are HMAC-SHA256 + base64 = 44 chars. This avoids D1 lookups and HMAC compute
  // for junk traffic on a public endpoint.
  const LINE_SIGNATURE_LENGTH = 44;
  if (signature.length !== LINE_SIGNATURE_LENGTH) {
    console.error('Missing or malformed LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  // Verify signature BEFORE JSON.parse so attacker-controlled bodies never reach the parser.
  // Fast path: try env default secret first so malformed/unauthenticated traffic
  //   fails fast without a D1 lookup. The main account is typically also registered
  //   in line_accounts; on env match we still look it up so matchedAccountId binds
  //   correctly for downstream account-scoped filters.
  // Slow path: iterate DB-registered accounts for genuinely multi-account installs.
  let channelAccessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  let matchedAccountId: string | null = null;
  let valid = false;

  const envSecret = c.env.LINE_CHANNEL_SECRET;
  if (envSecret) {
    valid = await verifySignature(envSecret, rawBody, signature);
    if (valid) {
      const accounts = await getLineAccounts(db);
      const main = accounts.find(
        (a) => a.is_active && a.channel_secret === envSecret,
      );
      if (main) {
        channelAccessToken = main.channel_access_token;
        matchedAccountId = main.id;
      }
    }
  }

  if (!valid) {
    const accounts = await getLineAccounts(db);
    for (const account of accounts) {
      if (!account.is_active) continue;
      if (envSecret && account.channel_secret === envSecret) continue; // already tried via fast path
      const isValid = await verifySignature(account.channel_secret, rawBody, signature);
      if (isValid) {
        channelAccessToken = account.channel_access_token;
        matchedAccountId = account.id;
        valid = true;
        break;
      }
    }
  }

  if (!valid) {
    console.error('Invalid LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  let body: WebhookRequestBody;
  try {
    body = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    console.error('Failed to parse webhook body');
    return c.json({ status: 'ok' }, 200);
  }

  const lineClient = new LineClient(channelAccessToken);

  // 非同期処理 — LINE は ~1s 以内のレスポンスを要求
  const processingPromise = processLineWebhookEvents({
    db,
    events: body.events,
    lineAccountId: matchedAccountId,
    handle: (event) => handleEvent(
      db,
      lineClient,
      event,
      channelAccessToken,
      matchedAccountId,
      c.env.WORKER_URL || new URL(c.req.url).origin,
      c.env.LIFF_URL,
      c.env.IMAGES,
      c.env.NEN_EC_BASE_URL && c.env.ECCUBE_WEBHOOK_SECRET
        ? { baseUrl: c.env.NEN_EC_BASE_URL, secret: c.env.ECCUBE_WEBHOOK_SECRET }
        : undefined,
    ),
  });

  c.executionCtx.waitUntil(processingPromise);

  return c.json({ status: 'ok' }, 200);
});

async function handleEvent(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  lineAccessToken: string,
  lineAccountId: string | null = null,
  workerUrl?: string,
  liffUrl?: string,
  r2?: R2Bucket,
  ecommerce?: { baseUrl: string; secret: string },
): Promise<void> {
  if (event.type === 'follow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    console.log({
      event: 'line_webhook_follow_received',
      webhook_event_id: event.webhookEventId,
      line_account_id: lineAccountId,
      event_type: event.type,
    });

    // プロフィール取得 & 友だち登録/更新
    let profile;
    try {
      profile = await lineClient.getProfile(userId);
    } catch (err) {
      logWebhookStepFailure('follow_profile', err, lineAccountId, event);
    }

    const friend = await upsertFriend(db, {
      lineUserId: userId,
      lineAccountId,
      displayName: profile?.displayName ?? null,
      pictureUrl: profile?.pictureUrl ?? null,
      statusMessage: profile?.statusMessage ?? null,
    });
    const friendKind = (friend.unfollow_count ?? 0) > 0 ? 'returning' : 'first_time';

    // V6台帳はWebhookイベント単位。初回流入 friends.ref_code とは分離し、
    // 再追加でも「今回開いたリンク」が取れた場合だけ候補を結び付ける。
    let friendAddEventId: string | null = null;
    /** 台帳の行を作れなかった。送信権を持てないので外部送信はしない。 */
    let friendAddLedgerUnavailable = false;
    if (lineAccountId) {
      try {
        friendAddEventId = await recordFriendAddEvent(db, {
          lineAccountId,
          friendId: friend.id,
          webhookEventId: event.webhookEventId,
          friendKind,
          isUnblockedHint:
            typeof (event as unknown as { follow?: { isUnblocked?: unknown } }).follow?.isUnblocked === 'boolean'
              ? Boolean((event as unknown as { follow: { isUnblocked: boolean } }).follow.isUnblocked)
              : null,
          occurredAt: toJstString(new Date(event.timestamp)),
        });
      } catch (err) {
        /*
         * 台帳の行が作れないと、送信権の予約も結果の記録もできない。
         * ここで送ると、並行する別の実行と二重に届き、しかも記録が
         * 残らないので誰も気づけない。**送らない**（fail-closed）。
         */
        friendAddLedgerUnavailable = true;
        logWebhookStepFailure('friend_add_event_record', err, lineAccountId, event);
      }
    }

    // Set line_account_id for multi-account tracking (always update on follow)
    if (lineAccountId) {
      await db.prepare('UPDATE friends SET line_account_id = ?, updated_at = ? WHERE id = ?')
        .bind(lineAccountId, jstNow(), friend.id).run();
      console.log({
        event: 'line_webhook_friend_account_linked',
        webhook_event_id: event.webhookEventId,
        line_account_id: lineAccountId,
        event_type: event.type,
      });
    }

    // 新規・再フォローのどちらでも、最初の友だち登録マイルを同じキーで非同期投入する。
    // first_followed_at を使うため再フォローやWebhook再送では二重加算されない。
    const firstFollowedAt = friend.first_followed_at ?? friend.created_at;
    await awardActivityMileage(db, {
      eventType: 'friend_registered',
      source: 'line_relationship',
      sourceEventId: `${friend.id}:friend_registered:${firstFollowedAt}`,
      friendId: friend.id,
      subjectKey: friend.id,
      metadata: { lineAccountId },
      occurredAt: firstFollowedAt,
    });

    // Resolve referral link (entry_route) for this friend.
    // /auth/callback (OAuth path) writes friends.ref_code in parallel with
    // this follow webhook, so the field can briefly be NULL when LINE
    // delivers the event. Retry a few times (~1s total) before giving up,
    // otherwise override mode and intro pushes silently fall back to the
    // account default whenever the webhook wins the race.
    const { getFriendById } = await import('@line-crm/db');
    let currentAttribution: { refCode: string; entryRouteId: string | null } | null = null;
    if (friendAddEventId && lineAccountId) {
      for (let attempt = 0; attempt < 5 && !currentAttribution; attempt++) {
        try {
          currentAttribution = await captureFriendAddEventAttribution(db, {
            eventId: friendAddEventId,
            lineAccountId,
            friendId: friend.id,
          });
        } catch (err) {
          logWebhookStepFailure('friend_add_attribution_capture', err, lineAccountId, event);
          break;
        }
        if (!currentAttribution) await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    let friendRefCode = currentAttribution?.refCode
      ?? (friend as { ref_code?: string | null }).ref_code
      ?? null;
    if (!friendRefCode) {
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const refreshed = await getFriendById(db, friend.id);
        const refreshedRef = (refreshed as { ref_code?: string | null } | null)?.ref_code ?? null;
        if (refreshedRef) {
          friendRefCode = refreshedRef;
          break;
        }
      }
    }
    const referralRoute: EntryRoute | null = friendRefCode
      ? await getEntryRouteByRefCode(db, friendRefCode)
      : null;
    const runAccountScenarios =
      !referralRoute || referralRoute.run_account_friend_add_scenarios !== 0;

    // 友だち追加時の配信の振り分け（設計 V2 4-6）。
    //
    // 設定が保存されているアカウントは、相手が「はじめて」か「以前からの友だち・
    // ブロックを解除した人」かを見て、流すシナリオを1本に絞る。
    //
    // **保存されていないアカウントは routed:false が返る。** そのときは下の
    // いままでどおりの経路（有効な friend_add シナリオを全部流す）に落ちる。
    // ここを既定で絞ると、設定していないアカウントで配信が止まる。
    /*
     * 送信権の予約。別webhook IDで並行に届いたfollowは、先に予約を取った
     * 実行だけが振り分け・登録・送信まで進む。取れなかった側は登録自体を
     * 作らず抑止として残す（勝った側が送るため二重にならない）。
     * 予約は振り分けの再送確認より先に取る。確認と登録の間に別の実行が
     * 入ると、送った直後の完了に2件目が被って二重に送ってしまう。
     */
    let sendRight = true;
    let claimedSendRight = false;
    let claimGeneration = 0;
    let claimError = false;
    let fencedOut = false;
    /** 奪い直した予約に、前の持ち主の「送り始めた」印が残っていた。 */
    let previousDispatchUnknown = false;
    /*
     * 送信の結末。**「送っていない」と「送ったか分からない」を分ける。**
     * 分けないと、届いたかもしれない実行を自動で送り直して二重に届く。
     *   none      … 外部送信を試みていない
     *   failed    … LINE が断った（届いていない）。自動再送してよい
     *   unknown   … 通信断・タイムアウト・5xx。届いたかもしれない
     *   delivered … 送れた
     */
    const sendState: { outcome: FollowSendOutcome } = { outcome: 'none' };
    /*
     * 1回のfollowで複数の送信を行う（初回案内・紹介リンクの案内・専用シナリオ・
     * クーポン）。**まとめた結末は「不明」を最優先にする。**
     *
     * 1通が送れたからといって、結末の分からない別の1通が「送れていない」に
     * なるわけではない。不明を成功で上書きすると、その実行を送り終えた扱いに
     * して予約を返してしまい、届いていたかもしれない通を次のfollowが送り直す。
     * 優先順位: unknown > delivered > failed > none。
     */
    const SEND_OUTCOME_RANK: Record<FollowSendOutcome, number> = {
      none: 0, failed: 1, delivered: 2, unknown: 3,
    };
    const noteSendOutcome = (outcome: 'delivered' | 'failed' | 'unknown'): void => {
      if (SEND_OUTCOME_RANK[outcome] > SEND_OUTCOME_RANK[sendState.outcome]) {
        sendState.outcome = outcome;
      }
    };
    const currentSendOutcome = (): FollowSendOutcome => sendState.outcome;
    if (friendAddLedgerUnavailable) {
      // 台帳が作れていない＝送信権を持てない。何も送らない。
      claimError = true;
      sendRight = false;
    } else if (friendAddEventId && lineAccountId) {
      try {
        const claim = await claimFriendAddSendRight(db, {
          lineAccountId,
          friendId: friend.id,
          eventId: friendAddEventId,
        });
        claimedSendRight = claim.held;
        claimGeneration = claim.generation;
        sendRight = claim.held;
        if (claim.held && claim.previousDispatchUnknown) {
          /*
           * 前の持ち主が送信を始めたまま消えていた。届いたかどうか分からない。
           * ここで送り直すと、届いていた人へ2通目が出る。送らない。
           */
          sendRight = false;
          previousDispatchUnknown = true;
        }
      } catch (err) {
        // 予約が取れないときは送らない（fail-closed）。振り分けは抑止側に倒す。
        claimError = true;
        sendRight = false;
        logWebhookStepFailure('friend_add_send_claim', err, lineAccountId, event);
      }
    }
    /*
     * **外部効果の直前に必ず通す関門。**
     *
     * 1文で「まだ予約の持ち主か」を確かめ、同時に貸出期限を延ばす
     * （heartbeat）。確認と延長を分けると、確認したあと送信に時間がかかる
     * 間に期限切れとみなされて別の実行に奪われる。ここを通すたびに期限が
     * 延びるので、処理が長引いても奪われない。
     *
     * `external` を渡すと「送り始めた」印も立てる。途中で消えても、
     * 奪った側がこの印を見て送らないため、二重に届かない。
     * 回収済み・確認できないときは送らない（fail-closed）。
     */
    const holdSendRight = async (options?: { external?: boolean }): Promise<boolean> => {
      if (!sendRight || friendAddEventId == null || lineAccountId == null) return sendRight;
      try {
        const held = await touchFriendAddSendClaim(db, {
          lineAccountId,
          friendId: friend.id,
          eventId: friendAddEventId,
          generation: claimGeneration,
          markDispatching: options?.external === true,
        });
        if (!held) fencedOut = true;
        return held;
      } catch (err) {
        fencedOut = true;
        logWebhookStepFailure('friend_add_send_fence', err, lineAccountId, event);
        return false;
      }
    };
    /*
     * LINE へ渡す再試行キー。予約と関門をすり抜けた万一の同時送信でも、
     * 同じキーの2回目は LINE 側で受け付け済みになり二重に届かない。
     * 友だち・用途ごとに決まる値にする（実行が違っても同じキーになる）。
     */
    const sendRetryKey = (purpose: string): string =>
      stableRetryKey(`friend-add:${lineAccountId ?? 'none'}:${friend.id}:${purpose}`);
    let routing: Awaited<ReturnType<typeof applyFriendAddRouting>> | null = null;
    try {
      routing = runAccountScenarios
          ? await applyFriendAddRouting(db, lineAccountId, friend, {
            defaultAccessToken: lineAccessToken,
            workerUrl,
          }, {
            entryRouteId: currentAttribution?.entryRouteId ?? referralRoute?.id ?? null,
            sendRight,
            claimError,
            dispatchUnknown: previousDispatchUnknown,
            // 登録・アクションも送信と同じ予約の下で行う。
            fence: holdSendRight,
          })
        : null;
    } catch (err) {
      if (friendAddEventId && lineAccountId) {
        try {
          /*
           * 失敗の記録も、勝った側の結果を上書きしないよう同じ予約の下で書く。
           * 予約を持たずに書くと、回収されたあとの実行が勝った側の
           * `completed` を `failed` に塗り替えてしまう。
           */
          await markFriendAddEventRouting(db, {
            eventId: friendAddEventId,
            lineAccountId,
            status: 'failed',
            fence: claimedSendRight && !claimError && claimGeneration > 0
              ? { friendId: friend.id, generation: claimGeneration }
              : undefined,
          });
        } catch (ledgerErr) {
          logWebhookStepFailure('friend_add_event_mark_failed', ledgerErr, lineAccountId, event);
        }
      }
      throw err;
    }
    let scenarioEnrollmentId = routing?.enrollments[0]?.enrollment.id ?? null;
    let friendAddDeliveryCount = 0;

    if (routing?.routed) {
      // 送信権を取れなかった実行は送らずに引く（予約を取った側が送る）。
      for (const { scenarioId, enrollment, resumed } of (sendRight ? routing.enrollments : [])) {
        try {
          // 「前回読んだところから」で再開したぶんは、ここで1通目を出さない。
          // 出すと続きではなく最初の1通がもう一度届く。次の通は
          // next_delivery_at を見て cron が出す。
          if (resumed) continue;
          if (routing.timing !== 'immediate') continue;
          // 回収されていたら古い持ち主として送らない。
          // 送る直前に関門を通す（持ち主の確認・期限の延長・送信の印）。
          if (!(await holdSendRight({ external: true }))) break;
          const sent = await pushImmediateFirstStep(
            db,
            friend.id,
            scenarioId,
            { defaultAccessToken: lineAccessToken, workerUrl },
            {
              enrollment,
              reply: { client: lineClient, replyToken: event.replyToken },
              skipCooldown: true,
              onSendOutcome: noteSendOutcome,
              // 送達不明のまま cron に送り直させない（二重に届く）。
              unknownSendPolicy: 'stop' as const,
              retryKey: sendRetryKey(`routed:${scenarioId}`),
            },
          );
          if (sent) {
            friendAddDeliveryCount += 1;
            console.log(`Immediate delivery (routed): sent scenario ${scenarioId} step 1`);
          }
        } catch (err) {
          logWebhookStepFailure('routed_scenario_delivery', err, lineAccountId, event);
        }
      }
      if (routing.suppressed) {
        console.log(`[friend-add-routing] suppressed (kind=${routing.kind})`);
      }
    }

    // friend_add シナリオに登録（このアカウントのシナリオのみ）
    // Skip entirely when a referral link explicitly overrides (run_account_friend_add_scenarios=0).
    // 振り分け設定があるアカウントはここを通らない（上で1本に絞ってある）。
    const scenarios = runAccountScenarios && !routing?.routed ? await getScenarios(db) : [];
    /*
     * 「友だち追加で始まる」は scenario_triggers から引く（128）。
     * 1本のシナリオに複数のきっかけを持たせられるようにしたため、
     * scenarios.trigger_type は判断に使わない。
     */
    const friendAddIds = scenarios.length > 0 ? new Set(await getFriendAddScenarioIds(db)) : new Set<string>();
    // 送信権を取れなかった実行は送らずに引く（予約を取った側が送る）。
    for (const scenario of (sendRight ? scenarios : [])) {
      // Only trigger scenarios belonging to this account (or unassigned for backward compat)
      const scenarioAccountMatch = !scenario.line_account_id || !lineAccountId || scenario.line_account_id === lineAccountId;
      if (friendAddIds.has(scenario.id) && scenarioAccountMatch) {
        try {
          // 回収されていたら古い持ち主として登録も送信もしない。
          // この経路は登録の直後に送るので、送信の印もここで立てる。
          if (!(await holdSendRight({ external: true }))) break;
          // INSERT OR IGNORE handles dedup via UNIQUE(friend_id, scenario_id)
          const friendScenario = await enrollFriendInScenario(db, friend.id, scenario.id);
          if (!friendScenario) continue; // already enrolled
          scenarioEnrollmentId ??= friendScenario.id;

          // Immediate delivery: step1 が「now 以前」にスケジュールされる場合のみ
          // replyMessage で即時送信する (reply token は無料・push 枠を消費しない)。
          // - relative + delay_minutes=0 → 即時
          // - elapsed + offset_days=0 + offset_minutes=0 → 即時
          // - absolute_time で過去時刻 → computeNextDeliveryAt が now に clamp するので即時
          // reply 失敗時 (2つ目のシナリオで token 消費済み等) は claim が解放され
          // cron が push で配信する。
          // skipCooldown: 60秒以内の再フォロー (前の enrollment が completed 済み)
          // でも必ず welcome を返す — 旧 webhook 実装のセマンティクスを維持。
          const sent = await pushImmediateFirstStep(
            db,
            friend.id,
            scenario.id,
            { defaultAccessToken: lineAccessToken, workerUrl },
            {
              enrollment: friendScenario,
              reply: { client: lineClient, replyToken: event.replyToken },
              skipCooldown: true,
              onSendOutcome: noteSendOutcome,
              // 送達不明のまま cron に送り直させない（二重に届く）。
              unknownSendPolicy: 'stop' as const,
              retryKey: sendRetryKey(`scenario:${scenario.id}`),
            },
          );
          if (sent) {
            friendAddDeliveryCount += 1;
            console.log(`Immediate delivery: sent scenario ${scenario.id} step 1`);
          }
        } catch (err) {
          logWebhookStepFailure('scenario_enrollment', err, lineAccountId, event);
        }
      }
    }

    /*
     * 流入リンクの付随処理（案内の送信・専用シナリオ）と友だち追加クーポン。
     *
     * **どれも外部送信なので、シナリオ配信と同じ送信権の下で行う。**
     * しかも「まとめて1回だけ確認」では足りない。確認したあと前の送信に
     * 時間がかかると、その間に奪われて双方が送る。**外部効果のひとつ手前で
     * 毎回**関門を通し、そのたびに期限を延ばし、送信の印を立てる。
     */
    // Referral link side-effects (intro push + dedicated scenario)
    if (referralRoute) {
      // Intro push from referral link
      if (referralRoute.intro_template_id && await holdSendRight({ external: true })) {
        try {
          const template = await getMessageTemplateById(db, referralRoute.intro_template_id);
          if (template) {
            const message = buildMessage(template.message_type, template.message_content);
            try {
              await lineClient.pushMessage(userId, [message], sendRetryKey(`referral-intro:${referralRoute.id}`));
            } catch (pushErr) {
              // 4xx は届いていない。それ以外は届いたかもしれない（送達不明）。
              noteSendOutcome(classifyFollowSendFailure(pushErr));
              throw pushErr;
            }
            noteSendOutcome('delivered');
            console.log(`[follow] referral intro push sent route=${referralRoute.id}`);
          }
        } catch (err) {
          logWebhookStepFailure('referral_intro_push', err, lineAccountId, event);
        }
      }

      // Dedicated scenario enrollment from referral link. A delay-0 first
      // step is pushed immediately (same instant-welcome semantics as
      // friend_add / tag_added enrollments — previously this path always
      // waited for the next cron tick). pushMessage, not reply: the reply
      // token may already be consumed by an account friend_add scenario
      // above, and the intro push on this path uses pushMessage too.
      if (referralRoute.scenario_id && await holdSendRight()) {
        try {
          const enrollment = await enrollFriendInScenario(db, friend.id, referralRoute.scenario_id);
          console.log(`[follow] referral scenario enrolled scenario=${referralRoute.scenario_id}`);
          if (enrollment && await holdSendRight({ external: true })) {
            await pushImmediateFirstStep(
              db,
              friend.id,
              referralRoute.scenario_id,
              { defaultAccessToken: lineAccessToken, workerUrl },
              {
                enrollment,
                onSendOutcome: noteSendOutcome,
                // 送達不明のまま cron に送り直させない（二重に届く）。
                unknownSendPolicy: 'stop' as const,
                retryKey: sendRetryKey(`referral-scenario:${referralRoute.scenario_id}`),
              },
            );
          }
        } catch (err) {
          logWebhookStepFailure('referral_scenario_enrollment', err, lineAccountId, event);
        }
      }
    }

    // NENの友だち追加クーポンは、アカウント別設定が有効な場合だけ初回追加時に発行する。
    // 再フォローとWebhook再送は発行台帳の一意制約でも二重発行を防ぐ。
    if ('first_time' === friendKind && lineAccountId && ecommerce && await holdSendRight({ external: true })) {
      try {
        await issueFriendAddCoupon(db, {
          lineAccountId,
          friendId: friend.id,
          now: new Date(event.timestamp),
        }, {
          createCoupon: (coupon) => createEccubeCoupon(ecommerce.baseUrl, ecommerce.secret, coupon),
          sendText: async (text) => {
            // クーポンの本文も外部送信。直前に関門を通し、結末を分けて残す。
            if (!(await holdSendRight({ external: true }))) {
              // 送信権を失った。**送っていない**ので、クーポンの状態は変えさせない。
              throw Object.assign(new Error('friend_add_coupon_fenced_out'), {
                friendAddSendAborted: true,
              });
            }
            try {
              await lineClient.pushMessage(userId, [{ type: 'text', text }], sendRetryKey('coupon'));
            } catch (pushErr) {
              noteSendOutcome(classifyFollowSendFailure(pushErr));
              throw pushErr;
            }
            noteSendOutcome('delivered');
          },
          // 送ったか分からないときは、次の追加で送り直さない（届いていたら2通目になる）。
          classifySendFailure: classifyFollowSendFailure,
        });
      } catch (err) {
        logWebhookStepFailure('friend_add_coupon', err, lineAccountId, event);
      }
    }

    /*
     * 台帳の確定。
     *
     * 予約を持って進んだ実行は、**確定の1文の中で**持ち主かを確かめる
     * （markFriendAddEventRouting の fence）。確かめてから書く2文にすると
     * その隙に回収されて、古い持ち主が結果を上書きできる。
     *
     * 状態と理由の決め方:
     *   送れた                   … completed（再送制限が数える）
     *   送ったか分からない       … partial_failed / delivery_unknown
     *                              **自動再送しない。** 送り直すと二重に届く。
     *   送っていない・断られた   … partial_failed / send_failed（再送できる）
     *   条件などで送らなかった   … suppressed（理由つき）
     */
    const delivered = friendAddDeliveryCount > 0;
    /*
     * **結末の分からない送信が1つでもあれば送達不明。** 別の通が送れていても
     * 変わらない。ここで「送れた」に丸めると予約を返してしまい、不明だった
     * 通を次のfollowが送り直す。
     */
    const deliveryUnknown = currentSendOutcome() === 'unknown';
    const ledgerErrorCode = routing?.suppressReason
      ?? (claimError
        ? 'send_claim_unavailable'
        : (previousDispatchUnknown
          ? 'delivery_unknown'
          : (!sendRight
            ? 'duplicate_in_flight'
            : (deliveryUnknown ? 'delivery_unknown' : (delivered ? null : 'send_failed')))));
    let ledgerFinalized = false;
    if (friendAddEventId && lineAccountId && !fencedOut) {
      try {
        ledgerFinalized = await markFriendAddEventRouting(db, {
          eventId: friendAddEventId,
          lineAccountId,
          status: routing?.suppressed ? 'suppressed' : (delivered ? 'completed' : 'partial_failed'),
          routingRuleId: routing?.ruleId ?? null,
          winningRuleVersionId: routing?.ruleVersionId ?? null,
          errorCode: ledgerErrorCode,
          scenarioEnrollmentId,
          deliveryCount: friendAddDeliveryCount,
          // 予約を持って進んだ実行だけ、同じ予約の下で確定する。
          fence: claimedSendRight && !claimError && claimGeneration > 0
            ? { friendId: friend.id, generation: claimGeneration }
            : undefined,
        });
        if (!ledgerFinalized) {
          // 回収されていた。勝った側が確定するのでここでは何も書かない。
          fencedOut = true;
          console.warn('[friend-add] ledger finalize fenced out (send right revoked)');
        }
      } catch (err) {
        logWebhookStepFailure('friend_add_event_mark_complete', err, lineAccountId, event);
      }
    }

    /*
     * 予約の解放。
     *
     * 台帳を確定できて、かつ**送達不明でない**ときだけ返す。
     * 送達不明のまま返すと、次のfollowが予約を取って送り直し、
     * 二重に届く。掴んだまま残し、TTL を過ぎるまで別の実行を止める。
     * 確定できなかった実行（送信後にDBが落ちた等）も掴んだままにする。
     */
    if (
      claimedSendRight && !claimError && ledgerFinalized && !deliveryUnknown
      // 前の持ち主が送り始めた印が残っている予約は返さない。返すと次の
      // follow が取って送り直し、届いていた人へ2通目が出る。
      && !previousDispatchUnknown
      && friendAddEventId && lineAccountId
    ) {
      try {
        await releaseFriendAddSendRight(db, {
          lineAccountId,
          friendId: friend.id,
          eventId: friendAddEventId,
          generation: claimGeneration,
        });
      } catch (err) {
        logWebhookStepFailure('friend_add_send_release', err, lineAccountId, event);
      }
    }

    // イベントバス発火: friend_add（replyToken は Step 0 で使用済みの可能性あり）
    await fireEvent(db, 'friend_add', {
      sourceEventId: event.webhookEventId,
      sourceKind: 'line_webhook',
      occurredAt: new Date(event.timestamp).toISOString(),
      friendId: friend.id,
      eventData: {
        displayName: friend.display_name,
        friendKind,
        attributionStatus: currentAttribution ? 'captured' : 'unavailable',
      },
    }, lineAccessToken, lineAccountId);
    return;
  }

  if (event.type === 'unfollow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    const friend = await getFriendByLineUserIdForAccount(db, userId, lineAccountId);
    await updateFriendFollowStatus(db, userId, false, lineAccountId);
    await recordWebhookAnalyticsEvent(db, lineAccountId, event, {
      friendId: friend?.id,
      eventType: 'friend_unfollow',
    });
    if (friend) {
      await fireEvent(db, 'friend_unfollow', {
        sourceEventId: event.webhookEventId,
        sourceKind: 'line_webhook',
        occurredAt: new Date(event.timestamp).toISOString(),
        friendId: friend.id,
      }, lineAccessToken, lineAccountId);
    }
    return;
  }

  // Postback events — triggered by Flex buttons with action.type: "postback"
  // Uses the same auto_replies matching but without displaying text in chat
  if (event.type === 'postback') {
    const userId = event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    const friend = await ensureFriendFromWebhookUser(db, lineClient, userId, lineAccountId);
    if (!friend) return;

    const rawPostbackData = (event as unknown as { postback: { data: string } }).postback.data;

    /*
     * リッチメニューのボタン。
     *
     * どのボタンが押されたかを知るために、publish のときに data の先頭へ area の
     * id を付けている。ここで剥がして、運用者が設定した本来の data だけを下流へ流す。
     * 自動応答やオートメーションは「data がこの文字列と一致したら」で判定しているので、
     * こちらの都合で付けた目印を混ぜたままにすると、今まで当たっていた条件に
     * 当たらなくなる。
     *
     * 剥がすついでに、そのボタンに設定された動き（タグ付け・スコア加算・
     * テンプレート送信）をここで実行する。
     */
    /*
     * カルーセルの選択肢。
     *
     * リッチメニューと同じ考え方で、data にテンプレートと選択肢の番号を入れて
     * ある。押されたら、その選択肢に設定されたアクションを実行する。
     * 「1人につき1回まで」の制限にかかっていれば、決めたテキストを返して終わる。
     */
    const carouselTap = parseCarouselPostbackData(rawPostbackData);
    if (carouselTap) {
      await recordWebhookAnalyticsEvent(db, lineAccountId, event, {
        friendId: friend.id,
        eventType: 'postback_received',
        dimensions: { matched: true },
      });
      try {
        const result = await handleCarouselTap(db, lineClient, friend, carouselTap, {
          lineAccountId,
          replyToken: event.replyToken,
        });
        // 制限にかかったときは、ここで終わる。自動応答まで回すと、
        // 「もう押せません」と自動応答の両方が届く。
        if (result.kind === 'blocked') return;
      } catch (err) {
        logWebhookStepFailure('carousel_tap', err, lineAccountId, event);
      }
      // カルーセルの data は運用者が組んだ文字列ではないので、自動応答の
      // キーワード照合には回さない。
      return;
    }

    const tap = parseTapPostbackData(rawPostbackData);
    let postbackReplyToken: string | undefined = event.replyToken;
    let tapLabel: string | null = null;
    if (tap) {
      try {
        const tapResult = await handleRichMenuTap(db, lineClient, friend, tap.areaId, {
          lineAccountId,
          replyToken: postbackReplyToken,
        });
        if (tapResult.replyTokenConsumed) postbackReplyToken = undefined;
        tapLabel = tapResult.target?.label ?? null;
      } catch (err) {
        // ボタンの動きが失敗しても、下の自動応答までは止めない。
        logWebhookStepFailure('rich_menu_tap', err, lineAccountId, event);
      }
    }
    const postbackData = tap ? (tap.inner ?? '') : rawPostbackData;
    // 押されたボタンに本来の data が無い（テンプレートを送るだけ等）ときは、
    // トーク履歴に空行を残さないようボタン名を出す。
    const postbackLogText =
      postbackData || (tapLabel ? `[メニュー] ${tapLabel}` : '[メニュー]');

    /*
     * シナリオの質問メッセージの選択肢。
     *
     * data が `sq:<stepId>:<index>` の形なら、こちらで処理して抜ける。
     * auto_replies のキーワード照合には回さない。`sq:...` は利用者が
     * 打った言葉ではないので、キーワードに当たっても意味がない。
     *
     * 記録も向こうで取る（押した回数を数えるのに、記録より先に読む必要が
     * あるため）。
     */
    const questionHit = parseQuestionPostback(postbackData);
    if (questionHit) {
      const answered = await handleQuestionAnswer(
        db,
        lineClient,
        friend,
        { ...questionHit, lineAccountId },
        postbackReplyToken,
      );
      if (answered.handled) {
        await fireEvent(db, 'postback_received', {
          sourceEventId: event.webhookEventId,
          sourceKind: 'line_webhook',
          occurredAt: new Date(event.timestamp).toISOString(),
          friendId: friend.id,
          eventData: { text: postbackData, matched: true },
          replyToken: answered.replyTokenConsumed ? undefined : postbackReplyToken,
        }, lineAccessToken, lineAccountId);
        return;
      }
    }

    // postback の incoming 自体を messages_log に記録する。Rich Menu のタップで
    // 利用者が "コスト比較" などのアクションを起こした事実を chat 履歴で可視化する。
    // delivery_type='push' は厳密には push ではないが、incoming/non-test として
    // 既存 chat list / 詳細 SQL のフィルタを通すための妥当な値 (auto_reply text 同様)。
    let postbackIncomingLogId: string | null = crypto.randomUUID();
    try {
      await db
        .prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
           VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, 'postback', ?, ?)`,
        )
        .bind(postbackIncomingLogId, friend.id, postbackLogText, lineAccountId ?? null, jstNow())
        .run();
    } catch (err) {
      postbackIncomingLogId = null;
      logWebhookStepFailure('incoming_postback_log', err, lineAccountId, event);
    }

    // postback data を auto_replies にマッチさせて返信 (テキスト経路と共通)。
    // silent + automation で「返信なしでタグだけ付ける」構成もここで成立する。
    // 本来の data が無いボタン（テンプレートを送るだけ等）は、自動応答の
    // キーワード照合に回さない。空文字はどのキーワードとも照らし合わせようがない。
    // 返信の権利（replyToken）を先にテンプレート送信で使い切っている場合も回さない。
    // 自動応答は reply でしか返せないので、使い切った後に呼ぶと送信が失敗する。
    const { matched: postbackMatched, replyTokenConsumed: postbackReplyTokenConsumed } =
      postbackData && postbackReplyToken
        ? await matchAndReply(db, lineClient, friend, postbackData, postbackReplyToken, {
            lineAccountId,
            workerUrl,
            logContext: 'postback',
            messageKind: 'postback',
            incomingEventId: event.webhookEventId,
            incomingMessageLogId: postbackIncomingLogId,
            occurredAt: new Date(event.timestamp).toISOString(),
          })
        : { matched: false, replyTokenConsumed: false };

    // イベントバス発火: 専用イベント postback_received。
    // postback.data を text に載せることで、IF-THEN 自動化の keyword /
    // keyword_exact 条件がリッチメニューのタップ（タグ付与等）に効く。
    // message_received を流用しないのは意図的 — 流用すると既存インストールの
    // message_received スコアリング・catch-all 自動化・送信 Webhook 購読者が
    // メニュータップで誤発火し、条件側に source を見る術がないため。
    // なお upsertChatOnMessage は呼ばない: メニュータップは自発メッセージでは
    // ないので、未対応 inbox を汚さないのが正しい (テキスト経路との意図的な差分)。
    await fireEvent(db, 'postback_received', {
      sourceEventId: event.webhookEventId,
      sourceKind: 'line_webhook',
      occurredAt: new Date(event.timestamp).toISOString(),
      friendId: friend.id,
      // data が無いボタンでも、ボタン名でオートメーションを組めるようにする。
      eventData: { text: postbackData || tapLabel || '', matched: postbackMatched },
      replyToken: postbackReplyTokenConsumed ? undefined : postbackReplyToken,
    }, lineAccessToken, lineAccountId);

    return;
  }

  // 非テキストの受信メッセージ（スタンプ/画像/音声/動画/ファイル/位置情報等）もログに残す。
  // N-082: ログ・受信箱・メディア保存はそのままに、自動応答の種別条件へ渡す。
  // 本文は捏造せず空文字で評価するため、キーワード条件のルールは当たらない。
  // 種別 + 時間帯等の条件で絞ったルール（例: 画像に定型文を返す）のみが動く。
  if (event.type === 'message' && event.message.type !== 'text') {
    const userId = event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;
    const friend = await ensureFriendFromWebhookUser(db, lineClient, userId, lineAccountId);
    if (!friend) return;

    const msg = event.message as {
      id: string;
      type: string;
      fileName?: string;
      title?: string;
      packageId?: string | number;
      package_id?: string | number;
      stickerId?: string | number;
      sticker_id?: string | number;
      stickerResourceType?: string | number;
      sticker_resource_type?: string | number;
    };
    const labels: Record<string, string> = {
      sticker: '[スタンプ]',
      image: '[画像]',
      audio: '[音声]',
      video: '[動画]',
      file: msg.fileName ? `[ファイル: ${msg.fileName}]` : '[ファイル]',
      location: msg.title ? `[位置情報: ${msg.title}]` : '[位置情報]',
    };
    const content = labels[msg.type] ?? `[${msg.type}]`;

    // image の場合は LINE Content API でバイナリを取得 → R2 → JSON URL に置換。
    // 失敗時は labels[msg.type] のラベル文字列のまま (フォールバック)。
    let finalContent = content;
    if (msg.type === 'sticker') {
      const stickerContent = createStickerMessageContent(msg);
      if (stickerContent) {
        finalContent = JSON.stringify(stickerContent);
      }
    }
    if (msg.type === 'image' && r2 && workerUrl) {
      const lineMessageId = msg.id;
      const { fetchAndStoreIncomingImage } = await import('../services/incoming-image.js');
      const refs = await fetchAndStoreIncomingImage({
        r2,
        workerUrl,
        channelAccessToken: lineAccessToken,
        accountId: lineAccountId ?? 'unknown',
        messageId: lineMessageId,
      });
      if (refs) {
        finalContent = JSON.stringify(refs);
      }
    }

    const logId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
         VALUES (?, ?, 'incoming', ?, ?, NULL, NULL, 'user', ?, ?)`,
      )
      .bind(logId, friend.id, msg.type, finalContent, lineAccountId, jstNow())
      .run();
    await awardActivityMileage(db, {
      eventType: 'message_received',
      source: 'line',
      sourceEventId: logId,
      friendId: friend.id,
      metadata: { messageType: msg.type },
    });
    // 自動応答の評価へ渡す。重複抑止・停止中除外・別アカウント分離は
    // 既存の matchAndReply が担う。replyToken はメッセージイベントに付く。
    const { matched: nonTextMatched } = await matchAndReply(
      db,
      lineClient,
      friend,
      '',
      event.replyToken,
      {
        lineAccountId,
        workerUrl,
        logContext: 'non-text-message',
        messageKind: msg.type,
        incomingEventId: event.webhookEventId,
        incomingMessageLogId: logId,
        occurredAt: new Date(event.timestamp).toISOString(),
      },
    );

    // 自動応答に当たらなかった自発メッセージだけ chat を unread に戻す
    // （テキスト経路と同じ扱い）。これが無いと resolved 除外
    // (unanswered-inbox CANDIDATES_SQL) が「解決済み後に画像だけ送ってきた
    // 友だち」をバッジ・未対応一覧から永久に落としてしまう。
    if (!nonTextMatched) {
      await upsertChatOnMessage(db, friend.id);
    }
    await recordWebhookAnalyticsEvent(db, lineAccountId, event, {
      friendId: friend.id,
      eventType: 'message_received',
      dimensions: { messageType: msg.type, matched: nonTextMatched },
    });
    return;
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const textMessage = event.message as TextEventMessage;
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    const friend = await ensureFriendFromWebhookUser(db, lineClient, userId, lineAccountId);
    if (!friend) return;

    const incomingText = textMessage.text;
    const now = jstNow();
    const logId = crypto.randomUUID();

    // 受信メッセージをログに記録
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
         VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, 'user', ?, ?)`,
      )
      .bind(logId, friend.id, incomingText, lineAccountId, now)
      .run();

    await awardActivityMileage(db, {
      eventType: 'message_received',
      source: 'line',
      sourceEventId: logId,
      friendId: friend.id,
      metadata: { messageType: 'text' },
      occurredAt: now,
    });

    // Cross-account trigger: send message from another account via UUID
    if (incomingText === '体験を完了する' && lineAccountId) {
      try {
        const friendRecord = await db.prepare('SELECT user_id FROM friends WHERE id = ?').bind(friend.id).first<{ user_id: string | null }>();
        if (friendRecord?.user_id) {
          // Find the same user on other accounts
          const otherFriends = await db.prepare(
            'SELECT f.line_user_id, f.line_account_id, la.channel_access_token, la.channel_access_token_encrypted FROM friends f INNER JOIN line_accounts la ON la.id = f.line_account_id WHERE f.user_id = ? AND f.line_account_id != ? AND f.is_following = 1'
          ).bind(friendRecord.user_id, lineAccountId).all<{ line_user_id: string; line_account_id: string; channel_access_token: string; channel_access_token_encrypted: string | null }>();

          for (const other of otherFriends.results) {
            const accessToken = await resolveLineCredential(
              other.channel_access_token_encrypted,
              other.channel_access_token,
              { lineAccountId: other.line_account_id, field: 'channel_access_token' },
            );
            const otherClient = new LineClient(accessToken);
            await otherClient.pushMessage(other.line_user_id, [buildMessage('flex', JSON.stringify({
              type: 'bubble', size: 'giga',
              header: { type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#fffbeb',
                contents: [{ type: 'text', text: `${friend.display_name || ''}さんへ`, size: 'lg', weight: 'bold', color: '#1e293b' }],
              },
              body: { type: 'box', layout: 'vertical', paddingAll: '20px',
                contents: [
                  { type: 'text', text: '別アカウントからのアクションを検知しました。', size: 'sm', color: '#06C755', weight: 'bold', wrap: true },
                  { type: 'text', text: 'アカウント連携が正常に動作しています。体験ありがとうございました。', size: 'sm', color: '#1e293b', wrap: true, margin: 'md' },
                  { type: 'separator', margin: 'lg' },
                  { type: 'text', text: 'ステップ配信・フォーム即返信・アカウント連携・リッチメニュー・自動返信 — 全て無料、全てOSS。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
                ],
              },
              footer: { type: 'box', layout: 'vertical', paddingAll: '16px',
                contents: [
                  { type: 'button', action: { type: 'message', label: '導入について相談する', text: '導入支援を希望します' }, style: 'primary', color: '#06C755' },
                  ...(liffUrl ? [{ type: 'button', action: { type: 'uri', label: 'フィードバックを送る', uri: `${liffUrl}?page=form` }, style: 'secondary', margin: 'sm' }] : []),
                ],
              },
            }))]);
          }

          // Reply on Account ② confirming
          await lineClient.replyMessage(event.replyToken, [buildMessage('flex', JSON.stringify({
            type: 'bubble',
            body: { type: 'box', layout: 'vertical', paddingAll: '20px',
              contents: [
                { type: 'text', text: 'Account ① にメッセージを送りました', size: 'sm', color: '#06C755', weight: 'bold', align: 'center' },
                { type: 'text', text: 'Account ① のトーク画面を確認してください', size: 'xs', color: '#64748b', align: 'center', margin: 'md' },
              ],
            },
          }))]);
          return;
        }
      } catch (err) {
        logWebhookStepFailure('cross_account_trigger', err, lineAccountId, event);
      }
    }

    // 自動返信チェック（このアカウントのルール + グローバルルールのみ）。
    // silent タイプは返信しないが matched=true になり unread / push を抑止する。
    const { matched, replyTokenConsumed } = await matchAndReply(
      db,
      lineClient,
      friend,
      incomingText,
      event.replyToken,
      // 種別は LINE から届いたものをそのまま渡す。ルール側で
      // 「画像には返さない」といった絞り込みができる。
      {
        lineAccountId,
        workerUrl,
        messageKind: event.message?.type ?? 'text',
        incomingEventId: event.webhookEventId,
        incomingMessageLogId: logId,
        occurredAt: new Date(event.timestamp).toISOString(),
      },
    );

    // auto_replies にマッチしなかった = 自発メッセージ → unread にする
    if (!matched) {
      await upsertChatOnMessage(db, friend.id);
    }

    // イベントバス発火: message_received
    // Pass replyToken only when auto_reply didn't actually consume it
    await fireEvent(db, 'message_received', {
      sourceEventId: event.webhookEventId,
      sourceKind: 'line_webhook',
      occurredAt: new Date(event.timestamp).toISOString(),
      friendId: friend.id,
      eventData: { text: incomingText, matched },
      replyToken: replyTokenConsumed ? undefined : event.replyToken,
    }, lineAccessToken, lineAccountId);

    return;
  }
}

/**
 * follow の外部送信の結末。「送っていない」と「送ったか分からない」を
 * 分けて持つ。分けないと、届いたかもしれない実行を自動で送り直す。
 */
type FollowSendOutcome = 'none' | 'failed' | 'unknown' | 'delivered';

/**
 * 送信の例外を「届いていない」と「届いたかもしれない」に分ける。
 * LINE が 4xx で断ったときは受け付けられていないので届いていない。
 * 通信断・タイムアウト・429・5xx は結果を知らないだけで届いていることがある。
 */
function classifyFollowSendFailure(error: unknown): 'failed' | 'unknown' {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) return 'failed';
  return 'unknown';
}

/**
 * 同じ意味の送信に、実行が違っても同じ値になるキーを作る（`X-Line-Retry-Key`）。
 * LINE は同じキーの2回目を受け付け済みとして扱うので、予約と関門をすり抜けた
 * 万一の同時送信でも二重に届かない。UUID の形にそろえる。
 */
function stableRetryKey(seed: string): string {
  // FNV-1a を4本、別の初期値で回して128bitぶんの桁を作る。
  const offsets = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  const words = offsets.map((offset) => {
    let hash = offset >>> 0;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  });
  const hex = words.join('');
  return [
    hex.slice(0, 8), hex.slice(8, 12), `4${hex.slice(13, 16)}`,
    `${((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

export { webhook };
