import { publicHttpsRequest, formWebhookTarget } from '../../services/public-https-request.js';
import { readBoundedBytes } from '../../lib/input-errors.js';
import type { WebhookSafetyOptions } from '../../services/outgoing-webhook-delivery.js';
import type { Form as DbForm } from '@line-crm/db';

export async function callFormWebhook(
  form: Pick<DbForm, 'on_submit_webhook_url' | 'on_submit_webhook_headers'>,
  submissionData: Record<string, unknown>,
  eventId: string | null,
  safetyOptions: WebhookSafetyOptions = {},
): Promise<{ passed: boolean; data: unknown }> {
  if (!form.on_submit_webhook_url) return { passed: true, data: null };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const url = formWebhookTarget(form.on_submit_webhook_url, submissionData);


    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // 安定 event id。同じ送信の呼び直しは同じ値になるので、受け側は
    // この値で重複を除ける(durable outbox の片割れ)。
    if (form.on_submit_webhook_headers) {
      try {
        const parsed = JSON.parse(form.on_submit_webhook_headers) as Record<string, string>;
        Object.assign(headers, parsed);
      } catch { /* ignore invalid headers */ }
    }

    // 保存済みのヘッダで永続的なイベントの識別を上書きさせない。
    if (eventId) {
      for (const name of Object.keys(headers)) {
        if (name.toLowerCase() === 'x-form-event-id') delete headers[name];
      }
      headers['X-Form-Event-Id'] = eventId;
    }

    // 置換済みのプレースホルダ URL は GET、それ以外は POST として扱う。
    const isGet = form.on_submit_webhook_url.includes('{');
    const res = await publicHttpsRequest(url, {
      method: isGet ? 'GET' : 'POST',
      redirect: 'manual',
      headers,
      signal: controller.signal,
      ...(isGet ? {} : { body: JSON.stringify(submissionData) }),
    }, safetyOptions);
    // Workerの型はtypeをdefault/errorに限定する。互換fetchのopaque転送も拒否する。
    if (String(res.type) === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return { passed: false, data: { error: 'Webhook redirect refused' } };
    }
    if (!res.ok) {
      return { passed: false, data: { error: `HTTP ${res.status}` } };
    }

    const bytes = await readBoundedBytes(res, 65536);
    if (!bytes) return { passed: false, data: { error: 'Webhook response too large' } };
    const data = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;

    // 応答形式の違いで参加資格の判定が変わらないよう、eligible 直下と success/data 内の両形式を受け付ける。
    const eligible = data.eligible ?? (data.data as Record<string, unknown> | undefined)?.eligible ?? data.success;
    // 公開回答には参加資格と既存の参加 URL だけを含め、内部情報を返さない。
    return { passed: Boolean(eligible), data: publicFormWebhookData(data) };
  } catch {
    // fetch例外には宛先や保存済みの認証情報が入る可能性がある。
    return { passed: false, data: { error: 'Webhook request failed' } };
  } finally {
    clearTimeout(timeout);
  }
}

/** 保存済みの応答にも同じ公開項目の制限を適用する。 */
export function publicFormWebhookData(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value !== 'object') return { eligible: false };
  const data = value as Record<string, unknown>;
  const nested = data.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : undefined;
  const result: Record<string, unknown> = { eligible: Boolean(data.eligible ?? nested?.eligible ?? data.success) };
  if (result.eligible && typeof data.join_url === 'string') {
    try {
      const url = new URL(data.join_url);
      if (url.protocol === 'https:' && !url.username && !url.password) result.join_url = data.join_url;
    } catch { /* An invalid link is never exposed as a customer destination. */ }
  }
  return result;
}
