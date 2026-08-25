import { Hono } from 'hono';
import type { Env } from '../index.js';
import { verifySupportRelay } from '../services/support-relay.js';
import {
  handleSlackTaskAction,
  relayCodexSlackEvent,
  type CodexSlackCategory,
  type CodexSlackEvent,
  type CodexSlackPrSnapshot,
} from '../services/codex-slack-relay.js';
import { verifySlackRequest } from '../services/slack-signature.js';
import {
  hasClaudeToCodexMarker,
  hasActualSlackMention,
  isAllowedRelayChannel,
  isAllowedRelaySource,
  isAutomaticCodexRelay,
  isCodexRelayEnabled,
  markCodexMentionFailed,
  observeOfficialCodexReply,
  parseSlackEventEnvelope,
  recordSlackMention,
  type CodexMentionQueueMessage,
} from '../services/codex-cloud-monitor.js';

const MAX_BODY_BYTES = 32 * 1024;
const ALLOWED_EVENT_TYPES = new Set(['prompt_submitted', 'turn_completed', 'approval_required']);
const ALLOWED_OPERATORS = new Set(['kenta', 'masato', 'codex']);
const ALLOWED_CATEGORIES = new Set(['error', 'idea', 'fix', 'decision']);
const ALLOWED_CHECK_STATES = new Set(['pass', 'pending', 'fail', 'none']);
const ALLOWED_EVENT_SOURCES = new Set(['codex', 'github']);
const ALLOWED_SYNC_MODES = new Set(['event', 'reconcile']);

export const codexSlackEvents = new Hono<Env>();

function parseOpenPrs(value: unknown): CodexSlackPrSnapshot[] | undefined | null {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 30) return null;
  const result: CodexSlackPrSnapshot[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const pr = item as Record<string, unknown>;
    if (
      !Number.isInteger(pr.number) || Number(pr.number) < 1 ||
      typeof pr.title !== 'string' || pr.title.length < 1 || pr.title.length > 240 ||
      typeof pr.url !== 'string' || !/^https:\/\/github\.com\//.test(pr.url) || pr.url.length > 500 ||
      typeof pr.author !== 'string' || pr.author.length > 100 ||
      typeof pr.headRefName !== 'string' || pr.headRefName.length > 255 ||
      typeof pr.isDraft !== 'boolean' ||
      typeof pr.mergeStateStatus !== 'string' || pr.mergeStateStatus.length > 30 ||
      typeof pr.updatedAt !== 'string' || !Number.isFinite(Date.parse(pr.updatedAt)) ||
      !Number.isInteger(pr.fileCount) || Number(pr.fileCount) < 0 ||
      !Array.isArray(pr.overlapsWith) || pr.overlapsWith.length > 30 ||
      pr.overlapsWith.some((number) => !Number.isInteger(number) || Number(number) < 1) ||
      typeof pr.checks !== 'string' || !ALLOWED_CHECK_STATES.has(pr.checks)
    ) return null;
    result.push({
      number: Number(pr.number),
      title: pr.title,
      url: pr.url,
      author: pr.author,
      headRefName: pr.headRefName,
      isDraft: pr.isDraft,
      mergeStateStatus: pr.mergeStateStatus,
      updatedAt: pr.updatedAt,
      fileCount: Number(pr.fileCount),
      overlapsWith: pr.overlapsWith.map(Number),
      checks: pr.checks as CodexSlackPrSnapshot['checks'],
    });
  }
  return result;
}

function parseEvent(rawBody: string): CodexSlackEvent | null {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    value.version !== 1 ||
    typeof value.eventId !== 'string' || value.eventId.length < 3 || value.eventId.length > 255 ||
    typeof value.eventType !== 'string' || !ALLOWED_EVENT_TYPES.has(value.eventType) ||
    typeof value.sessionId !== 'string' || value.sessionId.length < 3 || value.sessionId.length > 255 ||
    typeof value.operator !== 'string' || !ALLOWED_OPERATORS.has(value.operator) ||
    typeof value.content !== 'string' || value.content.length < 1 || value.content.length > 20_000 ||
    typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt))
  ) {
    return null;
  }
  if (value.prNumber != null && (!Number.isInteger(value.prNumber) || Number(value.prNumber) < 1)) return null;
  if (value.explicitCategory != null && (
    typeof value.explicitCategory !== 'string' || !ALLOWED_CATEGORIES.has(value.explicitCategory)
  )) return null;
  if (value.eventSource != null && (
    typeof value.eventSource !== 'string' || !ALLOWED_EVENT_SOURCES.has(value.eventSource)
  )) return null;
  if (value.syncMode != null && (
    typeof value.syncMode !== 'string' || !ALLOWED_SYNC_MODES.has(value.syncMode)
  )) return null;
  if (value.refreshCommandCenter != null && typeof value.refreshCommandCenter !== 'boolean') return null;
  if (value.commandCenterOnly != null && typeof value.commandCenterOnly !== 'boolean') return null;
  const openPrs = parseOpenPrs(value.openPrs);
  if (openPrs === null) return null;

  return {
    version: 1,
    eventId: value.eventId,
    eventType: value.eventType as CodexSlackEvent['eventType'],
    sessionId: value.sessionId,
    turnId: typeof value.turnId === 'string' ? value.turnId.slice(0, 255) : undefined,
    operator: value.operator as CodexSlackEvent['operator'],
    repository: typeof value.repository === 'string' ? value.repository.slice(0, 255) : undefined,
    branch: typeof value.branch === 'string' ? value.branch.slice(0, 255) : undefined,
    prNumber: typeof value.prNumber === 'number' ? value.prNumber : undefined,
    prUrl: typeof value.prUrl === 'string' && /^https:\/\/github\.com\//.test(value.prUrl)
      ? value.prUrl.slice(0, 500)
      : undefined,
    content: value.content,
    occurredAt: value.occurredAt,
    explicitCategory: value.explicitCategory as CodexSlackCategory | undefined,
    openPrs,
    eventSource: value.eventSource as CodexSlackEvent['eventSource'],
    syncMode: value.syncMode as CodexSlackEvent['syncMode'],
    refreshCommandCenter: typeof value.refreshCommandCenter === 'boolean'
      ? value.refreshCommandCenter
      : undefined,
    commandCenterOnly: value.commandCenterOnly === true,
  };
}

codexSlackEvents.post('/api/integrations/codex-slack/events', async (c) => {
  const secret = c.env.CODEX_SLACK_RELAY_SECRET;
  if (!secret || !c.env.SLACK_BOT_TOKEN) {
    return c.json({ success: false, error: 'Codex Slack relay not configured' }, 503);
  }
  const rawBody = await c.req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return c.json({ success: false, error: 'Payload too large' }, 413);
  }
  const verified = await verifySupportRelay(
    secret,
    c.req.header('x-nen-timestamp'),
    c.req.header('x-nen-signature'),
    rawBody,
  );
  if (!verified) return c.json({ success: false, error: 'Invalid signature' }, 401);

  const event = parseEvent(rawBody);
  if (!event) return c.json({ success: false, error: 'Invalid event payload' }, 400);

  try {
    const result = await relayCodexSlackEvent(c.env, event);
    return c.json({ success: true, ...result });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'codex_slack_relay_failed',
      eventId: event.eventId,
      sessionId: event.sessionId,
      error: String(error),
    }));
    return c.json({ success: false, error: 'Slack relay failed' }, 502);
  }
});

codexSlackEvents.post('/api/integrations/slack/actions', async (c) => {
  if (!c.env.SLACK_SIGNING_SECRET || !c.env.SLACK_BOT_TOKEN || !c.env.SLACK_TASK_CHANNEL_ID) {
    return c.json({ success: false, error: 'Slack task actions not configured' }, 503);
  }
  const rawBody = await c.req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return c.json({ success: false, error: 'Payload too large' }, 413);
  }
  const verified = await verifySlackRequest(
    c.env.SLACK_SIGNING_SECRET,
    c.req.header('x-slack-request-timestamp'),
    c.req.header('x-slack-signature'),
    rawBody,
  );
  if (!verified) return c.json({ success: false, error: 'Invalid Slack signature' }, 401);

  const encodedPayload = new URLSearchParams(rawBody).get('payload');
  if (!encodedPayload) return c.json({ success: false, error: 'Invalid Slack payload' }, 400);
  let payload: Parameters<typeof handleSlackTaskAction>[1];
  try {
    payload = JSON.parse(encodedPayload) as Parameters<typeof handleSlackTaskAction>[1];
  } catch {
    return c.json({ success: false, error: 'Invalid Slack payload' }, 400);
  }

  try {
    const result = await handleSlackTaskAction(c.env, payload);
    return c.json({ success: true, ...result });
  } catch (error) {
    const message = String(error);
    if (message.includes('FORBIDDEN')) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    if (message.includes('INVALID_')) {
      return c.json({ success: false, error: 'Invalid Slack task action' }, 400);
    }
    console.error(JSON.stringify({ event: 'slack_task_action_failed', error: message }));
    return c.json({ success: false, error: 'Slack task action failed' }, 502);
  }
});

codexSlackEvents.post('/api/integrations/slack/events', async (c) => {
  if (!c.env.SLACK_SIGNING_SECRET || !c.env.CODEX_SLACK_USER_ID || !c.env.CODEX_MENTION_QUEUE) {
    return c.json({ success: false, error: 'Slack event monitor not configured' }, 503);
  }
  const rawBody = await c.req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return c.json({ success: false, error: 'Payload too large' }, 413);
  }
  const verified = await verifySlackRequest(
    c.env.SLACK_SIGNING_SECRET,
    c.req.header('x-slack-request-timestamp'),
    c.req.header('x-slack-signature'),
    rawBody,
  );
  if (!verified) return c.json({ success: false, error: 'Invalid Slack signature' }, 401);

  const envelope = parseSlackEventEnvelope(rawBody);
  if (!envelope) return c.json({ success: false, error: 'Invalid Slack payload' }, 400);
  if (envelope.type === 'url_verification' && typeof envelope.challenge === 'string') {
    return c.text(envelope.challenge);
  }
  if (envelope.type !== 'event_callback' || !envelope.event_id || !envelope.team_id) {
    return c.json({ success: true, ignored: true });
  }
  if (!isAllowedRelaySource(c.env.CODEX_ALLOWED_TEAM_IDS, envelope.team_id)) {
    return c.json({ success: true, ignored: true });
  }
  const event = envelope.event;
  if (
    !event ||
    (event.type !== 'app_mention' && event.type !== 'message') ||
    event.subtype === 'message_changed' ||
    !event.user ||
    !event.channel ||
    !event.ts ||
    typeof event.text !== 'string'
  ) {
    return c.json({ success: true, ignored: true });
  }
  if (!await isAllowedRelayChannel(c.env, event.channel)) {
    return c.json({ success: true, ignored: true });
  }

  const threadTs = event.thread_ts ?? event.ts;
  if (event.user === c.env.CODEX_SLACK_USER_ID && event.thread_ts) {
    const observed = await observeOfficialCodexReply(c.env, event.channel, threadTs, event.text);
    if (observed.duplicateRisk) {
      await c.env.CODEX_MENTION_QUEUE.send({
        kind: 'notify_duplicate',
        slackEventId: envelope.event_id,
        channelId: event.channel,
        threadTs,
        officialTaskUrl: observed.taskUrl,
      });
    }
    return c.json({ success: true, observed: observed.tracked });
  }

  // The relay itself contains a real Codex mention. Ignore the explicit marker
  // before mention detection so the Worker cannot recursively relay its own post.
  if (isAutomaticCodexRelay(event.text)) {
    return c.json({ success: true, ignored: true });
  }

  if (!hasActualSlackMention(event.text, c.env.CODEX_SLACK_USER_ID)) {
    return c.json({ success: true, ignored: true });
  }
  const message: Extract<CodexMentionQueueMessage, { kind: 'inspect_official' }> = {
    kind: 'inspect_official',
    slackEventId: envelope.event_id,
    teamId: envelope.team_id,
    channelId: event.channel,
    messageTs: event.ts,
    threadTs,
    requesterUserId: event.user,
    prompt: event.text,
  };
  const inserted = await recordSlackMention(c.env.DB, message);
  if (
    !hasClaudeToCodexMarker(event.text) ||
    !isAllowedRelaySource(c.env.CODEX_RELAY_SOURCE_USER_IDS, event.user) ||
    !isCodexRelayEnabled(c.env.CODEX_RELAY_ENABLED)
  ) {
    if (inserted) await markCodexMentionFailed(c.env.DB, envelope.event_id);
    return c.json({ success: true, recorded: inserted, queued: false });
  }
  if (inserted) {
    const configuredGrace = Number.parseInt(c.env.CODEX_OFFICIAL_RECEIPT_GRACE_SECONDS ?? '30', 10);
    const delaySeconds = Number.isFinite(configuredGrace)
      ? Math.min(300, Math.max(10, configuredGrace))
      : 30;
    await c.env.CODEX_MENTION_QUEUE.send(message, { delaySeconds });
  }
  return c.json({ success: true, queued: inserted });
});

codexSlackEvents.get('/api/integrations/codex-monitor/status', async (c) => {
  const authorization = c.req.header('authorization');
  if (!c.env.API_KEY || authorization !== `Bearer ${c.env.API_KEY}`) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const parsedLimit = Number.parseInt(c.req.query('limit') ?? '20', 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 20;
  const result = await c.env.DB.prepare(`
    SELECT slack_event_id, team_id, channel_id, message_ts, thread_ts, status,
           official_task_url, fallback_conversation_url, detected_at, updated_at
      FROM codex_cloud_tasks
     ORDER BY detected_at DESC
     LIMIT ?
  `).bind(limit).all();
  return c.json({ success: true, tasks: result.results });
});
