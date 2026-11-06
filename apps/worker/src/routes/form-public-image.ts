import type { Context } from 'hono';
import { getFormById } from '@line-crm/db';
import { parseLayout } from '@line-crm/shared';
import { FormReferenceAccessError, adoptedFormReference, formReferenceAccount, formReferenceImage } from '../features/forms/index.js';
import { getPinnedMediaObject } from '../services/media-upload-storage.js';
import { readFormTestToken, stoppedPublicFormResponse } from './forms-definition.js';
import type { Env } from '../worker-env.js';

/** 採用中の公開版とブロックから解決する。任意の画像IDを受け取らない。 */
export async function getFormPublicImage(c: Context<Env, '/api/forms/:id/images/:blockId'>): Promise<Response> {
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  const unavailable = () => c.json({ success: false, error: 'Not found' }, 404);
  if (readFormTestToken(c)) return unavailable();
  const id = c.req.param('id');
  const stopped = await stoppedPublicFormResponse(c, id);
  if (stopped) return stopped;
  const form = await getFormById(c.env.DB, id, { published: true });
  if (!form?.is_active || !form.current_published_version_id
    || c.req.query('formVersionId') !== form.current_published_version_id) return unavailable();
  let accountId: string | null;
  try { accountId = await formReferenceAccount(c.env, id, c.req.header('Authorization')); }
  catch (error) { if (error instanceof FormReferenceAccessError) return unavailable(); throw error; }
  if (!accountId) return unavailable();
  const reference = adoptedFormReference(parseLayout(form.layout, form.fields), c.req.param('blockId'));
  if (reference?.kind !== 'image') return unavailable();
  const image = await formReferenceImage(c.env, accountId, reference);
  if (!image || !c.env.IMAGES) return unavailable();
  const object = await getPinnedMediaObject(c.env.IMAGES, image.r2_key, image.etag.replace(/^"|"$/g, ''));
  if (!object) return unavailable();
  return new Response(object.body, { headers: {
    'Content-Type': image.mime_type, 'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } });
}
