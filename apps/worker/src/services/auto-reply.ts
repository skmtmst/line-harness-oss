import type { LineClient } from '@line-crm/line-sdk';
import {
  ensureAutoReplyPublishedVersion,
  finishAutoReplyActionRun,
  getTemplateById,
  markAutoReplyEvaluationFinished,
  markAutoReplyEvaluationMatched,
  markAutoReplyEvaluationSkipped,
  recordAutoReplyEvaluationDetail,
  reserveAutoReplyActionRun,
  reserveAutoReplyEvaluation,
} from '@line-crm/db';
import type { AutoReply, Friend } from '@line-crm/db';
import { logOutgoingMessage } from './event-bus.js';
import { evaluateAutoReplyConditions } from './auto-reply-conditions.js';
import {
  runActionRows,
  type RunActionsResult,
  type ScenarioActionRow,
} from './scenario-actions.js';
import { recordAutoReplyHit } from '@line-crm/db';
import { resolveInterpolationExtra } from './interpolation-context.js';
import {
  buildMessage,
  expandVariables,
  messageToLogPayload,
  resolveMetadata,
} from './step-delivery.js';

/**
 * キーワード1行ぶんの設定（151）。
 *
 * これまでは1ルールに言葉が1つだけだった。実運用では「渋谷」「しぶや」
 * 「シブヤ」を同じ応答にしたい、という形が普通なので、複数行を持てるようにする。
 */
export interface KeywordRule {
  keyword: string;
  matchType: 'exact' | 'contains';
  /**
   * 受け取った文がこの字数に満たなければ当てない。
   *
   * 部分一致は短い言葉ほど誤爆する。「はい」を含む応答を作ると
   * 「はいどうも」「配送はいつ」まで当たってしまう。字数の下限を置くと、
   * ひとことの返事だけを拾える。
   */
  minLength?: number;
  /**
   * 大文字小文字・全角半角を区別するか。既定は区別する。
   * 切ると「LINE」「line」「ＬＩＮＥ」が同じものとして当たる。
   */
  caseSensitive?: boolean;
}

/** 大文字小文字と全角半角の違いを均す。 */
function normalizeForLooseMatch(text: string): string {
  return text
    .normalize('NFKC') // 全角英数・半角カナをそろえる
    .toLowerCase();
}

/** キーワード1行ぶんの判定。 */
export function keywordRuleMatches(rule: KeywordRule, text: string): boolean {
  const keyword = rule.keyword ?? '';
  if (keyword === '') return false;
  if (rule.minLength && [...text].length < rule.minLength) return false;

  const caseSensitive = rule.caseSensitive !== false;
  const haystack = caseSensitive ? text : normalizeForLooseMatch(text);
  const needle = caseSensitive ? keyword : normalizeForLooseMatch(keyword);

  if (rule.matchType === 'exact') return haystack === needle;
  if (rule.matchType === 'contains') return haystack.includes(needle);
  return false;
}

/**
 * `keywords_json` を読む。未設定なら、これまでどおり keyword / match_type を1行として扱う。
 *
 * 読めない設定は「1行も無い」ではなく**元の1行に戻す**。ここで空にすると、
 * 当たるはずのキーワードが黙って当たらなくなる。
 */
export function resolveKeywordRules(rule: {
  keyword: string;
  match_type: string;
  keywords_json?: string | null;
}): KeywordRule[] {
  const fallback: KeywordRule[] = [
    { keyword: rule.keyword, matchType: rule.match_type as KeywordRule['matchType'] },
  ];
  if (!rule.keywords_json) return fallback;
  try {
    const parsed = JSON.parse(rule.keywords_json) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;
    const rules = parsed.flatMap((item): KeywordRule[] => {
      if (!item || typeof item !== 'object') return [];
      const r = item as Record<string, unknown>;
      const keyword = r.keyword;
      if (typeof keyword !== 'string' || keyword === '') return [];
      const matchType = r.matchType === 'contains' ? 'contains' : 'exact';
      return [
        {
          keyword,
          matchType,
          minLength: typeof r.minLength === 'number' ? r.minLength : undefined,
          caseSensitive: r.caseSensitive === false ? false : undefined,
        },
      ];
    });
    return rules.length > 0 ? rules : fallback;
  } catch {
    console.error('[auto-reply] unreadable keywords_json — fell back to the single keyword');
    return fallback;
  }
}

/**
 * キーワードに当たるか。
 *
 * 複数行あるときの見方は2つ（158）。
 *   'any' … どれか1つに当たれば当たり（既定）
 *   'all' … 全部そろって初めて当たり
 *
 * 'all' は絞り込みに使う。「予約」と「キャンセル」の両方が入った文にだけ返す、
 * という形。どちらか片方だけの問い合わせには返さない。
 *
 * webhook のテキスト/postback 経路と unanswered-inbox の「構造化メッセ除外」
 * 判定が、同じ解釈を共有する。未知の match_type は当てない
 * （誤って当てて inbox から隠すより安全側）。
 */
export function keywordMatches(
  rule: {
    keyword: string;
    match_type: string;
    keywords_json?: string | null;
    respond_to_all?: number;
    keyword_match_mode?: string | null;
  },
  text: string,
): boolean {
  // 157: 一律で応答するルールは、キーワードを見ない。
  // 「営業時間外は必ずこれを返す」を作るための形。時間帯や友だち条件は
  // このあとで見るので、いつでも誰にでも返るわけではない。
  if (rule.respond_to_all === 1) return true;

  const rules = resolveKeywordRules(rule);
  if (rule.keyword_match_mode === 'all') {
    // 1行も無いときに every が true を返すと、全部に当たってしまう。
    // resolveKeywordRules は最低1行を返すので通常は起きないが、明示しておく。
    return rules.length > 0 && rules.every((k) => keywordRuleMatches(k, text));
  }
  return rules.some((k) => keywordRuleMatches(k, text));
}

/**
 * 対象のメッセージ種別か。
 *
 * message_kinds_json が無ければ何でも対象。壊れていても対象にする。
 * 設定が読めないからといって返さない、では自動応答が黙って消える。
 */
export function matchesMessageKind(
  rule: { message_kinds_json?: string | null },
  kind = 'text',
): boolean {
  if (!rule.message_kinds_json) return true;
  try {
    const kinds = JSON.parse(rule.message_kinds_json) as unknown;
    if (!Array.isArray(kinds) || kinds.length === 0) return true;
    return kinds.includes(kind);
  } catch {
    return true;
  }
}

/**
 * auto_reply 行の content/type を resolve する。template_id が set なら templates
 * から取得、参照切れや NULL のときは inline response_content/response_type を使う。
 */
export async function resolveAutoReplyContent(
  db: D1Database,
  rule: Pick<AutoReply, 'template_id' | 'response_type' | 'response_content'>,
): Promise<{ messageType: string; content: string }> {
  if (rule.template_id) {
    const tpl = await getTemplateById(db, rule.template_id);
    if (tpl) {
      return { messageType: tpl.message_type, content: tpl.message_content };
    }
  }
  return { messageType: rule.response_type, content: rule.response_content };
}

/** 送信せず、本番と同じ差し込み解決まで行った返信内容を返す。 */
export async function previewAutoReplyContent(
  db: D1Database,
  friend: Friend,
  rule: AutoReply,
  workerUrl?: string,
): Promise<{ messageType: string; content: string }> {
  const resolvedMeta = await resolveMetadata(db, friend);
  const resolved = await resolveAutoReplyContent(db, rule);
  const extra = await resolveInterpolationExtra(db, friend.id, resolved.content);
  return {
    messageType: resolved.messageType,
    content: expandVariables(
      resolved.content,
      { ...friend, metadata: resolvedMeta },
      workerUrl,
      resolved.messageType,
      extra,
    ),
  };
}

/**
 * `actions_json` を、アクション実行が受け取れる形に読む。
 *
 * 形はシナリオのアクション（scenario_actions の行）と同じにしてある。実行そのものを
 * 1か所（runActionRows）に寄せるため、自動応答専用のアクションは作らない。
 *
 * 読めない設定は空として扱う。ここで落とすと、キーワードに当たっても
 * 返信ごと止まる。アクションが動かないより、返信が来ないほうが困る。
 */
export function parseAutoReplyActions(raw: string | null | undefined): ScenarioActionRow[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[auto-reply] unreadable actions_json — ignored');
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item, index): ScenarioActionRow[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const actionType = row.actionType ?? row.action_type;
    const config = row.config ?? row.config_json;
    if (typeof actionType !== 'string' || config === undefined) return [];
    return [
      {
        // 実行側は id をログにしか使わない。並び順が分かる値にしておく。
        id: `auto-reply-action-${index}`,
        // 自動応答はシナリオに属さない。'scenario' アクションで
        // 「1つ前のシナリオを再開」を選んだときの起点が無いので、空にしておく。
        scenario_id: '',
        hook: 'step_sent',
        step_id: null,
        choice_index: null,
        sort_order: index,
        action_type: actionType as ScenarioActionRow['action_type'],
        config_json: typeof config === 'string' ? config : JSON.stringify(config),
        condition_json:
          typeof row.condition === 'string'
            ? row.condition
            : row.condition
              ? JSON.stringify(row.condition)
              : null,
        // 自動応答は当たるたびに動かす。「2回目以降は実行しない」を使いたい場合は
        // ルール側の「1人につき1回だけ応答する」で止める。
        repeat_on_refire: 1,
      },
    ];
  });
}

export interface MatchAndReplyResult {
  matched: boolean;
  replyTokenConsumed: boolean;
}

function normalizedInput(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 履歴一覧へ生の個人情報を残さない。本文は messages_log で権限付き表示する。 */
function maskedInputPreview(text: string): string {
  const masked = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[メールアドレス]')
    .replace(/(?:\+?81[-\s]?)?(?:0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})/g, '[電話番号]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[識別子]');
  return [...masked].slice(0, 80).join('');
}

export function matchedKeywordLabel(rule: AutoReply, text: string): string {
  if (rule.respond_to_all === 1) return 'すべてのメッセージ';
  return resolveKeywordRules(rule)
    .filter((keyword) => keywordRuleMatches(keyword, text))
    .map((keyword) => keyword.keyword)
    .join('・') || rule.keyword;
}

function addActionResult(total: RunActionsResult, current: RunActionsResult): void {
  total.executed += current.executed;
  total.skippedByCondition += current.skippedByCondition;
  total.skippedByOnce += current.skippedByOnce;
  total.failed += current.failed;
  total.skippedIncomplete += current.skippedIncomplete;
  total.scenarioTouched ||= current.scenarioTouched;
}

function emptyActionResult(): RunActionsResult {
  return {
    executed: 0,
    skippedByCondition: 0,
    skippedByOnce: 0,
    failed: 0,
    skippedIncomplete: 0,
    scenarioTouched: false,
  };
}

function actionResultStatus(result: RunActionsResult): 'succeeded' | 'skipped' | 'permanent_failed' {
  if (result.failed > 0) return 'permanent_failed';
  if (result.executed > 0) return 'succeeded';
  return 'skipped';
}

function actionCounts(result: RunActionsResult): Record<string, number> {
  return {
    executed: result.executed,
    skippedByCondition: result.skippedByCondition,
    skippedByOnce: result.skippedByOnce,
    failed: result.failed,
    skippedIncomplete: result.skippedIncomplete,
  };
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 80);
  return 'unknown_error';
}

export type AutoReplyCandidateReasonCode =
  | 'message_kind_not_matched'
  | 'keyword_not_matched'
  | 'outside_active_window'
  | 'weekday_not_allowed'
  | 'operator_handling'
  | 'already_replied_once'
  | 'cooldown_active'
  | 'friend_conditions_not_met';

export interface AutoReplyCandidateEvaluation {
  rule: AutoReply;
  order: number;
  result: 'not_matched' | 'skipped' | 'won';
  reasonCodes: AutoReplyCandidateReasonCode[];
}

/** DBのORDER BYと同じ。下書きを混ぜる試験でも本番順を変えない。 */
export function compareAutoReplyCandidates(a: AutoReply, b: AutoReply): number {
  return Number(a.line_account_id === null) - Number(b.line_account_id === null)
    || a.priority - b.priority
    || a.respond_to_all - b.respond_to_all
    || a.created_at.localeCompare(b.created_at);
}

/**
 * 本番返信と試験画面が共有する評価器。送信・記録・状態更新は一切しない。
 * 先に通った1件で止める順番も本番と同じにする。
 */
export async function evaluateAutoReplyCandidates(
  db: D1Database,
  candidates: AutoReply[],
  input: {
    friendId: string;
    incomingText: string;
    messageKind?: string;
    now: Date;
  },
): Promise<AutoReplyCandidateEvaluation[]> {
  const evaluations: AutoReplyCandidateEvaluation[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (!matchesMessageKind(candidate, input.messageKind)) {
      evaluations.push({
        rule: candidate,
        order: index + 1,
        result: 'not_matched',
        reasonCodes: ['message_kind_not_matched'],
      });
      continue;
    }
    if (!keywordMatches(candidate, input.incomingText)) {
      evaluations.push({
        rule: candidate,
        order: index + 1,
        result: 'not_matched',
        reasonCodes: ['keyword_not_matched'],
      });
      continue;
    }
    const condition = await evaluateAutoReplyConditions(db, candidate, input.friendId, input.now);
    if (!condition.matches) {
      evaluations.push({
        rule: candidate,
        order: index + 1,
        result: 'skipped',
        reasonCodes: condition.reasonCodes,
      });
      continue;
    }
    evaluations.push({ rule: candidate, order: index + 1, result: 'won', reasonCodes: [] });
    break;
  }
  return evaluations;
}

/**
 * incomingText を auto_replies (このアカウントのルール + グローバルルール) に
 * マッチさせ、最初にマッチしたルールで replyMessage を送って messages_log に
 * outgoing を記録する。webhook のテキストメッセージ経路と postback 経路の共通部。
 *
 * - silent タイプ: 返信せず matched=true だけ返す。テキスト経路では unread /
 *   push の抑止、postback 経路では「返信なしでタグだけ付ける」構成に使う。
 * - reply 失敗時も matched=true のまま (replyTokenConsumed=false)。呼び出し側は
 *   replyTokenConsumed=false のとき replyToken をイベントバスへ引き継げる。
 *
 * NOTE: auto-reply は replyMessage (無料・push 枠を消費しない) を使う。
 * replyToken の有効期限はイベントから約1分。
 */
export async function matchAndReply(
  db: D1Database,
  lineClient: LineClient,
  friend: Friend,
  incomingText: string,
  replyToken: string,
  opts: {
    lineAccountId?: string | null;
    workerUrl?: string;
    logContext?: string;
    /** 受け取ったメッセージの種別。省略時は text として扱う */
    messageKind?: string;
    /** LINE webhook の event ID。二重返信を防ぐため、省略不可。 */
    incomingEventId: string;
    /** 受信本文へ権限付きで辿るための messages_log ID。 */
    incomingMessageLogId?: string | null;
    /** LINE が付けた発生日時。 */
    occurredAt: string;
  },
): Promise<MatchAndReplyResult> {
  const {
    lineAccountId = null,
    workerUrl,
    logContext,
    incomingEventId,
    incomingMessageLogId = null,
    occurredAt,
  } = opts;

  // 台帳を確保できない状態で返信すると、Webhook再送時の二重実行を止められない。
  // 返信より先に必ず受信イベントを1行だけ確保する。
  const reservation = await reserveAutoReplyEvaluation(db, {
    incomingEventId,
    incomingMessageLogId,
    lineAccountId,
    friendId: friend.id,
    messageKind: opts.messageKind ?? 'text',
    normalizedTextHash: await sha256(normalizedInput(incomingText)),
    inputPreviewMasked: maskedInputPreview(incomingText),
    occurredAt,
  });
  if (!reservation.created) {
    // 同じイベントは再評価も再送もしない。進行中も下流の自動返信へ渡さない。
    if (reservation.row.status === 'skipped') {
      return { matched: false, replyTokenConsumed: false };
    }
    return { matched: true, replyTokenConsumed: true };
  }
  const evaluationId = reservation.row.id;

  // グローバルルール (line_account_id IS NULL) + このアカウントのルール。
  // lineAccountId が null のときは `= NULL` が偽になるのでグローバルのみ残る。
  // 上から順に評価して、最初に当てはまった1件だけを動かす。
  // 並び順は priority が先で、同じなら作った順。一覧の並びと評価順を
  // 一致させないと、「上にあるのに動かない」という形で食い違う。
  /*
   * 並び順は priority が先で、同じなら「キーワードのあるもの」を先に見る。
   *
   * 一律で応答するルール（157）が上にあると、そこで必ず止まって、キーワードの
   * ルールが1つも動かなくなる。しかも**一律のほうは返っている**ので、
   * 壊れていることに気づけない。画面の注意書きだけでは守れないので、
   * 並び順の既定で守る。
   *
   * 明示的に順番を決めたい人は、これまでどおり priority の数字で決められる。
   * **同じ数字のときだけ**この規則が効く。
   */
  const autoReplies = await db
    .prepare(
      `SELECT * FROM auto_replies WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?)
        ORDER BY CASE WHEN line_account_id = ? THEN 0 ELSE 1 END,
                 priority ASC, respond_to_all ASC, created_at ASC`,
    )
    .bind(lineAccountId, lineAccountId)
    .all<AutoReply>();

  // キーワードが合っても、時間帯・連投抑制・有人対応で返さないことがある。
  // 合ったものを1件だけ見るのではなく、条件まで通る最初の1件を探す。
  // 「営業時間内はAで返し、時間外はBで返す」を2行で書けるようにするため。
  const now = new Date(occurredAt);
  const candidateEvaluations = await evaluateAutoReplyCandidates(db, autoReplies.results, {
    friendId: friend.id,
    incomingText,
    messageKind: opts.messageKind,
    now,
  });
  let rule: AutoReply | undefined;
  let ruleVersionId = '';
  for (const evaluation of candidateEvaluations) {
    const version = await ensureAutoReplyPublishedVersion(db, evaluation.rule);
    await recordAutoReplyEvaluationDetail(db, {
      evaluationId,
      autoReplyId: evaluation.rule.id,
      ruleVersionId: version.id,
      order: evaluation.order,
      result: evaluation.result,
      reasonCodes: evaluation.reasonCodes,
    });
    if (evaluation.result === 'won') {
      rule = evaluation.rule;
      ruleVersionId = version.id;
    }
  }
  if (!rule) {
    await markAutoReplyEvaluationSkipped(db, evaluationId, 'no_matching_rule');
    return { matched: false, replyTokenConsumed: false };
  }

  const matchedKeyword = matchedKeywordLabel(rule, incomingText);
  await markAutoReplyEvaluationMatched(db, {
    evaluationId,
    autoReplyId: rule.id,
    versionId: ruleVersionId,
    matchedKeyword,
  });

  // 設定されたアクション（タグ付け・友だち情報・対応マーク・シナリオ・共通情報）を
  // 並べた順に実行する。返信より先に動かすのは、「タグを付けてから、そのタグで
  // 差し込む文面を作る」書き方ができるようにするため。
  const actions = parseAutoReplyActions(rule.actions_json);
  const actionSummary = emptyActionResult();
  if (actions.length > 0) {
    for (const action of actions) {
      const reserved = await reserveAutoReplyActionRun(db, {
        evaluationId,
        actionStableId: action.id,
        actionType: action.action_type,
        actionSnapshot: JSON.stringify(action),
        idempotencyKey: `${incomingEventId}:${action.id}`,
      });
      if (!reserved.acquired) continue;
      try {
        const result = await runActionRows(db, [action], friend.id);
        addActionResult(actionSummary, result);
        await finishAutoReplyActionRun(db, {
          id: reserved.id,
          status: actionResultStatus(result),
          errorCode: result.failed > 0 ? 'action_failed' : null,
          result: { ...result },
        });
      } catch (err) {
        actionSummary.failed += 1;
        await finishAutoReplyActionRun(db, {
          id: reserved.id,
          status: 'permanent_failed',
          errorCode: safeErrorCode(err),
        });
        console.error('[auto-reply] failed to run action', err);
      }
    }
  }

  if (rule.response_type === 'silent') {
    const allActionsSucceeded = actions.length > 0
      && actionSummary.executed === actions.length
      && actionSummary.failed === 0
      && actionSummary.skippedByCondition === 0
      && actionSummary.skippedByOnce === 0
      && actionSummary.skippedIncomplete === 0;
    await markAutoReplyEvaluationFinished(db, {
      evaluationId,
      status: allActionsSucceeded ? 'completed' : 'partial_failed',
      replyStatus: 'not_attempted',
      actionSummary: actionCounts(actionSummary),
      errorCode: allActionsSucceeded ? null : actions.length === 0 ? 'silent_without_actions' : 'action_incomplete',
    });
    if (allActionsSucceeded) {
      await recordAutoReplyHit(db, {
        autoReplyId: rule.id,
        friendId: friend.id,
        lineAccountId,
        matchedKeyword,
      });
    }
    return { matched: true, replyTokenConsumed: false };
  }

  let replyTokenConsumed = false;
  let lineRequestId: string | null = null;
  let messageLogId: string | null = null;
  let replyError: unknown = null;
  try {
    const resolved = await previewAutoReplyContent(db, friend, rule, workerUrl);
    const replyMsg = buildMessage(resolved.messageType, resolved.content);
    const response = await lineClient.replyMessageWithRequestId(replyToken, [replyMsg]);
    replyTokenConsumed = true;
    lineRequestId = response.requestId;

    // 送信ログ（replyMessage = 無料）— derive content from the built reply
    // message so any cleanEmptyNodes / parse-failure fallback is reflected
    // in the dashboard.
    const replyPayload = messageToLogPayload(replyMsg);
    messageLogId = await logOutgoingMessage(db, {
      friendId: friend.id,
      messageType: replyPayload.messageType,
      content: replyPayload.content,
      deliveryType: 'reply',
      source: 'auto_reply',
      lineAccountId,
    });
  } catch (err) {
    replyError = err;
    console.error(`Failed to send auto-reply${logContext ? ` (${logContext})` : ''}`, err);
  }

  if (replyTokenConsumed) {
    await markAutoReplyEvaluationFinished(db, {
      evaluationId,
      status: actionSummary.failed > 0 ? 'partial_failed' : 'completed',
      replyStatus: 'accepted',
      lineRequestId,
      messageLogId,
      actionSummary: actionCounts(actionSummary),
      errorCode: actionSummary.failed > 0 ? 'action_failed' : null,
    });
    try {
      await recordAutoReplyHit(db, {
        autoReplyId: rule.id,
        friendId: friend.id,
        lineAccountId,
        matchedKeyword,
      });
    } catch (error) {
      // LINEへの返信は既に成功している。集計の失敗を「返信失敗」へ書き換えない。
      console.error('[auto-reply] failed to record successful hit', error);
    }
  } else {
    await markAutoReplyEvaluationFinished(db, {
      evaluationId,
      status: actionSummary.executed > 0 ? 'partial_failed' : 'reply_failed',
      replyStatus: 'failed',
      lineRequestId,
      messageLogId,
      actionSummary: actionCounts(actionSummary),
      errorCode: safeErrorCode(replyError),
    });
  }

  return { matched: true, replyTokenConsumed };
}
