import type {
  OperationCapability,
  OperationIncident,
} from './operations.js';

/*
 * N-451: 緊急停止の「復旧前検査」。
 *
 * 停止した瞬間に、止めた対象（予約配信・シナリオ・リマインダ・
 * オートメーション・自動応答）の定義の版と期限を incident へ保存する。
 * 復旧時に現在の定義と比べ、停止中の 編集・削除・追加・権限喪失・期限切れ
 * を検出する。変更・追加がある能力は再開せず理由つきで止めたままにし、
 * 期限を過ぎた予約配信は下書きへ戻して過去時刻の catch-up 送信を防ぐ。
 *
 * 対象の切り方は影響人数プレビュー（operation-impact-preview）と
 * 同じ範囲に合わせる。止めたのと同じものを見なければ検査の意味がない。
 */

/** 停止時に記録する定義1件の指紋。 */
export interface OperationStoppedDefinition {
  id: string;
  /** 定義の版。更新される定義は updated_at、予約配信は lock_version。 */
  version: string | null;
  /** 期限。予約配信の scheduled_at。期限を持たない定義は null。 */
  expiresAt: string | null;
  /** 停止時点の状態（予約配信なら 'scheduled' / 'sending' など）。 */
  status: string | null;
}

export type OperationStoppedDefinitions = Partial<
  Record<OperationCapability, OperationStoppedDefinition[]>
>;

export type OperationDriftKind =
  /** 停止中に定義が編集された（版が違う）。 */
  | 'changed'
  /** 停止中に定義が削除された。 */
  | 'deleted'
  /** 停止中に人が止めた・送り終わった（稼働対象から外れた）。 */
  | 'inactive'
  /** 停止中に新しく追加された。 */
  | 'added'
  /** 停止中に期限を過ぎた。再開すると過去時刻を送ってしまう。 */
  | 'expired';

export interface OperationDefinitionDrift {
  id: string;
  kind: OperationDriftKind;
  beforeVersion: string | null;
  currentVersion: string | null;
  currentStatus: string | null;
  expiresAt: string | null;
}

export interface OperationCapabilityDrift {
  capability: OperationCapability;
  /** 停止時と同じ版のまま残っている定義。 */
  unchanged: string[];
  /** ずれが見つかった定義。 */
  drift: OperationDefinitionDrift[];
  /** 編集・追加があるため再開を止める。 */
  blocked: boolean;
}

export interface OperationRestoreDrift {
  /** 対象アカウントが停止中に無効化・アーカイブされた（権限喪失）。 */
  accountInactive: boolean;
  capabilities: OperationCapabilityDrift[];
  /** drift が無く再開してよい capability。 */
  resumable: OperationCapability[];
  /** 期限切れで下書きへ戻す対象。 */
  expired: { capability: OperationCapability; id: string; expiresAt: string | null }[];
}

type DefinitionRow = {
  id: string;
  version: string | null;
  expires_at: string | null;
  status: string | null;
};

/** 影響人数プレビューと同じ account 範囲の絞り込み。 */
function broadcastScopeClause(accountId: string | null): string {
  return accountId
    ? `AND (
         line_account_id = ?
         OR (
           target_type = 'multi-account-dedup'
           AND EXISTS (
             SELECT 1
               FROM json_each(CASE WHEN json_valid(account_ids) THEN account_ids ELSE '[]' END)
              WHERE value = ?
           )
         )
       )`
    : '';
}

/**
 * 各 capability の「いま稼働対象になっている定義」を取る。
 * 条件は operation-impact-preview と同じ。
 */
async function listActiveDefinitions(
  db: D1Database,
  capability: OperationCapability,
  accountId: string | null,
): Promise<DefinitionRow[]> {
  switch (capability) {
    case 'broadcast_dispatch': {
      const statement = db.prepare(
        `SELECT id, CAST(lock_version AS TEXT) AS version,
                scheduled_at AS expires_at, status
           FROM broadcasts
          WHERE status IN ('scheduled', 'sending') AND sent_at IS NULL
          ${broadcastScopeClause(accountId)}`,
      );
      const result = accountId
        ? await statement.bind(accountId, accountId).all<DefinitionRow>()
        : await statement.all<DefinitionRow>();
      return result.results ?? [];
    }
    case 'scenario_dispatch': {
      const statement = db.prepare(
        `SELECT id, updated_at AS version, NULL AS expires_at,
                CAST(is_active AS TEXT) AS status
           FROM scenarios
          WHERE is_active = 1
          ${accountId ? 'AND (line_account_id = ? OR line_account_id IS NULL)' : ''}`,
      );
      const result = accountId
        ? await statement.bind(accountId).all<DefinitionRow>()
        : await statement.all<DefinitionRow>();
      return result.results ?? [];
    }
    case 'reminder_dispatch': {
      const statement = db.prepare(
        `SELECT id, updated_at AS version, NULL AS expires_at,
                CAST(is_active AS TEXT) AS status
           FROM reminders
          WHERE is_active = 1 AND deleted_at IS NULL
          ${accountId ? 'AND line_account_id = ?' : ''}`,
      );
      const result = accountId
        ? await statement.bind(accountId).all<DefinitionRow>()
        : await statement.all<DefinitionRow>();
      return result.results ?? [];
    }
    case 'automation_actions': {
      const statement = db.prepare(
        `SELECT id, updated_at AS version, NULL AS expires_at, status
           FROM automation_definitions
          WHERE status = 'active'
          ${accountId ? 'AND line_account_id = ?' : ''}`,
      );
      const result = accountId
        ? await statement.bind(accountId).all<DefinitionRow>()
        : await statement.all<DefinitionRow>();
      return result.results ?? [];
    }
    case 'auto_reply_dispatch': {
      const statement = db.prepare(
        `SELECT id, updated_at AS version, NULL AS expires_at,
                CAST(is_active AS TEXT) AS status
           FROM auto_replies
          WHERE is_active = 1 AND deleted_at IS NULL
          ${accountId ? 'AND (line_account_id = ? OR line_account_id IS NULL)' : ''}`,
      );
      const result = accountId
        ? await statement.bind(accountId).all<DefinitionRow>()
        : await statement.all<DefinitionRow>();
      return result.results ?? [];
    }
    // webhook 送信・広告postbackには定義テーブルが無い。版の比較対象が
    // 無いので空を返し、capability 単位の停止/再開だけを扱う。
    default:
      return [];
  }
}

/** snapshotに載った定義を、稼働条件に関係なくidで引く（削除・停止済みの判定用）。 */
async function getDefinitionsByIds(
  db: D1Database,
  capability: OperationCapability,
  ids: string[],
): Promise<Map<string, DefinitionRow>> {
  const found = new Map<string, DefinitionRow>();
  if (ids.length === 0) return found;
  const placeholders = ids.map(() => '?').join(',');
  let sql: string;
  switch (capability) {
    case 'broadcast_dispatch':
      sql = `SELECT id, CAST(lock_version AS TEXT) AS version, scheduled_at AS expires_at, status
               FROM broadcasts WHERE id IN (${placeholders})`;
      break;
    case 'scenario_dispatch':
      sql = `SELECT id, updated_at AS version, NULL AS expires_at, CAST(is_active AS TEXT) AS status
               FROM scenarios WHERE id IN (${placeholders})`;
      break;
    case 'reminder_dispatch':
      sql = `SELECT id, updated_at AS version, NULL AS expires_at,
                    CASE WHEN deleted_at IS NOT NULL THEN 'deleted' ELSE CAST(is_active AS TEXT) END AS status
               FROM reminders WHERE id IN (${placeholders})`;
      break;
    case 'automation_actions':
      sql = `SELECT id, updated_at AS version, NULL AS expires_at, status
               FROM automation_definitions WHERE id IN (${placeholders})`;
      break;
    case 'auto_reply_dispatch':
      sql = `SELECT id, updated_at AS version, NULL AS expires_at, CAST(is_active AS TEXT) AS status
               FROM auto_replies WHERE id IN (${placeholders})`;
      break;
    default:
      return found;
  }
  const result = await db.prepare(sql).bind(...ids).all<DefinitionRow>();
  for (const row of result.results ?? []) found.set(row.id, row);
  return found;
}

/** 予約配信の期限切れ: まだ 'scheduled' で、予約時刻を過ぎたものだけ。 */
function isExpiredDefinition(
  capability: OperationCapability,
  row: DefinitionRow,
  nowMs: number,
): boolean {
  if (capability !== 'broadcast_dispatch') return false;
  if (row.status !== 'scheduled' || !row.expires_at) return false;
  const expiresMs = Date.parse(row.expires_at);
  return Number.isFinite(expiresMs) && expiresMs <= nowMs;
}

/**
 * 停止時に、止める capability の稼働対象の指紋を取る。
 * incident の stopped_definitions_json へ保存する。
 */
export async function captureStoppedDefinitions(
  db: D1Database,
  lineAccountId: string | null,
  capabilities: OperationCapability[],
): Promise<OperationStoppedDefinitions> {
  const definitions: OperationStoppedDefinitions = {};
  for (const capability of capabilities) {
    const rows = await listActiveDefinitions(db, capability, lineAccountId);
    definitions[capability] = rows.map((row) => ({
      id: row.id,
      version: row.version,
      expiresAt: row.expires_at,
      status: row.status,
    }));
  }
  return definitions;
}

/**
 * incident の stopped_definitions_json を読む。
 * 未保存（この仕組みより前の停止）や壊れたJSONは null を返し、
 * 呼び出し側で「検査できない」扱いにする。
 */
export function parseStoppedDefinitions(raw: string | null): OperationStoppedDefinitions | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const result: OperationStoppedDefinitions = {};
    for (const [capability, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) return null;
      result[capability as OperationCapability] = list.map((item) => {
        const entry = item as Partial<OperationStoppedDefinition>;
        return {
          id: String(entry.id),
          version: entry.version == null ? null : String(entry.version),
          expiresAt: entry.expiresAt == null ? null : String(entry.expiresAt),
          status: entry.status == null ? null : String(entry.status),
        };
      });
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * incident の停止時snapshotと現在の定義を比べる（復旧前検査）。
 */
export async function inspectIncidentRestoreDrift(
  db: D1Database,
  incident: OperationIncident,
  nowMs = Date.now(),
): Promise<OperationRestoreDrift> {
  const definitions = parseStoppedDefinitions(incident.stoppedDefinitionsJson ?? null);

  let accountInactive = false;
  if (incident.lineAccountId) {
    const account = await db.prepare(
      `SELECT is_active, archived_at FROM line_accounts WHERE id = ?`,
    ).bind(incident.lineAccountId).first<{ is_active: number; archived_at: string | null }>();
    accountInactive = !account || account.is_active !== 1 || account.archived_at !== null;
  }

  const capabilityDrifts: OperationCapabilityDrift[] = [];
  const resumable: OperationCapability[] = [];
  const expired: OperationRestoreDrift['expired'] = [];

  for (const capability of incident.capabilities) {
    /*
     * この検査より前に止めた incident には指紋が無い。
     * 「記録が無い = 停止中に全部追加された」と誤認して永遠に
     * 復旧できなくなることを防ぎ、その能力は検査なしで再開可とする。
     */
    if (definitions === null) {
      const blocked = accountInactive;
      if (!blocked) resumable.push(capability);
      capabilityDrifts.push({ capability, unchanged: [], drift: [], blocked });
      continue;
    }
    const before = definitions[capability] ?? [];
    const activeRows = await listActiveDefinitions(db, capability, incident.lineAccountId);
    const activeById = new Map(activeRows.map((row) => [row.id, row]));
    const currentRows = await getDefinitionsByIds(
      db,
      capability,
      before.map((entry) => entry.id),
    );

    const unchanged: string[] = [];
    const drift: OperationDefinitionDrift[] = [];

    for (const entry of before) {
      const current = currentRows.get(entry.id);
      if (!current) {
        drift.push({
          id: entry.id, kind: 'deleted',
          beforeVersion: entry.version, currentVersion: null,
          currentStatus: null, expiresAt: entry.expiresAt,
        });
        continue;
      }
      const active = activeById.get(entry.id);
      if (!active) {
        // 行は残っているが稼働対象から外れた = 停止中に人が止めたか送り終わった。
        drift.push({
          id: entry.id, kind: 'inactive',
          beforeVersion: entry.version, currentVersion: current.version,
          currentStatus: current.status, expiresAt: entry.expiresAt,
        });
        continue;
      }
      if (isExpiredDefinition(capability, active, nowMs)) {
        drift.push({
          id: entry.id, kind: 'expired',
          beforeVersion: entry.version, currentVersion: active.version,
          currentStatus: active.status, expiresAt: active.expires_at,
        });
        expired.push({ capability, id: entry.id, expiresAt: active.expires_at });
        continue;
      }
      if (active.version !== entry.version) {
        drift.push({
          id: entry.id, kind: 'changed',
          beforeVersion: entry.version, currentVersion: active.version,
          currentStatus: active.status, expiresAt: active.expires_at,
        });
        continue;
      }
      unchanged.push(entry.id);
    }

    for (const row of activeRows) {
      if (!before.some((entry) => entry.id === row.id)) {
        drift.push({
          id: row.id, kind: 'added',
          beforeVersion: null, currentVersion: row.version,
          currentStatus: row.status, expiresAt: row.expires_at,
        });
      }
    }

    const blocked = accountInactive
      || drift.some((entry) => entry.kind === 'changed' || entry.kind === 'added');
    if (!blocked) resumable.push(capability);
    capabilityDrifts.push({ capability, unchanged, drift, blocked });
  }

  return { accountInactive, capabilities: capabilityDrifts, resumable, expired };
}

/**
 * 期限切れの予約配信を下書きへ戻す（過去時刻の catch-up 送信を防ぐ）。
 * 実際に更新できた id だけを返す。scheduled 以外は触らない。
 */
export async function holdExpiredBroadcasts(
  db: D1Database,
  ids: string[],
  actorId: string,
  at: string,
): Promise<string[]> {
  const held: string[] = [];
  for (const id of ids) {
    const result = await db.prepare(
      `UPDATE broadcasts
          SET status = 'draft', scheduled_at = NULL,
              stopped_at = ?, stopped_by = ?,
              lock_version = lock_version + 1
        WHERE id = ? AND status = 'scheduled'`,
    ).bind(at, actorId, id).run();
    if (Number(result.meta?.changes ?? 0) === 1) held.push(id);
  }
  return held;
}
