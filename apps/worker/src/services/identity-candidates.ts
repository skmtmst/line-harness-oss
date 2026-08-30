import type {
  DecideIdentityCandidateRequest,
  IdentityCandidateDetail,
  IdentityCandidateEvidence,
  IdentityCandidateImpactMetric,
  IdentityCandidateKind,
  IdentityCandidateList,
  IdentityCandidateListItem,
  IdentityCandidateStatus,
  IdentityCandidateSubject,
  IdentityConfidenceLabel,
  IdentityReprocessMode,
} from '@line-crm/shared';

type CandidateRow = {
  id: string;
  tenant_id: string;
  kind: IdentityCandidateKind;
  status: IdentityCandidateStatus;
  version: number;
  confidence_score: number;
  detector_version: string;
  left_subject_kind: 'friend' | 'ec_event';
  left_subject_id: string;
  left_line_account_id: string;
  left_shop_key: string | null;
  left_snapshot_json: string;
  right_subject_kind: 'friend';
  right_subject_id: string;
  right_line_account_id: string;
  right_shop_key: string | null;
  right_snapshot_json: string;
  source_key: string | null;
  external_customer_id: string | null;
  evidence_fingerprint: string;
  evidence_json: string;
  impact_json: string;
  detected_at: string;
  reviewed_at: string | null;
};

type DecisionRow = {
  id: string;
  from_status: IdentityCandidateStatus;
  to_status: IdentityCandidateStatus;
  actor_name: string;
  reason: string;
  decided_at: string;
  reprocess_scope_json: string | null;
};

export type IdentityCandidateDraft = {
  id?: string;
  tenantId: string;
  kind: IdentityCandidateKind;
  confidenceScore: number;
  detectorVersion: string;
  left: IdentityCandidateSubject;
  right: IdentityCandidateSubject & { kind: 'friend' };
  evidence: IdentityCandidateEvidence[];
  impact: IdentityCandidateImpactMetric[];
  detectedAt: string;
  sourceKey?: string;
  externalCustomerId?: string;
};

export type IdentityActor = { id: string; name: string; tenantId: string };

export class IdentityCandidateError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 422,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const DECIDABLE = new Set<IdentityCandidateStatus>(['pending', 'deferred', 'invalidated']);
const REPROCESS_MODES = new Set<IdentityReprocessMode>([
  'future_only',
  'analytics_snapshot',
  'non_delivery_actions',
]);

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function confidenceLabel(score: number): IdentityConfidenceLabel {
  if (score >= 90) return 'very_high';
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function isoNow(): string {
  return new Date().toISOString();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalDraft(draft: IdentityCandidateDraft): IdentityCandidateDraft {
  if (draft.kind !== 'friend_duplicate' || draft.left.id < draft.right.id) return draft;
  return {
    ...draft,
    left: { ...draft.right, kind: 'friend' },
    right: { ...draft.left, kind: 'friend' },
  };
}

const MASK_MARKER = /[*\u2022\u25cf\u2026]/;
const RAW_EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
const RAW_PHONE = /(?:\+?\d[\s().-]*){10,15}/;
const SENSITIVE_LABEL = /(e-?mail|mail|\u30e1\u30fc\u30eb|phone|tel|\u96fb\u8a71)/i;

function containsRawSensitiveValue(label: string, preview: string | null): boolean {
  if (!preview) return false;
  if (RAW_EMAIL.test(preview) && !MASK_MARKER.test(preview)) return true;
  if (RAW_PHONE.test(preview) && !MASK_MARKER.test(preview)) return true;
  if (!SENSITIVE_LABEL.test(label)) return false;
  const digits = preview.replace(/\D/g, '');
  return digits.length >= 7 && !MASK_MARKER.test(preview);
}

function assertMaskedDraft(draft: IdentityCandidateDraft): void {
  for (const subject of [draft.left, draft.right]) {
    if (containsRawSensitiveValue('detail', subject.detail)) {
      throw new IdentityCandidateError(422, 'UNMASKED_IDENTITY_VALUE', '\u30e1\u30fc\u30eb\u30a2\u30c9\u30ec\u30b9\u3084\u96fb\u8a71\u756a\u53f7\u306f\u30de\u30b9\u30af\u3057\u3066\u304f\u3060\u3055\u3044');
    }
    for (const attribute of subject.attributes) {
      if (containsRawSensitiveValue(attribute.label, attribute.valuePreview)) {
        throw new IdentityCandidateError(422, 'UNMASKED_IDENTITY_VALUE', '\u30e1\u30fc\u30eb\u30a2\u30c9\u30ec\u30b9\u3084\u96fb\u8a71\u756a\u53f7\u306f\u30de\u30b9\u30af\u3057\u3066\u304f\u3060\u3055\u3044');
      }
    }
  }
  for (const evidence of draft.evidence) {
    if (containsRawSensitiveValue(`${evidence.key} ${evidence.label}`, evidence.valuePreview)) {
      throw new IdentityCandidateError(422, 'UNMASKED_IDENTITY_VALUE', '\u30e1\u30fc\u30eb\u30a2\u30c9\u30ec\u30b9\u3084\u96fb\u8a71\u756a\u53f7\u306f\u30de\u30b9\u30af\u3057\u3066\u304f\u3060\u3055\u3044');
    }
  }
}

async function assertLineAccountTenant(
  db: D1Database,
  tenantId: string,
  lineAccountId: string | null,
): Promise<void> {
  if (!lineAccountId) {
    throw new IdentityCandidateError(422, 'ACCOUNT_REQUIRED', 'LINEアカウントが確定していません');
  }
  const account = await db.prepare(
    `SELECT id FROM line_accounts
      WHERE id = ? AND COALESCE(tenant_id, '00000000-0000-4000-8000-000000000001') = ?`,
  ).bind(lineAccountId, tenantId).first<{ id: string }>();
  if (!account) {
    throw new IdentityCandidateError(403, 'ACCOUNT_SCOPE_MISMATCH', '別の統括の候補は扱えません');
  }
}

async function assertFriendScope(
  db: D1Database,
  tenantId: string,
  friendId: string,
  expectedAccountId: string | null,
): Promise<void> {
  const friend = await db.prepare(
    `SELECT f.id, f.line_account_id
       FROM friends f
       JOIN line_accounts la ON la.id = f.line_account_id
      WHERE f.id = ?
        AND COALESCE(la.tenant_id, '00000000-0000-4000-8000-000000000001') = ?`,
  ).bind(friendId, tenantId).first<{ id: string; line_account_id: string }>();
  if (!friend || friend.line_account_id !== expectedAccountId) {
    throw new IdentityCandidateError(403, 'FRIEND_SCOPE_MISMATCH', '候補の友だちの所属を確認できません');
  }
}

/**
 * 候補検出器が使う追記口。公開HTTP APIにはせず、検出元が安全なマスク済み
 * snapshotと根拠を渡す。根拠が変わった組は同じcandidate IDのまま再確認へ戻す。
 */
export async function upsertIdentityCandidate(
  db: D1Database,
  rawDraft: IdentityCandidateDraft,
): Promise<string> {
  const draft = canonicalDraft(rawDraft);
  if (!Number.isInteger(draft.confidenceScore) || draft.confidenceScore < 0 || draft.confidenceScore > 100) {
    throw new IdentityCandidateError(422, 'INVALID_CONFIDENCE', '確からしさは0から100で指定してください');
  }
  if (draft.evidence.length === 0) {
    throw new IdentityCandidateError(422, 'EVIDENCE_REQUIRED', '根拠の無い候補は作れません');
  }
  assertMaskedDraft(draft);
  await assertLineAccountTenant(db, draft.tenantId, draft.left.lineAccountId);
  await assertLineAccountTenant(db, draft.tenantId, draft.right.lineAccountId);
  await assertFriendScope(db, draft.tenantId, draft.right.id, draft.right.lineAccountId);
  if (draft.kind === 'friend_duplicate') {
    if (draft.left.kind !== 'friend') {
      throw new IdentityCandidateError(422, 'INVALID_SUBJECT_PAIR', '友だち同士の候補ではありません');
    }
    await assertFriendScope(db, draft.tenantId, draft.left.id, draft.left.lineAccountId);
  } else {
    if (draft.left.kind !== 'ec_event' || !draft.left.shopKey || !draft.sourceKey || !draft.externalCustomerId) {
      throw new IdentityCandidateError(422, 'EC_SCOPE_REQUIRED', 'ECの接続元・店舗・会員を確定してください');
    }
    if (draft.left.lineAccountId !== draft.right.lineAccountId) {
      throw new IdentityCandidateError(422, 'EC_ACCOUNT_MISMATCH', '別のLINEアカウントへ自動で結び付けられません');
    }
    const event = await db.prepare(
      'SELECT id, source, customer_id, line_account_id FROM ec_events WHERE id = ?',
    ).bind(draft.left.id).first<{
      id: string;
      source: string;
      customer_id: string | null;
      line_account_id: string | null;
    }>();
    if (
      !event
      || event.source !== draft.sourceKey
      || event.customer_id !== draft.externalCustomerId
      || event.line_account_id !== draft.left.lineAccountId
    ) {
      throw new IdentityCandidateError(422, 'EC_EVENT_MISMATCH', 'ECのできごとと会員情報が一致しません');
    }
  }

  const fingerprint = await sha256(JSON.stringify(draft.evidence));
  const existing = await db.prepare(
    `SELECT id, status, version, evidence_fingerprint
       FROM identity_candidates
      WHERE tenant_id = ? AND kind = ?
        AND left_subject_kind = ? AND left_subject_id = ?
        AND right_subject_kind = 'friend' AND right_subject_id = ?`,
  ).bind(draft.tenantId, draft.kind, draft.left.kind, draft.left.id, draft.right.id)
    .first<{ id: string; status: IdentityCandidateStatus; version: number; evidence_fingerprint: string }>();
  const now = isoNow();
  if (!existing) {
    const id = draft.id ?? crypto.randomUUID();
    await db.prepare(
      `INSERT INTO identity_candidates (
        id, tenant_id, kind, status, version, confidence_score, detector_version,
        left_subject_kind, left_subject_id, left_line_account_id, left_shop_key, left_snapshot_json,
        right_subject_kind, right_subject_id, right_line_account_id, right_shop_key, right_snapshot_json,
        source_key, external_customer_id, evidence_fingerprint, evidence_json, impact_json,
        detected_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', 1, ?, ?, ?, ?, ?, ?, ?, 'friend', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, draft.tenantId, draft.kind, draft.confidenceScore, draft.detectorVersion,
      draft.left.kind, draft.left.id, draft.left.lineAccountId, draft.left.shopKey,
      JSON.stringify(draft.left), draft.right.id, draft.right.lineAccountId, draft.right.shopKey,
      JSON.stringify(draft.right), draft.sourceKey ?? null, draft.externalCustomerId ?? null,
      fingerprint, JSON.stringify(draft.evidence), JSON.stringify(draft.impact),
      draft.detectedAt, now, now,
    ).run();
    return id;
  }

  if (existing.evidence_fingerprint === fingerprint) {
    await db.prepare(
      `UPDATE identity_candidates
          SET confidence_score = ?, detector_version = ?, left_snapshot_json = ?,
              right_snapshot_json = ?, impact_json = ?, detected_at = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?`,
    ).bind(
      draft.confidenceScore, draft.detectorVersion, JSON.stringify(draft.left),
      JSON.stringify(draft.right), JSON.stringify(draft.impact), draft.detectedAt, now,
      existing.id, draft.tenantId,
    ).run();
    return existing.id;
  }

  const nextVersion = existing.version + 1;
  await db.batch([
    db.prepare(
      `INSERT INTO identity_candidate_decisions (
        id, candidate_id, candidate_version, from_status, to_status, actor_staff_id,
        actor_name, reason, evidence_fingerprint, impact_snapshot_json, decided_at
      ) VALUES (?, ?, ?, ?, 'invalidated', NULL, 'システム', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), existing.id, nextVersion, existing.status,
      '根拠が変わったため、もう一度確認してください', fingerprint,
      JSON.stringify(draft.impact), now,
    ),
    db.prepare(
      `UPDATE identity_candidates
          SET status = 'invalidated', version = ?, confidence_score = ?, detector_version = ?,
              left_snapshot_json = ?, right_snapshot_json = ?, evidence_fingerprint = ?,
              evidence_json = ?, impact_json = ?, detected_at = ?, reviewed_by = NULL,
              reviewed_at = NULL, reason = NULL, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND version = ?`,
    ).bind(
      nextVersion, draft.confidenceScore, draft.detectorVersion,
      JSON.stringify(draft.left), JSON.stringify(draft.right), fingerprint,
      JSON.stringify(draft.evidence), JSON.stringify(draft.impact), draft.detectedAt, now,
      existing.id, draft.tenantId, existing.version,
    ),
  ]);
  return existing.id;
}

async function findRow(db: D1Database, tenantId: string, id: string): Promise<CandidateRow> {
  const row = await db.prepare(
    'SELECT * FROM identity_candidates WHERE id = ? AND tenant_id = ?',
  ).bind(id, tenantId).first<CandidateRow>();
  if (!row) throw new IdentityCandidateError(404, 'CANDIDATE_NOT_FOUND', '候補が見つかりません');
  return row;
}

async function hasActiveLink(db: D1Database, row: CandidateRow): Promise<boolean> {
  const table = row.kind === 'friend_duplicate' ? 'friend_identity_links' : 'ec_identity_links';
  const found = await db.prepare(
    `SELECT 1 AS found FROM ${table} WHERE candidate_id = ? AND unlinked_at IS NULL LIMIT 1`,
  ).bind(row.id).first<{ found: number }>();
  return Boolean(found);
}

function listItem(row: CandidateRow): IdentityCandidateListItem {
  const evidence = parseJson<IdentityCandidateEvidence[]>(row.evidence_json, []);
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    version: row.version,
    confidence: { score: row.confidence_score, label: confidenceLabel(row.confidence_score) },
    left: parseJson<IdentityCandidateSubject>(row.left_snapshot_json, {
      kind: row.left_subject_kind, id: row.left_subject_id, label: '表示できません', detail: null,
      lineAccountId: row.left_line_account_id, lineAccountName: null,
      shopKey: row.left_shop_key, attributes: [],
    }),
    right: parseJson<IdentityCandidateSubject>(row.right_snapshot_json, {
      kind: 'friend', id: row.right_subject_id, label: '表示できません', detail: null,
      lineAccountId: row.right_line_account_id, lineAccountName: null,
      shopKey: row.right_shop_key, attributes: [],
    }),
    evidenceSummary: evidence.map((item) => item.label),
    detectedAt: row.detected_at,
    reviewedAt: row.reviewed_at,
  };
}

export async function listIdentityCandidates(
  db: D1Database,
  input: {
    tenantId: string;
    kind: IdentityCandidateKind;
    status: IdentityCandidateStatus;
    allowedAccountIds: string[];
    limit: number;
    offset: number;
  },
): Promise<IdentityCandidateList> {
  if (input.allowedAccountIds.length === 0) {
    return { items: [], total: 0, limit: input.limit, offset: input.offset };
  }
  const placeholders = input.allowedAccountIds.map(() => '?').join(', ');
  const scopeSql = `left_line_account_id IN (${placeholders}) AND right_line_account_id IN (${placeholders})`;
  const bindings = [
    input.tenantId, input.kind, input.status,
    ...input.allowedAccountIds, ...input.allowedAccountIds,
  ];
  const [rows, count] = await Promise.all([
    db.prepare(
      `SELECT * FROM identity_candidates
        WHERE tenant_id = ? AND kind = ? AND status = ? AND ${scopeSql}
        ORDER BY detected_at DESC, id ASC LIMIT ? OFFSET ?`,
    ).bind(...bindings, input.limit, input.offset).all<CandidateRow>(),
    db.prepare(
      `SELECT COUNT(*) AS count FROM identity_candidates
        WHERE tenant_id = ? AND kind = ? AND status = ? AND ${scopeSql}`,
    ).bind(...bindings).first<{ count: number }>(),
  ]);
  return {
    items: rows.results.map(listItem),
    total: count?.count ?? 0,
    limit: input.limit,
    offset: input.offset,
  };
}

export async function getIdentityCandidate(
  db: D1Database,
  tenantId: string,
  id: string,
): Promise<IdentityCandidateDetail> {
  const row = await findRow(db, tenantId, id);
  const historyRows = await db.prepare(
    `SELECT id, from_status, to_status, actor_name, reason, decided_at, reprocess_scope_json
       FROM identity_candidate_decisions WHERE candidate_id = ?
      ORDER BY candidate_version DESC`,
  ).bind(id).all<DecisionRow>();
  const activeLink = await hasActiveLink(db, row);
  const summary = listItem(row);
  return {
    id: summary.id,
    kind: summary.kind,
    status: summary.status,
    version: summary.version,
    confidence: summary.confidence,
    left: summary.left,
    right: summary.right,
    evidence: parseJson<IdentityCandidateEvidence[]>(row.evidence_json, []),
    impact: parseJson<IdentityCandidateImpactMetric[]>(row.impact_json, []),
    history: historyRows.results.map((item) => ({
      id: item.id,
      fromStatus: item.from_status,
      toStatus: item.to_status,
      actorName: item.actor_name,
      reason: item.reason,
      decidedAt: item.decided_at,
      reprocessMode: parseJson<{ mode?: IdentityReprocessMode } | null>(
        item.reprocess_scope_json ?? 'null', null,
      )?.mode ?? null,
    })),
    detectedAt: summary.detectedAt,
    reviewedAt: summary.reviewedAt,
    canDecide: DECIDABLE.has(row.status) && !activeLink,
    canUndo: activeLink || row.status === 'different' || row.status === 'deferred',
    undoNote: activeLink
      ? '元の記録を消さず、現在の結び付けだけを解除できます。'
      : '判定を取り消すと、根拠を確認する候補へ戻ります。',
  };
}

function validateReprocess(
  row: CandidateRow,
  request: DecideIdentityCandidateRequest,
): string | null {
  if (row.kind !== 'ec_member') {
    if (request.reprocess) {
      throw new IdentityCandidateError(422, 'REPROCESS_NOT_ALLOWED', '友だち同士の判定に再処理は指定できません');
    }
    return null;
  }
  if (request.decision !== 'linked') {
    if (request.reprocess) {
      throw new IdentityCandidateError(422, 'REPROCESS_NOT_ALLOWED', '結び付ける場合だけ再処理を指定できます');
    }
    return null;
  }
  const scope = request.reprocess ?? { mode: 'future_only' as const, from: null, to: null };
  if (!REPROCESS_MODES.has(scope.mode)) {
    throw new IdentityCandidateError(422, 'INVALID_REPROCESS_MODE', '再処理の範囲が正しくありません');
  }
  if (scope.mode === 'future_only' && (scope.from || scope.to)) {
    throw new IdentityCandidateError(422, 'INVALID_REPROCESS_RANGE', '今後だけの場合は過去の期間を指定しません');
  }
  if (scope.from && scope.to && scope.from > scope.to) {
    throw new IdentityCandidateError(422, 'INVALID_REPROCESS_RANGE', '再処理の開始と終了が逆です');
  }
  return JSON.stringify(scope);
}

async function linkedUserId(db: D1Database, row: CandidateRow): Promise<string> {
  const friends = await db.prepare(
    `SELECT id, user_id, display_name FROM friends WHERE id IN (?, ?) ORDER BY id`,
  ).bind(row.left_subject_id, row.right_subject_id)
    .all<{ id: string; user_id: string | null; display_name: string | null }>();
  if (friends.results.length !== 2) {
    throw new IdentityCandidateError(422, 'FRIEND_NOT_FOUND', '結び付ける友だちを確認できません');
  }
  const userIds = [...new Set(friends.results.map((item) => item.user_id).filter(Boolean))] as string[];
  if (userIds.length > 1) {
    throw new IdentityCandidateError(
      409, 'IDENTITY_USER_CONFLICT',
      'それぞれが別の統合ユーザーへ結び付いています。先に現在の結び付きを確認してください',
    );
  }
  return userIds[0] ?? crypto.randomUUID();
}

export async function decideIdentityCandidate(
  db: D1Database,
  actor: IdentityActor,
  id: string,
  request: DecideIdentityCandidateRequest,
): Promise<IdentityCandidateDetail> {
  const row = await findRow(db, actor.tenantId, id);
  if (row.version !== request.expectedVersion) {
    throw new IdentityCandidateError(409, 'STALE_CANDIDATE', '別の人が先に判定しました。最新の状態を読み直してください');
  }
  if (!DECIDABLE.has(row.status) || await hasActiveLink(db, row)) {
    throw new IdentityCandidateError(409, 'CANDIDATE_ALREADY_DECIDED', 'この候補はすでに判定されています');
  }
  const reason = request.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new IdentityCandidateError(422, 'REASON_REQUIRED', '理由を3文字以上500文字以内で入力してください');
  }
  const reprocessJson = validateReprocess(row, request);
  const now = isoNow();
  const nextVersion = row.version + 1;
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO identity_candidate_decisions (
        id, candidate_id, candidate_version, from_status, to_status, actor_staff_id,
        actor_name, reason, evidence_fingerprint, impact_snapshot_json,
        reprocess_scope_json, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), row.id, nextVersion, row.status, request.decision,
      actor.id, actor.name, reason, row.evidence_fingerprint, row.impact_json,
      reprocessJson, now,
    ),
  ];

  if (request.decision === 'linked' && row.kind === 'friend_duplicate') {
    const userId = await linkedUserId(db, row);
    const left = parseJson<IdentityCandidateSubject>(row.left_snapshot_json, null as never);
    const right = parseJson<IdentityCandidateSubject>(row.right_snapshot_json, null as never);
    const displayName = right?.label || left?.label || '統合ユーザー';
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO users (
          id, tenant_id, status, display_name, primary_display_name, revision,
          created_by, created_at, updated_at
        ) VALUES (?, ?, 'active', ?, ?, 1, ?, ?, ?)`,
      ).bind(userId, row.tenant_id, displayName, displayName, actor.id, now, now),
    );
    for (const friendId of [row.left_subject_id, row.right_subject_id]) {
      statements.push(
        db.prepare(
          `INSERT INTO friend_identity_links (
            id, tenant_id, candidate_id, user_id, friend_id, link_method,
            evidence_snapshot_json, confidence_score, linked_by, linked_at
          )
          SELECT ?, ?, ?, ?, ?, 'operator_review', ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM friend_identity_links WHERE friend_id = ? AND unlinked_at IS NULL
          )`,
        ).bind(
          crypto.randomUUID(), row.tenant_id, row.id, userId, friendId,
          row.evidence_json, row.confidence_score, actor.id, now, friendId,
        ),
      );
      statements.push(
        db.prepare('UPDATE friends SET user_id = ?, updated_at = ? WHERE id = ?')
          .bind(userId, now, friendId),
      );
    }
  }

  if (request.decision === 'linked' && row.kind === 'ec_member') {
    if (!row.source_key || !row.left_shop_key || !row.external_customer_id) {
      throw new IdentityCandidateError(422, 'EC_SCOPE_REQUIRED', 'EC会員の所属を確認できません');
    }
    const existing = await db.prepare(
      `SELECT friend_id FROM ec_identity_links
        WHERE tenant_id = ? AND source_key = ? AND shop_key = ?
          AND external_customer_id = ? AND unlinked_at IS NULL`,
    ).bind(row.tenant_id, row.source_key, row.left_shop_key, row.external_customer_id)
      .first<{ friend_id: string }>();
    if (existing && existing.friend_id !== row.right_subject_id) {
      throw new IdentityCandidateError(
        409, 'EC_CUSTOMER_ALREADY_LINKED',
        'このEC会員は別の友だちへ結び付いています。現在の結び付きを確認してください',
      );
    }
    if (!existing) {
      statements.push(
        db.prepare(
          `INSERT INTO ec_identity_links (
            id, tenant_id, candidate_id, source_key, shop_key, external_customer_id,
            line_account_id, friend_id, linked_by, linked_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(), row.tenant_id, row.id, row.source_key, row.left_shop_key,
          row.external_customer_id, row.right_line_account_id, row.right_subject_id,
          actor.id, now,
        ),
      );
    }
  }

  statements.push(
    db.prepare(
      `UPDATE identity_candidates
          SET status = ?, version = ?, reviewed_by = ?, reviewed_at = ?, reason = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND version = ?`,
    ).bind(
      request.decision, nextVersion, actor.id, now, reason, now,
      row.id, row.tenant_id, row.version,
    ),
  );
  await db.batch(statements);
  return getIdentityCandidate(db, actor.tenantId, id);
}

export async function undoIdentityCandidate(
  db: D1Database,
  actor: IdentityActor,
  id: string,
  request: { expectedVersion: number; reason: string },
): Promise<IdentityCandidateDetail> {
  const row = await findRow(db, actor.tenantId, id);
  if (row.version !== request.expectedVersion) {
    throw new IdentityCandidateError(409, 'STALE_CANDIDATE', '別の人が先に変更しました。最新の状態を読み直してください');
  }
  const activeLink = await hasActiveLink(db, row);
  if (!activeLink && row.status !== 'different' && row.status !== 'deferred') {
    throw new IdentityCandidateError(409, 'NOTHING_TO_UNDO', '取り消せる判定がありません');
  }
  const reason = request.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new IdentityCandidateError(422, 'REASON_REQUIRED', '理由を3文字以上500文字以内で入力してください');
  }
  const now = isoNow();
  const nextVersion = row.version + 1;
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO identity_candidate_decisions (
        id, candidate_id, candidate_version, from_status, to_status, actor_staff_id,
        actor_name, reason, evidence_fingerprint, impact_snapshot_json, decided_at
      ) VALUES (?, ?, ?, ?, 'invalidated', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), row.id, nextVersion, row.status, actor.id, actor.name,
      reason, row.evidence_fingerprint, row.impact_json, now,
    ),
  ];
  if (row.kind === 'friend_duplicate') {
    statements.push(
      db.prepare(
        `UPDATE friend_identity_links
            SET unlinked_by = ?, unlinked_at = ?, unlink_reason = ?
          WHERE candidate_id = ? AND unlinked_at IS NULL`,
      ).bind(actor.id, now, reason, row.id),
    );
    for (const friendId of [row.left_subject_id, row.right_subject_id]) {
      statements.push(
        db.prepare(
          `UPDATE friends
              SET user_id = (
                SELECT user_id FROM friend_identity_links
                 WHERE friend_id = ? AND unlinked_at IS NULL
                 ORDER BY linked_at DESC LIMIT 1
              ), updated_at = ?
            WHERE id = ?`,
        ).bind(friendId, now, friendId),
      );
    }
  } else {
    statements.push(
      db.prepare(
        `UPDATE ec_identity_links
            SET unlinked_by = ?, unlinked_at = ?, unlink_reason = ?
          WHERE candidate_id = ? AND unlinked_at IS NULL`,
      ).bind(actor.id, now, reason, row.id),
    );
  }
  statements.push(
    db.prepare(
      `UPDATE identity_candidates
          SET status = 'invalidated', version = ?, reviewed_by = ?, reviewed_at = ?,
              reason = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND version = ?`,
    ).bind(nextVersion, actor.id, now, reason, now, row.id, row.tenant_id, row.version),
  );
  await db.batch(statements);
  return getIdentityCandidate(db, actor.tenantId, id);
}

export async function candidateAccountIds(
  db: D1Database,
  tenantId: string,
  id: string,
): Promise<string[]> {
  const row = await findRow(db, tenantId, id);
  return [...new Set([row.left_line_account_id, row.right_line_account_id])];
}
