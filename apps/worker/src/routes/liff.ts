import { inputJsonBoundary } from '../lib/input-errors.js';

import { Hono } from 'hono';

import type { Env } from '../worker-env.js';

import { requireRole } from '../middleware/role-guard.js';

import { get__auth_line_1, get__auth_oauth_2 } from './liff-oauth-start-handlers.js';

import { get__auth_callback_1, get__api_liff_customer_look_2, get__api_liff_config_3, post__api_liff_profile_4, post__api_liff_entry_route_coupon_5 } from './liff-oauth-config-handlers.js';

import { post__api_liff_entry_route_coupon_use_1, post__api_liff_friend_add_intent_2, post__api_liff_link_3, get__api_analytics_ref_summary_4, get__api_analytics_ref_refCode_5 } from './liff-account-link-handlers.js';

import { get__api_analytics_ref_refCode_orders_1, post__api_links_wrap_2, post__api_liff_send_form_link_3 } from './liff-form-links-handlers.js';

const liffRoutes = new Hono<Env>();

// ─── LINE Login OAuth (bot_prompt=aggressive) ───────────────────

/** 友だち追加の公開 URL。ref・完了後の移動先・広告クリック ID・UTM をログイン後へ引き継ぐ。 */
liffRoutes.get('/auth/line', get__auth_line_1);

/** Universal Link が開けない場合にも、その場で友だち追加を完了できるよう、端末によらず OAuth へ302で進む。/auth/line と同じ入力を使う。 */
liffRoutes.get('/auth/oauth', get__auth_oauth_2);


liffRoutes.get('/auth/callback', get__auth_callback_1);

// ─── LIFF config endpoint ──────────────────────────────────────

// 見た目だけの公開口。予約機能の有無に依存せず、LIFF IDで店を固定する。
liffRoutes.get('/api/liff/customer-look',get__api_liff_customer_look_2);

// LIFF ID から公開に必要なアカウント情報だけを解決する。
liffRoutes.get('/api/liff/config', get__api_liff_config_3);

// ─── Existing LIFF endpoints ────────────────────────────────────

// プロフィールは認証済み LIFF 本人の分だけを返す。
liffRoutes.post('/api/liff/profile', inputJsonBoundary(), post__api_liff_profile_4);

// クーポン画面用。本人以外・別アカウント・未フォローには渡さない。
liffRoutes.post('/api/liff/entry-route-coupon', post__api_liff_entry_route_coupon_5);

// 本人確認したクーポン画面からの使用。requestIdで通信の再試行も同じ結果にする。
liffRoutes.post('/api/liff/entry-route-coupon/use', post__api_liff_entry_route_coupon_use_1);

// POST /api/liff/friend-add-intent - 「今回開いたリンク」を追加イベント候補として記録
liffRoutes.post('/api/liff/friend-add-intent', inputJsonBoundary({"ref":["string"],"source":["string"]}), post__api_liff_friend_add_intent_2);

// 公開の結び付けも LINE ID トークンで本人を検証する。
liffRoutes.post('/api/liff/link', inputJsonBoundary({"idToken":["string"],"displayName":["null","string"],"ref":["string"],"existingUuid":["string"],"crossAccountToken":["string"],"ig":["string"],"iga":["string"],"igan":["string"]}), post__api_liff_link_3);

// ─── Attribution Analytics ──────────────────────────────────────

/**
 * GET /api/analytics/ref-summary — ref code analytics summary
 */
liffRoutes.get('/api/analytics/ref-summary', requireRole('owner', 'admin', 'staff'), get__api_analytics_ref_summary_4);


liffRoutes.get('/api/analytics/ref/:refCode', requireRole('owner', 'admin', 'staff'), get__api_analytics_ref_refCode_5);

/**
 * GET /api/analytics/ref/:refCode/orders — その経路から来た友だちの注文明細
 *
 * 経路別集計(ref-summary の orderCount)と同じ条件の明細を返し、
 * 画面上で集計と注文をつき合わせられるようにする。
 *
 * 帰属ルールは first-touch: friends.ref_code がこの経路の友だちに結びついた
 * ec_orders だけ。同じ注文は (line_account_id, source_key, external_order_id)
 * の一意制約で取り込み時に1行へ潰れているので、再取込で二重に出ない。
 * 友だちに結びついていない注文(未連携)や経路が分からない注文は
 * ここには出ず、ref-summary の orders.total/attributed で未計測として数える。
 */
liffRoutes.get('/api/analytics/ref/:refCode/orders', requireRole('owner', 'admin', 'staff'), get__api_analytics_ref_refCode_orders_1);


liffRoutes.post('/api/links/wrap', requireRole('owner', 'admin'), inputJsonBoundary({"url":["string"],"ref":["string"]}), post__api_links_wrap_2);

// フォーム URL を本人へ送る前に idToken を検証し、任意の lineUserId への送信を防ぐ。
liffRoutes.post('/api/liff/send-form-link', inputJsonBoundary({"lineUserId":["string"],"formId":["string"],"idToken":["string"],"ref":["string"],"gate":["string"],"xh":["string"],"ig":["string"],"iga":["string"],"igan":["string"]}), post__api_liff_send_form_link_3);

export { liffRoutes };
