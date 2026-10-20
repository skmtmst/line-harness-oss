import { getFormById, formBelongsToLineAccount, isLineAccountTenantActive } from '@line-crm/db';
import { resolveOgForEvent, resolveOgForForm, resolveOgForAccount } from './lib/og-resolver.js';
import { buildOgHtml } from './lib/og-html.js';


// URL（パス or クエリ）からイベント/フォーム等のレコードを引いて OGP HTML を組み立てる。
// LIFF アプリの共有 URL は実際には `https://liff.line.me/<LIFF_ID>/?page=event&id=<id>`
// 形式で、Worker に届くときは pathname が `/`、クエリに `page` `id` `liffId` が乗る。
// 旧形式の `/events/:id` パスも残しているのでパスマッチも合わせて見る。
export async function buildOgForLiffPath(db: D1Database, url: URL): Promise<string> {
  const pathname = url.pathname;
  const liffIdFromQuery = url.searchParams.get('liffId');
  const pageFromQuery = url.searchParams.get('page');
  const idFromQuery = url.searchParams.get('id');
  const absoluteUrl = url.toString();

  const lookupAccountByLiff = async (liffId: string | null): Promise<any> => {
    if (!liffId) return null;
    return db
      .prepare(`SELECT * FROM line_accounts WHERE liff_id = ?`)
      .bind(liffId)
      .first<any>();
  };
  const lookupAccountById = async (id: string | null): Promise<any> => {
    if (!id) return null;
    return db.prepare(`SELECT * FROM line_accounts WHERE id = ?`).bind(id).first<any>();
  };

  // event: パス `/events/:id` または クエリ `?page=event&id=`
  let eventId: string | null = null;
  const eventPathMatch = pathname.match(/^\/events\/([^/]+)(?:\/(?:confirm|done))?\/?$/);
  if (eventPathMatch) eventId = eventPathMatch[1];
  else if (pageFromQuery === 'event' && idFromQuery) eventId = idFromQuery;

  if (eventId) {
    // liffId クエリでアカウントが特定できる場合は /api/liff/events/:id と
    // 同じ可視性条件（deleted_at IS NULL, is_published=1, target アカウント所属）
    // で event を取得する。未公開・削除済みのイベント情報を bot プレビューに
    // 漏らさない。liffId が無いか不一致なら、最低限の公開条件のみ適用。
    let event: any = null;
    let account: any = null;

    if (liffIdFromQuery) {
      account = await lookupAccountByLiff(liffIdFromQuery);
      if (account) {
        event = await db
          .prepare(
            `SELECT * FROM events
              WHERE id = ? AND deleted_at IS NULL AND is_published = 1 AND (
                (target_type = 'single' AND line_account_id = ?)
                OR (target_type = 'multi-account-dedup'
                    AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
              )`,
          )
          .bind(eventId, account.id, account.id)
          .first<any>();
      }
    }

    if (!event && !liffIdFromQuery) {
      // liffId 指定が URL に無い場合（旧 /events/:id パス等）のみ、event 単独
      // lookup と event 所属 account からの branding を許可する。
      //
      // liffId 指定があるのに strict query が空ということは「URL の liffId
      // アカウントに属さない event」なので、ここで event 単独 lookup に落とすと
      // 他アカの event 詳細・branding が bot プレビューに漏れる。event=null の
      // まま外側のアカウントデフォルト OG（liffId 由来 account）にフォールバック
      // させて漏洩を防ぐ。
      account = null;
      event = await db
        .prepare(
          `SELECT * FROM events WHERE id = ? AND deleted_at IS NULL AND is_published = 1`,
        )
        .bind(eventId)
        .first<any>();
      if (event && event.target_type === 'single' && event.line_account_id) {
        // multi-account-dedup のときは line_account_id が sentinel なので
        // branding に使わない（og:site_name は 'LINE' フォールバック）。
        account = await lookupAccountById(event.line_account_id);
      }
    }

    if (event) {
      const og = resolveOgForEvent(event, account, absoluteUrl);
      return buildOgHtml(og);
    }
  }

  // form: クエリ `?page=form&id=`
  if (pageFromQuery === 'form' && idFromQuery) {
    const form = await getFormById(db, idFromQuery, { published: true });
    const account = liffIdFromQuery ? await lookupAccountByLiff(liffIdFromQuery) : await db.prepare(
      'SELECT a.* FROM line_accounts a JOIN form_accounts fa ON fa.line_account_id=a.id WHERE fa.form_id=? ORDER BY a.id LIMIT 1'
    ).bind(idFromQuery).first<any>();
    if (form?.is_active && account && account.is_active && !account.archived_at
      && await formBelongsToLineAccount(db, idFromQuery, account.id)
      && await isLineAccountTenantActive(db, account.id)) {
      return buildOgHtml(resolveOgForForm(form, account, absoluteUrl));
    }
  }

  // フォールバック: アカウントデフォルトのみ
  const account = await lookupAccountByLiff(liffIdFromQuery);
  const og = resolveOgForAccount(account, absoluteUrl);
  return buildOgHtml(og);
}
