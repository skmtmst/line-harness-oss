#!/usr/bin/env tsx
/**
 * 検証環境（staging）の Instagram 同時投稿を、ログイン済みの状態で「読むだけ」確認する。
 *
 * 公開APIは認証を要求するため、未認証の応答だけでは次の3点を合格にできない。
 *  1. ログイン後に Instagram が「設定がありません」（state=unconfigured）と出ること
 *  2. migration 611 の適用後も既存の投稿一覧・投稿詳細・口コミが今までどおり出ること
 *  3. PNG の実変換（Cloudflare Images）が今回の配備では到達しないこと
 *
 * この確認は 15 分で切れる一時的な管理セッションを staging D1 に 1 行だけ作り、
 * 読み取り専用の口だけを呼び、最後に必ずその 1 行を消して残り 0 件を確かめる。
 * 本番の Worker・D1 は `readVerificationTarget` が拒否する。書き込みの口は呼ばない。
 *
 * 3 については、同時投稿の入口 `crossPostToInstagram` が
 * `instagramConfig(env)` 不在で `instagram_unconfigured`(503) を投げ、
 * さらに `instagram_connections` の行・期限・投稿許可を全部通らないと
 * `instagramImageUrl`（Images を触る唯一の経路）へ届かない。
 * 未接続のまま配備した今回は到達しないので、課金も発生しない。
 * ここでは「接続状態が unconfigured である」ことを根拠として記録し、実変換の確認は
 * 利用者が Meta アプリを作って接続したあとの段へ送る。
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createD1Query, readVerificationTarget } from './verify-staging-operational-path.js';

const CONFIG_PATH = 'apps/worker/wrangler.staging.toml';
const SESSION_TTL_MINUTES = 15;
const SAMPLE_LIMIT = 5;
const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';

/** 読み取り専用の口だけを許す。ここに無い道は呼べない。 */
const READ_ONLY_PREFIXES = [
  '/api/instagram/connection?',
  '/api/restaurant-test/google/posts?',
  '/api/restaurant-test/google/posts/',
  '/api/restaurant-test/google/reviews?',
] as const;

/** migration 611 の前から画面が使っていた項目。1つでも欠けたら不合格にする。 */
const EXISTING_POST_FIELDS = [
  'id', 'kind', 'origin', 'summary', 'title', 'schedule', 'cta', 'offer', 'media',
  'publishMode', 'status', 'googleState', 'searchUrl', 'staffName', 'error',
  'createdAt', 'sentAt', 'publishedAt', 'updatedAt',
] as const;

type VerificationTarget = ReturnType<typeof readVerificationTarget>;
type QueryD1 = ReturnType<typeof createD1Query>;

type ConnectionStatus = { state: string; replyEnabled?: boolean };
type PublicPost = Record<string, unknown> & { id?: unknown; instagram?: Record<string, unknown> };

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
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
  if (!READ_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    throw new Error('The staging check may only call the read-only Instagram and Google post endpoints');
  }
  const response = await fetchImpl(`${target.workerUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer lh_session:${sessionToken}`,
      'Content-Type': 'application/json',
    },
  });
  let body: Record<string, unknown> = {};
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

/** 既存項目の欠けと、同時投稿欄の形を数える。 */
export function inspectPosts(posts: PublicPost[]): {
  checked: number;
  missingFields: string[];
  instagramEnabled: number;
  unexpectedStatus: string[];
} {
  const missingFields = new Set<string>();
  const unexpectedStatus = new Set<string>();
  let instagramEnabled = 0;
  for (const post of posts) {
    for (const field of EXISTING_POST_FIELDS) {
      if (!(field in post)) missingFields.add(field);
    }
    const instagram = post.instagram;
    if (!instagram || typeof instagram !== 'object') {
      missingFields.add('instagram');
      continue;
    }
    for (const field of ['enabled', 'caption', 'status', 'permalink', 'error']) {
      if (!(field in instagram)) missingFields.add(`instagram.${field}`);
    }
    if (instagram.enabled === true) instagramEnabled += 1;
    const status = String(instagram.status);
    // 画面のことばは「なし／済み／失敗」の3つだけ。
    if (!['none', 'published', 'failed'].includes(status)) unexpectedStatus.add(status);
  }
  return {
    checked: posts.length,
    missingFields: [...missingFields].sort(),
    instagramEnabled,
    unexpectedStatus: [...unexpectedStatus].sort(),
  };
}

async function countSessionLeftovers(query: QueryD1, sessionHash: string): Promise<number> {
  const rows = await query<{ count: number }>(
    'SELECT COUNT(*) AS count FROM admin_sessions WHERE token_hash = ?',
    [sessionHash],
  );
  return Number(rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  if (process.env.VERIFY_ENVIRONMENT !== 'staging') {
    throw new Error('VERIFY_ENVIRONMENT must be staging');
  }
  const target = readVerificationTarget(readFileSync(CONFIG_PATH, 'utf8'));
  const query = createD1Query(
    target,
    required('CLOUDFLARE_API_TOKEN', process.env.CLOUDFLARE_API_TOKEN),
  );
  const sessionToken = randomBytes(32).toString('base64url');
  const sessionHash = createHash('sha256').update(sessionToken).digest('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60_000).toISOString();

  const cleanupFailures: string[] = [];
  let report: Record<string, unknown> | null = null;
  let verificationError: unknown = null;

  try {
    // 担当者は作らずに探す。無ければ確認できないので、その事実を投げる。
    const targets = await query<{ staff_id: string; line_account_id: string }>(
      `SELECT sm.id AS staff_id, la.id AS line_account_id
         FROM staff_members sm
         JOIN line_accounts la
           ON COALESCE(sm.tenant_id, ?) = COALESCE(la.tenant_id, ?)
        WHERE sm.is_active = 1
          AND sm.role IN ('owner', 'admin')
          AND la.is_active = 1
          AND (
            COALESCE(sm.account_scope, 'all') = 'all'
            OR EXISTS (
              SELECT 1 FROM staff_account_scopes sas
               WHERE sas.staff_id = sm.id AND sas.line_account_id = la.id
            )
          )
        ORDER BY sm.id, la.id
        LIMIT 1`,
      [DEFAULT_TENANT_ID, DEFAULT_TENANT_ID],
    );
    const scoped = targets[0];
    if (!scoped) throw new Error('No scoped staging administrator/account pair found');

    await query(
      'INSERT OR IGNORE INTO admin_sessions (token_hash, staff_id, expires_at) VALUES (?, ?, ?)',
      [sessionHash, scoped.staff_id, expiresAt],
    );
    const accountQuery = encodeURIComponent(scoped.line_account_id);

    // 1. ログイン後の Instagram の表示。
    const connection = await readOnlyRequest(
      target,
      sessionToken,
      `/api/instagram/connection?lineAccountId=${accountQuery}`,
    );
    if (connection.status !== 200 || connection.body.success !== true) {
      throw new Error(`Authenticated Instagram connection check failed (http=${connection.status})`);
    }
    const status = connection.body.data as ConnectionStatus | undefined;
    if (status?.state !== 'unconfigured') {
      throw new Error(`Expected Instagram state unconfigured; found ${status?.state ?? 'none'}`);
    }

    // 2. 既存の投稿一覧・投稿詳細・口コミ。店舗が無い場合は「比べる行が無い」と記録する。
    const posts = await readOnlyRequest(
      target,
      sessionToken,
      `/api/restaurant-test/google/posts?account_id=${accountQuery}&filter=all&per_page=${SAMPLE_LIMIT}`,
    );
    const storeLinked = posts.status !== 404;
    let postReport: Record<string, unknown> = { storeLinked: false, checked: 0 };
    let reviewReport: Record<string, unknown> = { storeLinked: false, checked: 0 };

    if (storeLinked) {
      if (posts.status !== 200 || posts.body.success !== true) {
        throw new Error(`Existing Google post list check failed (http=${posts.status})`);
      }
      const rows = Array.isArray(posts.body.posts) ? posts.body.posts as PublicPost[] : [];
      const inspected = inspectPosts(rows);
      if (inspected.missingFields.length !== 0) {
        throw new Error(`Existing post fields missing: ${inspected.missingFields.join(',')}`);
      }
      if (inspected.unexpectedStatus.length !== 0) {
        throw new Error(`Unexpected Instagram status words: ${inspected.unexpectedStatus.join(',')}`);
      }
      if (inspected.instagramEnabled !== 0) {
        throw new Error(`Expected 0 posts with Instagram enabled; found ${inspected.instagramEnabled}`);
      }
      postReport = {
        storeLinked: true,
        checked: inspected.checked,
        total: Number(posts.body.total ?? 0),
        existingFieldsMissing: 0,
        instagramEnabled: inspected.instagramEnabled,
      };

      const firstId = rows[0]?.id;
      if (typeof firstId === 'string') {
        const detail = await readOnlyRequest(
          target,
          sessionToken,
          `/api/restaurant-test/google/posts/${encodeURIComponent(firstId)}?account_id=${accountQuery}`,
        );
        if (detail.status !== 200 || detail.body.success !== true) {
          throw new Error(`Existing Google post detail check failed (http=${detail.status})`);
        }
        const detailInspected = inspectPosts([detail.body.post as PublicPost]);
        if (detailInspected.missingFields.length !== 0) {
          throw new Error(`Existing post detail fields missing: ${detailInspected.missingFields.join(',')}`);
        }
        postReport = { ...postReport, detailChecked: 1 };
      } else {
        postReport = { ...postReport, detailChecked: 0 };
      }

      const reviews = await readOnlyRequest(
        target,
        sessionToken,
        `/api/restaurant-test/google/reviews?account_id=${accountQuery}&filter=all&per_page=${SAMPLE_LIMIT}`,
      );
      if (reviews.status !== 200 || reviews.body.success !== true) {
        throw new Error(`Existing Google review list check failed (http=${reviews.status})`);
      }
      const reviewRows = Array.isArray(reviews.body.reviews) ? reviews.body.reviews as Array<Record<string, unknown>> : [];
      // migration 611 は口コミの列を触っていない。口が success で返り、行の形が崩れていないことだけ見る。
      const reviewsMissingId = reviewRows.filter((row) => !('id' in row)).length;
      if (reviewsMissingId !== 0) throw new Error(`Existing reviews missing id: ${reviewsMissingId}`);
      reviewReport = { storeLinked: true, checked: reviewRows.length, missingId: 0 };
    }

    report = {
      environment: 'staging',
      instagramState: 'unconfigured',
      instagramConnectButtonShown: false,
      posts: postReport,
      reviews: reviewReport,
      // 未接続なので同時投稿の入口が 503 で止まり、画像変換へ到達しない。
      imageConversionReachable: false,
      imageConversionsRun: 0,
      temporarySessionTtlMinutes: SESSION_TTL_MINUTES,
      writeRequestsSent: 0,
      lineMessagesSent: 0,
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
    throw new Error(
      `Staging cleanup incomplete: stages=${cleanupFailures.join(',') || 'none'},`
      + ` leftovers=${leftoverCount}`,
    );
  }
  if (verificationError) throw verificationError;
  console.log(JSON.stringify({ ...report, temporarySessionDeleted: true }));
}

if (process.argv[1]?.endsWith('verify-staging-instagram-cross-post.ts')) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown staging verification failure';
    console.error(JSON.stringify({ success: false, error: message }));
    process.exitCode = 1;
  });
}
