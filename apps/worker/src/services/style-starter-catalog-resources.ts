const tables: Record<string, { table: string; account: string; children?: [string, string][] }> = {
  tag: { table: 'tags', account: 'line_account_id' },
  folder: { table: 'folders', account: 'account_id' },
  template: { table: 'templates', account: 'line_account_id', children: [['template_versions', 'template_id']] },
  media: { table: 'media', account: 'line_account_id', children: [['media_versions', 'media_id']] },
  auto_reply: { table: 'auto_replies', account: 'line_account_id', children: [['auto_reply_versions', 'auto_reply_id']] },
  scenario: { table: 'scenarios', account: 'line_account_id', children: [['scenario_steps', 'scenario_id']] },
  form: { table: 'forms', account: '', children: [['form_accounts', 'form_id']] },
  rich_menu: { table: 'rich_menu_groups', account: 'account_id', children: [['rich_menu_pages', 'group_id']] },
};
/** 名前だけで同じと見なさず、子行・公開状態も含めて店の編集を検出する。 */
export async function catalogResourceSnapshot(db: D1Database, account: string, kind: string, id: string): Promise<string | null> {
  const spec = tables[kind];
  if (!spec) return null;
  const root = await db.prepare(spec.account
    ? `SELECT * FROM ${spec.table} WHERE id=? AND ${spec.account}=?`
    : 'SELECT * FROM forms WHERE id=? AND EXISTS(SELECT 1 FROM form_accounts WHERE form_id=forms.id AND line_account_id=?)')
    .bind(id, account).first<Record<string, unknown>>();
  if (!root && kind === 'template') {
    const asset = await db.prepare('SELECT * FROM broadcast_message_assets WHERE id=? AND line_account_id=?').bind(id, account).first();
    return asset ? JSON.stringify({ root: asset }) : null;
  }
  if (!root) return null;
  const children: Record<string, unknown> = {};
  if (kind === 'tag') {
    children.bindings = (await db.prepare("SELECT * FROM common_action_bindings WHERE line_account_id=? AND consumer_type='tag' AND consumer_id=? ORDER BY id").bind(account, id).all()).results;
    children.actions = (await db.prepare("SELECT * FROM common_actions WHERE line_account_id=? AND id IN(SELECT common_action_id FROM common_action_bindings WHERE line_account_id=? AND consumer_type='tag' AND consumer_id=?) ORDER BY id").bind(account, account, id).all()).results;
    children.versions = (await db.prepare("SELECT * FROM common_action_versions WHERE common_action_id IN(SELECT common_action_id FROM common_action_bindings WHERE line_account_id=? AND consumer_type='tag' AND consumer_id=?) ORDER BY id").bind(account, id).all()).results;
  }
  for (const [table, owner] of spec.children ?? []) children[table] = (await db.prepare(`SELECT * FROM ${table} WHERE ${owner}=? ORDER BY 1,2`).bind(id).all()).results;
  if (kind === 'rich_menu') children.areas = (await db.prepare('SELECT * FROM rich_menu_areas WHERE page_id IN(SELECT id FROM rich_menu_pages WHERE group_id=?) ORDER BY id').bind(id).all()).results;
  return JSON.stringify({ root, children });
}
