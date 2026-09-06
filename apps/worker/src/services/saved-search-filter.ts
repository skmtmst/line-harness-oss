import type { SavedSearchCondition, SavedSearchConditions } from '@line-crm/shared';

export interface CompiledSavedSearch {
  sql: string;
  binds: unknown[];
}

type CompiledCondition = { sql: string; binds: unknown[] };

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function existence(
  condition: SavedSearchCondition,
  sql: string,
  binds: unknown[] = [],
): CompiledCondition | string {
  if (['exists', 'has', 'eq'].includes(condition.op)) return { sql: `EXISTS (${sql})`, binds };
  if (['not_exists', 'not_has', 'ne'].includes(condition.op)) {
    return { sql: `NOT EXISTS (${sql})`, binds };
  }
  return '存在確認で使えない比較方法が指定されています';
}

function dateCondition(
  condition: SavedSearchCondition,
  columnSql: string,
  label: string,
): CompiledCondition | string {
  if (condition.op === 'between' && condition.value && typeof condition.value === 'object') {
    const range = condition.value as { from?: unknown; to?: unknown };
    const from = text(range.from);
    const to = text(range.to);
    if (!from && !to) return `${label}の範囲がありません`;
    const clauses: string[] = [];
    const binds: unknown[] = [];
    if (from) { clauses.push(`${columnSql} >= ?`); binds.push(from); }
    if (to) { clauses.push(`${columnSql} <= ?`); binds.push(`${to}T23:59:59.999`); }
    return { sql: `(${clauses.join(' AND ')})`, binds };
  }
  const value = text(condition.value);
  if (!value) return `${label}の条件に値がありません`;
  if (condition.op === 'after') return { sql: `${columnSql} >= ?`, binds: [value] };
  if (condition.op === 'before') return { sql: `${columnSql} <= ?`, binds: [`${value}T23:59:59.999`] };
  return `${label}で使えない比較方法が指定されています`;
}

function compileCondition(condition: SavedSearchCondition): CompiledCondition | string {
  const value = text(condition.value);
  switch (condition.kind) {
    case 'name':
      if (!value) return '名前の条件に値がありません';
      if (condition.op === 'eq') return { sql: 'f.display_name = ?', binds: [value] };
      if (condition.op === 'contains') return { sql: 'f.display_name LIKE ?', binds: [`%${value}%`] };
      return '名前で使えない比較方法が指定されています';

    case 'tag':
      if (!value) return 'タグの条件に値がありません';
      if (['has', 'includes', 'eq'].includes(condition.op)) {
        return {
          sql: 'EXISTS (SELECT 1 FROM friend_tags sft WHERE sft.friend_id = f.id AND sft.tag_id = ?)',
          binds: [value],
        };
      }
      if (['not_has', 'excludes', 'ne'].includes(condition.op)) {
        return {
          sql: 'NOT EXISTS (SELECT 1 FROM friend_tags sft WHERE sft.friend_id = f.id AND sft.tag_id = ?)',
          binds: [value],
        };
      }
      return 'タグで使えない比較方法が指定されています';

    case 'field': {
      const key = text(condition.key);
      if (!key || !value) return '友だち情報の条件に項目または値がありません';
      if (condition.op === 'eq') {
        return { sql: `json_extract(f.metadata, '$.' || ?) = ?`, binds: [key, value] };
      }
      if (condition.op === 'ne') {
        return {
          sql: `(json_extract(f.metadata, '$.' || ?) IS NULL OR json_extract(f.metadata, '$.' || ?) != ?)`,
          binds: [key, key, value],
        };
      }
      if (condition.op === 'contains') {
        return { sql: `json_extract(f.metadata, '$.' || ?) LIKE ?`, binds: [key, `%${value}%`] };
      }
      return '友だち情報で使えない比較方法が指定されています';
    }

    case 'status_message':
      if (!value) return 'ステータスメッセージの条件に値がありません';
      if (condition.op === 'eq') return { sql: 'f.status_message = ?', binds: [value] };
      if (condition.op === 'contains') return { sql: 'f.status_message LIKE ?', binds: [`%${value}%`] };
      return 'ステータスメッセージで使えない比較方法が指定されています';

    case 'mark':
      if (!value) return '対応マークの条件に値がありません';
      if (condition.op !== 'eq') return '対応マークで使えない比較方法が指定されています';
      return { sql: 'f.support_mark_id = ?', binds: [value] };

    case 'assignee':
      if (!value) return '担当者の条件に値がありません';
      if (condition.op !== 'eq' && condition.op !== 'ne') {
        return '担当者で使えない比較方法が指定されています';
      }
      return {
        sql: `${condition.op === 'ne' ? 'NOT ' : ''}EXISTS (
          SELECT 1 FROM chats sac WHERE sac.friend_id = f.id AND sac.operator_id = ?
        )`,
        binds: [value],
      };

    case 'chat_status':
      if (!value || !['unread', 'in_progress', 'on_hold', 'resolved'].includes(value)) {
        return '対応状態の条件が正しくありません';
      }
      if (condition.op !== 'eq') return '対応状態で使えない比較方法が指定されています';
      return {
        sql: `COALESCE((SELECT status FROM chats sc WHERE sc.friend_id = f.id), 'resolved') = ?`,
        binds: [value],
      };

    case 'following':
      if (condition.op !== 'eq' || typeof condition.value !== 'boolean') {
        return '友だち状態の条件が正しくありません';
      }
      return { sql: 'f.is_following = ?', binds: [condition.value ? 1 : 0] };

    case 'scenario':
      if (!value) return 'シナリオの条件に値がありません';
      if (condition.op !== 'eq') return 'シナリオで使えない比較方法が指定されています';
      return {
        sql: `EXISTS (
          SELECT 1 FROM friend_scenarios sfs
          WHERE sfs.friend_id = f.id AND sfs.scenario_id = ?
            AND sfs.status IN ('active', 'delivering')
        )`,
        binds: [value],
      };

    case 'event_booking': {
      const sql = `SELECT 1 FROM event_bookings seb
        WHERE seb.friend_id = f.id${value ? ' AND seb.event_id = ?' : ''}`;
      return existence(condition, sql, value ? [value] : []);
    }

    case 'calendar_booking': {
      const sql = `SELECT 1 FROM calendar_bookings scb
        WHERE scb.friend_id = f.id${value ? ' AND scb.status = ?' : ''}`;
      return existence(condition, sql, value ? [value] : []);
    }

    case 'form': {
      const formId = text(condition.formId) ?? value;
      const sql = `SELECT 1 FROM form_submissions sfsu
        WHERE sfsu.friend_id = f.id${formId ? ' AND sfsu.form_id = ?' : ''}`;
      return existence(condition, sql, formId ? [formId] : []);
    }

    case 'last_activity':
      return dateCondition(
        condition,
        `(SELECT MAX(sml.created_at) FROM messages_log sml
          WHERE sml.friend_id = f.id AND (sml.delivery_type IS NULL OR sml.delivery_type != 'test'))`,
        '最終反応日',
      );

    case 'reminder': {
      const sql = `SELECT 1 FROM friend_reminders sfr
        WHERE sfr.friend_id = f.id${value ? ' AND sfr.reminder_id = ?' : ''}`;
      return existence(condition, sql, value ? [value] : []);
    }

    case 'memo':
      if (condition.op === 'exists') return { sql: "COALESCE(TRIM(f.private_memo), '') != ''", binds: [] };
      if (condition.op === 'not_exists') return { sql: "COALESCE(TRIM(f.private_memo), '') = ''", binds: [] };
      if (!value) return '個別メモの条件に値がありません';
      if (condition.op === 'eq') return { sql: 'f.private_memo = ?', binds: [value] };
      if (condition.op === 'contains') return { sql: 'f.private_memo LIKE ?', binds: [`%${value}%`] };
      return '個別メモで使えない比較方法が指定されています';

    case 'created_at': {
      return dateCondition(condition, 'f.created_at', '友だち追加日');
    }

    case 'purchase': {
      const sql = `SELECT 1 FROM ec_events see
        WHERE see.friend_id = f.id AND see.event_type LIKE 'ec.order.%'
          ${value ? 'AND see.event_type = ?' : ''}`;
      return existence(condition, sql, value ? [value] : []);
    }

    case 'common_event': {
      if (!value) return '共通イベントの条件に種類がありません';
      return existence(
        condition,
        'SELECT 1 FROM analytics_events sae WHERE sae.friend_id = f.id AND sae.event_type = ?',
        [value],
      );
    }
  }
}

/**
 * 保存条件を友だち一覧のSQLへ変換する。
 *
 * 未対応の条件を黙って落とさない。対象が広がって誤配信につながるため、
 * 使えない理由を返して一覧・配信の実行を止める。
 */
export function compileSavedSearch(conditions: SavedSearchConditions):
  | { ok: true; value: CompiledSavedSearch }
  | { ok: false; error: string } {
  const compileGroup = (items: SavedSearchCondition[], join: ' AND ' | ' OR '): CompiledCondition | string => {
    const clauses: string[] = [];
    const binds: unknown[] = [];
    for (const item of items) {
      const compiled = compileCondition(item);
      if (typeof compiled === 'string') return compiled;
      clauses.push(compiled.sql);
      binds.push(...compiled.binds);
    }
    return { sql: clauses.length ? `(${clauses.join(join)})` : '', binds };
  };

  const groups: string[] = [];
  const binds: unknown[] = [];
  if (conditions.all?.length) {
    const compiled = compileGroup(conditions.all, ' AND ');
    if (typeof compiled === 'string') return { ok: false, error: compiled };
    groups.push(compiled.sql);
    binds.push(...compiled.binds);
  }
  if (conditions.any?.length) {
    const compiled = compileGroup(conditions.any, ' OR ');
    if (typeof compiled === 'string') return { ok: false, error: compiled };
    groups.push(compiled.sql);
    binds.push(...compiled.binds);
  }
  if (conditions.visibility === 'visible_only') groups.push('f.is_hidden = 0');
  if (conditions.visibility === 'hidden_only') groups.push('f.is_hidden = 1');
  if (!groups.length) return { ok: false, error: '実行できる条件がありません' };
  return { ok: true, value: { sql: `(${groups.join(' AND ')})`, binds } };
}
