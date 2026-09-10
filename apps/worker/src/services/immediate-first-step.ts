import {
  getScenarioById,
  getScenarioPublishedVersion,
  getStepsForDelivery,
  scenarioStepExists,
  getFriendById,
  computeNextDeliveryAt,
  advanceFriendScenario,
  completeFriendScenario,
  claimFriendScenarioForDelivery,
  enrollFriendInScenario,
  getLineAccountByChannelId,
  getLineAccountById,
  addTagToFriend,
  jstNow,
  toJstString,
} from '@line-crm/db';
import type { PinnedScenarioStep, ScenarioDeliverySource } from '@line-crm/db';
import { LineClient, type Message } from '@line-crm/line-sdk';
import {
  buildMessage,
  expandVariables,
  resolveMetadata,
  messageToLogPayload,
} from './step-delivery.js';
import { decorateForFriendPush } from './auto-track.js';
import { resolveInterpolationExtra } from './interpolation-context.js';
import { buildQuestionMessages, parseQuestion } from './scenario-question.js';

export interface ImmediatePushContext {
  defaultAccessToken: string;
  /** Base URL for {{...}} / {{auth_url:...}} link expansion. Pass the env
   *  WORKER_URL whenever it is in scope; undefined leaves those variables
   *  unexpanded (matching expandVariables' own fallback). */
  workerUrl?: string;
  accountChannelId?: string | null;
}

export interface EnrollmentRef {
  id: string;
  current_step_order: number;
  /** 開始時に固定した公開版。無いときは購読行から読み直す。 */
  published_version_id?: string | null;
}

export interface ImmediatePushOptions {
  /**
   * - 'once' (default): exactly-once with the cron via the claim protocol.
   *   The enrollment must already exist (caller-supplied or looked up) and
   *   still be at a step before step 1.
   * - 'every-click': click-campaign semantics (tracked link / entry route).
   *   Pushes on EVERY hit — re-clicks included — enrolling the friend itself
   *   (INSERT OR IGNORE). When the enrollment still owes step 1 it is
   *   CLAIMED like 'once' (fencing the cron and any concurrent follow-path
   *   sender); a failed claim means someone else is delivering right now, so
   *   the click is skipped instead of double-sending. Re-clicks on an
   *   already-advanced enrollment push without touching the row.
   */
  mode?: 'once' | 'every-click';
  /** Pre-created enrollment ('once' mode) — skips the lookup query. */
  enrollment?: EnrollmentRef | null;
  /**
   * Push target override. LIFF/OAuth callers know the LINE user id from the
   * id_token before the friend row is fully wired; without this the push
   * requires friend.line_user_id.
   */
  targetLineUserId?: string;
  /**
   * Send through the follow event's reply token (free, no push quota)
   * instead of resolving an access token and pushing. On failure the claim
   * is released so the cron delivers by push on schedule. messages_log
   * rows are stamped delivery_type='reply' automatically.
   */
  reply?: { client: Pick<LineClient, 'replyMessage'>; replyToken: string };
  /**
   * Skip the 60s messages_log duplicate probe. The follow-webhook friend_add
   * path sets this to preserve its historical semantics: a re-follow within
   * 60s of the previous welcome (possible once the prior enrollment
   * completed) must still be answered — the fresh INSERT + claim already
   * fence every same-flow race there.
   */
  skipCooldown?: boolean;
}

/**
 * Push a scenario's delay-0 first step to a friend RIGHT NOW — no cron wait —
 * then advance the enrollment so the delivery worker never re-sends step 1.
 *
 * Single implementation behind every instant-first-message entry point:
 * tag-triggered enrollment (friend-tag-attach), the click-campaign block in
 * applyRefAttribution (liff.ts), the follow-webhook friend_add /
 * referral-route enrollments, and the OAuth /auth/callback friend_add
 * auto-enroll loop (liff.ts).
 *
 * Exactly-once with the cron: the enrollment is CLAIMED
 * (claimFriendScenarioForDelivery, status active→delivering) before any
 * network call, using the same optimistic lock the cron delivery worker
 * uses — whichever side claims first owns step 1, the other backs off.
 * advance/complete after the push releases the claim (status back to
 * active / completed).
 *
 * Other guards:
 * - paused scenarios (is_active = 0) never send — same gate as the cron and
 *   the friend_add / tag_added trigger loops
 * - non-immediate first steps (delay > 0 / clock-time modes) return before
 *   claiming/enrolling — cron owns those untouched
 * - a 60s messages_log cooldown catches a racing sender the claim can't see
 *   (a different enrollment row, or a send logged before this row existed);
 *   in 'once' mode a cooldown hit advances WITHOUT pushing (and still
 *   attaches the reach tag — the racer delivered the step) so the fresh row
 *   is never re-delivered by the cron, in 'every-click' mode it simply skips
 * - unresolvable push target releases the claim so the cron can retry on
 *   schedule
 * - an unexpected throw after a successful send still advances the
 *   enrollment (best effort) so the cron cannot re-send; a throw before the
 *   send releases the claim instead of stranding the row in 'delivering'
 *   until the stuck-delivery sweep
 *
 * Returns true when a message was actually sent.
 */
export async function pushImmediateFirstStep(
  db: D1Database,
  friendId: string,
  scenarioId: string,
  ctx: ImmediatePushContext,
  options?: ImmediatePushOptions,
): Promise<boolean> {
  const mode = options?.mode ?? 'once';
  // Function-scope so the outer catch can settle a half-finished delivery.
  let claimedEnrollmentId: string | null = null;
  let sent = false;
  let settleAfterSend: (() => Promise<void>) | null = null;
  try {
    const scenarioRow = await getScenarioById(db, scenarioId);
    if (!scenarioRow) return false;
    // Paused scenarios never send. The cron's due-for-delivery query and the
    // friend_add / tag_added trigger loops all gate on is_active; without
    // this an entry route pointing at a deactivated campaign would still
    // instant-push its first step.
    if (!scenarioRow.is_active) return false;

    // 送る1通目は、購読開始時に固定した公開版だけから読む（351）。live の
    // 下書き表は読まない。版が無い・欠損しているときは送らない。
    const loadPinnedFirstStep = async (
      pinnedVersionId: string | null | undefined,
    ): Promise<{ source: ScenarioDeliverySource; firstStep: PinnedScenarioStep } | null> => {
      const source = await getStepsForDelivery(db, scenarioId, pinnedVersionId ?? null);
      if (!source) return null;
      const liveSteps = source.steps.filter((s) => (s.is_draft ?? 0) === 0);
      const firstStep = liveSteps[0];
      if (!firstStep) return null;
      return { source, firstStep };
    };

    const resolveEnrollmentVersionId = async (
      enrollment: EnrollmentRef,
    ): Promise<string | null> => {
      if (enrollment.published_version_id) return enrollment.published_version_id;
      const row = await db
        .prepare(`SELECT published_version_id FROM friend_scenarios WHERE id = ?`)
        .bind(enrollment.id)
        .first<{ published_version_id: string | null }>();
      return row?.published_version_id ?? null;
    };

    // Cooldown probe: a racing sender the claim protocol can't see may have
    // just pushed this exact step (click campaign vs follow webhook, double
    // LIFF load, …). Identity is the version-owned step id — deleting and
    // re-creating the draft step must not lose the dedup. The live-step leg
    // covers sends logged before versions existed.
    const isRecentDuplicate = async (firstStep: PinnedScenarioStep): Promise<boolean> => {
      const cutoff = toJstString(new Date(Date.now() - 60_000));
      const recent = await db
        .prepare(
          `SELECT 1 FROM messages_log
           WHERE friend_id = ? AND (scenario_version_step_id = ? OR scenario_step_id = ?)
             AND direction = 'outgoing' AND created_at > ?
           LIMIT 1`,
        )
        .bind(friendId, firstStep.id, firstStep.live_step_id ?? firstStep.id, cutoff)
        .first();
      return recent !== null;
    };

    const lookupEnrollment = () =>
      db
        .prepare(
          `SELECT id, current_step_order, published_version_id FROM friend_scenarios
           WHERE friend_id = ? AND scenario_id = ? AND status != 'completed'
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .bind(friendId, scenarioId)
        .first<EnrollmentRef>();

    const advancePastFirstStep = async (
      enrollmentId: string,
      source: ScenarioDeliverySource,
      firstStep: PinnedScenarioStep,
    ) => {
      const nextStep = source.steps.filter((s) => (s.is_draft ?? 0) === 0)[1];
      if (nextStep) {
        const next = computeNextDeliveryAt(
          { delivery_mode: source.deliveryMode },
          nextStep,
          { enrolledAt: enrolledAtJst, previousDeliveredAt: enrolledAtJst, now: enrolledAtJst },
        );
        // `next` is already in the shifted-JST frame (its inputs were
        // Date.now()+9h), so serialize by relabeling — NOT toJstString(),
        // which would add the offset a second time and schedule step 2
        // nine hours late. Matches enrollFriendInScenario / the cron.
        await advanceFriendScenario(
          db,
          enrollmentId,
          firstStep.step_order,
          next.toISOString().slice(0, -1) + '+09:00',
        );
      } else {
        await completeFriendScenario(db, enrollmentId);
      }
    };

    const attachReachTag = async (firstStep: PinnedScenarioStep) => {
      if (!firstStep.on_reach_tag_id) return;
      try {
        await addTagToFriend(db, friendId, firstStep.on_reach_tag_id);
      } catch (err) {
        console.error(`[immediate-first-step] tag attach failed step=${firstStep.id}:`, err);
      }
    };

    // Immediate only: delay-0 relative steps schedule at-or-before "now".
    // elapsed/absolute_time modes have offset/clock-time semantics — cron
    // owns those. Checked BEFORE claiming/enrolling so non-immediate
    // enrollments are left untouched.
    const enrolledAtJst = new Date(Date.now() + 9 * 60 * 60_000);
    const isImmediate = (source: ScenarioDeliverySource, firstStep: PinnedScenarioStep) => {
      const firstScheduledAt = computeNextDeliveryAt(
        { delivery_mode: source.deliveryMode },
        firstStep,
        { enrolledAt: enrolledAtJst, previousDeliveredAt: enrolledAtJst, now: enrolledAtJst },
      );
      return firstScheduledAt.getTime() <= enrolledAtJst.getTime();
    };

    // Which row to advance after a successful send (null = pure re-click
    // re-delivery: the row is already past step 1, leave it alone).
    let advanceTargetId: string | null = null;
    let pinned: { source: ScenarioDeliverySource; firstStep: PinnedScenarioStep } | null = null;

    if (mode === 'once') {
      const enrollmentRow = options?.enrollment ?? (await lookupEnrollment());
      if (!enrollmentRow) return false;
      pinned = await loadPinnedFirstStep(await resolveEnrollmentVersionId(enrollmentRow));
      if (!pinned) return false;
      if (enrollmentRow.current_step_order >= pinned.firstStep.step_order) return false;
      if (!isImmediate(pinned.source, pinned.firstStep)) return false;

      // Optimistic lock shared with the cron worker: whoever claims first
      // delivers step 1; the loser backs off. Closes the double-send window
      // between the enrollment INSERT and the post-push advance.
      const claimed = await claimFriendScenarioForDelivery(
        db,
        enrollmentRow.id,
        enrollmentRow.current_step_order,
      );
      if (!claimed) return false;
      claimedEnrollmentId = enrollmentRow.id;
      advanceTargetId = enrollmentRow.id;

      // Advance without pushing on a cooldown hit so the row is neither
      // stranded at step -1 nor re-delivered by the cron. The racer
      // delivered step 1, so the reach tag still applies.
      if (!options?.skipCooldown && (await isRecentDuplicate(pinned.firstStep))) {
        await advancePastFirstStep(enrollmentRow.id, pinned.source, pinned.firstStep);
        claimedEnrollmentId = null; // the advance released the claim
        await attachReachTag(pinned.firstStep);
        return false;
      }
    } else {
      // every-click: cooldown FIRST, before enrolling. The LIFF entry points
      // fire on every page load (refresh, back-nav), not only on a fresh
      // tracked-link click. Enrolling before the cooldown check would leave
      // a fresh active step-0 row behind for the cron worker to pick up
      // (the partial UNIQUE on friend_scenarios is keyed
      // `WHERE status != 'completed'`, so completed runs don't block a new
      // INSERT). The probe identity comes from the current published version
      // (read-only — no side effects yet).
      const currentVersion = await getScenarioPublishedVersion(db, scenarioId);
      const pre = currentVersion ? await loadPinnedFirstStep(currentVersion.id) : null;
      if (!pre || !isImmediate(pre.source, pre.firstStep)) return false;
      if (await isRecentDuplicate(pre.firstStep)) return false;

      // INSERT OR IGNORE — null on re-clicks (already enrolled), still push.
      const enrollment = await enrollFriendInScenario(db, friendId, scenarioId);
      const row = enrollment ?? (await lookupEnrollment());
      // Authoritative read: the enrollment's own pinned version (a concurrent
      // publish may have moved the pointer between the probe and the enroll).
      pinned = row ? await loadPinnedFirstStep(await resolveEnrollmentVersionId(row)) : null;
      if (!pinned) return false;
      if (row && row.current_step_order < pinned.firstStep.step_order) {
        // This click owes step 1 to the enrollment — join the claim protocol
        // so the cron (the fresh row's next_delivery_at is already due) and
        // the follow-webhook path can't send it concurrently. A failed claim
        // means another sender is mid-delivery (or the row is paused): skip
        // rather than double-send.
        const claimed = await claimFriendScenarioForDelivery(db, row.id, row.current_step_order);
        if (!claimed) return false;
        claimedEnrollmentId = row.id;
        advanceTargetId = row.id;
      } else {
        // Pure re-click re-delivery. Re-probe the cooldown: the first probe
        // ran before the enroll round-trip, and a racing sender may have
        // logged its send in between.
        if (await isRecentDuplicate(pinned.firstStep)) return false;
      }
    }
    const { source, firstStep } = pinned;

    const releaseClaim = async () => {
      if (!claimedEnrollmentId) return;
      await releaseClaimById(db, claimedEnrollmentId);
      claimedEnrollmentId = null;
    };

    // Re-read the friend after caller writes (linkFriendToUser / ref_code
    // UPDATE / line_account_id wiring) so {{uid}}, {{ref}}, and merged
    // metadata expand against the latest state.
    const friend = await getFriendById(db, friendId);
    if (!friend) {
      await releaseClaim();
      return false;
    }

    // Independent D1 reads — resolve concurrently; this sits in front of the
    // reply-token send where latency eats into the token validity window.
    // ctxAccount is the caller-resolved channel (LIFF/OAuth flows), used for
    // both the push token and the tracked-link owner below.
    //
    // 文面・質問は固定版の写しをそのまま使う。配信時に templates 表を
    // 読み直さない（公開後の template 編集を混入させない）。
    const resolved = {
      messageType: firstStep.message_type,
      messageContent: firstStep.message_content,
      templateIdAtSend: firstStep.template_id_at_send ?? null,
      questionJson: firstStep.question_json ?? null,
    };
    const [resolvedMeta, ctxAccount] = await Promise.all([
      resolveMetadata(db, { user_id: friend.user_id, metadata: friend.metadata }),
      ctx.accountChannelId ? getLineAccountByChannelId(db, ctx.accountChannelId) : null,
    ]);
    const friendWithMeta = { ...friend, metadata: resolvedMeta } as Parameters<typeof expandVariables>[1];
    const extra = await resolveInterpolationExtra(db, friend.id, resolved.messageContent);
    const expanded = expandVariables(
      resolved.messageContent,
      friendWithMeta,
      ctx.workerUrl,
      resolved.messageType,
      extra,
    );
    // Same decoration pipeline as the cron (processStepDeliveries) via the
    // shared helper. Link owner: the friend's own account, else the
    // caller-resolved channel — LIFF/OAuth entry points run BEFORE the follow
    // webhook wires friend.line_account_id, and an owner-less link would send
    // that account's friends through the global LIFF consent screen.
    // live 側の通IDは履歴づけの控え。消されたあとは版所有の通IDに倒す。
    const liveStepId = (await scenarioStepExists(db, firstStep.live_step_id ?? null))
      ? firstStep.live_step_id!
      : null;
    const question = parseQuestion(resolved.questionJson);
    let messages: Message[];
    if (question) {
      messages = buildQuestionMessages(
        {
          ...question,
          intro: question.intro
            ? expandVariables(question.intro, friendWithMeta, ctx.workerUrl, 'text', extra)
            : question.intro,
          text: expandVariables(question.text, friendWithMeta, ctx.workerUrl, 'text', extra),
        },
        // 押し口は必ず版所有の通ID。live の通IDを載せると、公開後に直した
        // 返信・タグ・遷移が旧版の購読へ混入し、下書きの通を消した瞬間に
        // ボタンが無反応になる（#644 再審査 1）。
        { kind: 'version', stepId: firstStep.id },
      );
    } else {
      const decorated = await decorateForFriendPush(
        db,
        resolved.messageType,
        expanded,
        ctx.workerUrl,
        { lineAccountId: friend.line_account_id ?? ctxAccount?.id ?? null, friendId },
      );
      messages = [buildMessage(decorated.messageType, decorated.content)];
    }

    try {
      if (options?.reply) {
        await options.reply.client.replyMessage(options.reply.replyToken, messages);
      } else {
        const pushTarget = options?.targetLineUserId ?? friend.line_user_id;
        if (!pushTarget) {
          // Can't push from here — hand the claim back so the cron retries.
          await releaseClaim();
          return false;
        }
        // Token: caller-supplied account channel → friend's own account → env default.
        let accessToken = ctx.defaultAccessToken;
        if (ctx.accountChannelId) {
          if (ctxAccount?.channel_access_token) accessToken = ctxAccount.channel_access_token;
        } else if (friend.line_account_id) {
          const acct = await getLineAccountById(db, friend.line_account_id);
          if (acct?.channel_access_token) accessToken = acct.channel_access_token;
        }
        const lineClient = new LineClient(accessToken);
        await lineClient.pushMessage(pushTarget, messages);
      }
    } catch (err) {
      // The message never left LINE's API — release so the cron retries on
      // schedule.
      console.error('[immediate-first-step] send failed, releasing claim:', err);
      await releaseClaim();
      return false;
    }
    sent = true;
    settleAfterSend = async () => {
      if (advanceTargetId) {
        await advancePastFirstStep(advanceTargetId, source, firstStep);
        claimedEnrollmentId = null; // the advance released the claim
        await attachReachTag(firstStep);
      }
    };

    // Log what was actually delivered (post buildMessage normalization) so
    // the cooldown above sees it on subsequent calls and the dashboard chat
    // view mirrors LINE 1:1. delivery_type mirrors the send channel.
    //
    // 二重送信防止の正体は scenario_version_step_id（版所有の通ID）。
    // scenario_step_id には live が残っているときだけ入れ、消されたあとは
    // NULL（外部キーを壊さない）。
    for (const sentMessage of messages) {
      const logPayload = messageToLogPayload(sentMessage);
      await db
        .prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, template_id_at_send, created_at, scenario_version_step_id)
           VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, ?, 'scenario', ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          friendId,
          logPayload.messageType,
          logPayload.content,
          liveStepId,
          options?.reply ? 'reply' : null,
          resolved.templateIdAtSend,
          jstNow(),
          firstStep.id,
        )
        .run();
    }

    await settleAfterSend();
    settleAfterSend = null;
    return true;
  } catch (err) {
    console.error('[immediate-first-step] push failed:', err);
    try {
      if (sent && settleAfterSend) {
        // The message went out but logging/advancing threw — advance anyway
        // (best effort) so the cron cannot re-deliver step 1.
        await settleAfterSend();
      } else if (claimedEnrollmentId) {
        // Nothing was sent — hand the claim back now instead of leaving the
        // row in 'delivering' until the stuck-delivery sweep frees it.
        await releaseClaimById(db, claimedEnrollmentId);
      }
    } catch (settleErr) {
      console.error('[immediate-first-step] post-failure settle failed:', settleErr);
    }
    return sent;
  }
}

async function releaseClaimById(db: D1Database, enrollmentId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE friend_scenarios SET status = 'active', updated_at = ?
       WHERE id = ? AND status = 'delivering'`,
    )
    .bind(jstNow(), enrollmentId)
    .run();
}
