import { Hono } from 'hono';
import type { Env } from '../index.js';

const images = new Hono<Env>();

const MEDIA_MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = [
  'video/mp4',
  'application/pdf',
  'application/zip',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

// POST /api/images — upload image (base64 or binary)
images.post('/api/images', async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || '';

    let data: ArrayBuffer;
    let mimeType: string;
    let filename: string | undefined;

    if (contentType.includes('application/json')) {
      const body = await c.req.json<{
        data: string;
        mimeType?: string;
        filename?: string;
      }>();

      if (!body.data) {
        return c.json({ success: false, error: 'data (base64) is required' }, 400);
      }

      let base64 = body.data;
      if (base64.startsWith('data:')) {
        const match = base64.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64 = match[2];
        }
      }
      mimeType ??= body.mimeType ?? 'image/png';
      filename = body.filename;

      const binary = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      data = binary.buffer;
    } else {
      data = await c.req.arrayBuffer();
      mimeType = contentType.split(';')[0] || 'image/png';
    }

    if (data.byteLength > 10 * 1024 * 1024) {
      return c.json({ success: false, error: 'Image too large (max 10MB)' }, 400);
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(mimeType)) {
      return c.json({ success: false, error: `Unsupported image type: ${mimeType}. Allowed: ${allowedTypes.join(', ')}` }, 400);
    }

    const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1];
    const id = crypto.randomUUID();
    const key = `${id}.${ext}`;

    await c.env.IMAGES.put(key, data, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: filename ?? key },
    });

    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    const url = `${workerUrl}/images/${key}`;

    return c.json({
      success: true,
      data: { id, key, url, mimeType, size: data.byteLength },
    }, 201);
  } catch (err) {
    console.error('POST /api/images error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /images/:key — serve image (public, no auth)
images.get('/images/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.IMAGES.get(key);

  if (!object) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/png');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.etag);

  return new Response(object.body, { headers });
});

// POST /api/media — chat attachments that are not images.
// LINE can send MP4 as a native video. Other documents are delivered as a
// public HTTPS link because the Messaging API has no outbound "file" message.
images.post('/api/media', async (c) => {
  try {
    const mimeType = (c.req.header('Content-Type') || 'application/octet-stream').split(';')[0];
    const declaredSize = Number(c.req.header('Content-Length') || 0);
    if (declaredSize > MEDIA_MAX_BYTES) {
      return c.json({ success: false, error: 'File too large (max 25MB)' }, 413);
    }
    const encodedFilename = c.req.header('X-File-Name') || undefined;
    let filename = encodedFilename;
    if (encodedFilename) {
      try {
        filename = decodeURIComponent(encodedFilename);
      } catch {
        // Keep the original header value when a non-browser client sends a
        // plain filename rather than an encoded one.
      }
    }
    if (!ALLOWED_MEDIA_TYPES.includes(mimeType)) {
      return c.json({ success: false, error: `Unsupported media type: ${mimeType}` }, 400);
    }

    const data = await c.req.arrayBuffer();
    if (!data.byteLength) {
      return c.json({ success: false, error: 'File is empty' }, 400);
    }
    if (data.byteLength > MEDIA_MAX_BYTES) {
      return c.json({ success: false, error: 'File too large (max 25MB)' }, 400);
    }

    const safeExt = filename?.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')
      || (mimeType === 'video/mp4' ? 'mp4' : 'bin');
    const id = crypto.randomUUID();
    const key = `${id}.${safeExt}`;
    await c.env.IMAGES.put(key, data, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: filename ?? key },
    });

    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    return c.json({
      success: true,
      data: {
        id,
        key,
        url: `${workerUrl}/media/${key}`,
        mimeType,
        size: data.byteLength,
        filename: filename ?? key,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/media error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// Public media is intentionally served without admin auth: LINE's servers and
// the recipient's browser must be able to fetch it after a message is sent.
images.get('/media/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.IMAGES.get(key);
  if (!object) return c.json({ success: false, error: 'Media not found' }, 404);

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  const originalFilename = object.customMetadata?.originalFilename || key;
  // HTTP header values must remain ASCII; filename* preserves Japanese names.
  headers.set('Content-Disposition', `inline; filename="${key}"; filename*=UTF-8''${encodeURIComponent(originalFilename)}`);
  headers.set('ETag', object.etag);
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
});

// DELETE /api/images/:key — delete image
images.delete('/api/images/:key', async (c) => {
  try {
    const key = c.req.param('key');
    await c.env.IMAGES.delete(key);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/images/:key error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { images };
