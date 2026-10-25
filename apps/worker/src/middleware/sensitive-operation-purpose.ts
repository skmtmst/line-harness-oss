import { isOutputRequest } from './output-request.js';
import type { StepUpPurpose } from '../lib/step-up.js';

/** 認証と統括・機能の境界の後、全 route の前に適用する。 */
export function dangerousOperationPurpose(method: string, path: string, format?: string): StepUpPurpose | null {
  if (method === 'OPTIONS') return null;
  // これらの route は独自に厳しい一度限りの確認票を消費する。
  if (method === 'POST' && /^\/api\/affiliate-payout-batches\/[^/]+\/export$/.test(path)) return null;
  if (['POST','PUT'].includes(method) && /\/exports(?:\/|$)/.test(path)) return 'data.export';
  if (isOutputRequest(path, format, method)) return 'data.export';
  if (/^\/api\/ops\/impersonation\/(start|write|pii-reveal)$/.test(path) && method === 'POST') return 'ops.impersonation';
  if (/^\/api\/(?:hq\/)?broadcasts\/[^/]+\/(send|send-segment|resume|retry|retry-failed|schedule)$/.test(path) && method === 'POST') return 'broadcast.send';
  if (method === 'POST' && /^\/api\/hq\/broadcasts\/[^/]+\/targets\/[^/]+\/retry$/.test(path)) return 'broadcast.send';
  if (/^\/api\/(?:ops\/members|staff)(?:\/[^/]+)?$/.test(path) && ['POST','PATCH','PUT','DELETE'].includes(method)) return 'staff.permissions.change';
  if (method === 'POST' && /^\/api\/(?:ops\/members|staff)\/[^/]+\/(?:resend-invite|resend-invitation)$/.test(path)) return 'staff.permissions.change';
  // API キーと MFA の route は独自の厳しい一度限りの確認を保つ。
  if (method === 'POST' && /^\/api\/webhooks\/.*\/(?:secret|rotate-secret)$/.test(path)) return 'webhook.secret';
  if (method === 'POST' && /\/(?:ingest-secret|reveal-secret|rotate-secret)$/.test(path)) return 'secrets.reveal';
  if (method === 'GET' && /\/(credentials|secret|api-token|tokens)(?:\/[^/]+)?$/.test(path)) return 'secrets.reveal';
  return null;
}
