// オートウェビナー (疑似ライブ) HTTP routes.
//
// LIFF:   /api/liff/webinars/:slug          (id_token verify で friend 特定)
// Assets: /webinar-assets/:token/:slug/*    (HMAC トークン、R2 から HLS 配信)
// Admin:  /api/webinars/*                   (既存 authMiddleware がカバー)
//
// 時刻の権威はサーバー。resolveSession が「現在時刻 − 開始時刻」を返し、
// クライアントは受信 offset + 単調経過時間で再生位置を維持する。
// トークンをクエリでなく URL パスに置くのは、m3u8 内の相対参照
// (variant playlist / セグメント) が同じディレクトリ配下として解決され、
// 追加の書き換えなしに全リクエストへトークンが伝播するため。
//
// See: docs/superpowers/specs/2026-07-29-auto-webinar-design.md

import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  getWebinarById,
  getWebinarBySlug,
  createWebinar,
  updateWebinar,
  archiveWebinar,
  getWebinarComments,
  getWebinarCtas,
  replaceWebinarCtas,
  replaceWebinarComments,
  upsertWebinarViewer,
  updateWebinarViewerPosition,
  recordWebinarViewSegment,
  recordWebinarCtaClick,
  recordWebinarFunnelEvent,
  insertWebinarUserComment,
  countSessionUserComments,
  getWebinarUserComments,
  getWebinarSessionStats,
  getWebinarDropoff,
  getWebinarParticipantStats,
  getWebinarAnalyticsSummary,
  getWebinarDailyStats,
  getWebinarFormFunnelStats,
  getWebinarOverview,
  getWebinarList,
  countWebinarList,
  webinarListSort,
  type WebinarListFilters,
  getWebinarEditorSettings,
  saveWebinarEditorSettings,
  publishWebinarEditorVersion,
  getWebinarViewSegmentCoverage,
  getWebinarParticipantOperations,
  getWebinarMonitoringSummary,
  getWebinarPublicAccount,
  getWebinarActions,
  replaceWebinarActions,
  getFriendByLineUserId,
  getFriendByLineUserIdForAccount,
  getFormById,
  formBelongsToLineAccount,
  type Webinar,
  type WebinarListRow,
  getFolderById,
  getUpcomingWebinarRegistration,
  getWebinarRegistration,
  recordWebinarPickerOpen,
  type WebinarActionInput,
  type WebinarActionType,
  type WebinarEditorSettings,
  type WebinarEditorSettingsInput,
} from '@line-crm/db';
import { verifyCallerLineUserId } from '../services/liff-auth.js';
import { attachTagAndFireSideEffects } from '../services/friend-tag-attach.js';
import { resolveSession, parseScheduleRules, upcomingSessions } from '../services/webinar-schedule.js';
import { sendWebinarRegistrationConfirmation } from '../services/webinar-reminders.js';
import {
  enqueueWebinarCompletedNotification,
  getWebinarNotificationOverview,
  getWebinarNotificationSettings,
  registerWebinarSession,
  saveWebinarNotificationSettings,
  sendWebinarNotificationTest,
  type WebinarNotificationSettingsInput,
} from '../services/webinar-notifications.js';
import { dispatchLineProxyLocally } from '../services/local-line-proxy.js';
import { signWebinarToken, verifyWebinarToken } from '../lib/webinar-token.js';
import {
  awardWebinarCtaMileage,
  awardWebinarPositionMileage,
} from '../services/webinar-mileage.js';
import type { Env } from '../index.js';
import { buildOffsetListResponse, parseOffsetPaging } from '../lib/list-paging.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { auditLog } from '../lib/audit-log.js';

const webinarRoutes = new Hono<Env>();

const COMMENT_MAX = 500;
/* さくらコメント一括置換の件数上限。CTA の 20 件と違い演出行は多いが、
   上限なしだと巨大配列で D1 batch 上限超過→500 になる。 */
const SAKURA_COMMENTS_MAX = 200;
const SESSION_COMMENT_LIMIT = 60;
const TOKEN_GRACE_SECONDS = 3600;
// 開始後もこの秒数までは、その回を予約して途中参加できる。
// ただし未予約者へ再生トークンは一切返さず、必ず予約を先に通す。
const CURRENT_SESSION_JOIN_GRACE_SECONDS = 5 * 60;
// 開始前「待機ルーム」を開く秒数。この窓内はサクラコメント (負の at_seconds)
// と視聴者コメントが動く。管理画面での編集余地を持たせて負方向は 1h まで許容。
const WAITING_ROOM_SECONDS = 600;
const COMMENT_MIN_AT_SECONDS = -3600;
const FUNNEL_EVENT_TYPES = new Set([
  'cta_impression',
  'form_open',
  'form_start',
  'field_complete',
  'submit_attempt',
  'submit_success',
  'submit_error',
]);

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

// LIFF caller を認証し、webinar とそのアカウント配下の friend を解決する。
// 認証 (401) を webinar 存在確認より先に行う (existence oracle 対策)。
// friend はウェビナーのアカウント配下の行を優先する (同一プロバイダーの複数
// アカウントは line_user_id が同一のため、無指定の先頭一致だと別アカウントの
// friend 行に吸われて予約・確認プッシュ・リマインドのアカウントがズレる)。
async function resolveWebinarCaller(
  c: Context<Env>,
  slug: string,
): Promise<{ webinar: Webinar; friendId: string } | Response> {
  const lineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!lineUserId) return c.json({ error: 'unauthorized' }, 401);
  const loaded = await loadActiveWebinar(c, slug);
  if (loaded instanceof Response) return loaded;
  const friend = await getFriendByLineUserIdForAccount(
    c.env.DB, lineUserId, loaded.webinar.account_id,
  );
  if (!friend) return c.json({ error: 'friend_not_found' }, 403);
  return { webinar: loaded.webinar, friendId: friend.id };
}

async function loadActiveWebinar(
  c: Context<Env>,
  slug: string,
): Promise<{ webinar: Webinar } | Response> {
  const webinar = await getWebinarBySlug(c.env.DB, slug);
  if (!webinar || webinar.status !== 'active') {
    return c.json({ error: 'not_found' }, 404);
  }
  return { webinar };
}

// ----------------------------------------------------------------
// LIFF: 視聴状態
// ----------------------------------------------------------------

webinarRoutes.get('/api/liff/webinars/:slug', async (c) => {
  try {
    const auth = await resolveWebinarCaller(c, c.req.param('slug'));
    if (auth instanceof Response) return auth;
    const { webinar } = auth;

    const now = nowEpoch();
    const rules = parseScheduleRules(webinar.schedule_json);
    const session = resolveSession(rules, webinar.duration_seconds, now);

    // 予約後に発行した専用リンクは sessionStartAt を含む。
    // LIFF で本人確認した上で、同じ webinar×friend×session の予約行が
    // 実在する場合だけ予約パスとして扱う。URL を転送しても他人は通らない。
    const requestedSessionRaw = c.req.query('sessionStartAt');
    const requestedSessionStartAt = requestedSessionRaw === undefined
      ? null
      : Number(requestedSessionRaw);
    const admissionReg =
      requestedSessionStartAt !== null &&
      Number.isInteger(requestedSessionStartAt) &&
      requestedSessionStartAt > 0
        ? await getWebinarRegistration(
            c.env.DB, webinar.id, auth.friendId, requestedSessionStartAt,
          )
        : null;

    // 配信終了後でも、専用リンクを持つ予約済み本人には
    // その回を先頭から再生する。アセットトークンは開くたびに再発行するため、
    // 入場リンク自体に期限を持たせない。
    if (
      admissionReg &&
      requestedSessionStartAt !== null &&
      now >= requestedSessionStartAt + webinar.duration_seconds
    ) {
      await upsertWebinarViewer(
        c.env.DB, webinar.id, auth.friendId, requestedSessionStartAt,
      );
      if (webinar.tag_on_attend) {
        c.executionCtx.waitUntil(
          Promise.resolve(
            attachTagAndFireSideEffects(c.env.DB, auth.friendId, webinar.tag_on_attend),
          ).catch((err) => console.error('webinar replay attend tag error:', err)),
        );
      }

      const exp = now + webinar.duration_seconds + TOKEN_GRACE_SECONDS;
      const token = await signWebinarToken(c.env.LINE_CHANNEL_SECRET, webinar.slug, exp);
      const [comments, ctas] = await Promise.all([
        getWebinarComments(c.env.DB, webinar.id),
        getWebinarCtas(c.env.DB, webinar.id),
      ]);
      return c.json({
        live: true,
        replay: true,
        title: webinar.title,
        durationSeconds: webinar.duration_seconds,
        sessionStartAt: requestedSessionStartAt,
        offsetSeconds: 0,
        upcoming: upcomingSessions(rules, webinar.duration_seconds, now, 48),
        registeredSessionAt: null,
        registeredForThisSession: true,
        playlistUrl: `/webinar-assets/${token}/${webinar.slug}/master.m3u8`,
        cta: webinar.cta_json ? (JSON.parse(webinar.cta_json) as unknown) : null,
        comments: comments.map((cm) => ({
          atSeconds: cm.at_seconds,
          authorName: cm.author_name,
          body: cm.body,
        })),
        ctas: ctas.map((ct) => ({
          id: ct.id,
          atSeconds: ct.at_seconds,
          kind: ct.kind,
          title: ct.title,
          body: ct.body,
          buttonLabel: ct.button_label,
          autoOpen: Boolean(ct.auto_open),
          formId: ct.form_id,
          url: ct.url,
        })),
      });
    }

    if (!session.live) {
      const reg = await getUpcomingWebinarRegistration(c.env.DB, webinar.id, auth.friendId, now);
      // 開始 WAITING_ROOM_SECONDS 前からは「待機ルーム」: 開始前サクラコメント
      // (負の at_seconds) を流すためのペイロードを返す。ハートビート・attend
      // タグ・再生トークンはライブ開始まで発行しない。未予約者は待機ルームへ
      // 直行させず、必ずセッション選択メニューを表示する。
      const next = session.nextSessionAt;
      if (
        next !== null &&
        next - now <= WAITING_ROOM_SECONDS &&
        reg?.session_start_at === next
      ) {
        const comments = await getWebinarComments(c.env.DB, webinar.id);
        return c.json({
          live: false,
          waiting: true,
          title: webinar.title,
          nextSessionAt: next,
          offsetSeconds: now - next,
          comments: comments.map((cm) => ({
            atSeconds: cm.at_seconds,
            authorName: cm.author_name,
            body: cm.body,
          })),
        });
      }
      // 30分間隔・24時間開催の1日分。クライアントは直近6件から段階表示し、
      // 48件を一度に並べて離脱を招かない。
      const upcoming = upcomingSessions(rules, webinar.duration_seconds, now, 48);
      if (!reg && upcoming.length > 0) {
        await recordWebinarPickerOpen(c.env.DB, webinar.id, auth.friendId);
      }
      return c.json({
        live: false,
        title: webinar.title,
        nextSessionAt: next,
        upcoming,
        registeredSessionAt: reg?.session_start_at ?? null,
      });
    }

    const [currentReg, liveReg] = await Promise.all([
      getWebinarRegistration(c.env.DB, webinar.id, auth.friendId, session.sessionStartAt!),
      getUpcomingWebinarRegistration(c.env.DB, webinar.id, auth.friendId, now),
    ]);
    const withinJoinGrace = (session.offsetSeconds ?? Infinity) <= CURRENT_SESSION_JOIN_GRACE_SECONDS;
    const liveUpcoming = upcomingSessions(rules, webinar.duration_seconds, now, 48);

    // 直リンクを含め、未予約者へは動画 URL / 再生トークンを返さない。
    // 開始5分以内だけ現在回を新規予約できる。一方、すでにこの回を
    // 予約済みの本人は、LIFF を閉じた後でも配信終了まで再入場できる。
    if (!currentReg) {
      const bookable = withinJoinGrace
        ? [session.sessionStartAt!, ...liveUpcoming].slice(0, 48)
        : liveUpcoming;
      if (!liveReg && bookable.length > 0) {
        await recordWebinarPickerOpen(c.env.DB, webinar.id, auth.friendId);
      }
      return c.json({
        live: false,
        title: webinar.title,
        nextSessionAt: bookable[0] ?? session.nextSessionAt,
        upcoming: bookable,
        registeredSessionAt: liveReg?.session_start_at ?? null,
      });
    }

    await upsertWebinarViewer(c.env.DB, webinar.id, auth.friendId, session.sessionStartAt!);
    if (webinar.tag_on_attend) {
      c.executionCtx.waitUntil(
        Promise.resolve(
          attachTagAndFireSideEffects(c.env.DB, auth.friendId, webinar.tag_on_attend),
        ).catch((err) => console.error('webinar attend tag error:', err)),
      );
    }

    const exp = session.sessionStartAt! + webinar.duration_seconds + TOKEN_GRACE_SECONDS;
    const token = await signWebinarToken(c.env.LINE_CHANNEL_SECRET, webinar.slug, exp);
    const [comments, ctas] = await Promise.all([
      getWebinarComments(c.env.DB, webinar.id),
      getWebinarCtas(c.env.DB, webinar.id),
    ]);

    return c.json({
      live: true,
      title: webinar.title,
      durationSeconds: webinar.duration_seconds,
      sessionStartAt: session.sessionStartAt,
      offsetSeconds: session.offsetSeconds,
      upcoming: liveUpcoming,
      registeredSessionAt: liveReg?.session_start_at ?? null,
      registeredForThisSession: true,
      playlistUrl: `/webinar-assets/${token}/${webinar.slug}/master.m3u8`,
      cta: webinar.cta_json ? (JSON.parse(webinar.cta_json) as unknown) : null,
      comments: comments.map((cm) => ({
        atSeconds: cm.at_seconds,
        authorName: cm.author_name,
        body: cm.body,
      })),
      ctas: ctas.map((ct) => ({
        id: ct.id,
        atSeconds: ct.at_seconds,
        kind: ct.kind,
        title: ct.title,
        body: ct.body,
        buttonLabel: ct.button_label,
        autoOpen: Boolean(ct.auto_open),
        formId: ct.form_id,
        url: ct.url,
      })),
    });
  } catch (err) {
    console.error('GET /api/liff/webinars/:slug error:', err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

webinarRoutes.post('/api/liff/webinars/:slug/heartbeat', async (c) => {
  try {
    const auth = await resolveWebinarCaller(c, c.req.param('slug'));
    if (auth instanceof Response) return auth;
    const loaded = { webinar: auth.webinar };

    const body = await c.req.json<{ sessionStartAt?: unknown; positionSeconds?: unknown }>();
    const sessionStartAt = Number(body.sessionStartAt);
    const positionSeconds = Math.floor(Number(body.positionSeconds));
    if (
      !Number.isFinite(sessionStartAt) ||
      !Number.isFinite(positionSeconds) ||
      positionSeconds < 0 ||
      positionSeconds > loaded.webinar.duration_seconds + 60
    ) {
      return c.json({ error: 'invalid_body' }, 422);
    }
    await updateWebinarViewerPosition(
      c.env.DB, loaded.webinar.id, auth.friendId, sessionStartAt, positionSeconds,
    );
    if (positionSeconds > 0) {
      await recordWebinarViewSegment(
        c.env.DB, loaded.webinar.id, auth.friendId, sessionStartAt, positionSeconds,
      );
    }
    c.executionCtx.waitUntil(awardWebinarPositionMileage(c.env.DB, {
      webinarId: loaded.webinar.id,
      friendId: auth.friendId,
      sessionStartAt,
      positionSeconds,
      durationSeconds: loaded.webinar.duration_seconds,
    }));
    if (positionSeconds >= Math.floor(loaded.webinar.duration_seconds * 0.9)) {
      c.executionCtx.waitUntil(enqueueWebinarCompletedNotification(
        c.env.DB,
        loaded.webinar.id,
        auth.friendId,
        sessionStartAt,
      ));
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('POST heartbeat error:', err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

webinarRoutes.post('/api/liff/webinars/:slug/comments', async (c) => {
  try {
    const auth = await resolveWebinarCaller(c, c.req.param('slug'));
    if (auth instanceof Response) return auth;
    const loaded = { webinar: auth.webinar };

    const body = await c.req.json<{
      sessionStartAt?: unknown; atSeconds?: unknown; body?: unknown;
    }>();
    const sessionStartAt = Number(body.sessionStartAt);
    const atSeconds = Math.floor(Number(body.atSeconds));
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (
      !Number.isFinite(sessionStartAt) || !Number.isFinite(atSeconds) ||
      atSeconds < COMMENT_MIN_AT_SECONDS || text.length === 0 || text.length > COMMENT_MAX
    ) {
      return c.json({ error: 'invalid_body' }, 422);
    }
    // sessionStartAt はクライアント申告値。サーバー側で現在のセッションを再計算し、
    // ライブ外や偽装 sessionStartAt でのコメント投稿（60件上限バイパス含む）を防ぐ。
    // 待機ルーム中 (次回開始まで WAITING_ROOM_SECONDS 以内) は次回セッション帰属で
    // 負の atSeconds を受ける。
    const session = resolveSession(
      parseScheduleRules(loaded.webinar.schedule_json),
      loaded.webinar.duration_seconds,
      nowEpoch(),
    );
    if (session.live) {
      if (sessionStartAt !== session.sessionStartAt) {
        return c.json({ error: 'not_live' }, 409);
      }
    } else {
      const next = session.nextSessionAt;
      const inWaitingRoom = next !== null && next - nowEpoch() <= WAITING_ROOM_SECONDS;
      if (!inWaitingRoom || sessionStartAt !== next) {
        return c.json({ error: 'not_live' }, 409);
      }
    }
    const count = await countSessionUserComments(
      c.env.DB, loaded.webinar.id, auth.friendId, sessionStartAt,
    );
    if (count >= SESSION_COMMENT_LIMIT) {
      return c.json({ error: 'too_many_comments' }, 429);
    }
    await insertWebinarUserComment(c.env.DB, {
      webinarId: loaded.webinar.id,
      friendId: auth.friendId,
      sessionStartAt,
      atSeconds,
      body: text,
    });
    return c.json({ ok: true });
  } catch (err) {
    console.error('POST webinar comment error:', err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

// セッション選択メニューの予約。sessionStartAt はスケジュール上の実在する
// 未来セッションに加え、開始後5分以内だけ現在回も受理。
// 冪等 (同一回の再予約は成功扱い)。
webinarRoutes.post('/api/liff/webinars/:slug/register', async (c) => {
  try {
    const auth = await resolveWebinarCaller(c, c.req.param('slug'));
    if (auth instanceof Response) return auth;
    const loaded = { webinar: auth.webinar };
    const { webinar } = loaded;

    const body = await c.req.json<{ sessionStartAt?: unknown }>();
    const sessionStartAt = Number(body.sessionStartAt);
    const rules = parseScheduleRules(webinar.schedule_json);
    const now = nowEpoch();
    const session = resolveSession(rules, webinar.duration_seconds, now);
    const upcoming = upcomingSessions(rules, webinar.duration_seconds, now, 48);
    const currentIsBookable =
      session.live &&
      session.sessionStartAt === sessionStartAt &&
      (session.offsetSeconds ?? Infinity) <= CURRENT_SESSION_JOIN_GRACE_SECONDS;
    if (
      !Number.isFinite(sessionStartAt) ||
      (!currentIsBookable && !upcoming.includes(sessionStartAt))
    ) {
      return c.json({ error: 'invalid_session' }, 400);
    }
    const registered = await registerWebinarSession(
      c.env.DB,
      webinar.id,
      auth.friendId,
      sessionStartAt,
    );
    const notificationSettings = await getWebinarNotificationSettings(c.env.DB, webinar.id);
    const liffMatch = /liff\.line\.me\/([^/?]+)/.exec(c.env.LIFF_URL ?? '');
    if (registered.created && (notificationSettings?.registrationEnabled ?? true)) c.executionCtx.waitUntil(
      sendWebinarRegistrationConfirmation(
        c.env.DB,
        webinar,
        auth.friendId,
        sessionStartAt,
        {
          proxyBaseUrl: new URL(c.req.url).origin,
          defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
          defaultLiffId: liffMatch?.[1] ?? null,
          proxyDispatch: (request) =>
            dispatchLineProxyLocally(request, c.env, c.executionCtx),
        },
        registered.registration.id,
        notificationSettings
          ? [
              notificationSettings.dayBeforeEnabled ? `前日${notificationSettings.dayBeforeTime}` : '',
              notificationSettings.hourBeforeEnabled ? `${notificationSettings.hourBeforeMinutes}分前` : '',
              notificationSettings.startEnabled ? '開始時' : '',
            ].filter(Boolean).join('・') || '設定した時刻'
          : '開始5分前',
      ),
    );
    return c.json({
      ok: true,
      sessionStartAt,
      rescheduled: registered.rescheduled,
      confirmationQueued: registered.created && (notificationSettings?.registrationEnabled ?? true),
    });
  } catch (err) {
    console.error('POST webinar register error:', err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

webinarRoutes.post('/api/liff/webinars/:slug/cta-click', async (c) => {
  try {
    const auth = await resolveWebinarCaller(c, c.req.param('slug'));
    if (auth instanceof Response) return auth;
    const loaded = { webinar: auth.webinar };

    const body = await c.req.json<{ sessionStartAt?: unknown; ctaId?: unknown }>();
    const sessionStartAt = Number(body.sessionStartAt);
    const ctaId = typeof body.ctaId === 'string' ? body.ctaId.slice(0, 128) : '';
    if (!Number.isFinite(sessionStartAt)) return c.json({ error: 'invalid_body' }, 422);

    if (ctaId) {
      const ctas = await getWebinarCtas(c.env.DB, loaded.webinar.id);
      if (!ctas.some((cta) => cta.id === ctaId)) {
        return c.json({ error: 'invalid_cta' }, 422);
      }
    }

    await recordWebinarCtaClick(c.env.DB, loaded.webinar.id, auth.friendId, sessionStartAt);
    await recordWebinarFunnelEvent(c.env.DB, {
      webinarId: loaded.webinar.id,
      friendId: auth.friendId,
      sessionStartAt,
      eventType: 'cta_click',
      ctaId,
    });
    c.executionCtx.waitUntil(awardWebinarCtaMileage(c.env.DB, {
      webinarId: loaded.webinar.id,
      friendId: auth.friendId,
      sessionStartAt,
      ctaId,
    }));
    if (loaded.webinar.tag_on_cta_click) {
      c.executionCtx.waitUntil(
        Promise.resolve(
          attachTagAndFireSideEffects(
            c.env.DB, auth.friendId, loaded.webinar.tag_on_cta_click,
          ),
        ).catch((err) => console.error('webinar cta tag error:', err)),
      );
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('POST cta-click error:', err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

// CTA表示→フォーム入力→送信の途中離脱を段階計測する。
// 同一 friend・同一回・同一段階はDB側の一意制約で1件にまとめる。
webinarRoutes.post('/api/liff/webinars/:slug/funnel-event', async (c) => {
  try {
    const auth = await resolveWebinarCaller(c, c.req.param('slug'));
    if (auth instanceof Response) return auth;
    const body = await c.req.json<{
      sessionStartAt?: unknown;
      eventType?: unknown;
      ctaId?: unknown;
      formId?: unknown;
      fieldName?: unknown;
    }>();
    const sessionStartAt = Number(body.sessionStartAt);
    const eventType = typeof body.eventType === 'string' ? body.eventType : '';
    const ctaId = typeof body.ctaId === 'string' ? body.ctaId.slice(0, 128) : '';
    const formId = typeof body.formId === 'string' ? body.formId.slice(0, 128) : '';
    const fieldName = typeof body.fieldName === 'string' ? body.fieldName.slice(0, 64) : '';
    if (!Number.isInteger(sessionStartAt) || !FUNNEL_EVENT_TYPES.has(eventType)) {
      return c.json({ error: 'invalid_body' }, 422);
    }
    if (fieldName && !/^[A-Za-z0-9_]+$/.test(fieldName)) {
      return c.json({ error: 'invalid_field_name' }, 422);
    }
    const registration = await getWebinarRegistration(
      c.env.DB, auth.webinar.id, auth.friendId, sessionStartAt,
    );
    if (!registration) return c.json({ error: 'not_registered' }, 409);

    const ctas = await getWebinarCtas(c.env.DB, auth.webinar.id);
    if (ctaId && !ctas.some((cta) => cta.id === ctaId)) {
      return c.json({ error: 'invalid_cta' }, 422);
    }
    if (formId && !ctas.some((cta) => cta.form_id === formId)) {
      return c.json({ error: 'invalid_form' }, 422);
    }

    await recordWebinarFunnelEvent(c.env.DB, {
      webinarId: auth.webinar.id,
      friendId: auth.friendId,
      sessionStartAt,
      eventType: eventType as Parameters<typeof recordWebinarFunnelEvent>[1]['eventType'],
      ctaId,
      formId,
      fieldName,
    });
    return c.json({ ok: true });
  } catch (err) {
    console.error('POST funnel-event error:', err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

// ----------------------------------------------------------------
// HLS アセット配信
// ----------------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
  m4s: 'video/iso.segment',
  mp4: 'video/mp4',
  aac: 'audio/aac',
};

webinarRoutes.get('/webinar-assets/:token/:slug/*', async (c) => {
  const token = c.req.param('token');
  const slug = c.req.param('slug');

  const valid = await verifyWebinarToken(c.env.LINE_CHANNEL_SECRET, slug, token, nowEpoch());
  if (!valid) return c.json({ error: 'forbidden' }, 403);

  const webinar = await getWebinarBySlug(c.env.DB, slug);
  if (!webinar || !webinar.video_prefix) return c.json({ error: 'not_found' }, 404);

  const prefix = `/webinar-assets/${token}/${slug}/`;
  const rest = decodeURIComponent(c.req.path.slice(prefix.length));
  if (!rest || rest.includes('..') || rest.startsWith('/')) {
    return c.json({ error: 'bad_path' }, 400);
  }

  const object = await c.env.IMAGES.get(`${webinar.video_prefix}/${rest}`);
  if (!object) return c.json({ error: 'not_found' }, 404);

  const ext = rest.split('.').pop() ?? '';
  const headers = new Headers();
  headers.set('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');

  // ?at=<秒> 付きプレイリストは #EXT-X-START を注入し、途中参加位置からの
  // 再生を「配信側で」宣言する。iOS native HLS (LINE in-app) はクライアント側
  // の currentTime シークが 0 に巻き戻ることがあるため、開始位置はプレイリスト
  // で示すのが確実。master 内の variant URI にも ?at= を伝播する。
  const atRaw = c.req.query('at');
  if (ext === 'm3u8' && atRaw !== undefined) {
    const at = Math.floor(Number(atRaw));
    if (!Number.isFinite(at) || at < 0 || at > webinar.duration_seconds) {
      return c.json({ error: 'bad_at' }, 400);
    }
    const text = await object.text();
    const isMaster = text.includes('#EXT-X-STREAM-INF');
    const out: string[] = [];
    for (const line of text.split('\n')) {
      out.push(
        isMaster && line.trim() !== '' && !line.startsWith('#')
          ? `${line.trim()}${line.includes('?') ? '&' : '?'}at=${at}`
          : line,
      );
      if (line.startsWith('#EXTM3U')) {
        out.push(`#EXT-X-START:TIME-OFFSET=${at},PRECISE=YES`);
      }
    }
    // 開始位置は視聴タイミング依存の動的レスポンスなのでキャッシュさせない
    headers.set('Cache-Control', 'private, no-store');
    return new Response(out.join('\n'), { headers });
  }

  headers.set(
    'Cache-Control',
    ext === 'm3u8' ? 'public, max-age=3600' : 'public, max-age=31536000, immutable',
  );
  headers.set('ETag', object.etag);
  return new Response(object.body as ReadableStream, { headers });
});

// ----------------------------------------------------------------
// Admin API (/api/webinars/*) — 既存 authMiddleware がカバー
// ----------------------------------------------------------------

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

async function adminAccountScope(c: Context<Env>) {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const column = 'account_id';
  const where = scope.allowedAccountIds.length
    ? `(${column} IN (${scope.allowedAccountIds.map(() => '?').join(',')})${scope.canSeeUnassigned ? ` OR ${column} IS NULL` : ''})`
    : scope.canSeeUnassigned
      ? `${column} IS NULL`
      : '1 = 0';
  return { scope, where };
}

const requireVisibleWebinar: MiddlewareHandler<Env> = async (c, next) => {
  const webinar = await getWebinarById(c.env.DB, c.req.param('id') ?? '');
  if (!webinar || !await canAccessAllLineAccounts(
    c.env.DB, c.get('staff'), [webinar.account_id ?? null],
  )) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  await next();
};

webinarRoutes.get('/api/webinars/overview', async (c) => {
  try {
    const accountId = c.req.query('account_id')?.trim();
    if (!accountId) {
      return c.json({ success: false, error: 'account_id_required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    const overview = await getWebinarOverview(c.env.DB, accountId);
    return c.json({ success: true, data: overview });
  } catch (err) {
    console.error('GET /api/webinars/overview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.use('/api/webinars/:id', requireVisibleWebinar);
webinarRoutes.use('/api/webinars/:id/*', requireVisibleWebinar);

function publicationState(row: Webinar) {
  const startsAt = row.publication_starts_at ? Date.parse(row.publication_starts_at) : null;
  const endsAt = row.publication_ends_at ? Date.parse(row.publication_ends_at) : null;
  const now = Date.now();
  if (endsAt !== null && endsAt <= now) return 'ended' as const;
  if (startsAt !== null && startsAt > now) return 'scheduled' as const;
  if (row.status !== 'active') return 'unset' as const;
  if (startsAt === null && endsAt === null) return 'always' as const;
  return 'period' as const;
}

function serializeWebinar(row: Webinar) {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    videoPrefix: row.video_prefix,
    durationSeconds: row.duration_seconds,
    schedule: parseScheduleRules(row.schedule_json),
    cta: row.cta_json ? (JSON.parse(row.cta_json) as unknown) : null,
    tagOnAttend: row.tag_on_attend,
    tagOnCtaClick: row.tag_on_cta_click,
    folderId: row.folder_id ?? null,
    publicationState: publicationState(row),
    publicationStartsAt: row.publication_starts_at ?? null,
    publicationEndsAt: row.publication_ends_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeWebinarList(row: WebinarListRow) {
  return {
    ...serializeWebinar(row),
    folderName: row.folder_name ?? null,
    registrationCount: Number(row.registration_count),
    viewerCount: row.viewer_count === null ? null : Number(row.viewer_count),
  };
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function defaultEditorSettings(row: Webinar): WebinarEditorSettings {
  return {
    webinar_id: row.id,
    version: 0,
    delivery_kind: row.schedule_json === '[]' ? 'on_demand' : 'scheduled',
    viewing_condition_json: JSON.stringify({ kind: 'registered', label: '申込者向け' }),
    public_description: '',
    registration_form_id: null,
    notification_messages_json: '{}',
    notification_test_json: null,
    action_template_body: '',
    missing_result_policy: 'escalate',
    public_page_test_json: null,
    published_version: null,
    published_at: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function formFieldLabels(form: Awaited<ReturnType<typeof getFormById>>): string[] {
  if (!form) return [];
  const fields = parseJson<Array<Record<string, unknown>>>(form.fields, []);
  return fields.map((field) => String(field.label ?? field.name ?? field.key ?? '').trim()).filter(Boolean);
}

function formCompletionActions(form: Awaited<ReturnType<typeof getFormById>>): string[] {
  if (!form) return [];
  const actions: string[] = [];
  if (form.on_submit_tag_id) actions.push('タグを付ける');
  if (form.on_submit_scenario_id) actions.push('シナリオを開始する');
  if (form.on_submit_message_type) actions.push('完了メッセージを送る');
  if (form.on_submit_webhook_url) actions.push('Webhookへ送る');
  return actions;
}

async function getEditorPayload(c: Context<Env>, row: Webinar) {
  const stored = await getWebinarEditorSettings(c.env.DB, row.id);
  const settings = stored ?? defaultEditorSettings(row);
  const [form, account, monitoring] = await Promise.all([
    settings.registration_form_id
      ? getFormById(c.env.DB, settings.registration_form_id)
      : Promise.resolve(null),
    getWebinarPublicAccount(c.env.DB, row.account_id),
    getWebinarMonitoringSummary(c.env.DB, row.id),
  ]);
  const liffId = account?.liff_id ?? null;
  const publicUrl = liffId
    ? `https://liff.line.me/${encodeURIComponent(liffId)}/webinar/${encodeURIComponent(row.slug)}`
    : null;
  return {
    version: settings.version,
    deliveryKind: settings.delivery_kind,
    viewingCondition: parseJson(settings.viewing_condition_json, { kind: 'registered', label: '申込者向け' }),
    publicDescription: settings.public_description,
    registrationFormId: settings.registration_form_id,
    notificationMessages: parseJson<Record<string, string>>(settings.notification_messages_json, {}),
    notificationTest: parseJson<Record<string, unknown> | null>(settings.notification_test_json, null),
    actionPolicy: {
      templateBody: settings.action_template_body,
      missingResultPolicy: settings.missing_result_policy,
    },
    publicPage: {
      liffId,
      url: publicUrl,
      unavailableReason: publicUrl ? null : 'LINE公式アカウントにLIFF IDが設定されていません',
      description: settings.public_description,
      test: parseJson<Record<string, unknown> | null>(settings.public_page_test_json, null),
      form: form ? {
        id: form.id,
        name: form.name,
        active: Boolean(form.is_active),
        fields: formFieldLabels(form),
        completionActions: formCompletionActions(form),
      } : null,
    },
    publication: {
      status: row.status,
      draftVersion: settings.version,
      publishedVersion: settings.published_version,
      publishedAt: settings.published_at,
    },
    monitoring: {
      notificationFailures: Number(monitoring.notification_failures),
      duplicateRegistrations: Number(monitoring.duplicate_registrations),
      viewSegmentFailures: Number(monitoring.view_segment_failures),
      actionFailures: Number(monitoring.action_failures),
    },
  };
}

interface WebinarBody {
  accountId?: string | null;
  title?: string;
  slug?: string;
  status?: string;
  videoPrefix?: string | null;
  durationSeconds?: number;
  schedule?: unknown[];
  cta?: { label?: string; url?: string; showAtSeconds?: number } | null;
  tagOnAttend?: string | null;
  tagOnCtaClick?: string | null;
  folderId?: string | null;
  publicationStartsAt?: string | null;
  publicationEndsAt?: string | null;
  expectedVersion?: number;
  deliveryKind?: WebinarEditorSettingsInput['deliveryKind'];
  viewingCondition?: Record<string, unknown>;
  publicDescription?: string;
  registrationFormId?: string | null;
}

const WEBINAR_ACTION_TYPES = new Set<WebinarActionType>([
  'add_tag', 'remove_tag',
  'start_scenario', 'stop_scenario', 'resume_scenario',
  'send_message', 'send_webhook',
  'switch_rich_menu', 'remove_rich_menu',
]);

function requiredWebinarActionConfigKey(type: WebinarActionType): string | null {
  if (type === 'add_tag' || type === 'remove_tag') return 'tagId';
  if (type === 'start_scenario' || type === 'stop_scenario' || type === 'resume_scenario') {
    return 'scenarioId';
  }
  if (type === 'send_message') return 'templateId';
  if (type === 'send_webhook') return 'webhookId';
  if (type === 'switch_rich_menu') return 'richMenuPageId';
  return null;
}

function serializeWebinarAction(row: Awaited<ReturnType<typeof getWebinarActions>>[number]) {
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(row.config_json) as Record<string, unknown>; } catch { config = {}; }
  return {
    id: row.id,
    trigger: row.trigger,
    actionType: row.action_type,
    config,
    position: row.position,
    version: row.version,
  };
}

function parseWebinarActions(value: unknown): WebinarActionInput[] | null {
  if (!Array.isArray(value) || value.length > 30) return null;
  const parsed: WebinarActionInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    if (!['completed', 'cta_clicked', 'unviewed'].includes(String(row.trigger))) return null;
    if (!WEBINAR_ACTION_TYPES.has(row.actionType as WebinarActionType)) return null;
    if (!row.config || typeof row.config !== 'object' || Array.isArray(row.config)) return null;
    const actionType = row.actionType as WebinarActionType;
    const config = row.config as Record<string, unknown>;
    const requiredKey = requiredWebinarActionConfigKey(actionType);
    if (requiredKey && (typeof config[requiredKey] !== 'string' || !config[requiredKey].trim())) {
      return null;
    }
    parsed.push({
      trigger: row.trigger as WebinarActionInput['trigger'],
      actionType,
      config,
    });
  }
  return parsed;
}

// body → createWebinar/updateWebinar input。不正なら string (エラーコード) を返す
function validateWebinarBody(
  body: WebinarBody,
  { requireCore }: { requireCore: boolean },
): string | Record<string, unknown> {
  if (requireCore) {
    if (!body.title?.trim()) return 'title_required';
    if (!body.slug || !SLUG_RE.test(body.slug)) return 'invalid_slug';
  } else {
    if (body.title !== undefined && !body.title.trim()) return 'title_required';
    if (body.slug !== undefined && !SLUG_RE.test(body.slug)) return 'invalid_slug';
  }
  if (body.status !== undefined && !['draft', 'active', 'archived'].includes(body.status)) {
    return 'invalid_status';
  }
  if (body.durationSeconds !== undefined) {
    if (!Number.isFinite(body.durationSeconds) || body.durationSeconds < 0) {
      return 'invalid_duration';
    }
  }
  if (
    body.folderId !== undefined && body.folderId !== null &&
    (typeof body.folderId !== 'string' || !body.folderId.trim())
  ) {
    return 'invalid_folder';
  }
  for (const value of [body.publicationStartsAt, body.publicationEndsAt]) {
    if (
      value !== undefined && value !== null &&
      (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
    ) {
      return 'invalid_publication_period';
    }
  }
  if (
    body.publicationStartsAt && body.publicationEndsAt &&
    Date.parse(body.publicationStartsAt) > Date.parse(body.publicationEndsAt)
  ) {
    return 'invalid_publication_period';
  }
  let scheduleJson: string | undefined;
  if (body.schedule !== undefined) {
    if (!Array.isArray(body.schedule)) return 'invalid_schedule';
    const parsed = parseScheduleRules(JSON.stringify(body.schedule));
    if (parsed.length !== body.schedule.length) return 'invalid_schedule';
    scheduleJson = JSON.stringify(parsed);
  }
  let ctaJson: string | null | undefined;
  if (body.cta === null) {
    ctaJson = null;
  } else if (body.cta !== undefined) {
    const { label, url, showAtSeconds } = body.cta;
    if (
      !label?.trim() || !url?.trim() || !/^https?:\/\//.test(url) ||
      !Number.isFinite(showAtSeconds) || (showAtSeconds as number) < 0
    ) {
      return 'invalid_cta';
    }
    ctaJson = JSON.stringify({ label: label.trim(), url: url.trim(), showAtSeconds });
  }
  const input: Record<string, unknown> = {};
  if (body.accountId !== undefined) input.accountId = body.accountId;
  if (body.title !== undefined) input.title = body.title.trim();
  if (body.slug !== undefined) input.slug = body.slug;
  if (body.status !== undefined) input.status = body.status;
  if (body.videoPrefix !== undefined) {
    input.videoPrefix = body.videoPrefix?.replace(/^\/+|\/+$/g, '') || null;
  }
  if (body.durationSeconds !== undefined) {
    input.durationSeconds = Math.floor(body.durationSeconds);
  }
  if (scheduleJson !== undefined) input.scheduleJson = scheduleJson;
  if (ctaJson !== undefined) input.ctaJson = ctaJson;
  if (body.tagOnAttend !== undefined) input.tagOnAttend = body.tagOnAttend;
  if (body.tagOnCtaClick !== undefined) input.tagOnCtaClick = body.tagOnCtaClick;
  if (body.folderId !== undefined) input.folderId = body.folderId;
  if (body.publicationStartsAt !== undefined) {
    input.publicationStartsAt = body.publicationStartsAt;
  }
  if (body.publicationEndsAt !== undefined) input.publicationEndsAt = body.publicationEndsAt;
  return input;
}

webinarRoutes.get('/api/webinars', async (c) => {
  try {
    const { scope } = await adminAccountScope(c);
    const requestedAccountId = c.req.query('account_id');
    if (requestedAccountId && !scope.allowedAccountIds.includes(requestedAccountId)) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    /*
      共通一覧契約の offset 方式。以前は件数制限が無く全件転送だった。
      絞り(検索・フォルダ・状態・並び順)はサーバーで行い、頁を切る。
    */
    const paging = parseOffsetPaging({ page: c.req.query('page'), limit: c.req.query('limit') });
    const rawSort = c.req.query('sort');
    const sort = rawSort === 'created' || rawSort === 'name' ? rawSort : 'updated';
    const rawStatus = c.req.query('status');
    const status = rawStatus === 'active' || rawStatus === 'draft' ? rawStatus : undefined;
    const rawFolder = c.req.query('folder');
    const folderId = !rawFolder ? undefined : rawFolder === '__unfiled__' ? null : rawFolder;
    const q = (c.req.query('q') || '').trim() || undefined;
    const filters: WebinarListFilters = { q, folderId, status, sort };
    const listScope = {
      allowedAccountIds: scope.allowedAccountIds,
      canSeeUnassigned: scope.canSeeUnassigned,
      accountId: requestedAccountId || undefined,
    };
    const [items, total] = await Promise.all([
      getWebinarList(c.env.DB, listScope, { limit: paging.limit, offset: paging.offset }, filters),
      countWebinarList(c.env.DB, listScope, filters),
    ]);
    return c.json({
      success: true as const,
      data: buildOffsetListResponse({
        items: items.map(serializeWebinarList),
        total,
        paging,
        sort: webinarListSort(filters),
      }),
    });
  } catch (err) {
    console.error('GET /api/webinars error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.post('/api/webinars', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<WebinarBody>();
    if (!body.accountId) {
      return c.json({ success: false, error: 'account_id_required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    const input = validateWebinarBody(body, { requireCore: true });
    if (typeof input === 'string') return c.json({ success: false, error: input }, 400);
    if (body.folderId) {
      const folder = await getFolderById(c.env.DB, body.folderId);
      if (!folder || folder.kind !== 'webinar' || folder.account_id !== body.accountId) {
        return c.json({ success: false, error: 'invalid_folder' }, 400);
      }
    }
    const existing = await getWebinarBySlug(c.env.DB, body.slug!);
    if (existing) return c.json({ success: false, error: 'slug_taken' }, 409);
    const created = await createWebinar(
      c.env.DB, input as unknown as Parameters<typeof createWebinar>[1],
    );
    await saveWebinarEditorSettings(c.env.DB, created.id, 0, {
      deliveryKind: body.deliveryKind,
      viewingCondition: body.viewingCondition,
      publicDescription: body.publicDescription,
      registrationFormId: body.registrationFormId,
    });
    return c.json({ success: true, data: serializeWebinar(created) });
  } catch (err) {
    console.error('POST /api/webinars error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.get('/api/webinars/:id', async (c) => {
  try {
    const row = await getWebinarById(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeWebinar(row) });
  } catch (err) {
    console.error('GET /api/webinars/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.get('/api/webinars/:id/editor', async (c) => {
  try {
    const row = await getWebinarById(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: await getEditorPayload(c, row) });
  } catch (err) {
    console.error('GET /api/webinars/:id/editor error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.put('/api/webinars/:id/editor', requireRole('owner', 'admin'), async (c) => {
  try {
    const row = await getWebinarById(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<WebinarEditorSettingsInput & { expectedVersion?: unknown }>();
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
      return c.json({ success: false, error: 'expected_version_required' }, 400);
    }
    if (body.deliveryKind && !['on_demand', 'scheduled', 'external'].includes(body.deliveryKind)) {
      return c.json({ success: false, error: 'invalid_delivery_kind' }, 400);
    }
    if (
      body.missingResultPolicy &&
      !['escalate', 'retry_next_day'].includes(body.missingResultPolicy)
    ) {
      return c.json({ success: false, error: 'invalid_missing_result_policy' }, 400);
    }
    if (body.registrationFormId) {
      const form = await getFormById(c.env.DB, body.registrationFormId);
      if (!form || !form.is_active) {
        return c.json({ success: false, error: 'form_inactive_or_missing' }, 400);
      }
      if (!row.account_id || !await formBelongsToLineAccount(c.env.DB, form.id, row.account_id)) {
        return c.json({ success: false, error: 'form_account_mismatch' }, 400);
      }
    }
    const saved = await saveWebinarEditorSettings(
      c.env.DB,
      row.id,
      Number(body.expectedVersion),
      body,
    );
    if (!saved) return c.json({ success: false, error: 'version_conflict' }, 409);
    return c.json({ success: true, data: await getEditorPayload(c, row) });
  } catch (err) {
    console.error('PUT /api/webinars/:id/editor error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.post('/api/webinars/:id/public-page/test', requireRole('owner', 'admin'), async (c) => {
  try {
    const row = await getWebinarById(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ expectedVersion?: unknown }>();
    const editor = await getEditorPayload(c, row);
    if (!Number.isInteger(body.expectedVersion) || editor.version !== Number(body.expectedVersion)) {
      return c.json({ success: false, error: 'version_conflict' }, 409);
    }
    const failures = [
      !editor.publicPage.url ? 'missing_liff_id' : null,
      !row.video_prefix ? 'video_not_ready' : null,
      !editor.publicPage.form?.active ? 'form_inactive_or_missing' : null,
    ].filter((value): value is string => Boolean(value));
    const saved = await saveWebinarEditorSettings(c.env.DB, row.id, editor.version, {
      publicPageTest: {
        status: failures.length === 0 ? 'passed' : 'failed',
        failures,
        testedAt: new Date().toISOString(),
      },
    });
    if (!saved) return c.json({ success: false, error: 'version_conflict' }, 409);
    return c.json({ success: true, data: await getEditorPayload(c, row) });
  } catch (err) {
    console.error('POST /api/webinars/:id/public-page/test error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

async function buildPublishValidation(c: Context<Env>, row: Webinar) {
  const [editor, ctas, actions] = await Promise.all([
    getEditorPayload(c, row),
    getWebinarCtas(c.env.DB, row.id),
    getWebinarActions(c.env.DB, row.id),
  ]);
  const notificationTest = editor.notificationTest as { status?: unknown } | null;
  const publicPageTest = editor.publicPage.test as { status?: unknown } | null;
  const checks = [
    {
      key: 'video_ready',
      label: '動画・公開が設定されています',
      status: row.video_prefix ? 'passed' : 'failed',
      detail: row.video_prefix ? '動画を配信できます' : '動画がreadyではありません',
    },
    {
      key: 'form_active',
      label: '申込フォームが公開中です',
      status: editor.publicPage.form?.active ? 'passed' : 'failed',
      detail: editor.publicPage.form?.active ? editor.publicPage.form.name : '公開中の回答フォームを選んでください',
    },
    {
      key: 'cta_range',
      label: 'CTAの表示時刻とURLが有効です',
      status: ctas.length > 0 && ctas.every((cta) =>
        cta.at_seconds >= 0 && cta.at_seconds <= row.duration_seconds &&
        (cta.kind !== 'url' || Boolean(cta.url && /^https:\/\//.test(cta.url)))
      ) ? 'passed' : 'failed',
      detail: 'CTAは動画の長さ以内、外部URLはhttpsで検査します',
    },
    {
      key: 'notification_test',
      label: '通知のテスト送信が成功しています',
      status: notificationTest?.status === 'passed' ? 'passed' : 'failed',
      detail: notificationTest?.status === 'passed' ? '最後のテスト送信は成功です' : '通知をテスト送信してください',
    },
    {
      key: 'public_page_test',
      label: '公開ページを確認済みです',
      status: publicPageTest?.status === 'passed' && editor.publicPage.url ? 'passed' : 'failed',
      detail: editor.publicPage.url ? '公開ページの表示結果を確認します' : editor.publicPage.unavailableReason,
    },
    {
      key: 'notification_duplicates',
      label: '通知の重複がありません',
      status: editor.monitoring.duplicateRegistrations === 0 ? 'passed' : 'failed',
      detail: editor.monitoring.duplicateRegistrations === 0
        ? '同じ人・版・開催回・通知種別は1回です'
        : `${editor.monitoring.duplicateRegistrations}件の重複候補があります`,
    },
    {
      key: 'action_dependencies',
      label: '視聴後アクションの参照先が有効です',
      status: actions.length > 0 ? 'passed' : 'warning',
      detail: actions.length > 0 ? `${actions.length}件のアクションを確認しました` : '視聴後アクションは未設定です',
    },
  ];
  return {
    version: editor.version,
    checks,
    blockers: checks.filter((check) => check.status === 'failed').map((check) => check.key),
    warnings: checks.filter((check) => check.status === 'warning').map((check) => check.key),
  };
}

webinarRoutes.get('/api/webinars/:id/publish-validation', async (c) => {
  try {
    const row = await getWebinarById(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: await buildPublishValidation(c, row) });
  } catch (err) {
    console.error('GET /api/webinars/:id/publish-validation error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.post('/api/webinars/:id/publish', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ expectedVersion?: unknown }>();
    if (!Number.isInteger(body.expectedVersion)) {
      return c.json({ success: false, error: 'expected_version_required' }, 400);
    }
    const validation = await buildPublishValidation(c, row);
    if (validation.blockers.length > 0) {
      return c.json({ success: false, error: 'publish_validation_failed', data: validation }, 409);
    }
    const published = await publishWebinarEditorVersion(c.env.DB, id, Number(body.expectedVersion));
    if (!published) return c.json({ success: false, error: 'version_conflict' }, 409);
    const updated = await updateWebinar(c.env.DB, id, { status: 'active' });
    auditLog(c, 'webinar.publish', { kind: 'webinar', id });
    return c.json({ success: true, data: { webinar: serializeWebinar(updated!), validation } });
  } catch (err) {
    console.error('POST /api/webinars/:id/publish error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.post('/api/webinars/:id/pause', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ expectedVersion?: unknown }>();
    const settings = await getWebinarEditorSettings(c.env.DB, id);
    if (!Number.isInteger(body.expectedVersion) || settings?.version !== Number(body.expectedVersion)) {
      return c.json({ success: false, error: 'version_conflict' }, 409);
    }
    const updated = await updateWebinar(c.env.DB, id, { status: 'draft' });
    auditLog(c, 'webinar.pause', { kind: 'webinar', id });
    return c.json({ success: true, data: serializeWebinar(updated!) });
  } catch (err) {
    console.error('POST /api/webinars/:id/pause error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.post('/api/webinars/:id/duplicate', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ expectedVersion?: unknown }>();
    const settings = await getWebinarEditorSettings(c.env.DB, id);
    if (!settings || !Number.isInteger(body.expectedVersion) || settings.version !== Number(body.expectedVersion)) {
      return c.json({ success: false, error: 'version_conflict' }, 409);
    }
    const suffix = crypto.randomUUID().slice(0, 8);
    const duplicate = await createWebinar(c.env.DB, {
      accountId: row.account_id,
      title: `${row.title}（複製）`,
      slug: `${row.slug.slice(0, 54)}-${suffix}`,
      status: 'draft',
      videoPrefix: row.video_prefix,
      durationSeconds: row.duration_seconds,
      scheduleJson: row.schedule_json,
      ctaJson: row.cta_json,
      tagOnAttend: row.tag_on_attend,
      tagOnCtaClick: row.tag_on_cta_click,
      folderId: row.folder_id,
      publicationStartsAt: row.publication_starts_at,
      publicationEndsAt: row.publication_ends_at,
    });
    await saveWebinarEditorSettings(c.env.DB, duplicate.id, 0, {
      deliveryKind: settings.delivery_kind,
      viewingCondition: parseJson(settings.viewing_condition_json, {}),
      publicDescription: settings.public_description,
      registrationFormId: settings.registration_form_id,
      notificationMessages: parseJson(settings.notification_messages_json, {}),
      actionTemplateBody: settings.action_template_body,
      missingResultPolicy: settings.missing_result_policy,
    });
    auditLog(c, 'webinar.duplicate', { kind: 'webinar', id });
    return c.json({ success: true, data: serializeWebinar(duplicate) }, 201);
  } catch (err) {
    console.error('POST /api/webinars/:id/duplicate error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.get('/api/webinars/:id/notifications', async (c) => {
  try {
    const id = c.req.param('id') ?? '';
    const [settings, overview] = await Promise.all([
      getWebinarNotificationSettings(c.env.DB, id),
      getWebinarNotificationOverview(c.env.DB, id),
    ]);
    return c.json({ success: true, data: { settings, overview } });
  } catch (err) {
    console.error('GET /api/webinars/:id/notifications error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.put(
  '/api/webinars/:id/notifications',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const body = await c.req.json<Partial<WebinarNotificationSettingsInput>>();
      const required = [
        'registrationEnabled',
        'dayBeforeEnabled',
        'dayBeforeTime',
        'hourBeforeEnabled',
        'hourBeforeMinutes',
        'startEnabled',
        'missedEnabled',
        'missedTime',
        'completedEnabled',
      ] as const;
      if (required.some((key) => body[key] === undefined)) {
        return c.json({ success: false, error: 'invalid_settings' }, 400);
      }
      const booleans = [
        body.registrationEnabled,
        body.dayBeforeEnabled,
        body.hourBeforeEnabled,
        body.startEnabled,
        body.missedEnabled,
        body.completedEnabled,
      ];
      if (
        booleans.some((value) => typeof value !== 'boolean') ||
        typeof body.dayBeforeTime !== 'string' ||
        typeof body.missedTime !== 'string' ||
        typeof body.hourBeforeMinutes !== 'number'
      ) {
        return c.json({ success: false, error: 'invalid_settings' }, 400);
      }
      const result = await saveWebinarNotificationSettings(
        c.env.DB,
        c.req.param('id'),
        body as WebinarNotificationSettingsInput,
      );
      return c.json({ success: true, data: result });
    } catch (err) {
      const code = err instanceof Error ? err.message : 'invalid_settings';
      if (code === 'invalid_time' || code === 'invalid_hour_before') {
        return c.json({ success: false, error: code }, 400);
      }
      console.error('PUT /api/webinars/:id/notifications error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

webinarRoutes.post(
  '/api/webinars/:id/notifications/test',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const webinar = await getWebinarById(c.env.DB, c.req.param('id'));
      if (!webinar) return c.json({ success: false, error: 'Not found' }, 404);
      const nextSession = upcomingSessions(
        parseScheduleRules(webinar.schedule_json),
        webinar.duration_seconds,
        nowEpoch(),
        1,
      )[0];
      if (!nextSession) return c.json({ success: false, error: 'no_upcoming_session' }, 400);
      const liffMatch = /liff\.line\.me\/([^/?]+)/.exec(c.env.LIFF_URL ?? '');
      const result = await sendWebinarNotificationTest(
        c.env.DB,
        {
          id: webinar.id,
          accountId: webinar.account_id,
          title: webinar.title,
          slug: webinar.slug,
        },
        nextSession,
        {
          proxyBaseUrl: c.env.WORKER_PUBLIC_URL ?? 'https://your-worker.your-subdomain.workers.dev',
          defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
          defaultLiffId: liffMatch?.[1] ?? null,
          proxyDispatch: (request) => dispatchLineProxyLocally(request, c.env, c.executionCtx),
        },
      );
      const editor = await getWebinarEditorSettings(c.env.DB, webinar.id);
      if (editor) {
        await saveWebinarEditorSettings(c.env.DB, webinar.id, editor.version, {
          notificationTest: {
            status: result.failed === 0 ? 'passed' : 'failed',
            sent: result.sent,
            failed: result.failed,
            testedAt: new Date().toISOString(),
          },
        });
      }
      return c.json({ success: true, data: result });
    } catch (err) {
      const code = err instanceof Error ? err.message : 'test_send_failed';
      if ([
        'missing_line_account',
        'invalid_test_recipients',
        'no_test_recipients',
        'inactive_line_account',
        'missing_liff_id',
        'no_active_test_recipients',
      ].includes(code)) {
        return c.json({ success: false, error: code }, 400);
      }
      console.error('POST /api/webinars/:id/notifications/test error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

webinarRoutes.put('/api/webinars/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<WebinarBody>();
    if (body.accountId !== undefined && !await canAccessAllLineAccounts(
      c.env.DB, c.get('staff'), [body.accountId],
    )) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    const input = validateWebinarBody(body, { requireCore: false });
    if (typeof input === 'string') return c.json({ success: false, error: input }, 400);
    if (body.folderId) {
      const folder = await getFolderById(c.env.DB, body.folderId);
      const targetAccountId = body.accountId ?? row.account_id;
      if (!folder || folder.kind !== 'webinar' || folder.account_id !== targetAccountId) {
        return c.json({ success: false, error: 'invalid_folder' }, 400);
      }
    }
    if (body.slug && body.slug !== row.slug) {
      const dupe = await getWebinarBySlug(c.env.DB, body.slug);
      if (dupe) return c.json({ success: false, error: 'slug_taken' }, 409);
    }
    const updated = await updateWebinar(c.env.DB, id, input as Parameters<typeof updateWebinar>[2]);
    return c.json({ success: true, data: serializeWebinar(updated!) });
  } catch (err) {
    console.error('PUT /api/webinars/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.get('/api/webinars/:id/actions', async (c) => {
  try {
    const actions = await getWebinarActions(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: actions.map(serializeWebinarAction) });
  } catch (err) {
    console.error('GET /api/webinars/:id/actions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.put('/api/webinars/:id/actions', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ actions?: unknown }>();
    const actions = parseWebinarActions(body.actions);
    if (!actions) return c.json({ success: false, error: 'invalid_actions' }, 400);
    const saved = await replaceWebinarActions(c.env.DB, c.req.param('id'), actions);
    return c.json({ success: true, data: saved.map(serializeWebinarAction) });
  } catch (err) {
    console.error('PUT /api/webinars/:id/actions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

async function archiveVisibleWebinar(c: Context<Env>) {
  try {
    const id = c.req.param('id') ?? '';
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    if (row.status === 'active') {
      return c.json({ success: false, error: 'webinar_pause_required' }, 409);
    }
    const archived = await archiveWebinar(c.env.DB, id);
    auditLog(c, 'webinar.archive', { kind: 'webinar', id });
    return c.json({ success: true, data: serializeWebinar(archived!) });
  } catch (err) {
    console.error('Archive /api/webinars/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
}

webinarRoutes.post('/api/webinars/:id/archive', requireRole('owner', 'admin'), archiveVisibleWebinar);
// 旧クライアント互換。物理削除はせず、同じアーカイブ処理を行う。
webinarRoutes.delete('/api/webinars/:id', requireRole('owner', 'admin'), archiveVisibleWebinar);

webinarRoutes.get('/api/webinars/:id/comments', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const comments = await getWebinarComments(c.env.DB, id);
    return c.json({
      success: true,
      data: comments.map((cm) => ({
        id: cm.id, atSeconds: cm.at_seconds, authorName: cm.author_name, body: cm.body,
      })),
    });
  } catch (err) {
    console.error('GET /api/webinars/:id/comments error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.put('/api/webinars/:id/comments', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ comments?: unknown }>();
    if (!Array.isArray(body.comments)) {
      return c.json({ success: false, error: 'comments_required' }, 400);
    }
    if (body.comments.length > SAKURA_COMMENTS_MAX) {
      return c.json({ success: false, error: 'too_many_comments' }, 400);
    }
    const cleaned: Array<{ atSeconds: number; authorName: string; body: string }> = [];
    for (const raw of body.comments as Array<Record<string, unknown>>) {
      const atSeconds = Math.floor(Number(raw?.atSeconds));
      const authorName = typeof raw?.authorName === 'string' ? raw.authorName.trim() : '';
      const text = typeof raw?.body === 'string' ? raw.body.trim() : '';
      // 負の atSeconds = 開始前 (待機ルーム) コメント。-1h まで許容
      if (
        !Number.isFinite(atSeconds) || atSeconds < COMMENT_MIN_AT_SECONDS ||
        !authorName || authorName.length > 50 ||
        !text || text.length > COMMENT_MAX
      ) {
        return c.json({ success: false, error: 'invalid_comment' }, 400);
      }
      cleaned.push({ atSeconds, authorName, body: text });
    }
    const count = await replaceWebinarComments(c.env.DB, id, cleaned);
    return c.json({ success: true, data: { count } });
  } catch (err) {
    console.error('PUT /api/webinars/:id/comments error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.get('/api/webinars/:id/ctas', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const ctas = await getWebinarCtas(c.env.DB, id);
    return c.json({
      success: true,
      data: ctas.map((ct) => ({
        id: ct.id,
        atSeconds: ct.at_seconds,
        kind: ct.kind,
        title: ct.title,
        body: ct.body,
        buttonLabel: ct.button_label,
        autoOpen: Boolean(ct.auto_open),
        formId: ct.form_id,
        url: ct.url,
      })),
    });
  } catch (err) {
    console.error('GET /api/webinars/:id/ctas error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// CTA カード一括置換。kind='form' は forms 実在チェック、kind='url' は https? 必須。
// 全要素検証 → 不正が1件でもあれば何も書かない (comments と同じ all-or-nothing)。
webinarRoutes.put('/api/webinars/:id/ctas', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ ctas?: unknown }>();
    if (!Array.isArray(body.ctas)) {
      return c.json({ success: false, error: 'ctas_required' }, 400);
    }
    if (body.ctas.length > 20) {
      return c.json({ success: false, error: 'too_many_ctas' }, 400);
    }
    const cleaned: Array<{
      atSeconds: number; kind: 'form' | 'url'; title: string; body: string | null;
      buttonLabel: string; autoOpen: boolean; formId: string | null; url: string | null;
    }> = [];
    const formIdsToCheck = new Set<string>();
    for (const raw of body.ctas as Array<Record<string, unknown>>) {
      const atSeconds = Math.floor(Number(raw?.atSeconds));
      const kind = raw?.kind;
      const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
      const bodyText = typeof raw?.body === 'string' ? raw.body.trim() : '';
      const buttonLabel = typeof raw?.buttonLabel === 'string' ? raw.buttonLabel.trim() : '';
      const formId = typeof raw?.formId === 'string' && raw.formId ? raw.formId : null;
      const url = typeof raw?.url === 'string' && raw.url ? raw.url.trim() : null;
      if (
        !Number.isFinite(atSeconds) || atSeconds < 0 ||
        (kind !== 'form' && kind !== 'url') ||
        !title || title.length > 100 ||
        bodyText.length > 300 ||
        !buttonLabel || buttonLabel.length > 50
      ) {
        return c.json({ success: false, error: 'invalid_cta' }, 400);
      }
      if (kind === 'form') {
        if (!formId) return c.json({ success: false, error: 'form_id_required' }, 400);
        formIdsToCheck.add(formId);
      } else if (!url || !/^https:\/\//.test(url)) {
        return c.json({ success: false, error: 'invalid_url' }, 400);
      }
      cleaned.push({
        atSeconds, kind, title, body: bodyText || null, buttonLabel,
        autoOpen: Boolean(raw?.autoOpen),
        formId: kind === 'form' ? formId : null,
        url: kind === 'url' ? url : null,
      });
    }
    const forms = await Promise.all(
      [...formIdsToCheck].map((fid) => getFormById(c.env.DB, fid)),
    );
    if (forms.some((f) => !f)) {
      return c.json({ success: false, error: 'form_not_found' }, 400);
    }
    if (forms.some((f) => f && !f.is_active)) {
      return c.json({ success: false, error: 'form_inactive' }, 400);
    }
    if (
      formIdsToCheck.size > 0 &&
      (!row.account_id || !(await Promise.all(
        [...formIdsToCheck].map((formId) =>
          formBelongsToLineAccount(c.env.DB, formId, row.account_id!),
        ),
      )).every(Boolean))
    ) {
      return c.json({ success: false, error: 'form_account_mismatch' }, 400);
    }
    const count = await replaceWebinarCtas(c.env.DB, id, cleaned);
    return c.json({ success: true, data: { count } });
  } catch (err) {
    console.error('PUT /api/webinars/:id/ctas error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.get('/api/webinars/:id/analytics', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const completionThreshold = Math.max(1, Math.floor(row.duration_seconds * 0.9));
    const [sessions, dropoff, participants, summary, daily, formFunnel, viewSegments, editor] = await Promise.all([
      getWebinarSessionStats(c.env.DB, id),
      getWebinarDropoff(c.env.DB, id),
      getWebinarParticipantStats(c.env.DB, id, 200),
      getWebinarAnalyticsSummary(c.env.DB, id, completionThreshold),
      getWebinarDailyStats(c.env.DB, id),
      getWebinarFormFunnelStats(c.env.DB, id),
      getWebinarViewSegmentCoverage(c.env.DB, id),
      getWebinarEditorSettings(c.env.DB, id),
    ]);
    return c.json({
      success: true,
      data: {
        summary: {
          reservations: summary.reservations,
          viewers: summary.viewers,
          registeredAndJoined: summary.registered_and_joined,
          watched5m: summary.watched_5m,
          watched15m: summary.watched_15m,
          completed: summary.completed,
          avgWatchedSeconds: summary.avg_watched_seconds,
          ctaClicks: summary.cta_clicks,
          formSubmissions: summary.form_submissions,
        },
        daily: daily.map((d) => ({
          date: d.stat_date,
          reservations: d.reservations,
          viewers: d.viewers,
          ctaClicks: d.cta_clicks,
          formSubmissions: d.form_submissions,
        })),
        participants: participants.map((p) => ({
          friendId: p.friend_id,
          friendName: p.friend_name,
          pictureUrl: p.picture_url,
          sessions: p.sessions,
          firstJoinedAt: p.first_joined_at,
          latestJoinedAt: p.latest_joined_at,
          maxWatchedSeconds: p.max_watched_seconds,
          ctaClickedAt: p.cta_clicked_at,
          registered: Boolean(p.registered),
          formSubmittedAt: p.form_submitted_at,
        })),
        sessions: sessions.map((s) => ({
          sessionStartAt: s.session_start_at,
          viewers: s.viewers,
          avgWatchedSeconds: s.avg_watched_seconds,
          ctaClicks: s.cta_clicks,
        })),
        dropoff: dropoff.map((d) => ({ bucketStart: d.bucket_start, viewers: d.viewers })),
        viewSegments: viewSegments.map((segment) => ({
          startSeconds: segment.start_seconds,
          endSeconds: segment.end_seconds,
          viewers: Number(segment.viewers),
        })),
        measurement: editor?.delivery_kind === 'external'
          ? { state: 'unavailable', reason: '外部動画では個人の視聴区間を取得できません' }
          : viewSegments.length > 0
            ? { state: 'available', reason: null }
            : { state: 'unavailable', reason: '実視聴区間がまだ記録されていません' },
        formFunnel: {
          ctaImpressions: formFunnel.cta_impressions,
          ctaClicks: formFunnel.cta_clicks,
          formOpens: formFunnel.form_opens,
          formStarts: formFunnel.form_starts,
          submitAttempts: formFunnel.submit_attempts,
          submitSuccesses: formFunnel.submit_successes,
          submitErrors: formFunnel.submit_errors,
          fieldCompletions: formFunnel.field_completions.map((field) => ({
            fieldName: field.field_name,
            users: field.users,
          })),
        },
      },
    });
  } catch (err) {
    console.error('GET /api/webinars/:id/analytics error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.get('/api/webinars/:id/participants', async (c) => {
  try {
    const id = c.req.param('id');
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
    const offset = Math.max(0, Number(c.req.query('cursor') ?? 0) || 0);
    const rows = await getWebinarParticipantOperations(c.env.DB, id, limit + 1, offset);
    const hasNext = rows.length > limit;
    return c.json({
      success: true,
      data: {
        items: rows.slice(0, limit).map((row) => ({
          friendId: row.friend_id,
          friendName: row.friend_name,
          pictureUrl: row.picture_url,
          sessions: Number(row.sessions),
          firstJoinedAt: row.first_joined_at || null,
          latestJoinedAt: row.latest_joined_at || null,
          maxWatchedSeconds: Number(row.max_watched_seconds),
          ctaClickedAt: row.cta_clicked_at,
          registered: Boolean(row.registered),
          formSubmittedAt: row.form_submitted_at,
          actionStatus: row.action_status,
          errorDetail: row.action_error,
          staffIntegrationStatus: row.integration_status,
        })),
        nextCursor: hasNext ? String(offset + limit) : null,
      },
    });
  } catch (err) {
    console.error('GET /api/webinars/:id/participants error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  // 表計算ソフトで式として実行されないようにする。
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

webinarRoutes.get(
  '/api/webinars/:id/participants.csv',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const id = c.req.param('id');
      const participants = await getWebinarParticipantStats(c.env.DB, id, 10_000);
      const rows = participants.map((participant) => [
        participant.friend_name ?? '',
        participant.first_joined_at,
        participant.latest_joined_at,
        participant.max_watched_seconds,
        participant.registered ? '申込あり' : '申込なし',
        participant.cta_clicked_at ? 'クリック済み' : '未クリック',
        participant.form_submitted_at ? '送信済み' : '未送信',
      ].map(csvCell).join(','));
      const csv = [
        ['参加者', '初回視聴', '最終視聴', '最大視聴秒数', '申込', 'CTA', 'フォーム'].map(csvCell).join(','),
        ...rows,
      ].join('\r\n');
      auditLog(c, 'webinar.participant.export', { kind: 'webinar', id });
      return new Response(`\uFEFF${csv}`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="webinar-${id}-participants.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      console.error('GET /api/webinars/:id/participants.csv error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

webinarRoutes.get('/api/webinars/:id/user-comments', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const items = await getWebinarUserComments(c.env.DB, id);
    return c.json({
      success: true,
      data: items.map((cm) => ({
        id: cm.id,
        friendId: cm.friend_id,
        friendName: cm.friend_name ?? null,
        pictureUrl: cm.picture_url ?? null,
        sessionStartAt: cm.session_start_at,
        atSeconds: cm.at_seconds,
        body: cm.body,
        createdAt: cm.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/webinars/:id/user-comments error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { webinarRoutes };
