import type { WebinarActionInput } from './webinars/types/index.js';


export async function webinarActionReferenceValid(
  db: D1Database,
  accountId: string | null,
  action: Pick<WebinarActionInput, 'actionType' | 'config'>,
): Promise<boolean> {
  const ref = (key: string): string | null => {
    const value = action.config[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  const exists = async (sql: string, id: string): Promise<boolean> =>
    Boolean(await db.prepare(sql).bind(id, accountId).first());
  switch (action.actionType) {
    case 'add_tag':
    case 'remove_tag': {
      const tagId = ref('tagId');
      return tagId !== null && await exists(
        `SELECT id FROM tags WHERE id = ? AND line_account_id = ? AND status = 'active'`,
        tagId,
      );
    }
    case 'start_scenario':
    case 'stop_scenario':
    case 'resume_scenario': {
      const scenarioId = ref('scenarioId');
      return scenarioId !== null && await exists(
        'SELECT id FROM scenarios WHERE id = ? AND line_account_id = ?',
        scenarioId,
      );
    }
    case 'send_message': {
      const templateId = ref('templateId');
      return templateId !== null && await exists(
        'SELECT id FROM templates WHERE id = ? AND line_account_id = ?',
        templateId,
      );
    }
    case 'send_webhook': {
      const webhookId = ref('webhookId');
      return webhookId !== null && await exists(
        'SELECT id FROM outgoing_webhooks WHERE id = ? AND line_account_id = ? AND is_active = 1 AND deleted_at IS NULL',
        webhookId,
      );
    }
    case 'switch_rich_menu': {
      const pageId = ref('richMenuPageId');
      return pageId !== null && await exists(
        `SELECT p.id FROM rich_menu_pages p
          JOIN rich_menu_groups g ON g.id = p.group_id
         WHERE p.id = ? AND g.account_id = ? AND g.status = 'published'`,
        pageId,
      );
    }
    case 'remove_rich_menu':
      return true;
    default:
      return false;
  }
}
