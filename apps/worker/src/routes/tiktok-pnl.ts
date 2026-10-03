/**
 * TikTok利益計算の自動化: 状態確認と手動同期のAPI。
 *
 * - 認可は既存の google_sheets_integrations（#838）を使い回すため、
 *   ここに新しいOAuthは無い。Googleの認可が生きているアカウントだけ動く。
 * - 変更系（手動同期）は owner / admin に限定する。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { auditLog } from '../lib/audit-log.js';
import { dbFor } from '../services/db-router.js';
import type { GoogleSheetsIntegrationRow } from '../services/google-sheets.js';
import {
  syncTiktokPnlForAccount,
  TIKTOK_PNL_USABLE_STATUS_SQL,
  type TiktokPnlSettingsRow,
} from '../services/tiktok-pnl.js';

export const tiktokPnl = new Hono<Env>();

function fail(
  c: Context<Env>,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503,
  error: string,
) {
  return c.json({ success: false, error }, status);
}

/**
 * 利益計算に使えるGoogle連携を1件返す。
 *
 * #838 の書き出し先スプレッドシート未選択（`pending_target`）でも、
 * Googleの認可と更新用トークンは保存されているので利益計算は動く。
 * 利益計算は自分でスプレッドシートを作るため #838 の書き出し先に依存しない。
 * 認可切れ（`expired`）と未接続（行なし）だけを未接続として扱う。
 */
async function connectedIntegration(
  c: Context<Env>,
  lineAccountId: string,
): Promise<GoogleSheetsIntegrationRow | null> {
  return dbFor(c.env).prepare(
    `SELECT * FROM google_sheets_integrations
      WHERE line_account_id = ? AND status IN ${TIKTOK_PNL_USABLE_STATUS_SQL}
      LIMIT 1`,
  ).bind(lineAccountId).first<GoogleSheetsIntegrationRow>();
}

/** 現在の状態（シートURL・最終同期・エラー）を返す。 */
tiktokPnl.get(
  '/api/integrations/tiktok-pnl/status',
  requireRole('owner', 'admin'),
  async (c) => {
    const lineAccountId = c.req.query('account_id');
    if (!lineAccountId) return fail(c, 400, 'account_id を指定してください');
    const db = dbFor(c.env);
    const settings = await db.prepare(
      'SELECT * FROM tiktok_pnl_settings WHERE line_account_id = ?',
    ).bind(lineAccountId).first<TiktokPnlSettingsRow>();
    const integration = await connectedIntegration(c, lineAccountId);
    const pending = await db.prepare(
      `SELECT COUNT(*) AS n FROM tiktok_pnl_order_lines
        WHERE line_account_id = ? AND sheet_dirty = 1`,
    ).bind(lineAccountId).first<{ n: number }>();
    return c.json({
      success: true,
      data: {
        sheetsConnected: Boolean(integration),
        spreadsheetUrl: settings?.spreadsheet_url ?? null,
        status: settings?.status ?? 'pending',
        lastImportAt: settings?.last_import_at ?? null,
        lastSheetSyncAt: settings?.last_sheet_sync_at ?? null,
        lastError: settings?.last_error ?? null,
        // 連続失敗回数。ここが増え続けている時は再接続や設定の見直しが必要なので
        // 管理画面で見えるようにする。
        consecutiveFailures: settings?.consecutive_failures ?? 0,
        pendingRows: pending?.n ?? 0,
      },
    });
  },
);

/** 手動同期。cronと同じ経路を1アカウント分だけ即時実行する。 */
tiktokPnl.post(
  '/api/integrations/tiktok-pnl/sync',
  requireRole('owner', 'admin'),
  async (c) => {
    const lineAccountId = c.req.query('account_id');
    if (!lineAccountId) return fail(c, 400, 'account_id を指定してください');
    const integration = await connectedIntegration(c, lineAccountId);
    if (!integration) {
      return fail(c, 409, 'Google Sheets連携が未接続です。先に管理画面のスプレッドシート連携を接続してください');
    }
    // 手動同期を押した時点が、このアカウントで利益計算シートを使うという
    // 明示的な意思表示。ここで有効化して以降はcronの対象にもする。
    await dbFor(c.env).prepare(
      `INSERT INTO tiktok_pnl_settings (line_account_id, enabled)
         VALUES (?, 1)
       ON CONFLICT(line_account_id)
         DO UPDATE SET enabled = 1, updated_at = datetime('now')`,
    ).bind(lineAccountId).run();
    const result = await syncTiktokPnlForAccount(c.env, integration, {
      now: new Date().toISOString(),
    });
    auditLog(
      c,
      'tiktok_pnl.manual_sync',
      { id: lineAccountId, kind: 'tiktok_pnl' },
      { result: result.status === 'error' ? 'failed' : 'success', lineAccountId },
    );
    if (result.status === 'error') {
      return fail(c, 502, `同期に失敗しました（${result.error ?? 'unknown'}）`);
    }
    return c.json({ success: true, data: result });
  },
);
