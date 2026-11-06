import { type BroadcastRenderContext } from '../../services/render-message.js';

/**
 * 配信全体で1つに決まる差し込みの値。
 *
 * 共通情報（営業時間など）と配信日は、誰に送っても同じ値になる。
 * 1人ずつ引くと人数分クエリが増えるので、送る前に1回だけ用意する。
 *
 * 配信日の起点は**実際に送る時刻**。予約時刻ではない。cron は5分刻みで
 * 動くので、深夜0時前後の配信では予約時刻と実際の日付が割れる。
 * 相手が受け取った日と、本文に書かれた日が食い違うのがいちばん困る。
 */
export async function broadcastWideContext(
  db: D1Database,
  accountId: string | null,
  content: string,
  fixedVars: Record<string, string> | undefined,
  broadcastId: string,
): Promise<BroadcastRenderContext> {
  const context: BroadcastRenderContext = { deliveredAt: new Date() };
  if(/\{\{\s*account\.name\s*\}\}/.test(content)) {
    if(!accountId)throw new Error('店名の差し込みには店舗が必要です');
    const a=await db.prepare('SELECT name FROM line_accounts WHERE id=?').bind(accountId).first<{name:string}>();
    if(!a)throw new Error('店名を確認できません');context.accountName=a.name;
  }
  if (accountId) {
    const { getLineAccountById: getLA } = await import('@line-crm/db');
    const acct = await getLA(db, accountId);
    context.liffId = (acct as unknown as { liff_id?: string | null } | null)?.liff_id ?? null;
  }
  // 共通情報は本文で使っているときだけ引く。使わない配信で毎回1クエリ増やさない。
  // snapshot の無い到達経路でも、消えた共通情報を空文字へ落とさず fail-closed にする。
  if (/\{\{\s*var\./.test(content)) {
    if (fixedVars) context.vars = fixedVars;
    else {
      const { resolveSendCommonVars } = await import('../../services/interpolation-context.js');
      context.vars = await resolveSendCommonVars(
        db, accountId, content, { kind: 'broadcast', id: broadcastId },
      );
    }
  }
  return context;
}
