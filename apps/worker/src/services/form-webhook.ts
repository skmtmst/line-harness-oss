import type { Form as DbForm } from '@line-crm/db';

export async function callFormWebhook(
  form: Pick<DbForm, 'on_submit_webhook_url' | 'on_submit_webhook_headers'>,
  submissionData: Record<string, unknown>,
  eventId: string | null,
): Promise<{ passed: boolean; data: unknown }> {
  if (!form.on_submit_webhook_url) return { passed: true, data: null };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    // Replace {field_name} placeholders in URL with submitted values
    let url = form.on_submit_webhook_url;
    for (const [key, value] of Object.entries(submissionData)) {
      url = url.replace(`{${key}}`, encodeURIComponent(String(value ?? '')));
    }

    // Parse headers
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // 安定 event id。同じ送信の呼び直しは同じ値になるので、受け側は
    // この値で重複を除ける(durable outbox の片割れ)。
    if (eventId) headers['X-Form-Event-Id'] = eventId;
    if (form.on_submit_webhook_headers) {
      try {
        const parsed = JSON.parse(form.on_submit_webhook_headers) as Record<string, string>;
        Object.assign(headers, parsed);
      } catch { /* ignore invalid headers */ }
    }

    // Determine method: GET if URL has {placeholders} replaced, POST otherwise
    const isGet = form.on_submit_webhook_url.includes('{');
    const res = await fetch(url, {
      method: isGet ? 'GET' : 'POST',
      redirect: 'manual',
      headers,
      signal: controller.signal,
      ...(isGet ? {} : { body: JSON.stringify(submissionData) }),
    });
    // Workerの型はtypeをdefault/errorに限定する。互換fetchのopaque転送も拒否する。
    if (String(res.type) === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return { passed: false, data: { error: 'Webhook redirect refused' } };
    }
    if (!res.ok) {
      return { passed: false, data: { error: `HTTP ${res.status}` } };
    }

    const data = await res.json() as Record<string, unknown>;

    // Check for eligibility — support both { eligible: bool } and { success: bool, data: { eligible: bool } }
    const eligible = data.eligible ?? (data.data as Record<string, unknown> | undefined)?.eligible ?? data.success;
    return { passed: Boolean(eligible), data };
  } catch {
    // fetch例外には宛先や保存済みの認証情報が入る可能性がある。
    return { passed: false, data: { error: 'Webhook request failed' } };
  } finally {
    clearTimeout(timeout);
  }
}
