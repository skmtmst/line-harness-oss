import { extractFlexAltText } from '../utils/flex-alt-text.js';
// メッセージの組み立ては一斉配信と共有する。ここからも取れるようにしておく（呼び出し側が多い）。
import { buildMessage } from './line-message.js';
export { buildMessage };
import { resolveInterpolationExtra } from './interpolation-context.js';
import {
  getFriendScenariosDueForDelivery,
  getScenarioSteps,
  advanceFriendScenario,
  completeFriendScenario,
  pauseFriendScenario,
  claimFriendScenarioForDelivery,
  recoverStuckDeliveries,
  pauseFriendScenarioDelivery,
  getFriendById,
  jstNow,
  computeNextDeliveryAt,
  resolveStepContent,
  addTagToFriend,
  type DeliveryMode,
  type Friend,
} from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { jitterDeliveryTime, addJitter, sleep } from './stealth.js';
import { matchesCondition, parseCondition } from './segment-query.js';
import { runScenarioActions, resumePreviousScenario, runScenarioOp } from './scenario-actions.js';
import { parseQuestion, buildQuestionMessages } from './scenario-question.js';
import { expandDateVariables } from './interpolation-date.js';

/**
 * Replace template variables in message content.
 *
 * Supported variables:
 * - {{name}}                → friend's display name
 * - {{uid}}                 → friend's user UUID
 * - {{friend_id}}           → friend's internal ID
 * - {{auth_url:CHANNEL_ID}} → full /auth/line URL with uid for cross-account linking
 * - {{metadata.KEY}}       → friend's metadata value (from form responses etc.)
 */
/**
 * 差し込みの記法について。
 *
 * 友だち情報欄は {{field.pet_name}}、共通情報は {{var.shop_hours}} で書く。
 * 要件定義書は {pet_name} という単一の波括弧を想定していたが、それは採れない。
 * Flex メッセージの本文は JSON で、{ が至るところに出てくる。単一の波括弧で
 * 置換すると、差し込みのつもりが無い箇所まで書き換えて本文を壊す。
 *
 * 既存の {{metadata.KEY}} と同じ形にそろえたので、書き方も1つで済む。
 */
export function expandVariables(
  content: string,
  friend: { id: string; display_name: string | null; user_id: string | null; ref_code?: string | null; metadata?: Record<string, unknown> | string | null },
  apiOrigin?: string,
  messageType?: string,
  extra?: {
    /** 友だち情報欄。field_key => 値 */
    fields?: Record<string, string>;
    /** 共通情報。var_key => 値 */
    vars?: Record<string, string>;
    /**
     * この通が届く日時。{{date}} や {{days_until:…}} の起点。
     * 省略したら「いま」。テスト送信やプレビューはそれでよい。
     */
    deliveredAt?: Date;
  },
): string {
  let result = content;

  /*
   * 日付の差し込みを先に処理する。
   *
   * 後にすると、{{field.x}} に入っていた文字列が偶然 {{date}} の形を
   * していた場合に二重に置き換わる。差し込みの値は利用者が入れたもので、
   * それが差し込みとして解釈されるのは事故のもと。
   */
  result = expandDateVariables(result, extra?.deliveredAt ?? new Date());
  result = result.replace(/\{\{name\}\}/g, friend.display_name || '');
  result = result.replace(/\{\{uid\}\}/g, friend.user_id || '');
  result = result.replace(/\{\{friend_id\}\}/g, friend.id);
  result = result.replace(/\{\{ref\}\}/g, friend.ref_code || '');
  // Conditional block: {{#if_ref}}...{{/if_ref}} — only shown if ref_code exists
  if (friend.ref_code) {
    result = result.replace(/\{\{#if_ref\}\}([\s\S]*?)\{\{\/if_ref\}\}/g, '$1');
  } else {
    result = result.replace(/\{\{#if_ref\}\}[\s\S]*?\{\{\/if_ref\}\}/g, '');
  }
  // Metadata variables: {{metadata.KEY}} → value from friend's metadata
  const meta = friend.metadata
    ? (typeof friend.metadata === 'string' ? JSON.parse(friend.metadata) as Record<string, unknown> : friend.metadata)
    : {};
  // Conditional block: {{#if_metadata.KEY}}...{{/if_metadata.KEY}} — only shown if metadata key has a value
  // When inside JSON arrays, removes the element and fixes trailing/leading commas
  result = result.replace(/\{\{#if_metadata\.([^}]+)\}\}([\s\S]*?)\{\{\/if_metadata\.\1\}\}/g, (_match, key, inner) => {
    const val = meta[key];
    if (val == null || val === '') return '';
    return inner;
  });
  // Clean up broken JSON commas from removed conditional blocks (e.g. ",," or "[," or ",]").
  // Flex only: this is JSON repair — running it on plain text silently rewrote
  // user-authored bodies containing ",," / "[," / ",]" (bug present since initial release).
  if (messageType === 'flex') {
    result = result.replace(/,\s*,/g, ',');
    result = result.replace(/\[\s*,/g, '[');
    result = result.replace(/,\s*\]/g, ']');
  }
  result = result.replace(/\{\{metadata\.([^}]+)\}\}/g, (_match, key) => {
    const val = meta[key];
    if (val == null) return '';
    return Array.isArray(val) ? val.join(', ') : String(val);
  });

  // 友だち情報欄。{{#if_field.KEY}}...{{/if_field.KEY}} で「値があるときだけ」も書ける。
  // 条件ブロックを先に処理するのは、中の {{field.KEY}} を消してからでは
  // 判定できないため。
  const fields = extra?.fields ?? {};
  result = result.replace(
    /\{\{#if_field\.([a-z][a-z0-9_]*)\}\}([\s\S]*?)\{\{\/if_field\.\1\}\}/g,
    (_match, key: string, inner: string) => {
      const val = fields[key];
      return val == null || val === '' ? '' : inner;
    },
  );
  result = result.replace(/\{\{field\.([a-z][a-z0-9_]*)\}\}/g, (_match, key: string) => {
    // 未設定の項目は空文字にする。「未設定」と書くと、そのまま送られて
    // お客様に見えてしまう。空にしておけば文として不自然でも意味は壊れない。
    return fields[key] ?? '';
  });

  // 共通情報。営業時間や電話番号のように、全テンプレートで同じ値を使うもの。
  const vars = extra?.vars ?? {};
  result = result.replace(/\{\{var\.([a-z][a-z0-9_]*)\}\}/g, (_match, key: string) => {
    return vars[key] ?? '';
  });
  if (apiOrigin) {
    result = result.replace(/\{\{auth_url:([^}]+)\}\}/g, (_match, channelId) => {
      const params = new URLSearchParams({ account: channelId, ref: 'cross-link' });
      if (friend.user_id) params.set('uid', friend.user_id);
      return `${apiOrigin}/auth/line?${params.toString()}`;
    });
  }
  return result;
}

/**
 * Resolve metadata for a friend, merging across all UUID-linked records.
 * Falls back to the friend's own metadata if no user_id.
 */
export async function resolveMetadata(
  db: D1Database,
  friend: { user_id?: string | null; metadata?: string | null },
): Promise<Record<string, unknown>> {
  // If friend has a UUID, merge metadata from all linked records
  if (friend.user_id) {
    const { getMergedMetadataByUserId } = await import('@line-crm/db');
    return getMergedMetadataByUserId(db, friend.user_id);
  }
  // Fallback: parse own metadata
  if (friend.metadata) {
    try { return JSON.parse(friend.metadata); } catch { return {}; }
  }
  return {};
}

const MAX_SENDS_PER_CRON = 40; // CF Free plan: 50 subrequests limit (margin for other jobs)
const MAX_ATTEMPTS_PER_CRON = 40; // condition skips/errors also consume CPU and D1 work

export function getLineApiErrorStatus(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const match = err.message.match(/^LINE API error:\s+(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

export function isPermanentLineDeliveryError(err: unknown): boolean {
  const status = getLineApiErrorStatus(err);
  return status !== null && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
}

export async function processStepDeliveries(
  db: D1Database,
  lineClient: LineClient,
  workerUrl?: string,
): Promise<void> {
  // Crash recovery: a claim (active→delivering) that never got released means
  // the worker died mid-delivery — without this, the enrollment is stranded
  // forever because the due query only picks up 'active' rows. Reclaim after
  // 5 minutes (at-least-once: a crash after the LINE push but before advance
  // re-sends that step once).
  const recovered = await recoverStuckDeliveries(db);
  if (recovered > 0) {
    console.warn(`[step-delivery] recovered ${recovered} stuck 'delivering' enrollment(s)`);
  }

  const now = jstNow();
  const dueFriendScenarios = await getFriendScenariosDueForDelivery(db, now);

  let sendCount = 0;
  let attemptCount = 0;
  for (let i = 0; i < dueFriendScenarios.length; i++) {
    if (sendCount >= MAX_SENDS_PER_CRON || attemptCount >= MAX_ATTEMPTS_PER_CRON) break;
    const fs = dueFriendScenarios[i];
    attemptCount++;
    try {
      // Stealth: add small random delay between deliveries to avoid burst patterns
      if (i > 0) {
        await sleep(addJitter(50, 200));
      }
      const sent = await processSingleDelivery(db, lineClient, fs, workerUrl);
      if (sent) sendCount++;
    } catch (err) {
      console.error(`Error processing friend_scenario ${fs.id}:`, err);
      // A permanent LINE 4xx (invalid/unreachable recipient, invalid payload,
      // unauthorized channel, etc.) must not be recovered and retried forever.
      // 408/409/429 are transient and retain the existing 5-minute recovery.
      if (isPermanentLineDeliveryError(err)) {
        await pauseFriendScenarioDelivery(db, fs.id);
        console.warn(
          `[step-delivery] paused enrollment=${fs.id} after permanent LINE ${getLineApiErrorStatus(err)}`,
        );
      }
      // Continue with next one.
    }
  }
}

/**
 * Resolve the account-specific friend that an account-bound scenario may
 * safely message.
 *
 * - Same-account enrollment: use it directly.
 * - UUID-linked cross-account enrollment: use the friend row belonging to the
 *   scenario account.
 * - OAuth-before-webhook legacy row (line_account_id NULL): the row's LINE user
 *   id was issued in the scenario account context, so allow one attempt with
 *   the scenario token. A permanent 4xx pauses it.
 * - A friend explicitly belonging to another account is never sent through a
 *   fallback/default token when no linked destination exists.
 */
export async function resolveScenarioDeliveryFriend(
  db: D1Database,
  enrolledFriend: Friend,
  scenarioAccountId: string | null,
): Promise<Friend | null> {
  if (!scenarioAccountId || enrolledFriend.line_account_id === scenarioAccountId) {
    return enrolledFriend;
  }

  if (enrolledFriend.user_id) {
    const linked = await db
      .prepare(
        `SELECT * FROM friends
         WHERE user_id = ? AND line_account_id = ?
         ORDER BY is_following DESC, updated_at DESC
         LIMIT 1`,
      )
      .bind(enrolledFriend.user_id, scenarioAccountId)
      .first<Friend>();
    if (linked) return linked.is_following ? linked : null;
  }

  return enrolledFriend.line_account_id === null ? enrolledFriend : null;
}

async function processSingleDelivery(
  db: D1Database,
  lineClient: LineClient,
  fs: {
    id: string;
    friend_id: string;
    scenario_id: string;
    current_step_order: number;
    status: string;
    next_delivery_at: string | null;
    started_at: string;
  },
  workerUrl?: string,
): Promise<boolean> {
  // Optimistic lock: claim this delivery (prevents duplicate sends from parallel workers)
  const claimed = await claimFriendScenarioForDelivery(db, fs.id, fs.current_step_order);
  if (!claimed) return false;

  const enrolledFriend = await getFriendById(db, fs.friend_id);
  if (!enrolledFriend) {
    await completeFriendScenario(db, fs.id);
    return false;
  }

  // Fetch scenario account together with delivery_mode. Account-bound
  // scenarios must use that account's friend identity and token.
  const scenarioRow = await db
    .prepare(
      `SELECT delivery_mode, line_account_id, audience_condition_json,
              on_complete_mode, on_complete_scenario_id
         FROM scenarios WHERE id = ?`,
    )
    .bind(fs.scenario_id)
    .first<{
      delivery_mode: DeliveryMode;
      line_account_id: string | null;
      audience_condition_json: string | null;
      on_complete_mode: string | null;
      on_complete_scenario_id: string | null;
    }>();
  if (!scenarioRow) {
    await completeFriendScenario(db, fs.id);
    return false;
  }

  const friend = await resolveScenarioDeliveryFriend(
    db,
    enrolledFriend,
    scenarioRow.line_account_id,
  );
  if (!friend) {
    await pauseFriendScenarioDelivery(db, fs.id);
    console.warn(
      `[step-delivery] paused enrollment=${fs.id}: no following friend for scenario account=${scenarioRow.line_account_id}`,
    );
    return false;
  }
  if (!friend.is_following) {
    await completeFriendScenario(db, fs.id);
    return false;
  }

  // Get all steps for this scenario.
  //
  // 下書き (is_draft) はここで落とす。落としておけば「次の通」を探す処理が
  // そのまま次の公開ぶんを選ぶ。あとから条件で弾く作りにすると、下書きに
  // 到達した時点で止まって見える。
  const steps = (await getScenarioSteps(db, fs.scenario_id)).filter((s) => (s.is_draft ?? 0) === 0);
  if (steps.length === 0) {
    await completeFriendScenario(db, fs.id);
    return false;
  }

  /*
   * シナリオ全体の配信対象。
   *
   * 購読したあとに条件から外れることがある（タグを外した、対応マークが
   * 変わった等）。外れた人には**送らずに止める**。完了にしないのは、
   * 条件に戻ったときに人が再開できるようにするため。
   */
  const audience = parseCondition(scenarioRow.audience_condition_json);
  if (scenarioRow.audience_condition_json && !audience) {
    console.error(
      `[step-delivery] unreadable audience condition scenario=${fs.scenario_id} — paused enrollment=${fs.id}`,
    );
    await pauseFriendScenarioDelivery(db, fs.id);
    return false;
  }
  if (audience && !(await matchesCondition(db, fs.friend_id, audience))) {
    await pauseFriendScenarioDelivery(db, fs.id);
    return false;
  }

  // computeNextDeliveryAt は「JST clock-time を UTC として表現する Date」前提
  // (setHours/getDate が JST clock 通りに動くようにオフセット済みの Date)。
  // fs.started_at は "+09:00" 付き ISO で本物の UTC instant として parse されるため、
  // +9h ずらして JST clock-time 表現に揃える必要がある。
  const enrolledAtDate = new Date(new Date(fs.started_at).getTime() + 9 * 60 * 60_000);
  const nowJstDate = new Date(Date.now() + 9 * 60 * 60_000);
  const nextDeliveryFor = (step: { delay_minutes: number; offset_days: number | null; offset_minutes: number | null; delivery_time: string | null }): Date =>
    computeNextDeliveryAt(
      { delivery_mode: scenarioRow.delivery_mode },
      step,
      { enrolledAt: enrolledAtDate, previousDeliveredAt: nowJstDate, now: nowJstDate },
    );

  // Steps are sorted by step_order but may not be contiguous (e.g., 1, 3, 5 after deletions).
  // Find the next step whose step_order > current_step_order.
  const currentStep = steps.find((s) => s.step_order > fs.current_step_order);

  if (!currentStep) {
    await finishScenario(db, fs.id, fs.scenario_id, fs.friend_id, scenarioRow);
    return false;
  }

  // Check step condition before sending
  if (currentStep.condition_type) {
    const conditionMet = await evaluateCondition(db, fs.friend_id, currentStep);
    if (!conditionMet) {
      if (currentStep.next_step_on_false !== null && currentStep.next_step_on_false !== undefined) {
        const jumpStep = steps.find((s) => s.step_order === currentStep.next_step_on_false);
        if (jumpStep) {
          const jitteredDate = jitterDeliveryTime(nextDeliveryFor(jumpStep));
          // Advance to just before the jump target so the next tick's
          // `find(step_order > current_step_order)` selects jumpStep itself.
          // Passing currentStep.step_order here (pre-fix) delivered the
          // sequentially-next step and silently ignored next_step_on_false.
          await advanceFriendScenario(db, fs.id, jumpStep.step_order - 1, jitteredDate.toISOString().slice(0, -1) + '+09:00');
          return false;
        }
      }
      const nextIndex = steps.indexOf(currentStep) + 1;
      if (nextIndex < steps.length) {
        const nextStep = steps[nextIndex];
        const jitteredDate = jitterDeliveryTime(nextDeliveryFor(nextStep));
        await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
      } else {
        await completeFriendScenario(db, fs.id);
      }
      return false;
    }
  }

  /*
   * 1通ごとの配信対象。
   *
   * 対象から外れている人には、この通だけ送らずに次へ進める。止めないのは、
   * 「今回はこの人向けではない」だけであって、シナリオそのものを降りた
   * わけではないため。Lステップの「配信対象の絞り込み」と同じ扱い。
   */
  const stepTarget = parseCondition(currentStep.target_condition_json);
  if (currentStep.target_condition_json && !stepTarget) {
    console.error(
      `[step-delivery] unreadable target condition step=${currentStep.id} — skipping this step`,
    );
  }
  const stepTargeted = currentStep.target_condition_json
    ? stepTarget
      ? await matchesCondition(db, fs.friend_id, stepTarget)
      : false
    : true;
  if (!stepTargeted) {
    const skipIndex = steps.indexOf(currentStep) + 1;
    if (skipIndex < steps.length) {
      const jitteredDate = jitterDeliveryTime(nextDeliveryFor(steps[skipIndex]));
      await advanceFriendScenario(
        db,
        fs.id,
        currentStep.step_order,
        jitteredDate.toISOString().slice(0, -1) + '+09:00',
      );
    } else {
      await finishScenario(db, fs.id, fs.scenario_id, fs.friend_id, scenarioRow);
    }
    return false;
  }

  // Resolve template_id → templates table (参照型). template_id 未設定なら step 値そのまま。
  const resolved = await resolveStepContent(db, currentStep);

  // Expand template variables ({{name}}, {{uid}}, {{auth_url:CHANNEL_ID}}, {{metadata.KEY}}, etc.)
  const resolvedMeta = await resolveMetadata(db, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
  const friendWithMeta = { ...friend, metadata: resolvedMeta } as Parameters<typeof expandVariables>[1];
  const extra = await resolveInterpolationExtra(db, friend.id, resolved.messageContent);
  /*
   * 日付の差し込みの起点は「いま」。
   *
   * 予定時刻ではなく実際に配る時刻を使う。cron は5分刻みなので予定から
   * 数分ずれることがあり、深夜0時前後の配信で予定と実際の日付が割れる。
   * 相手が受け取った日と、本文に書かれた日は合っていないといけない。
   */
  const expandedContent = expandVariables(
    resolved.messageContent,
    friendWithMeta,
    workerUrl,
    resolved.messageType,
    { ...extra, deliveredAt: new Date() },
  );
  // Auto-wrap URLs with tracking links + bake f=<friendId> into /t links —
  // shared pipeline with the instant first-step push (immediate-first-step.ts).
  // リンクの所有アカウントは実際に配信するアカウント (= friend の account) に合わせる
  const friendAccountId = friend.line_account_id;
  const deliveryAccountId = scenarioRow.line_account_id ?? friendAccountId;
  const { decorateForFriendPush } = await import('./auto-track.js');
  const tracked = await decorateForFriendPush(db, resolved.messageType, expandedContent, workerUrl, {
    lineAccountId: deliveryAccountId ?? null,
    friendId: friend.id,
  });
  /*
   * 質問メッセージなら、本文の代わりに選択肢つきのメッセージを組み立てる。
   *
   * 前文があるぶん複数通になるので、以降は配列で扱う。差し込みは前文にも
   * 効かせたいので、質問の組み立ては差し込みのあとに置いている。
   */
  const question = parseQuestion(currentStep.question_json);
  const messages: Message[] = question
    ? buildQuestionMessages(
        {
          ...question,
          intro: question.intro
            ? expandVariables(question.intro, friendWithMeta, workerUrl, 'text', extra)
            : question.intro,
          text: expandVariables(question.text, friendWithMeta, workerUrl, 'text', extra),
        },
        currentStep.id,
      )
    : [buildMessage(tracked.messageType, tracked.content)];
  // Resolve the correct LINE client for this friend's account
  let deliveryClient = lineClient;
  if (deliveryAccountId) {
    const { getLineAccountById } = await import('@line-crm/db');
    const account = await getLineAccountById(db, deliveryAccountId);
    if (!account) {
      await pauseFriendScenarioDelivery(db, fs.id);
      console.warn(
        `[step-delivery] paused enrollment=${fs.id}: missing LINE account=${deliveryAccountId}`,
      );
      return false;
    }
    const { LineClient: LC } = await import('@line-crm/line-sdk');
    deliveryClient = new LC(account.channel_access_token);
  }
  await deliveryClient.pushMessage(friend.line_user_id, messages);

  // Log what we actually pushed: variables expanded, URLs auto-tracked, AND
  // any cleanEmptyNodes() mutation or parse-failure text fallback applied by
  // buildMessage(). Use scenario_step_id to recover the original template.
  //
  // 質問は前文と本体で2通になることがある。押した記録と突き合わせられるよう、
  // 送った通ぶんすべて残す。
  for (const sent of messages) {
    const logPayload = messageToLogPayload(sent);
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, template_id_at_send, line_account_id, created_at)
         VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, 'scenario', ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), friend.id, logPayload.messageType, logPayload.content, currentStep.id, resolved.templateIdAtSend, deliveryAccountId, jstNow())
      .run();
  }

  // Determine next step (find the step after currentStep in the sorted list)
  const currentIndex = steps.indexOf(currentStep);
  const nextStep = currentIndex + 1 < steps.length ? steps[currentIndex + 1] : null;

  /*
   * この通に「送信後 一時停止」が付いていたら、次へ進めずに止める。
   *
   * 体調の記録をお願いして返事を待つ、といった流れで要る。止めておけば、
   * 返事が来てから人が再開できる。列が無かったころは送ったら必ず次へ進み、
   * 返事を待つあいだにも次の通が届いていた。
   *
   * 止めるのは送ったあと。送る前に止めると、この通そのものが届かない。
   */
  if ((currentStep.after_send ?? 'continue') === 'pause') {
    await pauseFriendScenario(db, fs.id, currentStep.step_order);
  } else if (nextStep) {
    const jitteredDate = jitterDeliveryTime(nextDeliveryFor(nextStep));
    await advanceFriendScenario(db, fs.id, currentStep.step_order, jitteredDate.toISOString().slice(0, -1) + '+09:00');
  } else {
    // This was the last step
    await finishScenario(db, fs.id, fs.scenario_id, fs.friend_id, scenarioRow);
  }

  // 到達タグ付与 (advance / complete の後 = 再送が起きてもタグ付与は影響しない順序)
  // 失敗してもログに残すだけで配信フローは止めない。
  if (currentStep.on_reach_tag_id) {
    try {
      await addTagToFriend(db, friend.id, currentStep.on_reach_tag_id);
    } catch (err) {
      console.error(`[scenario] tag attach failed step=${currentStep.id}:`, err);
    }
  }

  /*
   * この通に紐づくアクション。
   *
   * 進行を決めたあとに動かす。先に動かすと、アクションが購読を止めたのに
   * そのあとの advance が起こして、止めたつもりが進む。
   *
   * 失敗しても配信フローは止めない（runScenarioActions が中で握りつぶす）。
   */
  await runScenarioActions(db, {
    scenarioId: fs.scenario_id,
    hook: 'step_sent',
    friendId: friend.id,
    stepId: currentStep.id,
  });

  return true;
}

/**
 * 最終コンテンツを配り終えたあとの処理。
 *
 * Lステップの「最終コンテンツ配信後の処理」にあたる。
 *   pause           … 止める（これまでと同じ）
 *   resume_previous … 割り込む前に読んでいたシナリオへ戻す
 *   move            … 別のシナリオへ移す
 *
 * どれを選んでいても、まず完了にしてからアクションを動かす。完了にする前に
 * 別シナリオへ移すと、並行を許さない設定のときに「まだ読んでいる」と見なされて
 * 移動そのものが弾かれる。
 */
export async function finishScenario(
  db: D1Database,
  enrollmentId: string,
  scenarioId: string,
  friendId: string,
  scenario: { on_complete_mode: string | null; on_complete_scenario_id: string | null },
): Promise<void> {
  const mode = scenario.on_complete_mode ?? 'pause';

  await completeFriendScenario(db, enrollmentId);

  try {
    if (mode === 'resume_previous') {
      await resumePreviousScenario(db, friendId, scenarioId);
    } else if (mode === 'move' && scenario.on_complete_scenario_id) {
      await runScenarioOp(db, friendId, scenarioId, {
        op: 'start',
        scenarioId: scenario.on_complete_scenario_id,
        restart: 'from_start',
      });
    }
  } catch (err) {
    console.error(`[step-delivery] on-complete (${mode}) failed scenario=${scenarioId}`, err);
  }

  await runScenarioActions(db, {
    scenarioId,
    hook: 'scenario_completed',
    friendId,
  });
}

/** Supported scenario step condition_type values evaluated at delivery time. */
export const SUPPORTED_CONDITION_TYPES = [
  'tag_exists',
  'tag_not_exists',
  'metadata_equals',
  'metadata_not_equals',
] as const;
export type ConditionType = (typeof SUPPORTED_CONDITION_TYPES)[number];

export function isSupportedConditionType(value: unknown): value is ConditionType {
  return typeof value === 'string' && (SUPPORTED_CONDITION_TYPES as readonly string[]).includes(value);
}

/**
 * Evaluate a scenario step's condition_type/condition_value at delivery time.
 *
 * Semantics:
 *  - condition_type null/empty (no condition configured) → `true` (deliver normally).
 *  - condition_type set but condition_value missing/empty → `false` (skip + log).
 *    This is the same OSS issue #120 over-delivery pattern: a configured condition with
 *    no value would otherwise match every friend, e.g. tag_not_exists with empty value
 *    binds '' into the SQL and returns 0 rows → "tag absent" for everyone.
 *  - unknown condition_type or malformed condition_value JSON → `false` (skip + log).
 *  - condition_type + condition_value valid → actually evaluate.
 */
export async function evaluateCondition(
  db: D1Database,
  friendId: string,
  step: { condition_type: string | null; condition_value: string | null },
): Promise<boolean> {
  // No condition configured at all → deliver as usual.
  if (!step.condition_type) return true;

  if (!isSupportedConditionType(step.condition_type)) {
    console.error(
      `[scenario] unknown condition_type "${step.condition_type}" for friend=${friendId} — skipping step. ` +
        `Supported types: ${SUPPORTED_CONDITION_TYPES.join(', ')}`,
    );
    return false;
  }

  if (!step.condition_value) {
    console.error(
      `[scenario] condition_type=${step.condition_type} is set but condition_value is empty for friend=${friendId} — skipping step`,
    );
    return false;
  }

  switch (step.condition_type) {
    case 'tag_exists': {
      const tag = await db
        .prepare(
          `SELECT 1 FROM friend_tags ft
           INNER JOIN friends tagged_friend ON tagged_friend.id = ft.friend_id
           WHERE ft.tag_id = ?
             AND (
               tagged_friend.id = ?
               OR tagged_friend.user_id = (
                 SELECT user_id FROM friends WHERE id = ? AND user_id IS NOT NULL
               )
             )
           LIMIT 1`,
        )
        .bind(step.condition_value, friendId, friendId)
        .first();
      return !!tag;
    }
    case 'tag_not_exists': {
      const tag = await db
        .prepare(
          `SELECT 1 FROM friend_tags ft
           INNER JOIN friends tagged_friend ON tagged_friend.id = ft.friend_id
           WHERE ft.tag_id = ?
             AND (
               tagged_friend.id = ?
               OR tagged_friend.user_id = (
                 SELECT user_id FROM friends WHERE id = ? AND user_id IS NOT NULL
               )
             )
           LIMIT 1`,
        )
        .bind(step.condition_value, friendId, friendId)
        .first();
      return !tag;
    }
    case 'metadata_equals':
    case 'metadata_not_equals': {
      let raw: unknown;
      try {
        raw = JSON.parse(step.condition_value);
      } catch {
        console.error(
          `[scenario] malformed condition_value JSON for friend=${friendId} type=${step.condition_type} — skipping step`,
        );
        return false;
      }
      if (
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        typeof (raw as { key?: unknown }).key !== 'string' ||
        !('value' in (raw as Record<string, unknown>))
      ) {
        // 既存行や直接 INSERT された行で {"key":"x"} のように value が欠落しているケースは
        // friend.metadata[x] === undefined と比較されて「key 不在の全友だち」に一致する
        // (= 同じ OSS issue #120 の over-delivery を再現する) ので明示的にスキップする。
        console.error(
          `[scenario] condition_value missing key/value for friend=${friendId} type=${step.condition_type} — skipping step`,
        );
        return false;
      }
      const parsed = raw as { key: string; value: unknown };
      const friend = await db
        .prepare('SELECT user_id, metadata FROM friends WHERE id = ?')
        .bind(friendId)
        .first<{ user_id: string | null; metadata: string | null }>();
      const metadata = await resolveMetadata(db, {
        user_id: friend?.user_id ?? null,
        metadata: friend?.metadata ?? null,
      });
      const actual = metadata[parsed.key];
      return step.condition_type === 'metadata_equals'
        ? actual === parsed.value
        : actual !== parsed.value;
    }
  }
}


/**
 * Derive (messageType, content) from a built `Message` object so that what
 * lands in messages_log mirrors what was actually pushed to LINE — including
 * cleanEmptyNodes() mutations and any parse-failure text fallback inside
 * buildMessage(). Use this whenever you log a message you just pushed.
 */
export function messageToLogPayload(message: Message): { messageType: string; content: string } {
  if (message.type === 'text') return { messageType: 'text', content: message.text };
  if (message.type === 'flex') return { messageType: 'flex', content: JSON.stringify(message.contents) };
  if (message.type === 'image') {
    return {
      messageType: 'image',
      content: JSON.stringify({
        originalContentUrl: message.originalContentUrl,
        previewImageUrl: message.previewImageUrl,
      }),
    };
  }
  return { messageType: message.type, content: JSON.stringify(message) };
}

