export type SavedAnalyticsKind = 'cross' | 'funnel';
export type SavedAnalyticsState = 'available' | 'partial' | 'unavailable' | 'failed';

export interface SavedAnalyticsSummary {
  id: string;
  name: string;
  kind: SavedAnalyticsKind;
  status: 'active' | 'archived';
  currentVersionNumber: number;
  createdBy: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  snapshotCount: number;
  latestSnapshot: {
    id: string;
    state: SavedAnalyticsState;
    periodFrom: string;
    periodTo: string;
    dataCutoffAt: string;
    createdAt: string;
  } | null;
}

export interface SavedAnalyticsSnapshot {
  id: string;
  savedAnalysisId: string;
  analysisVersionId: string;
  sourceKind: SavedAnalyticsKind;
  sourceResultId: string;
  periodFrom: string;
  periodTo: string;
  timeZone: string;
  dataCutoffAt: string;
  state: SavedAnalyticsState;
  result: unknown;
  createdBy: string | null;
  createdAt: string;
}

function requiredName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 120) throw new Error('analytics_saved_name_invalid');
  return name;
}

function parseJson(value: string, code: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(code);
  }
}

async function loadSourceResult(
  db: D1Database,
  lineAccountId: string,
  sourceKind: SavedAnalyticsKind,
  sourceResultId: string,
): Promise<{
  definition: unknown;
  resultJson: string;
  periodFrom: string;
  periodTo: string;
  timeZone: string;
  dataCutoffAt: string;
  state: SavedAnalyticsState;
}> {
  if (sourceKind === 'cross') {
    const row = await db.prepare(
      `SELECT query_json, result_json, period_from, period_to, time_zone,
              data_cutoff_at, state
         FROM analytics_cross_runs
        WHERE id = ? AND line_account_id = ?
          AND state IN ('available','partial','unavailable','failed')`,
    ).bind(sourceResultId, lineAccountId).first<{
      query_json: string; result_json: string; period_from: string; period_to: string;
      time_zone: string; data_cutoff_at: string; state: SavedAnalyticsState;
    }>();
    if (!row) throw new Error('analytics_saved_source_not_found');
    return {
      definition: parseJson(row.query_json, 'analytics_saved_definition_invalid'),
      resultJson: row.result_json,
      periodFrom: row.period_from,
      periodTo: row.period_to,
      timeZone: row.time_zone,
      dataCutoffAt: row.data_cutoff_at,
      state: row.state,
    };
  }

  const row = await db.prepare(
    `SELECT r.funnel_id, r.funnel_version_id, r.result_json, r.cohort_from,
            r.cohort_to, r.time_zone, r.data_cutoff_at, r.state,
            v.version_number, v.window_days, v.steps_json, v.segment_json,
            v.comparison_groups_json
       FROM analytics_funnel_runs r
       LEFT JOIN analytics_funnel_versions v
         ON v.id = r.funnel_version_id AND v.line_account_id = r.line_account_id
      WHERE r.id = ? AND r.line_account_id = ?
        AND r.state IN ('available','partial','unavailable','failed')`,
  ).bind(sourceResultId, lineAccountId).first<{
    funnel_id: string; funnel_version_id: string | null; result_json: string;
    cohort_from: string; cohort_to: string; time_zone: string; data_cutoff_at: string;
    state: SavedAnalyticsState; version_number: number | null; window_days: number | null;
    steps_json: string | null; segment_json: string | null; comparison_groups_json: string | null;
  }>();
  if (!row) throw new Error('analytics_saved_source_not_found');
  return {
    definition: {
      funnelId: row.funnel_id,
      funnelVersionId: row.funnel_version_id,
      versionNumber: row.version_number,
      windowDays: row.window_days,
      steps: row.steps_json ? parseJson(row.steps_json, 'analytics_saved_definition_invalid') : null,
      segment: row.segment_json ? parseJson(row.segment_json, 'analytics_saved_definition_invalid') : null,
      comparisonGroups: row.comparison_groups_json
        ? parseJson(row.comparison_groups_json, 'analytics_saved_definition_invalid')
        : [],
    },
    resultJson: row.result_json,
    periodFrom: row.cohort_from,
    periodTo: row.cohort_to,
    timeZone: row.time_zone,
    dataCutoffAt: row.data_cutoff_at,
    state: row.state,
  };
}

export async function createSavedAnalyticsFromResult(
  db: D1Database,
  input: {
    lineAccountId: string;
    name: string;
    sourceKind: SavedAnalyticsKind;
    sourceResultId: string;
    createdBy?: string | null;
    createdByName: string;
    createdAt: string;
  },
): Promise<{ id: string; versionId: string; snapshotId: string }> {
  const name = requiredName(input.name);
  if (!['cross', 'funnel'].includes(input.sourceKind)) {
    throw new Error('analytics_saved_kind_invalid');
  }
  const source = await loadSourceResult(
    db, input.lineAccountId, input.sourceKind, input.sourceResultId,
  );
  parseJson(source.resultJson, 'analytics_saved_result_invalid');
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT INTO analytics_saved_analyses (
         id, line_account_id, name, kind, current_version_number, status,
         created_by, created_by_name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 1, 'active', ?, ?, ?, ?)`,
    ).bind(
      id, input.lineAccountId, name, input.sourceKind, input.createdBy ?? null,
      input.createdByName.trim() || '不明', input.createdAt, input.createdAt,
    ),
    db.prepare(
      `INSERT INTO analytics_saved_analysis_versions (
         id, saved_analysis_id, line_account_id, version_number,
         definition_json, created_by, created_at
       ) VALUES (?, ?, ?, 1, ?, ?, ?)`,
    ).bind(
      versionId, id, input.lineAccountId, JSON.stringify(source.definition),
      input.createdBy ?? null, input.createdAt,
    ),
    db.prepare(
      `INSERT INTO analytics_saved_analysis_snapshots (
         id, saved_analysis_id, analysis_version_id, line_account_id,
         source_kind, source_result_id, period_from, period_to, time_zone,
         data_cutoff_at, state, result_json, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      snapshotId, id, versionId, input.lineAccountId, input.sourceKind,
      input.sourceResultId, source.periodFrom, source.periodTo, source.timeZone,
      source.dataCutoffAt, source.state, source.resultJson,
      input.createdBy ?? null, input.createdAt,
    ),
  ]);
  return { id, versionId, snapshotId };
}

export async function getSavedAnalytics(
  db: D1Database,
  lineAccountId: string,
): Promise<SavedAnalyticsSummary[]> {
  const rows = await db.prepare(
    `SELECT a.*,
            (SELECT COUNT(*) FROM analytics_saved_analysis_snapshots s
              WHERE s.saved_analysis_id = a.id) AS snapshot_count,
            s.id AS snapshot_id, s.state AS snapshot_state,
            s.period_from AS snapshot_period_from, s.period_to AS snapshot_period_to,
            s.data_cutoff_at AS snapshot_data_cutoff_at,
            s.created_at AS snapshot_created_at
       FROM analytics_saved_analyses a
       LEFT JOIN analytics_saved_analysis_snapshots s ON s.id = (
         SELECT s2.id FROM analytics_saved_analysis_snapshots s2
          WHERE s2.saved_analysis_id = a.id
          ORDER BY s2.created_at DESC, s2.id DESC LIMIT 1
       )
      WHERE a.line_account_id = ? AND a.status = 'active'
      ORDER BY a.updated_at DESC, a.id DESC`,
  ).bind(lineAccountId).all<{
    id: string; name: string; kind: SavedAnalyticsKind; status: 'active' | 'archived';
    current_version_number: number; created_by: string | null; created_by_name: string;
    created_at: string; updated_at: string; snapshot_count: number;
    snapshot_id: string | null; snapshot_state: SavedAnalyticsState | null;
    snapshot_period_from: string | null; snapshot_period_to: string | null;
    snapshot_data_cutoff_at: string | null; snapshot_created_at: string | null;
  }>();
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    currentVersionNumber: row.current_version_number,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    snapshotCount: Number(row.snapshot_count),
    latestSnapshot: row.snapshot_id ? {
      id: row.snapshot_id,
      state: row.snapshot_state!,
      periodFrom: row.snapshot_period_from!,
      periodTo: row.snapshot_period_to!,
      dataCutoffAt: row.snapshot_data_cutoff_at!,
      createdAt: row.snapshot_created_at!,
    } : null,
  }));
}

export async function getSavedAnalyticsSnapshots(
  db: D1Database,
  lineAccountId: string,
  savedAnalysisId: string,
): Promise<SavedAnalyticsSnapshot[] | null> {
  const analysis = await db.prepare(
    `SELECT id FROM analytics_saved_analyses WHERE id = ? AND line_account_id = ?`,
  ).bind(savedAnalysisId, lineAccountId).first<{ id: string }>();
  if (!analysis) return null;
  const rows = await db.prepare(
    `SELECT * FROM analytics_saved_analysis_snapshots
      WHERE saved_analysis_id = ? AND line_account_id = ?
      ORDER BY created_at DESC, id DESC`,
  ).bind(savedAnalysisId, lineAccountId).all<{
    id: string; saved_analysis_id: string; analysis_version_id: string;
    source_kind: SavedAnalyticsKind; source_result_id: string;
    period_from: string; period_to: string; time_zone: string; data_cutoff_at: string;
    state: SavedAnalyticsState; result_json: string; created_by: string | null; created_at: string;
  }>();
  return rows.results.map((row) => ({
    id: row.id,
    savedAnalysisId: row.saved_analysis_id,
    analysisVersionId: row.analysis_version_id,
    sourceKind: row.source_kind,
    sourceResultId: row.source_result_id,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    timeZone: row.time_zone,
    dataCutoffAt: row.data_cutoff_at,
    state: row.state,
    result: parseJson(row.result_json, 'analytics_saved_result_invalid'),
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}
