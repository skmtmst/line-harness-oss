import { logger } from '@line-crm/shared/server';
import { patchFriendMetadata } from '../features/friends/friend-metadata/index.js';
import { inputError, readBoundedBytes } from '../lib/input-errors.js';
import { uploadFormDocument } from './form-documents.js';

import { getFormById, formBelongsToLineAccount, getLatestFormSubmission, getFriendByLineUserIdForAccount, jstNow } from '@line-crm/db';
import { verifyCallerLineIdentity } from '../services/liff-auth.js';
import { builtinFileScan, markFileScanClean } from '../services/file-scan.js';
import { imageDimensions } from '../features/media/media-metadata/index.js';
import { ensureFileScanForUpload } from './file-scan.js';
import type { Form as DbForm } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { collectInputs, formFileKind, parseLayout } from '@line-crm/shared';
import { stoppedPublicFormResponse, readFormTestToken, verifyFormTestToken, PARTIAL_MERGED_MAX_BYTES, FORM_UPLOAD_TYPES, FORM_UPLOAD_MAX_BYTES } from './forms-definition.js';
import type { Context } from 'hono';

export const post__api_forms_id_opened_1 = async (c: Context<Env, "/api/forms/:id/opened">) => {
  const stopped = await stoppedPublicFormResponse(c, c.req.param('id'));
  if (stopped) return stopped;
  try {
    const formId = c.req.param('id');
    // P（試し回答）：試し合言葉が正しければ、下書きの「開いた記録」を試しで残す。
    // 受付停止の下書きでも試せる。本物の数（完了率の分母）には入れない。
    const presentedTestToken = readFormTestToken(c);
    if (presentedTestToken) {
      if (!await verifyFormTestToken(c.env.DB, formId, presentedTestToken)) {
        return c.json({ success: false, error: '試し合言葉が無効です。管理画面から取り直してください' }, 403);
      }
      const draft = await getFormById(c.env.DB, formId);
      if (!draft) {
        return c.json({ success: false, error: 'Form not found' }, 404);
      }
      const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
      if (identity && (!identity.lineAccountId
        || !await formBelongsToLineAccount(c.env.DB, formId, identity.lineAccountId))) {
        return c.json({ success: true, isTest: true });
      }
      const friend = identity
        ? await getFriendByLineUserIdForAccount(
            c.env.DB,
            identity.lineUserId,
            identity.lineAccountId,
          )
        : null;
      await c.env.DB.prepare(
        'INSERT INTO form_opens (id, form_id, friend_id, friend_name, opened_at, is_test) VALUES (?, ?, ?, ?, ?, 1)',
      ).bind(
        crypto.randomUUID(),
        formId,
        friend?.id ?? null,
        friend?.display_name ?? null,
        jstNow(),
      ).run();
      return c.json({ success: true, isTest: true });
    }
    /*
     * 受け付けていないフォームの「開いた記録」を増やさない。**塞ぐのは2つ。**
     *
     *   保管した（status='archived'） … `getFormById` が見つけない → 404
     *   受付を止めた（is_active=0）   … 下で弾く → 記録せず 200
     *
     * #722 の前は保管の側しか塞いでおらず、注記も保管のことしか書いて
     * いなかった。読むと全部塞がったように見えるのに、**受付を止めた
     * フォームは開かれるたびに `form_opens` が増え続けていた。**削除影響の
     * 画面に出る「開かれた回数」が水増しされ、止めたはずのフォームが
     * 使われ続けているように見えた。
     *
     * 止めた側を 404 にしないのは、この口が計測用で、呼び出し元（LIFF）の
     * 表示を邪魔しないため。**すぐ下の「関係のない公式アカウント」も同じ形**
     * ——記録せずに 200 を返す。
     */
    const openedForm = await getFormById(c.env.DB, formId, { published: true });
    if (!openedForm) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    if (!openedForm.is_active) {
      return c.json({ success: true });
    }
    // Open analytics may remain anonymous, but a caller can only attribute an
    // open to the LINE identity proven by its ID token. Body-supplied customer
    // IDs are intentionally ignored.
    const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
    if (identity && (!identity.lineAccountId
      || !await formBelongsToLineAccount(c.env.DB, formId, identity.lineAccountId))) {
      // 関係のない公式アカウントから開いた記録を、このフォームへ混ぜない。
      return c.json({ success: true });
    }
    const friend = identity
      ? await getFriendByLineUserIdForAccount(
          c.env.DB,
          identity.lineUserId,
          identity.lineAccountId,
        )
      : null;

    const now = jstNow();
    await c.env.DB.prepare(
      'INSERT INTO form_opens (id, form_id, friend_id, friend_name, opened_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      formId,
      friend?.id ?? null,
      friend?.display_name ?? null,
      now,
    ).run();

    return c.json({ success: true });
  } catch (err) {
    logger.error("forms.forms_id_opened_post_failed");
    return c.json({ success: true }); // non-blocking, always succeed
  }
};

export const post__api_forms_id_partial_2 = async (c: Context<Env, "/api/forms/:id/partial">) => {
  const stopped = await stoppedPublicFormResponse(c, c.req.param('id'));
  if (stopped) return stopped;
  const body = await c.req.json<{ data?: Record<string, unknown> }>();
  const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
  if (!identity) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  if (!identity.lineAccountId
    || !await formBelongsToLineAccount(c.env.DB, c.req.param('id'), identity.lineAccountId)) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }

  const friend = await getFriendByLineUserIdForAccount(
    c.env.DB,
    identity.lineUserId,
    identity.lineAccountId,
  );

  if (!friend) {
    return c.json({ success: false, error: 'Friend not found' }, 404);
  }

  const form = await getFormById(c.env.DB, c.req.param('id'), { published: true });
  if (!form) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  /*
   * 受付を止めたフォームへ下書きを書かない（#722）。ここは友だちの
   * `friends.metadata` を直に書き換えるので、止めたあとも書けると
   * **受け付けていないはずの答えが業務データへ入り続ける。**
   * 断り方は `/submit`（:1024）・`/files`（:891）と同じ 400 に揃える。
   */
  if (!form.is_active) {
    return inputError(c, { success: false, error: 'This form is no longer accepting responses' }, 400, []);
  }
  // 回答定義に無い鍵は受け付けない。業務で使う鍵の上書きを防ぐ。
  const allowedNames = new Set(
    collectInputs(parseLayout(form.layout, form.fields)).map((block) => block.name),
  );
  const incoming = body.data && typeof body.data === 'object' ? body.data : {};
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (allowedNames.has(key)) filtered[key] = value;
  }

  // Save survey data to friend metadata (merge with existing).
  // 壊れた既存値は空として扱う。ここで例外を投げると500になる。
  let existingMeta: Record<string, unknown> = {};
  try {
    const parsed: unknown = friend.metadata ? JSON.parse(friend.metadata) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existingMeta = parsed as Record<string, unknown>;
    }
  } catch {
    existingMeta = {};
  }
  const merged = { ...existingMeta, ...filtered };
  const mergedJson = JSON.stringify(merged);
  if (new TextEncoder().encode(mergedJson).byteLength > PARTIAL_MERGED_MAX_BYTES) {
    return c.json({ success: false, error: '送信内容が大きすぎます' }, 413);
  }
  if (!await patchFriendMetadata(c.env.DB, friend.id, filtered, { maxBytes: PARTIAL_MERGED_MAX_BYTES })) {
    return c.json({ success: false, error: '送信内容が大きすぎます' }, 413);
  }

  return c.json({ success: true });
};

export const post__api_forms_id_files_3 = async (c: Context<Env, "/api/forms/:id/files">) => {
  const stopped = await stoppedPublicFormResponse(c, c.req.param('id'));
  if (stopped) return stopped;
  const formId = c.req.param('id');
  // P（試し回答）：試し合言葉が正しければ、下書きへの添付も試せる。
  // 受付停止の下書きでも試せる。検査（危険な中身の確認）は本物と同じにする。
  const fileTestToken = readFormTestToken(c);
  let form: DbForm;
  if (fileTestToken) {
    if (!await verifyFormTestToken(c.env.DB, formId, fileTestToken)) {
      return c.json({ success: false, error: '試し合言葉が無効です。管理画面から取り直してください' }, 403);
    }
    const draft = await getFormById(c.env.DB, formId);
    if (!draft) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    form = draft;
  } else {
    const published = await getFormById(c.env.DB, formId, { published: true });
    if (!published) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    if (!published.is_active) {
      return inputError(c, { success: false, error: 'このフォームは受け付けていません' }, 400, []);
    }
    form = published;
  }

  const layout = parseLayout(form.layout, form.fields);
  const fileBlocks = collectInputs(layout).filter(block => block.type === 'file');
  const acceptsFile = fileBlocks.length > 0;
  if (!acceptsFile) {
    return inputError(c, { success: false, error: 'このフォームはファイルを受け付けていません' }, 400, []);
  }

  const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
  if (!identity) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  if (!identity.lineAccountId
    || !await formBelongsToLineAccount(c.env.DB, formId, identity.lineAccountId)) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  const friend = await getFriendByLineUserIdForAccount(
    c.env.DB,
    identity.lineUserId,
    identity.lineAccountId,
  );
  if (!friend) {
    return c.json({ success: false, error: 'Friend not found' }, 404);
  }

  const blockId = c.req.query('block_id');
  if (blockId) {
    const block = fileBlocks.find(b => b.id === blockId);
    if (!block) return c.json({ success: false, error: '添付の質問が見つかりません' }, 400);
    return await uploadFormDocument(c, block, { accountId: identity.lineAccountId, formId, friendId: friend.id, versionId: form.current_published_version_id ?? null });
  }
  if (!fileBlocks.some(b => formFileKind(b) === 'image')) return c.json({ success: false, error: '添付する質問を選んでください' }, 400);

  const mimeType = (c.req.header('Content-Type') || '').split(';')[0].trim();
  const extension = FORM_UPLOAD_TYPES[mimeType];
  if (!extension) {
    return inputError(c, { success: false, error: '画像は jpg・png・gif・webp・heic のいずれかで送ってください' }, 400, []);
  }

  // 本文を読む前に、申告された長さで断れるものは断る。10MBを読み込んでから
  // 大きすぎると返すのは、相手の通信量を無駄に使う。
  const declared = Number(c.req.header('Content-Length') || 0);
  if (declared > FORM_UPLOAD_MAX_BYTES) {
    return inputError(c, { success: false, error: '画像は10MBまでです' }, 400, []);
  }

  const data = await readBoundedBytes(c.req.raw, FORM_UPLOAD_MAX_BYTES);
  if (data === null) return inputError(c, { success: false, error: '画像は10MBまでです' }, 400, []);
  if (data.byteLength === 0) {
    return inputError(c, { success: false, error: 'ファイルが空です' }, 400, []);
  }
  if (data.byteLength > FORM_UPLOAD_MAX_BYTES) {
    return inputError(c, { success: false, error: '画像は10MBまでです' }, 400, []);
  }

  // 誰の・どのフォームの添付かが、キーを見れば分かるようにしておく。
  // 削除依頼が来たときに、消す対象をキーの形だけで絞り込める。
  const key = `form-uploads/${formId}/${friend.id}/${crypto.randomUUID()}.${extension}`;
  // 保存の前に検査の段を入れる。危険な中身はしまって保存しない。
  const formBytes = new Uint8Array(data);
  const formDims = imageDimensions(formBytes, mimeType);
  const formCheck = builtinFileScan(formBytes, {
    filename: `添付.${extension}`,
    mimeType,
    sizeBytes: formBytes.byteLength,
    width: formDims?.width ?? null,
    height: formDims?.height ?? null,
  });
  if (formCheck.verdict !== 'clean') {
    const message = formCheck.verdict === 'quarantined'
      ? '確認のため受け付けできません。別の画像を選び直してください'
      : `受け付けできません（${formCheck.detail}）。画像を選び直してください`;
    return inputError(c, { success: false, code: 'file_scan_blocked', error: message }, 422, []);
  }
  await c.env.IMAGES.put(key, data, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { formId, friendId: friend.id },
  });
  // 配信・公開に出す前の門番用に、検査済みの記録を残す。
  await ensureFileScanForUpload({
    db: c.env.DB,
    lineAccountId: identity.lineAccountId,
    subjectKind: 'form_file',
    subjectId: key,
    mediaId: null,
    filename: `添付.${extension}`,
    mimeType,
    sizeBytes: formBytes.byteLength,
  }).then((scan) => markFileScanClean(c.env.DB, scan.id))
    .catch((err) => logger.error("forms.forms_id_files_post_failed"));

  const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
  return c.json(
    { success: true, data: { key, url: `${workerUrl}/images/${key}`, mimeType, size: data.byteLength } },
    201,
  );
};

export const get__api_forms_id_my_latest_4 = async (c: Context<Env, "/api/forms/:id/my-latest">) => {
  const stopped = await stoppedPublicFormResponse(c, c.req.param('id'));
  if (stopped) return stopped;
  const formId = c.req.param('id');
  const form = await getFormById(c.env.DB, formId, { published: true });
  if (!form) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }

  const layout = parseLayout(form.layout, form.fields);
  if (!layout.options?.restorePrevious) {
    return c.json({ success: true, data: null });
  }

  const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
  if (!identity) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  if (!identity.lineAccountId
    || !await formBelongsToLineAccount(c.env.DB, formId, identity.lineAccountId)) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  const friend = await getFriendByLineUserIdForAccount(
    c.env.DB,
    identity.lineUserId,
    identity.lineAccountId,
  );
  if (!friend) {
    return c.json({ success: true, data: null });
  }

  const latest = await getLatestFormSubmission(c.env.DB, formId, friend.id);
  if (!latest) {
    return c.json({ success: true, data: null });
  }

  let answers: Record<string, unknown> = {};
  try {
    answers = JSON.parse(latest.data || '{}') as Record<string, unknown>;
  } catch {
    answers = {};
  }
  delete answers._webhookResult;
  return c.json({ success: true, data: { answers, createdAt: latest.created_at } });
};
