import { tracedFetch as fetch } from '@line-crm/shared/server';
import { checkWebhookUrlSafety, type WebhookSafetyOptions } from './outgoing-webhook-delivery.js';

/** Same DNS policy as outgoing webhooks; no redirect or extra delivery attempt. */
export async function publicHttpsRequest(url: string, init: RequestInit, options: WebhookSafetyOptions = {}): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error('unsafe_destination');
  const send = options.fetchImpl ?? fetch;
  const transport: typeof fetch = (input, request) => send(input, { ...request,
    signal: init.signal ? request?.signal ? AbortSignal.any([init.signal, request.signal]) : init.signal : request?.signal,
  });
  const safety = { ...options, fetchImpl: transport };
  const before = await checkWebhookUrlSafety(url, safety);
  if (!before.ok) throw new Error('unsafe_destination');
  const after = await checkWebhookUrlSafety(url, safety);
  if (!after.ok || [...before.addresses].sort().join(',') !== [...after.addresses].sort().join(',')) throw new Error('unsafe_destination');
  return (options.fetchImpl ?? fetch)(url, { ...init, redirect: 'manual' });
}

/** Answer variables are data within a fixed origin, never a scheme or authority. */
export function formWebhookTarget(template: string, answers: Record<string, unknown>): string {
  const authority = /^https:\/\/[^/?#]+/i.exec(template)?.[0];
  if (!authority || /[{}\\]/.test(authority)) throw new Error('unsafe_destination');
  const origin = new URL(template).origin;
  const value = template.replace(/\{([^{}]+)\}/g, (_, key: string) => encodeURIComponent(String(answers[key] ?? '')));
  const templatePath = template.slice(authority.length).split(/[?#]/)[0].split('/');
  const renderedPath = value.slice(authority.length).split(/[?#]/)[0].split('/');
  if (templatePath.some((segment, i) => /\{[^{}]+\}/.test(segment) && /^(?:\.|%2e){1,2}$/i.test(renderedPath[i] ?? ''))) throw new Error('unsafe_destination');
  if (new URL(value).origin !== origin) throw new Error('unsafe_destination');
  return value;
}
