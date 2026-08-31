import { jstNow } from '@line-crm/db';

import { createAutomationActionExecutors } from './automation-action-executors.js';
import {
  processAutomationRun,
  startAutomationRun,
  type AutomationActionExecutor,
  type RunStatus,
} from './automation-engine.js';

export const WEBINAR_ACTION_TRIGGERS = ['completed', 'cta_click', 'missed'] as const;
export type WebinarActionTrigger = typeof WEBINAR_ACTION_TRIGGERS[number];

type WebinarActionRow = {
  webinar_id: string;
  trigger_type: WebinarActionTrigger;
  version: number;
  common_action_id: string | null;
  common_action_version_id: string | null;
  action_name: string | null;
  version_number: number | null;
  updated_at: string;
};

export type WebinarActionSetting = {
  trigger: WebinarActionTrigger;
  version: number;
  action: null | {
    id: string;
    name: string;
    versionId: string;
    versionNumber: number;
  };
  updatedAt: string | null;
};

export const WEBINAR_ACTION_TRIGGER_DEFINITIONS = [
  {
    trigger: 'completed',
    label: '視聴完了',
    availability: 'estimated',
    definition: '動画の90%地点まで再生位置が進んだ人',
    limitation: '実際に見た区間の計測はまだ接続されていないため、早送りを除いた視聴完了ではありません。',
  },
  {
    trigger: 'cta_click',
    label: '案内を押した',
    availability: 'available',
    definition: 'この回で案内を初めて押した人',
    limitation: null,
  },
  {
    trigger: 'missed',
    label: '未視聴',
    availability: 'available',
    definition: '申込が有効で、翌日の設定時刻（未設定なら10:00）まで視聴記録がない人',
    limitation: null,
  },
] as const;

const JST_SECONDS = 9 * 60 * 60;
const DEFAULT_MISSED_TIME_MINUTES = 10 * 60;

export type WebinarActionExecutionResult = {
  kind: 'not_configured' | 'created' | 'existing';
  runId: string | null;
  status: RunStatus | 'busy' | 'not_found' | null;
};

export class WebinarActionError extends Error {
  constructor(
    public readonly code: 'not_found' | 'version_not_found' | 'version_conflict' | 'account_mismatch',
    message: string,
    public readonly current?: WebinarActionSetting,
  ) {
    super(message);
    this.name = 'WebinarActionError';
  }
}

function runnerId(webinarId: string, trigger: WebinarActionTrigger): string {
  return `system:webinar:${webinarId}:${trigger}`;
}

function runnerVersionId(webinarId: string, trigger: WebinarActionTrigger, version: number): string {
  return `${runnerId(webinarId, trigger)}:v${version}`;
}

function serialize(row: WebinarActionRow | null, trigger: WebinarActionTrigger): WebinarActionSetting {
  return {
    trigger,
    version: row?.version ?? 0,
    action: row?.common_action_id && row.common_action_version_id && row.action_name && row.version_number
      ? {
          id: row.common_action_id,
          name: row.action_name,
          versionId: row.common_action_version_id,
          versionNumber: row.version_number,
        }
      : null,
    updatedAt: row?.updated_at ?? null,
  };
}

async function getRows(db: D1Database, webinarId: string): Promise<WebinarActionRow[]> {
  const result = await db.prepare(
    `SELECT wa.webinar_id, wa.trigger_type, wa.version,
            wa.common_action_id, wa.common_action_version_id,
            ca.name AS action_name, cav.version_number, wa.updated_at
       FROM webinar_actions wa
       LEFT JOIN common_actions ca ON ca.id = wa.common_action_id
       LEFT JOIN common_action_versions cav ON cav.id = wa.common_action_version_id
      WHERE wa.webinar_id = ?`,
  ).bind(webinarId).all<WebinarActionRow>();
  return result.results ?? [];
}

export async function getWebinarActionSettings(
  db: D1Database,
  webinarId: string,
  lineAccountId: string,
): Promise<{
  settings: WebinarActionSetting[];
  availableActions: Array<{ id: string; name: string; versionId: string; versionNumber: number }>;
  triggerDefinitions: typeof WEBINAR_ACTION_TRIGGER_DEFINITIONS;
}> {
  const webinar = await db.prepare(
    'SELECT id FROM webinars WHERE id = ? AND account_id = ?',
  ).bind(webinarId, lineAccountId).first<{ id: string }>();
  if (!webinar) throw new WebinarActionError('not_found', 'ウェビナーが見つかりません');
  const [rows, available] = await Promise.all([
    getRows(db, webinarId),
    db.prepare(
      `SELECT ca.id, ca.name, cav.id AS version_id, cav.version_number
         FROM common_actions ca
         JOIN common_action_versions cav
           ON cav.id = ca.current_published_version_id
          AND cav.common_action_id = ca.id AND cav.status = 'published'
        WHERE ca.line_account_id = ? AND ca.status = 'published'
        ORDER BY ca.name ASC, ca.updated_at DESC`,
    ).bind(lineAccountId).all<{
      id: string; name: string; version_id: string; version_number: number;
    }>(),
  ]);
  const byTrigger = new Map(rows.map((row) => [row.trigger_type, row]));
  return {
    settings: WEBINAR_ACTION_TRIGGERS.map((trigger) => serialize(byTrigger.get(trigger) ?? null, trigger)),
    availableActions: (available.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      versionId: row.version_id,
      versionNumber: row.version_number,
    })),
    triggerDefinitions: WEBINAR_ACTION_TRIGGER_DEFINITIONS,
  };
}

export async function saveWebinarActionSetting(
  db: D1Database,
  input: {
    webinarId: string;
    lineAccountId: string;
    trigger: WebinarActionTrigger;
    commonActionVersionId: string | null;
    expectedVersion: number;
    updatedBy?: string | null;
    now?: string;
  },
): Promise<WebinarActionSetting> {
  const webinar = await db.prepare(
    'SELECT id FROM webinars WHERE id = ? AND account_id = ?',
  ).bind(input.webinarId, input.lineAccountId).first<{ id: string }>();
  if (!webinar) throw new WebinarActionError('not_found', 'ウェビナーが見つかりません');

  let action: { id: string; version_id: string; version_number: number; action_config: string } | null = null;
  if (input.commonActionVersionId) {
    action = await db.prepare(
      `SELECT ca.id, cav.id AS version_id, cav.version_number, cav.action_config
         FROM common_action_versions cav
         JOIN common_actions ca ON ca.id = cav.common_action_id
        WHERE cav.id = ? AND cav.status = 'published'
          AND ca.line_account_id = ? AND ca.status = 'published'`,
    ).bind(input.commonActionVersionId, input.lineAccountId).first<{
      id: string; version_id: string; version_number: number; action_config: string;
    }>();
    if (!action) {
      throw new WebinarActionError(
        'version_not_found',
        '選んだ共通アクションの公開版が見つからないか、別のLINE公式アカウントにあります',
      );
    }
  }

  const now = input.now ?? jstNow();
  // 派生する利用先・実行定義を、この保存が実際に版を進めた場合だけ更新する。
  // 値が同じ古いリクエストでも409を完全な無変更にするため、時刻ではなく一意値で照合する。
  const operationToken = crypto.randomUUID();
  const nextVersion = input.expectedVersion + 1;
  const definitionId = runnerId(input.webinarId, input.trigger);
  const versionId = runnerVersionId(input.webinarId, input.trigger, nextVersion);
  const rootAction = action ? [{
    id: 'webinar-action',
    type: 'common_action',
    params: { commonActionId: action.id, commonActionVersionId: action.version_id },
    onFailure: 'stop',
  }] : [];

  const statements: D1PreparedStatement[] = [];
  if (input.expectedVersion === 0) {
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO webinar_actions
         (webinar_id, trigger_type, version, operation_token,
          common_action_id, common_action_version_id,
          updated_by, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.webinarId, input.trigger, operationToken,
      action?.id ?? null, action?.version_id ?? null,
      input.updatedBy ?? null, now, now,
    ));
  } else {
    statements.push(db.prepare(
      `UPDATE webinar_actions
          SET version = version + 1, operation_token = ?,
              common_action_id = ?, common_action_version_id = ?,
              updated_by = ?, updated_at = ?
        WHERE webinar_id = ? AND trigger_type = ? AND version = ?`,
    ).bind(
      operationToken, action?.id ?? null, action?.version_id ?? null,
      input.updatedBy ?? null, now,
      input.webinarId, input.trigger, input.expectedVersion,
    ));
  }

  const currentGuard = `EXISTS (
    SELECT 1 FROM webinar_actions
     WHERE webinar_id = ? AND trigger_type = ? AND version = ? AND operation_token = ?
       AND common_action_version_id ${action ? '= ?' : 'IS NULL'}
  )`;
  const guardValues = action
    ? [input.webinarId, input.trigger, nextVersion, operationToken, action.version_id]
    : [input.webinarId, input.trigger, nextVersion, operationToken];

  statements.push(db.prepare(
    `DELETE FROM common_action_bindings
      WHERE line_account_id = ? AND consumer_type = 'webinar'
        AND consumer_id = ? AND consumer_path = ? AND ${currentGuard}`,
  ).bind(input.lineAccountId, input.webinarId, input.trigger, ...guardValues));

  if (action) {
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO common_action_bindings
         (id, line_account_id, common_action_id, common_action_version_id,
          consumer_type, consumer_id, consumer_path, created_by, created_at, updated_at)
       SELECT ?, ?, ?, ?, 'webinar', ?, ?, ?, ?, ?
        WHERE ${currentGuard}`,
    ).bind(
      crypto.randomUUID(), input.lineAccountId, action.id, action.version_id,
      input.webinarId, input.trigger, input.updatedBy ?? null, now, now, ...guardValues,
    ));
  }

  statements.push(db.prepare(
    `INSERT OR IGNORE INTO automation_definitions
       (id, line_account_id, name, description, status, priority,
        created_by, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, 0, 'system:webinar', ?, ?
      WHERE ${currentGuard}`,
  ).bind(
    definitionId, input.lineAccountId, `ウェビナー視聴後処理（${input.trigger}）`,
    'ウェビナーで固定した共通アクションを実行する内部定義です。',
    action ? 'active' : 'stopped', now, now, ...guardValues,
  ));

  if (action) {
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO automation_versions
         (id, automation_id, version_number, status, trigger_type,
          trigger_config, condition_config, action_config, created_by, created_at, published_at)
       SELECT ?, ?, ?, 'published', ?, ?, '{}', ?, 'system:webinar', ?, ?
        WHERE ${currentGuard}`,
    ).bind(
      versionId, definitionId, nextVersion, `webinar_${input.trigger}`,
      JSON.stringify({ webinarId: input.webinarId, trigger: input.trigger }),
      JSON.stringify(rootAction), now, now, ...guardValues,
    ));
  }

  statements.push(db.prepare(
    `UPDATE automation_definitions
        SET status = ?, current_published_version_id = ?, updated_at = ?
      WHERE id = ? AND ${currentGuard}`,
  ).bind(
    action ? 'active' : 'stopped', action ? versionId : null, now, definitionId,
    ...guardValues,
  ));

  const results = await db.batch(statements);
  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    const current = (await getWebinarActionSettings(db, input.webinarId, input.lineAccountId))
      .settings.find((item) => item.trigger === input.trigger)!;
    throw new WebinarActionError(
      'version_conflict',
      'ほかの担当者が先に変更しました。最新の内容を読み直してください',
      current,
    );
  }

  return (await getWebinarActionSettings(db, input.webinarId, input.lineAccountId))
    .settings.find((item) => item.trigger === input.trigger)!;
}

export async function startWebinarActionExecution(
  db: D1Database,
  input: {
    webinarId: string;
    lineAccountId: string;
    trigger: WebinarActionTrigger;
    friendId: string;
    sessionStartAt: number;
    sourceEventId: string;
    now?: string;
    executors?: Record<string, AutomationActionExecutor>;
    credentialEncryptionKey?: string;
  },
): Promise<WebinarActionExecutionResult> {
  const definitionId = runnerId(input.webinarId, input.trigger);
  const configured = await db.prepare(
    `SELECT wa.common_action_version_id
       FROM webinar_actions wa
       JOIN webinars w ON w.id = wa.webinar_id AND w.account_id = ?
       JOIN friends f ON f.id = ? AND f.line_account_id = ?
      WHERE wa.webinar_id = ? AND wa.trigger_type = ?
        AND wa.common_action_version_id IS NOT NULL`,
  ).bind(
    input.lineAccountId, input.friendId, input.lineAccountId,
    input.webinarId, input.trigger,
  ).first<{ common_action_version_id: string }>();
  if (!configured) return { kind: 'not_configured', runId: null, status: null };

  const idempotencyKey = [
    'webinar', input.webinarId, input.trigger, input.friendId, input.sessionStartAt,
  ].join(':');
  const started = await startAutomationRun(db, {
    lineAccountId: input.lineAccountId,
    automationId: definitionId,
    sourceEventId: input.sourceEventId,
    idempotencyKey,
    friendId: input.friendId,
    inputEvent: {
      type: `webinar_${input.trigger}`,
      webinarId: input.webinarId,
      sessionStartAt: input.sessionStartAt,
    },
    conditionMatched: true,
    now: input.now,
  });
  if (started.kind === 'not_active' || !started.runId || !started.status) {
    return { kind: 'not_configured', runId: null, status: null };
  }
  await db.prepare(
    `INSERT OR IGNORE INTO webinar_action_executions
       (id, webinar_id, trigger_type, friend_id, session_start_at,
        automation_run_id, source_event_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), input.webinarId, input.trigger, input.friendId,
    input.sessionStartAt, started.runId, input.sourceEventId, input.now ?? jstNow(),
  ).run();

  let status: WebinarActionExecutionResult['status'] = started.status;
  if (started.kind === 'created' && started.status === 'queued') {
    status = await processAutomationRun(db, started.runId, {
      now: input.now,
      executors: input.executors ?? createAutomationActionExecutors({
        credentialEncryptionKey: input.credentialEncryptionKey,
      }),
    });
  }
  return { kind: started.kind, runId: started.runId, status };
}

function jstNextDayAt(sessionStartAt: number, minutes: number): number {
  const local = new Date((sessionStartAt + JST_SECONDS) * 1000);
  return Math.floor(Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 1,
    Math.floor(minutes / 60),
    minutes % 60,
  ) / 1000) - JST_SECONDS;
}

/**
 * 未視聴アクションは「見逃し通知」と別の機能なので、通知のON/OFFや送信成否に依存させない。
 * 申込・視聴・実行台帳を直接照合し、同じ人・同じ回は実行台帳の一意制約で1回に保つ。
 */
export async function processDueMissedWebinarActions(
  db: D1Database,
  options: {
    now?: Date;
    limit?: number;
    executors?: Record<string, AutomationActionExecutor>;
    credentialEncryptionKey?: string;
  } = {},
): Promise<{ processed: number; failed: number }> {
  const now = options.now ?? new Date();
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const nowIso = now.toISOString();
  const candidates = await db.prepare(
    `SELECT r.webinar_id, r.friend_id, r.session_start_at, w.account_id,
            COALESCE(s.missed_time_minutes, ?) AS missed_time_minutes
       FROM webinar_registrations r
       JOIN webinars w ON w.id = r.webinar_id
       JOIN webinar_actions wa
         ON wa.webinar_id = r.webinar_id
        AND wa.trigger_type = 'missed'
        AND wa.common_action_version_id IS NOT NULL
       LEFT JOIN webinar_notification_settings s ON s.webinar_id = r.webinar_id
      WHERE r.status = 'active' AND w.status = 'active' AND w.account_id IS NOT NULL
        AND r.session_start_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM webinar_viewers v
           WHERE v.webinar_id = r.webinar_id AND v.friend_id = r.friend_id
             AND v.session_start_at = r.session_start_at
        )
        AND NOT EXISTS (
          SELECT 1 FROM webinar_action_executions e
           WHERE e.webinar_id = r.webinar_id AND e.trigger_type = 'missed'
             AND e.friend_id = r.friend_id AND e.session_start_at = r.session_start_at
        )
      ORDER BY r.session_start_at ASC
      LIMIT ?`,
  ).bind(DEFAULT_MISSED_TIME_MINUTES, nowEpoch, options.limit ?? 100).all<{
    webinar_id: string;
    friend_id: string;
    session_start_at: number;
    account_id: string;
    missed_time_minutes: number;
  }>();

  let processed = 0;
  let failed = 0;
  for (const row of candidates.results ?? []) {
    if (jstNextDayAt(row.session_start_at, row.missed_time_minutes) > nowEpoch) continue;
    try {
      const result = await startWebinarActionExecution(db, {
        webinarId: row.webinar_id,
        lineAccountId: row.account_id,
        trigger: 'missed',
        friendId: row.friend_id,
        sessionStartAt: row.session_start_at,
        sourceEventId: `webinar:${row.webinar_id}:${row.session_start_at}:${row.friend_id}:missed`,
        now: nowIso,
        executors: options.executors,
        credentialEncryptionKey: options.credentialEncryptionKey,
      });
      if (result.kind !== 'not_configured') processed++;
    } catch (error) {
      failed++;
      console.error('webinar missed action error:', error);
    }
  }
  return { processed, failed };
}
