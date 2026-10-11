import { inputError, inputJsonBoundary } from '../lib/input-errors.js';
import { Hono, type Context } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { builtinFileScan, checkKeyGate } from '../services/file-scan.js';
import { imageDimensions } from '../services/media-metadata.js';

const images = new Hono<Env>();

// 汎用画像の管理口は所有者をR2の記録から読む。未記録の古い画像は操作しない。
async function ownedImage(c: Context<Env>, key: string) {
  if (!key || key.includes('/') || key.includes('..')) return null;
  const object = await c.env.IMAGES.head(key);
  const accountId = object?.customMetadata?.lineAccountId;
  const tenantId = object?.customMetadata?.tenantId;
  if (!accountId || tenantId !== (c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID)) return null;
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) return null;
  const requested = c.req.query('account_id');
  return requested && requested !== accountId ? null : object;
}


// POST /api/images — upload image (base64 or binary)
images.post('/api/images', requireRole('owner', 'admin', 'staff'), inputJsonBoundary({"data":["string"],"mimeType":["string"],"filename":["string"]}), async (c) => {
  try {
    const staff = c.get('staff');
    const scope = await getVisibleLineAccountScope(c.env.DB, staff);
    const accountId = c.req.query('account_id') ?? c.req.header('X-Line-Account-Id')
      ?? (scope.ids.length === 1 ? scope.ids[0] : null);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, staff, [accountId])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
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
        return inputError(c, { success: false, error: 'data (base64) is required' }, 400, ["data"]);
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
      return inputError(c, { success: false, error: 'Image too large (max 10MB)' }, 400, ["data"]);
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(mimeType)) {
      return inputError(c, { success: false, error: `Unsupported image type: ${mimeType}. Allowed: ${allowedTypes.join(', ')}` }, 400, ["mimeType"]);
    }

    // 保存の前に検査の段を入れる。危険な中身は保存せず、URL も返さない。
    const rawBytes = new Uint8Array(data);
    const rawDims = imageDimensions(rawBytes, mimeType);
    const preCheck = builtinFileScan(rawBytes, {
      filename: filename ?? `image.${mimeType.split('/')[1]}`,
      mimeType,
      sizeBytes: rawBytes.byteLength,
      width: rawDims?.width ?? null,
      height: rawDims?.height ?? null,
    });
    if (preCheck.verdict !== 'clean') {
      const message = preCheck.verdict === 'quarantined'
        ? '確認のため受け付けできません'
        : `受け付けできません（${preCheck.detail}）`;
      return inputError(c, { success: false, code: 'file_scan_blocked', error: message }, 422, []);
    }

    const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1];
    const id = crypto.randomUUID();
    const key = `${id}.${ext}`;

    await c.env.IMAGES.put(key, data, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: filename ?? key, lineAccountId: accountId, tenantId: staff.tenantId ?? DEFAULT_TENANT_ID },
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

// 管理画面から原本を読む口も、削除と同じ所有権を確かめる。
images.get('/api/images/:key', requireRole('owner', 'admin', 'staff'), async (c) => {
  const key = c.req.param('key');
  if (!await ownedImage(c, key)) return c.json({ success: false, error: 'Image not found' }, 404);
  const object = await c.env.IMAGES.get(key);
  if (!object) return c.json({ success: false, error: 'Image not found' }, 404);
  return new Response(object.body, { headers: {
    'Content-Type': object.httpMetadata?.contentType ?? 'image/png',
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  } });
});

// GET /images/:key — LINEが表示する公開済み画像（公開URLの互換性を保つ）
images.get('/images/*', async (c) => {
  // NENのペット写真は `nen-pets/{friendId}/{file}` の階層キーで保存する。
  // `:key` では最初の `/` までしか一致せず404になっていたため、全パスを受け取る。
  const key = c.req.path.slice('/images/'.length);
  if (!key || key.includes('..')) {
    return c.json({ success: false, error: 'Invalid image key' }, 400);
  }
  // 写真審査の原本は公開配信しない。管理画面もreview/public派生画像だけを使う。
  if (key.startsWith('nen-photo-originals/') || key.startsWith('private/') || /^hq-templates\/[^/]+\/pending\//.test(key)) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }
  // 検査が終わるまで出さない。記録が無い古いファイルは通す。
  const gateKind = key.startsWith('form-uploads/')
    ? 'form_file'
    : key.startsWith('broadcast-media/') || /^hq-templates\/[^/]+\/uploads\/[^/]+\.(mp4|m4a)$/.test(key)
      ? 'broadcast_asset'
      : null;
  if (gateKind) {
    if (key.startsWith('hq-templates/') && !await c.env.DB.prepare("SELECT 1 FROM media_file_scans WHERE subject_kind='broadcast_asset' AND subject_id=?").bind(key).first()) {
      return c.json({ success: false, error: 'ファイルの安全性を確かめています' }, 409);
    }
    const gate = await checkKeyGate(c.env.DB, c.env.IMAGES, gateKind, key);
    if (!gate.allowed) {
      return c.json({ success: false, code: gate.code, error: gate.message }, 409);
    }
  }
  const object = await c.env.IMAGES.get(key);

  if (!object) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }

  const contentType = object.httpMetadata?.contentType || 'image/png';
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.etag);
  // 判別不能なまま開かせない。画像以外はそのまま表示せず添付で渡す。
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set(
    'Content-Disposition',
    contentType.toLowerCase().startsWith('image/') ? 'inline' : 'attachment',
  );

  return new Response(object.body, { headers });
});

// DELETE /api/images/:key — delete image
images.delete('/api/images/:key', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const key = c.req.param('key');
    if (key.startsWith('hq-templates/')) return c.json({success:false,error:'統括のファイルは統括の削除操作から外してください'},403);
    if (!await ownedImage(c, key)) return c.json({ success: false, error: 'Image not found' }, 404);
    await c.env.IMAGES.delete(key);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/images/:key error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { images };
