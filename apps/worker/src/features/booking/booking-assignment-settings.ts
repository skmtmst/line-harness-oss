import type { BookingAssignmentResource, BookingAssignmentSettings, BookingAssignmentWrite } from '@line-crm/shared';

export interface AssignmentScope { kind: 'staff' | 'table'; id: string }
export interface AssignmentSettingsStore {
  read(scope: AssignmentScope): Promise<BookingAssignmentSettings>;
  save(scope: AssignmentScope, input: BookingAssignmentWrite): Promise<'saved' | 'conflict' | 'unavailable'>;
}
export const defaultAssignmentResource = (resourceId: string): BookingAssignmentResource => ({
  resourceId, priority: 'normal', dailyLimit: null, sortOrder: 0,
});
export const defaultAssignmentSettings = (storageReady: boolean): BookingAssignmentSettings => ({
  method: 'balanced', balancePeriod: 'day', resources: [], version: 0,
  storageReady, effectiveMethod: storageReady ? 'balanced' : 'legacy_first',
});

/** 保存先を差し替えられる境界。DDL・自動の表作成は実行しない。 */
export function d1AssignmentSettingsStore(db: D1Database): AssignmentSettingsStore {
  const ready = async () => (await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='booking_assignment_settings'",
  ).first<{ name: string }>())?.name === 'booking_assignment_settings';
  return {
    async read(scope) {
      if (!await ready()) return defaultAssignmentSettings(false);
      const row = await db.prepare(`SELECT method,balance_period,resources_json,version FROM booking_assignment_settings
        WHERE scope_kind=? AND scope_id=?`).bind(scope.kind, scope.id)
        .first<{ method: BookingAssignmentSettings['method']; balance_period: BookingAssignmentSettings['balancePeriod']; resources_json: string; version: number }>();
      if (!row) return defaultAssignmentSettings(true);
      const input = { method: row.method, balancePeriod: row.balance_period, resources: JSON.parse(row.resources_json), expectedVersion: row.version };
      if (!validAssignmentWrite(input)) throw new Error('invalid_stored_assignment_settings');
      return { method: input.method, balancePeriod: input.balancePeriod, resources: input.resources,
        version: row.version, storageReady: true, effectiveMethod: row.method };
    },
    async save(scope, input) {
      if (!await ready()) return 'unavailable';
      const result = await db.prepare(`INSERT INTO booking_assignment_settings(scope_kind,scope_id,method,balance_period,resources_json,version)
        SELECT ?,?,?,?,?,1 WHERE ?=0 OR EXISTS(SELECT 1 FROM booking_assignment_settings WHERE scope_kind=? AND scope_id=?)
        ON CONFLICT(scope_kind,scope_id) DO UPDATE SET method=excluded.method,balance_period=excluded.balance_period,
          resources_json=excluded.resources_json,version=booking_assignment_settings.version+1,updated_at=datetime('now')
        WHERE booking_assignment_settings.version=?`)
        .bind(scope.kind, scope.id, input.method, input.balancePeriod, JSON.stringify(input.resources),
          input.expectedVersion, scope.kind, scope.id, input.expectedVersion).run();
      return result.meta.changes === 1 ? 'saved' : 'conflict';
    },
  };
}

export function validAssignmentWrite(value: unknown): value is BookingAssignmentWrite {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const b = value as BookingAssignmentWrite;
  if (!['balanced', 'priority', 'random'].includes(b.method) || !['day', 'week'].includes(b.balancePeriod)
    || !Number.isSafeInteger(b.expectedVersion) || b.expectedVersion < 0
    || !Array.isArray(b.resources) || b.resources.length > 1000) return false;
  const ids = new Set<string>();
  for (const r of b.resources) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.resourceId !== 'string'
      || !r.resourceId.trim() || r.resourceId.length > 128 || ids.has(r.resourceId)
      || !['preferred', 'normal', 'low'].includes(r.priority)
      || !(r.dailyLimit === null || (Number.isSafeInteger(r.dailyLimit) && r.dailyLimit >= 1))
      || !Number.isSafeInteger(r.sortOrder) || r.sortOrder < 0) return false;
    ids.add(r.resourceId);
  }
  return true;
}

export async function assignmentResourceIds(db: D1Database, scope: AssignmentScope): Promise<string[]> {
  const rows = scope.kind === 'staff'
    ? await db.prepare(`SELECT id FROM staff WHERE line_account_id=? AND deleted_at IS NULL AND is_designation_optional=0 ORDER BY sort_order,id`).bind(scope.id).all<{ id: string }>()
    : await db.prepare('SELECT id FROM rt_tables WHERE store_id=? ORDER BY id').bind(scope.id).all<{ id: string }>();
  return rows.results.map(r => r.id);
}

export async function assignmentSettingsWithResources(db: D1Database, scope: AssignmentScope) {
  const settings = await d1AssignmentSettingsStore(db).read(scope);
  const resources = new Map(settings.resources.map(r => [r.resourceId, r]));
  return { ...settings, resources: (await assignmentResourceIds(db, scope)).map(id => resources.get(id) ?? defaultAssignmentResource(id)) };
}
