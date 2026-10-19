import { logger } from '@line-crm/shared/server';
import { logWebhookStepFailure } from './webhook-analytics.js';

import { sendEntryRouteCoupon } from '../services/entry-route-coupon.js';

import type { WorkflowExecution } from '../services/workflow-execution.js';

import { LineClient } from '@line-crm/line-sdk';

import type { WebhookEvent } from '@line-crm/line-sdk';

import { upsertFriend, getScenarios, enrollFriendInScenario, jstNow, getEntryRouteByRefCode, getMessageTemplateById, getFriendAddScenarioIds, recordFriendAddEvent, captureFriendAddEventAttribution, markFriendAddEventRouting, claimFriendAddSendRight, touchFriendAddSendClaim, recordFriendAddDelivery, releaseFriendAddSendRight, toJstString } from '@line-crm/db';
import type { EntryRoute, Friend } from '@line-crm/db';


import { isStoppedEntryRouteRef, getActiveStopSuppressionSafe } from '../services/entry-route-stop.js';
import { applyFriendAddRouting } from '../features/friends/friend-add-routing/index.js';
import { fireEvent, logOutgoingMessage } from '../services/event-bus.js';

import { buildMessage } from '../services/step-delivery.js';
import { pushImmediateFirstStep } from '../services/immediate-first-step.js';

import type { Env } from '../worker-env.js';
import { awardActivityMileage } from '../services/activity-mileage.js';
import { createEccubeCoupon } from '../services/eccube-coupon.js';
import { issueFriendAddCoupon } from '../features/friends/friend-add-coupon/index.js';

import { isFriendScopeConflict, type FollowSendOutcome, stableRetryKey, classifyFollowSendFailure } from './webhook-definition-is-friend-scope-conflict.js';

/** Follow-specific ledger, routing and notification steps; called once in event order. */
export async function handleFollowEvent(
  db: D1Database,
  lineClient: LineClient,
  event: Extract<WebhookEvent, { type: 'follow' }>,
  lineAccessToken: string,
  lineAccountId: string | null,
  lineMessageAccountKey: string,
  workerUrl?: string,
  liffUrl?: string,
  r2?: R2Bucket,
  ecommerce?: { baseUrl: string; secret: string },
  operatorMailEnv?: Env['Bindings'],
  execution?: WorkflowExecution
): Promise<void> {
  const replay=<T>(key:string,work:()=>Promise<T>):Promise<T>=>execution?execution.step(key,work):work();

    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    logger.log("line_webhook_follow_received");

    // プロフィール取得 & 友だち登録/更新
    let profile: Awaited<ReturnType<LineClient['getProfile']>> | undefined;
    try {
      profile = await lineClient.getProfile(userId);
    } catch (err) {
      logWebhookStepFailure('follow_profile', err, lineAccountId, event);
    }

    let friend: Friend;
    try {
      friend = execution ? await execution.step('friend',async()=>{ return upsertFriend(execution?.mutationDb('friend') ?? db, {
        lineUserId: userId,
        lineAccountId,
        followOccurredAt: toJstString(new Date(event.timestamp)),
        displayName: profile?.displayName ?? null,
        pictureUrl: profile?.pictureUrl ?? null,
        statusMessage: profile?.statusMessage ?? null,
      }); }) : await upsertFriend(db,{lineUserId:userId,lineAccountId,followOccurredAt:toJstString(new Date(event.timestamp)),displayName:profile?.displayName ?? null,pictureUrl:profile?.pictureUrl ?? null,statusMessage:profile?.statusMessage ?? null});
    } catch (err) {
      if (!isFriendScopeConflict(err)) throw err;
      // 同一 line_user_id が別アカウント所有。friend 行なしではフォロー処理を
      // 進められないので、相手の行に触れずこのイベントを諦める (Issue #961)。
      logger.warn("line_webhook_friend_scope_conflict");
      return;
    }
    if (friend.is_following === 0 || (friend.last_followed_at && Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(friend.last_followed_at)?friend.last_followed_at:`${friend.last_followed_at}${friend.last_followed_at.length===10?'T00:00:00':''}+09:00`) > event.timestamp)) return;
    const friendKind = (friend.unfollow_count ?? 0) > 0 ? 'returning' : 'first_time';

    // 台帳はWebhookイベント単位。初回流入 friends.ref_code とは分離し、
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

    // line_account_id の紐づけは upsertFriend 内で行う（新規行は受信アカウント
    // で作り、未割当行だけを引き当てる）。ここで別アカウントの行を
    // 「移動」する経路は Issue #961 で廃止した。

    // 新規・再フォローのどちらでも、最初の友だち登録マイルを同じキーで非同期投入する。
    // first_followed_at を使うため再フォローやWebhook再送では二重加算されない。
    const firstFollowedAt = friend.first_followed_at ?? friend.created_at;
    await replay('awardActivityMileage:2',()=>awardActivityMileage(execution?.mutationDb('awardActivityMileage:2') ?? db, {
      eventType: 'friend_registered',
      source: 'line_relationship',
      sourceEventId: `${friend.id}:friend_registered:${firstFollowedAt}`,
      friendId: friend.id,
      subjectKey: friend.id,
      metadata: { lineAccountId },
      occurredAt: firstFollowedAt,
    }));

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

    // N-244競合: 候補保存→経路停止→follow到着の順でも、停止refを
    // friends.ref_code・計測・友だち追加ルールへ使わない。capture は停止
    // ref を friend_add_events へ確定させてしまうため、台帳も unavailable
    // へ戻して計測に残さない。
    // N-244差戻: 停止ref由来では unknown-route/アカウント共通の友だち追加
    // シナリオを含めタグ・シナリオを一切開始しないため、破棄したことを覚える。
    let stoppedRefDiscarded = false;
    if (currentAttribution?.refCode && (await isStoppedEntryRouteRef(db, currentAttribution.refCode))) {
      try {
        await db.prepare(
          `UPDATE friend_add_events SET attribution_status = 'unavailable', ref_code = NULL, entry_route_id = NULL, candidate_id = NULL WHERE id = ? AND line_account_id = ?`,
        ).bind(friendAddEventId, lineAccountId).run();
      } catch (err) {
        logWebhookStepFailure('friend_add_attribution_discard_stopped', err, lineAccountId, event);
      }
      currentAttribution = null;
      stoppedRefDiscarded = true;
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
    // N-244競合: 停止前に LIFF/OAuth が保存した既存 ref も停止済みなら
    // 使わない。friends.ref_code の停止値は消し、計測・帰属に残さない。
    if (friendRefCode && (await isStoppedEntryRouteRef(db, friendRefCode))) {
      try {
        await db.prepare(
          `UPDATE friends SET ref_code = NULL, updated_at = ? WHERE id = ? AND ref_code = ?`,
        ).bind(jstNow(), friend.id, friendRefCode).run();
      } catch (err) {
        logWebhookStepFailure('friend_ref_code_discard_stopped', err, lineAccountId, event);
      }
      friendRefCode = null;
      stoppedRefDiscarded = true;
    }
    // N-244差戻(再審査): 候補Bが停止済みで破棄した場合、friends.ref_code の
    // 過去active経路Aへ fallback しない。B由来の follow でAの紹介メッセージ/
    // 専用scenarioが動くのを止める。A の DB 値は正規の履歴のため残すが、
    // 今回の follow では使わない。既存ref由来の破棄では既に null のため no-op。
    if (stoppedRefDiscarded) {
      friendRefCode = null;
    }
    // N-244差戻(台帳): 候補・既存refが無く自然流入に見えても、同一利用者の
    // 直近の停止試行が抑止台帳にあれば停止由来として抑止する。これで
    // LIFF/callbackと別followが前後・同時に来ても停止由来が共有される。
    // 明示の帰属(候補・既存ref)がある場合はそちらが勝ち、ここでは見ない。
    if (!stoppedRefDiscarded && !currentAttribution && !friendRefCode && lineAccountId && userId) {
      const suppression = await getActiveStopSuppressionSafe(db, lineAccountId, userId);
      if (suppression) {
        stoppedRefDiscarded = true;
      }
    }
    const referralRoute: EntryRoute | null = friendRefCode
      ? await getEntryRouteByRefCode(db, friendRefCode)
      : null;
    // N-244差戻: 停止refを消した後は referralRoute が null になるため、
    // 従来の条件だけでは unknown-route/アカウント共通の友だち追加ルールへ
    // 流れてタグ・シナリオが始まる。破棄した場合は振り分けもアカウント共通
    // シナリオもすべて止める。ref が無い自然流入は従来どおり進める。
    const runAccountScenarios =
      !stoppedRefDiscarded &&
      (!referralRoute || referralRoute.run_account_friend_add_scenarios !== 0);

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
    /*
     * 送れたと分かったその場で、**送信の事実だけ**を台帳へ残す。
     * まとめて書く確定が落ちても、この行が再送制限の材料になり、
     * 印の期限が切れたあとの2通目を止める。ここが落ちても送信は続ける
     * （送れたことは変わらないので、記録の失敗で配信を止めない）。
     */
    const noteDelivered = async (): Promise<void> => {
      if (friendAddEventId == null || lineAccountId == null) return;
      try {
        await recordFriendAddDelivery(db, {
          eventId: friendAddEventId,
          lineAccountId,
        });
      } catch (err) {
        logWebhookStepFailure('friend_add_delivery_record', err, lineAccountId, event);
      }
    };
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
            eventId: friendAddEventId,
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

    if (routing?.messageText && !routing.suppressed && sendRight) {
      try {
        const { expandSendCommonVars } = await import('../services/interpolation-context.js');
        const content = await expandSendCommonVars(db, routing.messageText,
          { kind: 'notification', id: routing.ruleId ?? friend.id },
          { lineAccountId, friendId: friend.id, messageType: 'text' });
        if (await holdSendRight({ external: true })) {
          try {
            await lineClient.pushMessage(userId, [buildMessage('text', content)], sendRetryKey(`rule-text:${routing.ruleVersionId}`));
          } catch (error) {
            noteSendOutcome(classifyFollowSendFailure(error));
            throw error;
          }
          noteSendOutcome('delivered');
          friendAddDeliveryCount += 1;
          await logOutgoingMessage(db, { friendId: friend.id, messageType: 'text', content,
            deliveryType: 'push', source: 'friend_add', lineAccountId });
        }
      } catch (error) { logWebhookStepFailure('friend_add_rule_text', error, lineAccountId, event); }
    }

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
            await noteDelivered();
            logger.log("routes_webhook_log");
          }
        } catch (err) {
          logWebhookStepFailure('routed_scenario_delivery', err, lineAccountId, event);
        }
      }
      if (routing.suppressed) {
        logger.log("routes_webhook_log");
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
            await noteDelivered();
            logger.log("routes_webhook_log");
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
     *
     * 台帳の確定はここではなく、外部効果を全部終えたあとで行う（下）。
     * 送った結末が出そろってからでないと、送達不明を取りこぼす。
     * N-244 の「停止ref由来で止めた」も、その確定へ持っていく。
     */
    // Referral link side-effects (intro push + dedicated scenario)
    if (referralRoute) {
      // Intro push from referral link
      if (referralRoute.intro_template_id && await holdSendRight({ external: true })) {
        try {
          const template = await getMessageTemplateById(db, referralRoute.intro_template_id);
          if (template) {
            // 紹介リンクの案内文にも {{var.*}} を書ける。消えた共通情報は
            // 空文字にせず止め、解決できるものは送信時点の値へ置き換える。
            const { expandSendCommonVars } = await import('../services/interpolation-context.js');
            const introContent = await expandSendCommonVars(
              db, template.message_content,
              { kind: 'notification', id: referralRoute.id },
              { lineAccountId, friendId: friend.id, messageType: template.message_type },
            );
            const message = buildMessage(template.message_type, introContent);
            try {
              await lineClient.pushMessage(userId, [message], sendRetryKey(`referral-intro:${referralRoute.id}`));
            } catch (pushErr) {
              // 4xx は届いていない。それ以外は届いたかもしれない（送達不明）。
              noteSendOutcome(classifyFollowSendFailure(pushErr));
              throw pushErr;
            }
            noteSendOutcome('delivered');
            logger.log("routes_webhook_log");
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
          logger.log("routes_webhook_log");
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

    // QRのクーポン: 初めての追加だけ。既存友だちは本人確認済みLIFFで受け取る。
    if (friendKind === 'first_time' && !stoppedRefDiscarded && referralRoute?.coupon_enabled === 1
      && lineAccountId && await holdSendRight({ external: true })) {
      try {
        await sendEntryRouteCoupon(db, referralRoute, friend, async (message, retryKey) => {
          if (!await holdSendRight({ external: true })) {
            throw Object.assign(new Error('entry_coupon_fenced_out'), { friendAddSendAborted: true });
          }
          try {
            await lineClient.pushMessage(userId, [message], retryKey);
          } catch (error) {
            noteSendOutcome(classifyFollowSendFailure(error));
            throw error;
          }
          noteSendOutcome('delivered');
        });
      } catch (error) {
        logWebhookStepFailure('entry_route_coupon', error, lineAccountId, event);
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
              // 設定画面で書けるクーポン本文にも {{var.*}} を置ける。
              // 消えた共通情報は fail-closed で止める。
              const { expandSendCommonVars } = await import('../services/interpolation-context.js');
              const expanded = await expandSendCommonVars(
                db, text,
                { kind: 'notification', id: 'friend_add_coupon' },
                { lineAccountId, friendId: friend.id },
              );
              await lineClient.pushMessage(userId, [{ type: 'text', text: expanded }], sendRetryKey('coupon'));
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
    const actionFailed = (routing?.actionFailureCount ?? 0) > 0;
    const deliveryErrorCode = (stoppedRefDiscarded ? 'entry_route_stopped' : null)
      ?? routing?.suppressReason
      ?? (claimError
        ? 'send_claim_unavailable'
        : (previousDispatchUnknown
          ? 'delivery_unknown'
          : (!sendRight
            ? 'duplicate_in_flight'
            : (deliveryUnknown ? 'delivery_unknown' : (delivered ? null : 'send_failed')))));
    const deliveryStatus = (stoppedRefDiscarded || routing?.suppressed)
      ? 'suppressed' as const
      : (delivered ? 'completed' as const : 'partial_failed' as const);
    const ledgerErrorCode = actionFailed ? 'action_failed' : deliveryErrorCode;
    let ledgerFinalized = false;
    if (friendAddEventId && lineAccountId && !fencedOut) {
      try {
        ledgerFinalized = await markFriendAddEventRouting(db, {
          eventId: friendAddEventId,
          lineAccountId,
          // N-244: 停止ref由来で振り分けを止めた場合も suppressed に倒す。
          status: actionFailed
            ? 'partial_failed'
            : deliveryStatus,
          routingRuleId: routing?.ruleId ?? null,
          winningRuleVersionId: routing?.ruleVersionId ?? null,
          errorCode: ledgerErrorCode,
          scenarioEnrollmentId,
          deliveryCount: friendAddDeliveryCount,
          // 処理だけ失敗した場合、再試行完了後は送信側の元の結末へ戻す。
          actionBaseStatus: actionFailed ? deliveryStatus : null,
          actionBaseErrorCode: actionFailed ? deliveryErrorCode : null,
          // 予約を持って進んだ実行だけ、同じ予約の下で確定する。
          fence: claimedSendRight && !claimError && claimGeneration > 0
            ? { friendId: friend.id, generation: claimGeneration }
            : undefined,
        });
        if (!ledgerFinalized) {
          // 回収されていた。勝った側が確定するのでここでは何も書かない。
          fencedOut = true;
          logger.warn("friend_add_ledger_finalize_fenced_out_send_right_revoked");
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
    await replay('fireEvent:4',()=>fireEvent(db, 'friend_add', {
      sourceEventId: event.webhookEventId,
      sourceKind: 'line_webhook',
      occurredAt: new Date(event.timestamp).toISOString(),
      friendId: friend.id,
      eventData: {
        displayName: friend.display_name,
        friendKind,
        attributionStatus: currentAttribution ? 'captured' : 'unavailable',
      },
    }, lineAccessToken, lineAccountId, execution));
    return;
}
