import { logger } from '@line-crm/shared/server';
import { getScenarios, enrollFriendInScenario, resumeFriendScenario, type FriendScenario, ensureFriendAddFallbackRules } from '@line-crm/db';

import { FRIEND_ADD_ROUTING_DEFAULT, type FriendAddRouting, type FriendAddBranch } from '@line-crm/shared';


import type { ImmediatePushContext } from '../../services/immediate-first-step.js';

import { type FriendKind, type FriendAddSuppressReason, type FriendAddSubject, classifyFriend, loadFriendAddRouting } from './friend-add-routing-pick-string.js';
import { type PublishedFriendAddSelection, loadPublishedFriendAddCandidates, type PublishedFriendAddCandidate, evaluateFriendAddRuleConditions, type FriendAddRoutingResult, ruleActions, runActions, type FriendAddEnrollment } from './friend-add-routing-find-friend-add-unusable-references.js';

/**
 * 優先順位どおりに公開版を選び、曜日・時間帯・友だち条件・再送制限も見る。
 *
 * 2段階で選ぶ。受け皿は「経路が分からなかった人」のためだけに残す。
 *
 * 1. 流入経路に合う通常ルールを優先順位順に見る。条件をすべて通った最初の
 *    1件が勝ち。経路は合うが条件に合わないものしか無いときは、受け皿へ
 *    落とさず抑止する（経路が分かっている人に「経路不明の人用」を届けない）。
 * 2. 通常ルールが経路に1件も合わないときだけ、受け皿を見る。
 *
 * 再送制限で止まったときは下の順位を試さない。送ったばかりの人に別の
 * シナリオを送ると、制限を付けた意味が無くなる。
 */
export async function selectPublishedFriendAddRule(
  db: D1Database,
  input: {
    accountId: string;
    friendId: string;
    kind: FriendKind;
    entryRouteId: string | null;
    now: Date;
  },
): Promise<PublishedFriendAddSelection> {
  const none = { selected: null, evaluated: null, reason: null } as PublishedFriendAddSelection;
  const candidates = await loadPublishedFriendAddCandidates(db, input);
  if (candidates.length === 0) return none;
  const check = async (
    candidate: PublishedFriendAddCandidate,
  ): Promise<{ matched: boolean; reason: FriendAddSuppressReason | null }> =>
    evaluateFriendAddRuleConditions(db, {
      lineAccountId: input.accountId,
      friendId: input.friendId,
      definition: candidate.definition,
      now: input.now,
    });

  const routed = candidates.filter((candidate) => !candidate.isFallback);
  let firstFailure: { candidate: PublishedFriendAddCandidate; reason: FriendAddSuppressReason } | null = null;
  for (const candidate of routed) {
    const result = await check(candidate);
    if (result.matched) return { selected: candidate, evaluated: candidate, reason: null };
    if (result.reason === 'resend_suppressed') {
      return { selected: null, evaluated: candidate, reason: result.reason };
    }
    firstFailure ??= { candidate, reason: result.reason ?? 'outside_time_window' };
  }
  if (firstFailure) {
    return { selected: null, evaluated: firstFailure.candidate, reason: firstFailure.reason };
  }
  for (const candidate of candidates.filter((candidate) => candidate.isFallback)) {
    const result = await check(candidate);
    if (result.matched) return { selected: candidate, evaluated: candidate, reason: null };
    if (result.reason === 'resend_suppressed') {
      return { selected: null, evaluated: candidate, reason: result.reason };
    }
    firstFailure ??= { candidate, reason: result.reason ?? 'outside_time_window' };
  }
  if (firstFailure) {
    return { selected: null, evaluated: firstFailure.candidate, reason: firstFailure.reason };
  }
  return none;
}

/**
 * 設定に従って登録する。
 *
 * **設定が保存されていないアカウントでは何もしない**（`routed: false`）。
 * 呼ぶ側は、そのときだけ従来どおり全 friend_add シナリオを流す。
 */
export async function applyFriendAddRouting(
  db: D1Database,
  accountId: string | null,
  friend: FriendAddSubject,
  push?: ImmediatePushContext,
  routingContext?: {
    /** 各処理をこの実行台帳へ結び付ける。Webhook本番経路では必須。 */
    eventId?: string | null;
    entryRouteId?: string | null;
    now?: Date;
    sendRight?: boolean;
    claimError?: boolean;
    /**
     * 奪い直した予約に、前の持ち主の「送り始めた」印が残っていた。
     * 送ったかもしれないので送らず、理由を送達不明として残す。
     */
    dispatchUnknown?: boolean;
    /**
     * 送信権の持ち主かを確かめる関数（fencing）。登録・アクション・送信の
     * どれかを始める直前に呼ぶ。false なら回収されているので何もしない。
     * 渡さないときは確かめない（画面のテスト実行など、副作用が無い呼び出し）。
     */
    fence?: () => Promise<boolean>;
  },
): Promise<FriendAddRoutingResult> {
  const none: FriendAddRoutingResult = {
    routed: false,
    kind: null,
    enrollments: [],
    timing: FRIEND_ADD_ROUTING_DEFAULT.firstTime.timing,
    suppressed: false,
    suppressReason: null,
    ruleId: null,
    ruleVersionId: null,
    actionFailureCount: 0,
  };
  if (!accountId) return none;

  const now = routingContext?.now ?? new Date();
  const kind = classifyFriend(friend, FRIEND_ADD_ROUTING_DEFAULT.criteria.firstTime);
  await ensureFriendAddFallbackRules(db, accountId);
  const selection = await selectPublishedFriendAddRule(db, {
    accountId,
    friendId: friend.id,
    kind,
    entryRouteId: routingContext?.entryRouteId ?? null,
    now,
  });
  /*
   * 送信権を取れなかった実行は、選ぶだけ選んで登録も送信もしない。
   * 並行する勝った側が送るため、ここで enrollment を作ると cron が
   * 拾って二重に届いてしまう。追跡用に抑止として残す。
   */
  if (routingContext?.sendRight === false && selection.evaluated) {
    return {
      routed: true,
      kind,
      enrollments: [],
      timing: selection.evaluated.definition.timing,
      suppressed: true,
      suppressReason: routingContext?.claimError === true
        ? 'send_claim_unavailable'
        : (routingContext?.dispatchUnknown === true ? 'delivery_unknown' : 'duplicate_in_flight'),
      ruleId: selection.evaluated.ruleId,
      ruleVersionId: selection.evaluated.versionId,
    };
  }
  const matchedRule = selection.selected;
  /*
   * 経路は合うが曜日・時間帯・友だち条件・再送制限に止まった。
   * 送らず、どの公開版のどの理由かだけ残す。送信済みにはしない
   * （enrollment を作らず deliveryCount も上げないのは呼ぶ側の仕事）。
   */
  if (!matchedRule && selection.evaluated && selection.reason) {
    return {
      routed: true,
      kind,
      enrollments: [],
      timing: selection.evaluated.definition.timing,
      suppressed: true,
      suppressReason: selection.reason,
      ruleId: selection.evaluated.ruleId,
      ruleVersionId: selection.evaluated.versionId,
    };
  }
  const routing = matchedRule
    ? {
        firstTime: {
          scenarioId: matchedRule.definition.scenarioId,
          timing: matchedRule.definition.timing,
          actions: ruleActions(matchedRule.definition.actions),
        },
        returning: {
          scenarioId: matchedRule.definition.scenarioId,
          mode: matchedRule.definition.returningMode ?? 'other',
          startPosition: matchedRule.definition.startPosition ?? 'beginning',
          actions: ruleActions(matchedRule.definition.actions),
        },
        criteria: FRIEND_ADD_ROUTING_DEFAULT.criteria,
      } satisfies FriendAddRouting
    : await loadFriendAddRouting(db, accountId);
  if (!routing) return none;

  /*
   * ここから先は登録・アクション・送信の副作用に入る。**外部送信と同じ
   * fence をくぐらせる。** 条件の評価に時間がかかった間に予約を回収されて
   * いたら、勝った側が送るのでこちらは何もしない。アクションだけ実行して
   * 送信はしない、という食い違いを作らない。
   */
  if (routingContext?.fence && !(await routingContext.fence())) {
    return {
      routed: true,
      kind,
      enrollments: [],
      timing: matchedRule?.definition.timing ?? routing.firstTime.timing,
      suppressed: true,
      suppressReason: 'send_right_revoked',
      ruleId: matchedRule?.ruleId ?? null,
      ruleVersionId: matchedRule?.versionId ?? null,
    };
  }

  const timing = routing.firstTime.timing;
  const classifiedKind = matchedRule ? kind : classifyFriend(friend, routing.criteria.firstTime);

  if (matchedRule?.definition.messageType === 'text' &&
      !(classifiedKind === 'returning' && routing.returning.mode === 'none')) {
    const actionResult = await runActions(db, friend.id, ruleActions(matchedRule.definition.actions), push, routingContext?.fence,
      routingContext?.eventId ? { eventId: routingContext.eventId, ruleVersionId: matchedRule.versionId, lineAccountId: accountId } : undefined);
    const messageText = matchedRule.definition.messageText;
    return { routed: true, kind: classifiedKind, enrollments: [], timing,
      suppressed: !messageText.trim(), suppressReason: messageText.trim() ? null : 'delivery_disabled',
      ruleId: matchedRule.ruleId, ruleVersionId: matchedRule.versionId,
      actionFailureCount: actionResult.failed, messageText };
  }

  // ② で「配信しない」を選んでいる
  if (classifiedKind === 'returning' && routing.returning.mode === 'none') {
    const actionResult = await runActions(
      db, friend.id, routing.returning.actions, push, routingContext?.fence,
      routingContext?.eventId ? {
        eventId: routingContext.eventId,
        ruleVersionId: matchedRule?.versionId ?? null,
        lineAccountId: accountId,
      } : undefined,
    );
    return {
      routed: true,
      kind: classifiedKind,
      enrollments: [],
      timing,
      suppressed: true,
      suppressReason: 'delivery_disabled',
      ruleId: matchedRule?.ruleId ?? null,
      ruleVersionId: matchedRule?.versionId ?? null,
      actionFailureCount: actionResult.failed,
    };
  }

  // ② が「はじめての人と同じもの」なら ① の設定を使う
  const useFirst = classifiedKind === 'first_time' || routing.returning.mode === 'same';
  const branch: FriendAddBranch = useFirst ? routing.firstTime : routing.returning;

  /*
   * シナリオを決めていない。
   *
   * ①（はじめての人）で決めていないのは**意図した設定**。画面にも
   * 「決めていない（有効なシナリオを全部流す）」と書いてある。従来どおり流す。
   *
   * ②で「別のシナリオを配信する」を選んでシナリオが空なのは**書きかけ**。
   * ここで従来どおりに落とすと、**有効な友だち追加シナリオが全部流れる**。
   * この画面は「以前からのお客さまに『はじめまして』を届けない」ために
   * あるのに、書きかけの設定がいちばん困る結果（全部届く）になる。
   *
   * 送らないほうへ倒す。「別のシナリオ」と決めた人が、そのシナリオを
   * 選び忘れただけで全部届くよりは、何も届かないほうがまだ直せる。
   * 画面側でも保存させないようにしてある。
   */
  if (!branch.scenarioId) {
    if (matchedRule) {
      const actionResult = await runActions(
        db, friend.id, branch.actions, push, routingContext?.fence,
        routingContext?.eventId ? {
          eventId: routingContext.eventId,
          ruleVersionId: matchedRule.versionId,
          lineAccountId: accountId,
        } : undefined,
      );
      return {
        routed: true,
        kind: classifiedKind,
        enrollments: [],
        timing,
        suppressed: true,
        suppressReason: 'delivery_disabled',
        ruleId: matchedRule.ruleId,
        ruleVersionId: matchedRule.versionId,
        actionFailureCount: actionResult.failed,
      };
    }
    if (classifiedKind === 'returning' && routing.returning.mode === 'other') {
      logger.warn("services_friend_add_routing_warn");
      const actionResult = await runActions(
        db, friend.id, routing.returning.actions, push, routingContext?.fence,
        routingContext?.eventId ? {
          eventId: routingContext.eventId,
          ruleVersionId: null,
          lineAccountId: accountId,
        } : undefined,
      );
      return {
        routed: true,
        kind: classifiedKind,
        enrollments: [],
        timing,
        suppressed: true,
        suppressReason: 'delivery_disabled',
        ruleId: null,
        ruleVersionId: null,
        actionFailureCount: actionResult.failed,
      };
    }
    return none;
  }

  /*
   * 「前回読んだところから」は、**②に当たる人すべて**で意味がある。
   *
   * 以前は「別のシナリオを選んだとき」だけに絞っていたが、
   * 「はじめての人と同じものを配信する」を選んでいるアカウントで、
   * **ブロックを解除した人に何も届かない**という壊れ方をしていた。
   *
   * ブロック中に購読が止まっている（status='paused'）と、
   * `enrollFriendInScenario` は部分UNIQUE索引（status != 'completed'）に
   * 弾かれて null を返す。resume も呼ばれないので、止まったまま何も起きない。
   * 解除した本人にも、設定した人にも、何が起きていないのか分からない。
   *
   * ①（はじめての人）では効かせない。履歴が無いので resume は必ず空振りし、
   * 呼ぶだけ1クエリ増える。
   */
  const wantResume = classifiedKind === 'returning' && routing.returning.startPosition === 'resume';

  const enrollments: FriendAddEnrollment[] = [];
  let record: FriendScenario | null = null;
  let resumed = false;
  // 登録は cron の配信につながる外部効果。書く直前にもう一度確かめる。
  if (routingContext?.fence && !(await routingContext.fence())) {
    return {
      routed: true,
      kind: classifiedKind,
      enrollments: [],
      timing,
      suppressed: true,
      suppressReason: 'send_right_revoked',
      ruleId: matchedRule?.ruleId ?? null,
      ruleVersionId: matchedRule?.versionId ?? null,
    };
  }
  if (wantResume) {
    record = await resumeFriendScenario(db, friend.id, branch.scenarioId);
    resumed = record !== null;
    // 続きが無い（読み終えている・そもそも入っていない）ときは最初から
    if (!record) record = await enrollFriendInScenario(db, friend.id, branch.scenarioId);
  } else {
    record = await enrollFriendInScenario(db, friend.id, branch.scenarioId);
  }
  if (record) {
    enrollments.push({ scenarioId: branch.scenarioId, enrollment: record, resumed });
  }

  const actionResult = await runActions(
    db, friend.id, branch.actions, push, routingContext?.fence,
    routingContext?.eventId ? {
      eventId: routingContext.eventId,
      ruleVersionId: matchedRule?.versionId ?? null,
      lineAccountId: accountId,
    } : undefined,
  );

  return {
    routed: true,
    kind: classifiedKind,
    enrollments,
    timing,
    suppressed: false,
    suppressReason: null,
    ruleId: matchedRule?.ruleId ?? null,
    ruleVersionId: matchedRule?.versionId ?? null,
    actionFailureCount: actionResult.failed,
  };
}

/**
 * 下書きのdry-runと本番前確認が共有する判定器。
 * DBへの登録・配信・タグ付けは行わず、実行時と同じ分岐だけを返す。
 */
export function previewFriendAddRoutingDefinition(
  routing: FriendAddRouting,
  friend: FriendAddSubject,
): { kind: FriendKind; scenarioId: string | null; suppressed: boolean; actionCount: number } {
  const kind = classifyFriend(friend, routing.criteria.firstTime);
  if (kind === 'returning' && routing.returning.mode === 'none') {
    return {
      kind,
      scenarioId: null,
      suppressed: true,
      actionCount: routing.returning.actions.length,
    };
  }
  const useFirst = kind === 'first_time' || routing.returning.mode === 'same';
  const branch = useFirst ? routing.firstTime : routing.returning;
  return {
    kind,
    scenarioId: branch.scenarioId,
    suppressed: false,
    actionCount: branch.actions.length,
  };
}

/**
 * 画面の「テスト実行」用。**登録も配信もしない。**
 * この人ならどちらに振り分けられるかだけを返す。
 */
export async function previewFriendAddRouting(
  db: D1Database,
  accountId: string,
  friend: FriendAddSubject,
): Promise<{ configured: boolean; kind: FriendKind; scenarioId: string | null; suppressed: boolean }> {
  const savedRouting = await loadFriendAddRouting(db, accountId);
  const routing = savedRouting ?? FRIEND_ADD_ROUTING_DEFAULT;
  const configured = savedRouting !== null;
  return { configured, ...previewFriendAddRoutingDefinition(routing, friend) };
}

/** 画面が選択肢を出すための friend_add シナリオ一覧。 */
export async function listFriendAddScenarios(
  db: D1Database,
  accountId: string | null,
): Promise<{ id: string; name: string }[]> {
  /*
   * 候補は**すべてのシナリオ**にする。
   *
   * これまで trigger_type === 'friend_add' のものだけを出していたので、
   * 「このシナリオを友だち追加で流したい」と思っても、シナリオ側の設定を
   * 先に変えないと選べなかった。呼ぶ側で選ぶのが自然なので、ここで絞らない。
   *
   * アカウント違いだけは外す。他のアカウントのシナリオを選んでも配れない。
   */
  const scenarios = await getScenarios(db);
  return scenarios
    .filter(s => !s.line_account_id || !accountId || s.line_account_id === accountId)
    .map(s => ({ id: s.id, name: s.name }));
}
