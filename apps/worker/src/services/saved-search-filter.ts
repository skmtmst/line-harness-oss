import type { SavedSearchCondition, SavedSearchConditions } from '@line-crm/shared';

export interface CompiledSavedSearch {
  sql: string;
  binds: unknown[];
}

type CompiledCondition = { sql: string; binds: unknown[] };

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

    case 'created_at': {
      if (condition.op === 'between' && condition.value && typeof condition.value === 'object') {
        const range = condition.value as { from?: unknown; to?: unknown };
        const from = text(range.from);
        const to = text(range.to);
        if (!from && !to) return '友だち追加日の範囲がありません';
        const clauses: string[] = [];
        const binds: unknown[] = [];
        if (from) { clauses.push('f.created_at >= ?'); binds.push(from); }
        if (to) { clauses.push('f.created_at <= ?'); binds.push(`${to}T23:59:59.999`); }
        return { sql: `(${clauses.join(' AND ')})`, binds };
      }
      if (!value) return '友だち追加日の条件に値がありません';
      if (condition.op === 'after') return { sql: 'f.created_at >= ?', binds: [value] };
      if (condition.op === 'before') return { sql: 'f.created_at <= ?', binds: [`${value}T23:59:59.999`] };
      return '友だち追加日で使えない比較方法が指定されています';
    }

    case 'form':
      return '回答フォームの条件は、回答と友だちを結ぶ口が未接続です';
    case 'purchase':
      return '購入履歴の条件は、購入と友だちを結ぶ口が未接続です';
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
