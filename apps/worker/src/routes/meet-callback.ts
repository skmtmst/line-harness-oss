import { Hono } from 'hono';
import type { Env } from '../index.js';
import { getFriendByLineUserIdForAccount, getScenarioById } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { verifySupportRelay } from '../services/support-relay.js';
import { sha256Hex } from '../middleware/auth.js';

const app = new Hono<Env>();

// Meet Harness calls this when a hearing session completes
app.post('/api/meet-callback', async (c) => {
  const secret = c.env.MEET_CALLBACK_SECRET;
  if (!secret) return c.json({ success: false, error: 'Meet callback not configured' }, 503);
  const rawBody = await c.req.text();
  if (new TextEncoder().encode(rawBody).byteLength > 256 * 1024) {
    return c.json({ success: false, error: 'Payload too large' }, 413);
  }
  const verified = await verifySupportRelay(
    secret,
    c.req.header('x-nen-timestamp'),
    c.req.header('x-nen-signature'),
    rawBody,
  );
  if (!verified) return c.json({ success: false, error: 'Invalid signature' }, 401);

  let body: {
    session_id: string;
    scenario_id: string;
    line_user_id: string;
    status: string;
    context?: Record<string, unknown>;
    transcripts: Array<{
      question_text?: string;
      transcript: string;
    }>;
    requirements_doc?: string;
    completed_at: string;
  };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }

  if (
    !body.session_id || body.session_id.length > 255 ||
    !/^U[0-9a-f]{32}$/i.test(body.line_user_id || '') ||
    !Array.isArray(body.transcripts) || body.transcripts.length > 100 ||
    body.transcripts.some((item) => !item || typeof item.transcript !== 'string' || item.transcript.length > 10_000) ||
    (body.requirements_doc?.length ?? 0) > 100_000 ||
    !Number.isFinite(Date.parse(body.completed_at))
  ) {
    return c.json({ success: false, error: 'Invalid callback payload' }, 400);
  }

  const payloadHash = await sha256Hex(rawBody);
  const existing = await c.env.DB.prepare(
    'SELECT payload_hash FROM meet_callback_receipts WHERE session_id = ?',
  ).bind(body.session_id).first<{ payload_hash: string }>();
  if (existing) {
    if (existing.payload_hash !== payloadHash) {
      return c.json({ success: false, error: 'Session payload conflict' }, 409);
    }
    return c.json({ success: true, duplicate: true });
  }

  const scenario = await getScenarioById(c.env.DB, body.scenario_id);
  const friend = await getFriendByLineUserIdForAccount(
    c.env.DB,
    body.line_user_id,
    scenario?.line_account_id ?? null,
  );
  if (!friend) {
    return c.json({ success: false, error: 'friend not found' }, 404);
  }

  const receipt = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO meet_callback_receipts (session_id, payload_hash, received_at)
     VALUES (?, ?, ?)`,
  ).bind(body.session_id, payloadHash, new Date().toISOString()).run();
  if (!receipt.meta.changes) return c.json({ success: true, duplicate: true });

  // Resolve LINE access token (multi-account support)
  let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  if ((friend as unknown as Record<string, unknown>).line_account_id) {
    const { getLineAccountById } = await import('@line-crm/db');
    const account = await getLineAccountById(c.env.DB, (friend as unknown as Record<string, unknown>).line_account_id as string);
    if (account) accessToken = account.channel_access_token;
  }
  const lineClient = new LineClient(accessToken);

  // Build Flex message with requirements doc
  const transcriptRows = body.transcripts.map((t) => ({
    type: 'box' as const, layout: 'vertical' as const, margin: 'md' as const,
    contents: [
      { type: 'text' as const, text: t.question_text || 'Q', size: 'xxs' as const, color: '#64748b' },
      { type: 'text' as const, text: t.transcript, size: 'sm' as const, color: '#1e293b', wrap: true },
    ],
  }));

  const resultFlex = {
    type: 'bubble', size: 'giga',
    header: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: 'ヒアリング完了', size: 'lg', weight: 'bold', color: '#1e293b' },
        { type: 'text', text: `${friend.display_name || ''}さん`, size: 'xs', color: '#64748b', margin: 'sm' },
      ],
      paddingAll: '20px', backgroundColor: '#f0f9ff',
    },
    body: {
      type: 'box', layout: 'vertical',
      contents: [
        ...transcriptRows,
        { type: 'separator', margin: 'lg' },
        ...(body.requirements_doc ? [
          { type: 'text' as const, text: '要件定義書', size: 'sm' as const, weight: 'bold' as const, color: '#1e293b', margin: 'lg' as const },
          { type: 'text' as const, text: body.requirements_doc.slice(0, 1000), size: 'xs' as const, color: '#334155', wrap: true, margin: 'sm' as const },
        ] : []),
      ],
      paddingAll: '20px',
    },
  };

  try {
    await lineClient.pushMessage(friend.line_user_id, [
      { type: 'flex', altText: 'ヒアリング結果', contents: resultFlex },
    ]);
  } catch (e) {
    console.error('Failed to send meet callback message:', e);
  }

  // Save to friend metadata
  try {
    const existing = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
    const updated = {
      ...existing,
      meet_hearing: {
        session_id: body.session_id,
        status: body.status,
        context: body.context,
        transcripts: body.transcripts,
        requirements_doc: body.requirements_doc,
        completed_at: body.completed_at,
      },
    };
    await c.env.DB.prepare('UPDATE friends SET metadata = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(JSON.stringify(updated), friend.id)
      .run();
  } catch (e) {
    console.error('Failed to save meet hearing to metadata:', e);
  }

  return c.json({ success: true });
});

export { app as meetCallback };
