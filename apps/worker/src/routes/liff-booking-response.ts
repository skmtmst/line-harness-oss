import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { readApiError } from '@line-crm/shared';
import { fail, failureDetail } from '../lib/fail.js';
import { inputError } from '../lib/input-errors.js';

/** 古いLIFFが読む項目・文言を残したまま、予約の応答に成功フラグを付ける。 */
export async function liffBookingJson(c: Context, payload: object, status: ContentfulStatusCode = 200): Promise<Response> {
  const body = payload as Record<string, unknown>;
  if (status < 400) return c.json({ ...body, success: true }, status);
  const detail = readApiError(body);
  const code = detail.code ?? failureDetail(detail.message, status).code;
  const response = fail(c, status, code, { ...body, code });
  const normalized = await response.json<Record<string, unknown>>();
  // failの入力案内への変換で、既存のerrorやfieldsを上書きしない。
  return c.json({ ...normalized, ...body, success: false, code }, status);
}

/** 既存の欄ごとの案内を作ってから、同じ予約の応答契約へそろえる。 */
export function liffBookingInputError(c: Context, payload: Record<string, unknown>, status: ContentfulStatusCode,
  keys: readonly string[] = []): Promise<Response> {
  return liffBookingResponse(c, inputError(c, payload, status, keys));
}

/** 冪等再送・共通の予約処理が返す応答も、保存内容や副作用を変えずにそろえる。 */
export async function liffBookingResponse(c: Context, response: Response): Promise<Response> {
  const body = await response.json<object>();
  const normalized = await liffBookingJson(c, body, response.status as ContentfulStatusCode);
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.delete('Content-Encoding');
  headers.delete('ETag');
  return new Response(normalized.body, { status: response.status, statusText: response.statusText, headers });
}
