#!/usr/bin/env tsx
/**
 * 検証環境（staging）のデリバリー受注を、ログイン済みの状態で「読むだけ」確認する。
 *
 * 公開APIも管理画面も認証を要求するため、未認証では3画面とも `/login` へ移り、
 * 承認版v02（板 `kDQHr`・`OzHLO`・`h7OeT`）が実際に描けているかを合格にできない。
 * ここで確かめるのは次の2つ。
 *  1. 読み口4つ（注文一覧・注文の詳細・注文履歴・品切れ一括の品目）が、本物と同じ
 *     平らな形（`data` で包まない）で主要項目をそろえて返ること
 *  2. 注文一覧・注文履歴・品切れ一括の3画面が実ブラウザで `/login` へ移らず、
 *     題を 22px/700/32px で出し「画面を表示できませんでした」にならないこと
 *
 * 認証は 15 分で切れる一時的な管理セッションを staging D1 に 1 行だけ作って渡す。
 * 担当者は作らずに探す。最後に必ずその 1 行を消して残り 0 件を確かめる。
 * 本番の Worker・D1 は `readVerificationTarget` が拒否し、管理画面の宛先は
 * `readAdminTarget` が検証環境の2つのホストだけに限る。書き込みの口は呼ばない。
 * ブラウザからの GET 以外の通信は全部断ち、断った件数を根拠として残す。
 *
 * セッションの合言葉は URL（fragment）へ載せず、`sessionStorage` の
 * `lh_admin_session_fallback` へ直接置く。`getAdminSessionToken` がそこを読むので、
 * `AuthGuard` の `/api/auth/session` と画面側の取得の両方に同じ合言葉が乗る。
 * 合言葉・識別子はログ・サマリーへ出さない。
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createD1Query, readVerificationTarget } from './verify-staging-operational-path.js';

const CONFIG_PATH = 'apps/worker/wrangler.staging.toml';
const SESSION_TTL_MINUTES = 15;
const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';

/**
 * 読み取り専用の口だけを許す。ここに無い道は呼べない。
 *
 * 道の頭だけで許すと、注文の詳細 `/orders/<id>` のつもりで
 * 操作の口 `/orders/<id>/accept`・`/orders/<id>/cancel` まで通ってしまう。
 * だから端まで縛り、識別子の後ろに `/` が続く道は入口で落とす。
 */
const READ_ONLY_PATTERNS = [
  /^\/api\/restaurant-test\/delivery\/orders\?[^/]*$/,
  /^\/api\/restaurant-test\/delivery\/orders\/[A-Za-z0-9_\-.~%]+\?[^/]*$/,
  /^\/api\/restaurant-test\/delivery\/history\?[^/]*$/,
  /^\/api\/restaurant-test\/delivery\/menu-items\?[^/]*$/,
] as const;

/** 検証環境の管理画面だけを許す。本番の管理画面は開かない。 */
const ADMIN_HOSTS = ['stg-admin.musubo.jp', 'nen-line-stg-admin.pages.dev'] as const;

/** 画面が実際に回している項目。1つでも欠けたら不合格にする。 */
const ORDERS_FIELDS = [
  'store.id', 'store.name', 'services', 'kpis.todayCount', 'tab', 'tabCounts', 'orders',
] as const;
const ORDER_DETAIL_FIELDS = [
  'order.id', 'order.service', 'order.serviceLabel', 'order.status', 'order.statusLabel', 'items',
] as const;
const HISTORY_FIELDS = [
  'range.from', 'range.to', 'totals.count', 'totals.amount', 'totals.byService', 'orders',
] as const;
const MENU_ITEM_FIELDS = ['store.id', 'items'] as const;

/** 承認版v02の3画面。題は `delivery.tsx` の `PAGE_META` と同じ。 */
const SCREENS = [
  { view: 'orders', search: '', title: 'デリバリー受注' },
  { view: 'history', search: '?view=history', title: '注文履歴・売上' },
  { view: 'sold-out', search: '?view=sold-out', title: '品切れ一括設定' },
] as const;

const SCREEN_PATH = '/restaurant-test/delivery';
const CRASH_TITLE = '画面を表示できませんでした';

type VerificationTarget = ReturnType<typeof readVerificationTarget>;
type QueryD1 = ReturnType<typeof createD1Query>;

type AdminTarget = { adminUrl: string };

export type DeliveryGates = {
  restaurantTestEnabled: boolean;
  activeAdmins: number;
  activeLineAccounts: number;
  tenantsWithRestaurantPack: number;
  storesLinkedToLineAccount: number;
};

export type ScreenReport = {
  view: string;
  title: string | null;
  titlePasses: boolean;
  landedOnLogin: boolean;
  crashed: boolean;
  /** 画面の中に出た「表示できませんでした」の1枚。題が正しくても取得に失敗していれば入る。 */
  loadFailures: string[];
  pageErrors: number;
  blockedWriteRequests: number;
};

/**
 * 1画面の不合格の理由を並べる。空なら合格。
 *
 * **題が出ているだけでは合格にしない。** 読み口を Node から呼べていても、
 * 画面からの取得が CORS や合言葉で落ちると、題はそのままで中身だけが
 * 「注文を表示できませんでした」に変わる（`delivery.tsx` / `history.tsx` /
 * `bulk.tsx` の `ListState kind="error"`）。未捕捉の例外も同じく不合格にする。
 */
export function screenFailures(report: ScreenReport): string[] {
  const reasons: string[] = [];
  if (report.landedOnLogin) reasons.push('login');
  if (report.crashed) reasons.push('crash');
  if (!report.titlePasses) reasons.push('title');
  for (const failure of report.loadFailures) reasons.push(`load-failure(${failure})`);
  if (report.pageErrors !== 0) reasons.push(`page-error(${report.pageErrors})`);
  return reasons;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/** 管理画面の宛先は設定から読む。検証環境の2ホスト以外は拒否する。 */
export function readAdminTarget(config: string): AdminTarget {
  const match = /^\s*ADMIN_PUBLIC_URL\s*=\s*"([^"]+)"/m.exec(config);
  if (!match) throw new Error('ADMIN_PUBLIC_URL is missing from the staging configuration');
  let url: URL;
  try {
    url = new URL(match[1]);
  } catch {
    throw new Error('Unexpected staging admin URL');
  }
  if (url.protocol !== 'https:') throw new Error('Unexpected staging admin URL');
  if (!ADMIN_HOSTS.includes(url.hostname as (typeof ADMIN_HOSTS)[number])) {
    throw new Error('Only the staging admin site is allowed');
  }
  return { adminUrl: url.origin };
}

/** 飲食店の試験スイッチ。false だと読み口が 404 になるので先に見る。 */
export function readRestaurantTestFlag(config: string): boolean {
  return /^\s*RESTAURANT_TEST_ENABLED\s*=\s*"true"/m.test(config);
}

/** 点で区切った道をたどって、欠けている項目だけを並べる。 */
export function missingFields(value: unknown, paths: readonly string[]): string[] {
  const missing: string[] = [];
  for (const path of paths) {
    let cursor: unknown = value;
    let found = true;
    for (const key of path.split('.')) {
      if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)
        || !(key in (cursor as Record<string, unknown>))) {
        found = false;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[key];
    }
    if (!found || cursor === undefined || cursor === null) missing.push(path);
  }
  return missing.sort();
}

/**
 * 本物と同じ形かを見る。既定の器は `data` で包むので、包まれていないことが証。
 * 包まれていると画面は例外を捕まえられず「画面を表示できませんでした」になる。
 */
export function inspectFlatBody(
  body: Record<string, unknown>,
  fields: readonly string[],
): { wrapped: boolean; success: boolean; missing: string[] } {
  return {
    wrapped: 'data' in body,
    success: body.success === true,
    missing: missingFields(body, fields),
  };
}

/** 足りない入口が分かるように、次の手を1つだけ返す。 */
export function nextStepFor(gates: DeliveryGates): string {
  if (!gates.restaurantTestEnabled) {
    return 'apps/worker/wrangler.staging.toml の RESTAURANT_TEST_ENABLED を "true" にして検証環境へ配備する';
  }
  if (gates.activeAdmins === 0) return '検証環境に有効な owner/admin の担当者を1人用意する';
  if (gates.activeLineAccounts === 0) return '検証環境に有効なLINE公式アカウントを1つ用意する';
  if (gates.tenantsWithRestaurantPack === 0) {
    return '担当者のテナントの feature_packs に "restaurant" を追加する';
  }
  if (gates.storesLinkedToLineAccount === 0) {
    return '店舗管理で、同じテナントのLINE公式アカウントに店舗（rt_stores.line_account_id）を紐付ける';
  }
  return '担当者の可視範囲（account_scope / staff_account_scopes）に、店舗が紐付いたLINEアカウントを含める';
}

/**
 * 読み取り専用の口を 1 回呼ぶ。許可した道以外、GET 以外は投げる。
 * 応答本文は呼び出し側で形を確かめるため、そのまま返す。
 */
export async function readOnlyRequest(
  target: VerificationTarget,
  sessionToken: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!READ_ONLY_PATTERNS.some((pattern) => pattern.test(path))) {
    throw new Error('The staging check may only call the read-only delivery endpoints');
  }
  const response = await fetchImpl(`${target.workerUrl}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer lh_session:${sessionToken}`, 'Content-Type': 'application/json' },
  });
  let body: Record<string, unknown> = {};
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

/** 読み口を1つ確かめる。形が崩れていればその場で投げる。 */
async function readEndpoint(
  target: VerificationTarget,
  sessionToken: string,
  label: string,
  path: string,
  fields: readonly string[],
): Promise<Record<string, unknown>> {
  const { status, body } = await readOnlyRequest(target, sessionToken, path);
  const shape = inspectFlatBody(body, fields);
  if (status !== 200 || !shape.success || shape.wrapped || shape.missing.length !== 0) {
    throw new Error(
      `Unexpected staging delivery response for ${label}`
      + ` (status=${status}, wrapped=${shape.wrapped}, missing=${shape.missing.join(',') || 'none'})`,
    );
  }
  return body;
}

async function countRows(query: QueryD1, sql: string, params: unknown[] = []): Promise<number> {
  const rows = await query<{ count: number }>(sql, params);
  return Number(rows[0]?.count ?? 0);
}

async function readGates(query: QueryD1, restaurantTestEnabled: boolean): Promise<DeliveryGates> {
  return {
    restaurantTestEnabled,
    activeAdmins: await countRows(
      query,
      "SELECT COUNT(*) AS count FROM staff_members WHERE is_active = 1 AND role IN ('owner', 'admin')",
    ),
    activeLineAccounts: await countRows(
      query,
      'SELECT COUNT(*) AS count FROM line_accounts WHERE is_active = 1',
    ),
    tenantsWithRestaurantPack: await countRows(
      query,
      `SELECT COUNT(*) AS count FROM tenants WHERE feature_packs LIKE '%"restaurant"%'`,
    ),
    storesLinkedToLineAccount: await countRows(
      query,
      `SELECT COUNT(*) AS count
         FROM rt_stores s
         JOIN rt_organizations o ON o.id = s.organization_id
        WHERE s.line_account_id IS NOT NULL AND o.tenant_id IS NOT NULL`,
    ),
  };
}

async function countSessionLeftovers(query: QueryD1, sessionHash: string): Promise<number> {
  return countRows(query, 'SELECT COUNT(*) AS count FROM admin_sessions WHERE token_hash = ?', [sessionHash]);
}

/**
 * 題を読む。型の題を優先し、札・窓・引き出し・外側の帯の見出しは数えない
 * （`scripts/visual-qa/title-audit.mjs` と同じ選び方。横の案内の文字を拾わない）。
 */
/**
 * 画面の中で「読み込めなかった」を出していないか見る。
 *
 * 失敗の1枚は共通部品に寄せてあり（`components/shared/list-state.tsx`）、
 * `kind="error"` / `kind="forbidden"` のとき必ず `data-list-state` が付く。
 * 3画面とも同じ部品で出すので、ここを見れば取得の失敗を取りこぼさない。
 */
function readFailureStatesInPage(): string[] {
  const visible = (el: Element) => el.getBoundingClientRect().height > 1
    && getComputedStyle(el).visibility !== 'hidden';
  return Array.from(
    document.querySelectorAll('[data-list-state="error"], [data-list-state="forbidden"]'),
  )
    .filter(visible)
    .map((el) => {
      const kind = el.getAttribute('data-list-state') || 'error';
      // 見出しだけを残す。説明文に識別子が入ることがあるので長さも切る。
      const text = (el.querySelector('h1, h2, h3, p')?.textContent || '')
        .trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${kind}:${text}`;
    });
}

function readTitleInPage(): { text: string; size: string; weight: string; lh: string } | null {
  const visible = (el: Element) => el.getBoundingClientRect().height > 1
    && getComputedStyle(el).visibility !== 'hidden';
  const root = document.querySelector('main') || document.body;
  const title = Array.from(root.querySelectorAll('[data-template-region="heading"] h1, [data-template-region="heading"] h2'))
    .find(visible)
    || Array.from(root.querySelectorAll('h1, h2'))
      .find((el) => visible(el) && !el.closest('[role="dialog"], aside, [data-template-region="folders"]'));
  if (!title) return null;
  const css = getComputedStyle(title);
  return {
    text: (title.textContent || '').trim().replace(/\s+/g, ' '),
    size: css.fontSize,
    weight: css.fontWeight,
    lh: css.lineHeight,
  };
}

/**
 * 3画面を実ブラウザで開く。ログイン済みの状態は `sessionStorage` の合言葉で作る。
 * GET 以外の通信は断つので、画面から書き込みは起こらない。
 */
async function inspectScreens(
  admin: AdminTarget,
  sessionToken: string,
  lineAccountId: string,
): Promise<ScreenReport[]> {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const reports: ScreenReport[] = [];
  try {
    for (const screen of SCREENS) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
      });
      const pageErrors: string[] = [];
      let blockedWriteRequests = 0;
      page.on('pageerror', (error) => pageErrors.push(error.message));
      // 読むだけにする。GET 以外は全部断ち、断った件数を根拠に残す。
      await page.route('**/*', async (route) => {
        if (route.request().method() === 'GET') return route.continue();
        blockedWriteRequests += 1;
        return route.abort();
      });
      await page.addInitScript(
        ([token, accountId]) => {
          // 合言葉は `getAdminSessionToken` が読む場所へ直接置く。URLへは載せない。
          try { sessionStorage.setItem('lh_admin_session_fallback', token) } catch { /* 画面側で再取得される */ }
          // 未選択のとき先頭へフォールバックしないので、見る店舗を明示する。
          try {
            localStorage.setItem('lh_selected_account', accountId);
            localStorage.setItem('lh-admin-theme', 'v8');
          } catch { /* 既定のまま進む */ }
        },
        [sessionToken, lineAccountId] as [string, string],
      );
      try {
        await page.goto(`${admin.adminUrl}${SCREEN_PATH}${screen.search}`, { waitUntil: 'load' });
        await page.waitForTimeout(4000);
        await page.evaluate(() => document.fonts.ready.then(() => true));
        const title = await page.evaluate(readTitleInPage);
        const loadFailures = await page.evaluate(readFailureStatesInPage);
        const landedOnLogin = new URL(page.url()).pathname.startsWith('/login');
        reports.push({
          view: screen.view,
          title: title?.text ?? null,
          titlePasses: title?.text === screen.title
            && title.size === '22px' && title.weight === '700' && title.lh === '32px',
          landedOnLogin,
          crashed: title?.text === CRASH_TITLE,
          loadFailures,
          pageErrors: pageErrors.length,
          blockedWriteRequests,
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return reports;
}

async function main(): Promise<void> {
  if (process.env.VERIFY_ENVIRONMENT !== 'staging') {
    throw new Error('VERIFY_ENVIRONMENT must be staging');
  }
  const config = readFileSync(CONFIG_PATH, 'utf8');
  const target = readVerificationTarget(config);
  const admin = readAdminTarget(config);
  const restaurantTestEnabled = readRestaurantTestFlag(config);
  const query = createD1Query(target, required('CLOUDFLARE_API_TOKEN', process.env.CLOUDFLARE_API_TOKEN));

  // 担当者は作らずに探す。飲食店の機能パック・店舗の紐付け・可視範囲まで本物と同じ条件で絞る。
  const candidates = await query<{ staff_id: string; line_account_id: string }>(
    `SELECT sm.id AS staff_id, la.id AS line_account_id
       FROM staff_members sm
       JOIN tenants t ON t.id = COALESCE(sm.tenant_id, ?)
       JOIN line_accounts la ON COALESCE(la.tenant_id, ?) = COALESCE(sm.tenant_id, ?)
       JOIN rt_stores s ON s.line_account_id = la.id
       JOIN rt_organizations o ON o.id = s.organization_id AND o.tenant_id = COALESCE(sm.tenant_id, ?)
      WHERE sm.is_active = 1 AND sm.role IN ('owner', 'admin') AND la.is_active = 1
        AND t.feature_packs LIKE '%"restaurant"%'
        AND ( COALESCE(sm.account_scope, 'all') = 'all'
          OR EXISTS (SELECT 1 FROM staff_account_scopes sas
                      WHERE sas.staff_id = sm.id AND sas.line_account_id = la.id) )
      ORDER BY sm.id, la.id
      LIMIT 1`,
    [DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, DEFAULT_TENANT_ID],
  );
  const scoped = candidates[0];
  if (!scoped || !restaurantTestEnabled) {
    // 失敗ではなく「次の手が分かる状態」として出す。入口のどこが空かだけを報告する。
    const gates = await readGates(query, restaurantTestEnabled);
    console.log(JSON.stringify({
      environment: 'staging',
      status: 'blocked',
      reason: 'デリバリー受注を開ける担当者とLINEアカウントの組を検証環境で見つけられませんでした',
      gates,
      nextStep: nextStepFor(gates),
      temporarySessionCreated: false,
      writeRequestsSent: 0,
    }));
    process.exitCode = 1;
    return;
  }

  const sessionToken = randomBytes(32).toString('base64url');
  const sessionHash = createHash('sha256').update(sessionToken).digest('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60_000).toISOString();
  const cleanupFailures: string[] = [];
  let report: Record<string, unknown> | null = null;
  let verificationError: unknown = null;

  try {
    await query(
      'INSERT OR IGNORE INTO admin_sessions (token_hash, staff_id, expires_at) VALUES (?, ?, ?)',
      [sessionHash, scoped.staff_id, expiresAt],
    );
    const accountQuery = encodeURIComponent(scoped.line_account_id);

    const orders = await readEndpoint(
      target, sessionToken, 'orders',
      `/api/restaurant-test/delivery/orders?account_id=${accountQuery}&tab=all`,
      ORDERS_FIELDS,
    );
    const orderRows = Array.isArray(orders.orders) ? orders.orders as Record<string, unknown>[] : [];
    const firstOrderId = typeof orderRows[0]?.id === 'string' ? orderRows[0].id as string : '';
    let orderDetail: Record<string, unknown> | null = null;
    if (firstOrderId) {
      orderDetail = await readEndpoint(
        target, sessionToken, 'order detail',
        `/api/restaurant-test/delivery/orders/${encodeURIComponent(firstOrderId)}?account_id=${accountQuery}`,
        ORDER_DETAIL_FIELDS,
      );
    }
    const history = await readEndpoint(
      target, sessionToken, 'history',
      `/api/restaurant-test/delivery/history?account_id=${accountQuery}`,
      HISTORY_FIELDS,
    );
    const menuItems = await readEndpoint(
      target, sessionToken, 'menu items',
      `/api/restaurant-test/delivery/menu-items?account_id=${accountQuery}`,
      MENU_ITEM_FIELDS,
    );

    const screens = await inspectScreens(admin, sessionToken, scoped.line_account_id);
    const brokenScreens = screens
      .map((screen) => ({ screen, reasons: screenFailures(screen) }))
      .filter(({ reasons }) => reasons.length !== 0);
    if (brokenScreens.length !== 0) {
      throw new Error(
        `Staging delivery screens failed: ${brokenScreens.map(
          ({ screen, reasons }) => `${screen.view}[${reasons.join(',')}]`,
        ).join(', ')}`,
      );
    }

    report = {
      environment: 'staging',
      status: 'verified',
      endpoints: {
        orders: {
          wrapped: false,
          orderCount: orderRows.length,
          serviceCount: Array.isArray(orders.services) ? orders.services.length : 0,
        },
        orderDetail: orderDetail
          ? { wrapped: false, itemCount: Array.isArray(orderDetail.items) ? orderDetail.items.length : 0 }
          : { skipped: 'no-order-rows' },
        history: {
          wrapped: false,
          orderCount: Array.isArray(history.orders) ? history.orders.length : 0,
        },
        menuItems: {
          wrapped: false,
          itemCount: Array.isArray(menuItems.items) ? menuItems.items.length : 0,
        },
      },
      screens: screens.map((screen) => ({
        view: screen.view,
        title: screen.title,
        titlePasses: screen.titlePasses,
        landedOnLogin: screen.landedOnLogin,
        crashed: screen.crashed,
        loadFailures: screen.loadFailures.length,
        pageErrors: screen.pageErrors,
        blockedWriteRequests: screen.blockedWriteRequests,
      })),
      temporarySessionTtlMinutes: SESSION_TTL_MINUTES,
      writeRequestsSent: 0,
    };
  } catch (error) {
    verificationError = error;
  } finally {
    try {
      await query('DELETE FROM admin_sessions WHERE token_hash = ?', [sessionHash]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown cleanup failure';
      cleanupFailures.push(`admin-session[reason=${reason}]`);
    }
  }

  let leftoverCount = -1;
  try {
    leftoverCount = await countSessionLeftovers(query, sessionHash);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown leftover-check failure';
    cleanupFailures.push(`leftover-check[reason=${reason}]`);
  }
  if (cleanupFailures.length !== 0 || leftoverCount !== 0) {
    throw new Error(`Staging cleanup incomplete: stages=${cleanupFailures.join(',') || 'none'}, leftovers=${leftoverCount}`);
  }
  if (verificationError) throw verificationError;
  console.log(JSON.stringify({ ...report, temporarySessionDeleted: true }));
}

if (process.argv[1]?.endsWith('verify-staging-restaurant-delivery.ts')) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown staging verification failure';
    console.error(JSON.stringify({ success: false, error: message }));
    process.exitCode = 1;
  });
}
