import { liffActionUrl, type LiffAction, type MessageTemplateDefinition } from '@line-crm/shared';
import { collectLiffActionLocators, isLiffActionKind } from '@line-crm/shared';
import { normalizeScopedTagName } from '@line-crm/db';
import { messageCardReferences } from './message-card-references.js';
import { HqTemplateError } from './tag.js';
import type { HqTemplateAuthority, HqTemplateStatement } from './contract.js';

type Row = Record<string, string | number | null>;
const unavailable = (): never => { throw new HqTemplateError('REFERENCE_UNAVAILABLE', 409); };

/** 選んだメニュー・カードは配り先の同名の1件だけを再利用する。作成はしない。 */
export async function resolveHqLiffActions(db: D1Database, authority: HqTemplateAuthority, accountId: string, actions: ReadonlyMap<string, LiffAction>) {
  const targets: Record<string, string> = {}, snapshot: unknown[] = [], statements: HqTemplateStatement[] = [];
  if (!actions.size) return { targets, snapshot, statements };
  const account = await db.prepare('SELECT liff_id FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL')
    .bind(accountId, authority.tenantId).first<{ liff_id: string | null }>();
  if (!account) throw new HqTemplateError('FORBIDDEN', 403);
  const liffId = account!.liff_id;
  if (!liffId || !/^[A-Za-z0-9_-]{1,128}$/.test(liffId)) throw new HqTemplateError('LIFF_UNAVAILABLE', 409);
  snapshot.push([accountId, liffId]);
  statements.push({ sql: "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM line_accounts WHERE id=? AND tenant_id=? AND liff_id IS ? AND is_active=1 AND archived_at IS NULL) THEN '{}' ELSE 'HQ_LIFF_CONFLICT' END)", bindings: [accountId, authority.tenantId, liffId] });

  // 計画で使った全行と所属を、配布の原子的な書き込み直前にも確かめる。
  async function read(sql: string, bindings: (string | number | null)[]): Promise<Row[]> {
    const rows = (await db.prepare(sql).bind(...bindings).all<Row>()).results;
    snapshot.push([sql, bindings, rows]);
    if (rows.length) {
      const columns = Object.keys(rows[0]);
      const jsonSql = `SELECT json_group_array(json_object(${columns.flatMap(column => [`'${column}'`, column]).join(',')})) FROM (${sql})`;
      statements.push({ sql: `SELECT json(CASE WHEN (${jsonSql}) IS json(?) THEN '{}' ELSE 'HQ_LIFF_CONFLICT' END)`, bindings: [...bindings, JSON.stringify(rows)] });
    }
    return rows;
  }
  for (const [key, action] of actions) {
    let target: LiffAction = action;
    if (action.kind === 'form') {
      const plan = await messageCardReferences(db, authority, accountId, { format: 'flex', title: '', body: '参照', buttons: [{ id: 'form', label: '回答フォーム', action: 'form', value: action.formId }] });
      targets[key] = plan.targets[`form:${action.formId}`];
      snapshot.push(...plan.snapshot); statements.push(...plan.statements);
      continue;
    }
    const sourceId = action.kind === 'booking' ? action.menuId : action.kind === 'visit_stamp' ? action.cardId : undefined;
    if (sourceId) {
      const booking = action.kind === 'booking';
      const table = booking ? 'menus' : 'visit_stamp_cards';
      const sourceSql = booking
        ? 'SELECT m.* FROM menus m JOIN line_accounts a ON a.id=m.line_account_id WHERE m.id=? AND m.is_active=1 AND m.deleted_at IS NULL AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL ORDER BY m.id'
        : 'SELECT c.* FROM visit_stamp_cards c WHERE c.id=? AND c.tenant_id=? AND c.active=1 ORDER BY c.id';
      const sources = await read(sourceSql, [sourceId, authority.tenantId]);
      if (sources.length !== 1) unavailable();
      const inventorySql = booking
        ? `SELECT * FROM ${table} WHERE line_account_id=? AND is_active=1 AND deleted_at IS NULL ORDER BY id`
        : 'SELECT c.* FROM visit_stamp_cards c WHERE c.active=1 AND c.tenant_id=? AND EXISTS(SELECT 1 FROM visit_stamp_card_accounts ca WHERE ca.card_id=c.id AND ca.line_account_id=?) ORDER BY c.id';
      const bindings = booking ? [accountId] : [authority.tenantId, accountId];
      const rows = await read(inventorySql, bindings);
      const matches = rows.filter(row => normalizeScopedTagName(String(row.name)) === normalizeScopedTagName(String(sources[0].name)));
      if (matches.length !== 1) unavailable();
      target = booking ? { kind: 'booking', menuId: String(matches[0].id) } : { kind: 'visit_stamp', cardId: String(matches[0].id) };
    }
    targets[key] = liffActionUrl({ liffId, ...target });
  }
  return { targets, snapshot, statements };
}

export function messageLiffActions(definition: MessageTemplateDefinition): Map<string, LiffAction> {
  const actions = definition.card ? new Map<string, LiffAction>() : collectLiffActionLocators(definition);
  for (const button of definition.card?.buttons ?? []) {
    if (!isLiffActionKind(button.action)) continue;
    const spec: LiffAction = button.action === 'form' ? { kind: 'form', formId: button.value }
      : button.action === 'booking' ? { kind: 'booking', ...(button.value ? { menuId: button.value } : {}) }
      : button.action === 'visit_stamp' ? { kind: 'visit_stamp', ...(button.value ? { cardId: button.value } : {}) }
      : { kind: 'booking_history' };
    actions.set(`${button.action}:${button.value}`, spec);
  }
  return actions;
}
