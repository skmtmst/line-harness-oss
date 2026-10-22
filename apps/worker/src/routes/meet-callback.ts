import { lineTransport } from '../lib/external-call/line.js';
import { acquireWorkflow } from '../services/workflow-execution.js';
import { sendRecordedNotification,NotificationDeliveryIncomplete } from '../services/recorded-notification-send.js';
import { prepareWorkflowStep, getWorkflowStep,ensureWorkflowStep,claimWorkflowStep,finishWorkflowStep,failWorkflowStep } from '@line-crm/db';
import { patchFriendMetadata,friendMetadataPatchStatement } from '../features/friends/friend-metadata/index.js';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { resolveLineToken } from '../services/line-token.js';
import { getFriendByLineUserIdForAccount, getScenarioById } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { verifySupportRelay } from '../services/support-relay.js';
import { sha256Hex } from '../middleware/auth.js';
import { readBoundedText } from '../lib/input-errors.js';

const app = new Hono<Env>();

// Meet Harness calls this when a hearing session completes
app.post('/api/meet-callback', async (c) => {
  const secret = c.env.MEET_CALLBACK_SECRET;
  if (!secret) return c.json({ success: false, error: 'Meet callback not configured' }, 503);
  const rawBody = await readBoundedText(c.req.raw, 256 * 1024);
  if (rawBody === null) {
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

  const ref = {scopeId:`line:${friend.line_account_id ?? 'default'}`,processKind:'meet_callback',subjectId:body.session_id};
  if (existing && !await getWorkflowStep(c.env.DB,{...ref,stepKey:'__run'})) {
    // Old receipts do not prove whether LINE accepted a notification. Repair only the result.
    await patchFriendMetadata(c.env.DB,friend.id,{meet_hearing:body});
    return c.json({success:false,code:'MEET_DELIVERY_REVIEW_REQUIRED'},202);
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT OR IGNORE INTO meet_callback_receipts(session_id,payload_hash,received_at) VALUES(?,?,?)`)
      .bind(body.session_id,payloadHash,new Date().toISOString()),
    prepareWorkflowStep(c.env.DB,{...ref,stepKey:'__run'},{input:{payloadHash},maxAttempts:50}),
  ]);
  const actualReceipt=await c.env.DB.prepare('SELECT payload_hash FROM meet_callback_receipts WHERE session_id=?').bind(body.session_id).first<{payload_hash:string}>();
  if(actualReceipt?.payload_hash!==payloadHash)return c.json({success:false,error:'Session payload conflict'},409);
  const execution=await acquireWorkflow(c.env.DB,ref);
  if(!execution){
    const finished=await getWorkflowStep(c.env.DB,{...ref,stepKey:'__run'});
    return finished?.status==='succeeded'?c.json({success:true,duplicate:true}):c.json({success:false,code:finished?.status==='unknown'?'MEET_DELIVERY_REVIEW_REQUIRED':'MEET_PROCESSING_INCOMPLETE'},202);
  }
  try {
    const metadataRef={...execution.ref,stepKey:'metadata'};
    const priorMetadata=await ensureWorkflowStep(execution.db,metadataRef,{maxAttempts:50});
    if(priorMetadata.status!=='succeeded'){
      const owned=await claimWorkflowStep(execution.db,metadataRef);
      if(!owned)throw new Error('metadata_processing_incomplete');
      try{
        await finishWorkflowStep(execution.db,metadataRef,owned.lease_owner!,{statements:[
          execution.db.prepare("SELECT json(CASE WHEN EXISTS(SELECT 1 FROM friends WHERE id=?) THEN 'true' ELSE 'friend_unavailable' END)").bind(friend.id),
          friendMetadataPatchStatement(execution.db,friend.id,{meet_hearing:{
            session_id:body.session_id,status:body.status,context:body.context,transcripts:body.transcripts,
            requirements_doc:body.requirements_doc,completed_at:body.completed_at,
          }}),
        ]});
      }catch(error){await failWorkflowStep(execution.db,metadataRef,owned.lease_owner!,{delayMs:0});throw error;}
    }


  // Resolve LINE access token (multi-account support)
  let accountToken: string | null = null;
  let accountId = ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null;
  if ((friend as unknown as Record<string, unknown>).line_account_id) {
    const { getLineAccountById } = await import('@line-crm/db');
    const account = await getLineAccountById(c.env.DB, (friend as unknown as Record<string, unknown>).line_account_id as string);
    accountToken = account?.channel_access_token ?? null;
    accountId = account?.id ?? accountId;
  }
  const accessToken = resolveLineToken({
    accountToken,
    defaultToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
    accountId,
    context: 'meet-callback.confirmation',
  });
  const lineClient = new LineClient(accessToken,{transport:lineTransport(AbortSignal.timeout(10_000))});

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

  const messages = [{type:'flex' as const,altText:'ヒアリング結果',contents:resultFlex}];
  await sendRecordedNotification(execution.db,{
    sourceId:`meet:${body.session_id}`,channel:'line',recipient:friend.line_user_id,
    lineAccountId:friend.line_account_id,payload:JSON.stringify(messages),
    send:key=>lineClient.pushMessage(friend.line_user_id,messages,key),
  });
  await execution.complete();
  return c.json({ success: true });
  } catch(error) {
    const unknown=error instanceof NotificationDeliveryIncomplete&&error.deliveryStatus==='unknown';
    if(unknown)await failWorkflowStep(c.env.DB,execution.ref,execution.owner,{unknown:true,code:'delivery_unknown'}).catch(()=>undefined);
    else await execution.fail().catch(()=>undefined);
    return c.json({success:false,code:unknown?'MEET_DELIVERY_REVIEW_REQUIRED':'MEET_PROCESSING_INCOMPLETE'},202);
  }
});

export { app as meetCallback };
