export type AffiliateBankAccountType = 'ordinary' | 'checking';

export interface AffiliateBankProfile {
  affiliateId: string;
  lineAccountId: string;
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: AffiliateBankAccountType;
  accountLast4: string;
  accountHolderName: string;
  version: number;
  updatedAt: string;
}

type BankProfileRow = {
  affiliate_id: string;
  line_account_id: string;
  bank_code: string;
  bank_name: string;
  branch_code: string;
  branch_name: string;
  account_type: AffiliateBankAccountType;
  account_number_encrypted: string;
  account_last4: string;
  account_holder_name: string;
  version: number;
  last_idempotency_key: string;
  last_request_fingerprint: string;
  updated_at: string;
};

function bankProfile(row: BankProfileRow): AffiliateBankProfile {
  return {
    affiliateId: row.affiliate_id,
    lineAccountId: row.line_account_id,
    bankCode: row.bank_code,
    bankName: row.bank_name,
    branchCode: row.branch_code,
    branchName: row.branch_name,
    accountType: row.account_type,
    accountLast4: row.account_last4,
    accountHolderName: row.account_holder_name,
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
}

export async function getAffiliateBankProfile(
  db: D1Database,
  input: { tenantId: string; lineAccountId: string; affiliateId: string },
): Promise<AffiliateBankProfile | null> {
  const row = await db.prepare(
    `SELECT * FROM affiliate_bank_profiles
      WHERE organization_id = ? AND line_account_id = ? AND affiliate_id = ?`,
  ).bind(input.tenantId, input.lineAccountId, input.affiliateId).first<BankProfileRow>();
  return row ? bankProfile(row) : null;
}

export type SaveAffiliateBankProfileResult =
  | { kind: 'created'; profile: AffiliateBankProfile }
  | { kind: 'updated'; profile: AffiliateBankProfile }
  | { kind: 'duplicate'; profile: AffiliateBankProfile }
  | { kind: 'changed' }
  | { kind: 'idempotency_conflict' };

export async function saveAffiliateBankProfile(
  db: D1Database,
  input: {
    tenantId: string;
    lineAccountId: string;
    affiliateId: string;
    bankCode: string;
    bankName: string;
    branchCode: string;
    branchName: string;
    accountType: AffiliateBankAccountType;
    encryptedAccountNumber: string;
    accountLast4: string;
    accountHolderName: string;
    accountFingerprint: string;
    expectedVersion: number;
    idempotencyKey: string;
    requestFingerprint: string;
    now?: string;
  },
): Promise<SaveAffiliateBankProfileResult> {
  const existing = await db.prepare(
    `SELECT * FROM affiliate_bank_profiles
      WHERE organization_id = ? AND line_account_id = ? AND affiliate_id = ?`,
  ).bind(input.tenantId, input.lineAccountId, input.affiliateId).first<BankProfileRow>();
  if (existing?.last_idempotency_key === input.idempotencyKey) {
    return existing.last_request_fingerprint === input.requestFingerprint
      ? { kind: 'duplicate', profile: bankProfile(existing) }
      : { kind: 'idempotency_conflict' };
  }
  if ((existing?.version ?? 0) !== input.expectedVersion) return { kind: 'changed' };

  const now = input.now ?? new Date().toISOString();
  if (!existing) {
    await db.prepare(
      `INSERT INTO affiliate_bank_profiles
         (affiliate_id, organization_id, line_account_id, bank_code, bank_name,
          branch_code, branch_name, account_type, account_number_encrypted,
          account_last4, account_holder_name, account_fingerprint, version,
          last_idempotency_key, last_request_fingerprint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    ).bind(
      input.affiliateId, input.tenantId, input.lineAccountId, input.bankCode,
      input.bankName, input.branchCode, input.branchName, input.accountType,
      input.encryptedAccountNumber, input.accountLast4, input.accountHolderName,
      input.accountFingerprint, input.idempotencyKey, input.requestFingerprint, now, now,
    ).run();
  } else {
    const changed = await db.prepare(
      `UPDATE affiliate_bank_profiles
          SET bank_code = ?, bank_name = ?, branch_code = ?, branch_name = ?,
              account_type = ?, account_number_encrypted = ?, account_last4 = ?,
              account_holder_name = ?, account_fingerprint = ?, version = version + 1,
              last_idempotency_key = ?, last_request_fingerprint = ?, updated_at = ?
        WHERE affiliate_id = ? AND organization_id = ? AND line_account_id = ? AND version = ?`,
    ).bind(
      input.bankCode, input.bankName, input.branchCode, input.branchName,
      input.accountType, input.encryptedAccountNumber, input.accountLast4,
      input.accountHolderName, input.accountFingerprint, input.idempotencyKey,
      input.requestFingerprint, now, input.affiliateId, input.tenantId,
      input.lineAccountId, input.expectedVersion,
    ).run();
    if (Number(changed.meta.changes ?? 0) !== 1) return { kind: 'changed' };
  }
  const profile = await getAffiliateBankProfile(db, input);
  if (!profile) throw new Error('affiliate bank profile was not saved');
  return { kind: existing ? 'updated' : 'created', profile };
}

export type EligibleRewardRow = {
  conversion_event_id: string;
  affiliate_id: string;
  affiliate_name: string;
  affiliate_code: string;
  offer_id: string | null;
  approved_at: string;
  reward_amount: number;
  bank_profile_version: number | null;
  calculation_id: string;
};

export interface AffiliateSettlementPreviewRow {
  affiliateId: string;
  affiliateName: string;
  code: string;
  amount: number;
  conversionCount: number;
  bankProfileRegistered: boolean;
}

export interface AffiliateAccountSettlementPreview {
  lineAccountId: string;
  periodFrom: string;
  periodTo: string;
  currency: 'JPY';
  totalAmount: number;
  conversionCount: number;
  affiliates: AffiliateSettlementPreviewRow[];
  previewVersion: string;
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function eligibleRewards(
  db: D1Database,
  input: { tenantId: string; lineAccountId: string; periodFrom: string; periodTo: string },
): Promise<EligibleRewardRow[]> {
  // 全体締めも承認時の版だけを使う。版が無い承認済み行は対象外にして
  // 安全に止める(現在値での再計算はしない)。版は承認時と移行で作られる。
  const result = await db.prepare(
    `SELECT ce.id AS conversion_event_id,
            a.id AS affiliate_id,
            a.name AS affiliate_name,
            a.code AS affiliate_code,
            calc.offer_id AS offer_id,
            ce.approved_at,
            calc.amount_minor AS reward_amount,
            bp.version AS bank_profile_version,
            calc.id AS calculation_id
       FROM conversion_events ce
       JOIN friends f ON f.id = ce.friend_id AND f.line_account_id = ?
       JOIN affiliates a
         ON a.tenant_id = ? AND a.line_account_id = ?
        AND (ce.affiliate_id = a.id OR (ce.affiliate_id IS NULL AND ce.affiliate_code = a.code))
       JOIN affiliate_reward_calculations calc
         ON calc.conversion_event_id = ce.id
        AND calc.formula IN ('rate', 'fixed')
       LEFT JOIN affiliate_bank_profiles bp
         ON bp.affiliate_id = a.id AND bp.organization_id = a.tenant_id
        AND bp.line_account_id = a.line_account_id
      WHERE COALESCE(ce.approval_status, 'pending') = 'approved'
        AND ce.approved_at IS NOT NULL
        AND ce.approved_at >= ? AND ce.approved_at <= ?
        AND julianday(ce.approved_at) <= julianday(?, '-' || COALESCE(a.hold_days, 0) || ' days')
        AND NOT EXISTS (
          SELECT 1 FROM affiliate_reward_entries re
           WHERE re.conversion_event_id = ce.id AND re.entry_type = 'credit'
        )
      ORDER BY a.id, ce.approved_at, ce.id`,
  ).bind(
    input.lineAccountId, input.tenantId, input.lineAccountId,
    input.periodFrom, input.periodTo, input.periodTo,
  ).all<EligibleRewardRow>();
  return result.results.filter((row) => Math.round(Number(row.reward_amount)) > 0);
}

/**
 * プレビュー版の算出。プレビュー表示と全体締めで同じ行集合から同じ版を
 * 作るための共通関数。締めはこの版の照合に使った行集合をそのまま明細へ
 * 書き込む(照合後に取り直さない = TOCTOU排除)。
 */
export async function accountPreviewVersion(rows: EligibleRewardRow[]): Promise<string> {
  const versionSource = rows.map((row) => [
    row.conversion_event_id,
    row.affiliate_id,
    Math.round(Number(row.reward_amount)),
    row.approved_at,
  ].join(':')).join('|');
  return sha256(versionSource);
}

export async function previewAffiliateAccountSettlement(
  db: D1Database,
  input: { tenantId: string; lineAccountId: string; periodFrom: string; periodTo: string },
): Promise<AffiliateAccountSettlementPreview> {
  const rows = await eligibleRewards(db, input);
  const grouped = new Map<string, AffiliateSettlementPreviewRow>();
  for (const row of rows) {
    const current = grouped.get(row.affiliate_id) ?? {
      affiliateId: row.affiliate_id,
      affiliateName: row.affiliate_name,
      code: row.affiliate_code,
      amount: 0,
      conversionCount: 0,
      bankProfileRegistered: row.bank_profile_version !== null,
    };
    current.amount += Math.round(Number(row.reward_amount));
    current.conversionCount += 1;
    grouped.set(row.affiliate_id, current);
  }
  return {
    lineAccountId: input.lineAccountId,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    currency: 'JPY',
    totalAmount: rows.reduce((sum, row) => sum + Math.round(Number(row.reward_amount)), 0),
    conversionCount: rows.length,
    affiliates: Array.from(grouped.values()),
    previewVersion: await accountPreviewVersion(rows),
  };
}

export type CloseAffiliateAccountSettlementResult =
  | { kind: 'created' | 'duplicate'; settlementId: string; totalAmount: number; conversionCount: number; version: number; closedAt: string }
  | { kind: 'empty' | 'changed' | 'idempotency_conflict' };

export async function closeAffiliateAccountSettlement(
  db: D1Database,
  input: {
    tenantId: string;
    lineAccountId: string;
    periodFrom: string;
    periodTo: string;
    actorId: string;
    expectedPreviewVersion: string;
    idempotencyKey: string;
    requestFingerprint: string;
    now?: string;
  },
): Promise<CloseAffiliateAccountSettlementResult> {
  const existing = await db.prepare(
    `SELECT id, total_amount_minor, version, closed_at, request_fingerprint,
            (SELECT COUNT(*) FROM affiliate_settlement_lines sl WHERE sl.settlement_id = s.id) AS line_count
       FROM affiliate_settlements s
      WHERE organization_id = ? AND line_account_id = ? AND idempotency_key = ?`,
  ).bind(input.tenantId, input.lineAccountId, input.idempotencyKey).first<{
    id: string; total_amount_minor: number; version: number; closed_at: string;
    request_fingerprint: string; line_count: number;
  }>();
  if (existing) {
    if (existing.request_fingerprint !== input.requestFingerprint) return { kind: 'idempotency_conflict' };
    return {
      kind: 'duplicate', settlementId: existing.id,
      totalAmount: Number(existing.total_amount_minor), conversionCount: Number(existing.line_count),
      version: Number(existing.version), closedAt: existing.closed_at,
    };
  }
  // 行集合は1回だけ取得し、版照合と明細書込みの両方に使う。
  // 照合後に取り直すと、その隙に承認・締めが変わってheaderと明細がずれる。
  const rows = await eligibleRewards(db, input);
  if (rows.length === 0) return { kind: 'empty' };
  if (await accountPreviewVersion(rows) !== input.expectedPreviewVersion) return { kind: 'changed' };
  const totalAmount = rows.reduce((sum, row) => sum + Math.round(Number(row.reward_amount)), 0);
  const now = input.now ?? new Date().toISOString();
  const settlementId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [db.prepare(
    `INSERT INTO affiliate_settlements
       (id, organization_id, line_account_id, affiliate_id, period_from, period_to,
        timezone, currency, total_amount_minor, state, closed_by, version,
        idempotency_key, closed_at, created_at, request_fingerprint)
     VALUES (?, ?, ?, NULL, ?, ?, 'Asia/Tokyo', 'JPY', ?, 'closed', ?, 1, ?, ?, ?, ?)`,
  ).bind(
    settlementId, input.tenantId, input.lineAccountId, input.periodFrom, input.periodTo,
    totalAmount, input.actorId, input.idempotencyKey, now, now, input.requestFingerprint,
  )];
  for (const row of rows) {
    const entryId = crypto.randomUUID();
    const amount = Math.round(Number(row.reward_amount));
    // 版は承認時と移行で作り済みのため、ここでは紐付けるだけ(作らない)。
    statements.push(
      db.prepare(
        `INSERT INTO affiliate_reward_entries
           (id, organization_id, line_account_id, affiliate_id, conversion_event_id,
            offer_id, reward_calculation_id, entry_type, amount_minor, currency, status, approved_at,
            payable_at, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'credit', ?, 'JPY', 'settled', ?, ?, ?, ?)`,
      ).bind(
        entryId, input.tenantId, input.lineAccountId, row.affiliate_id,
        row.conversion_event_id, row.offer_id, row.calculation_id, amount,
        row.approved_at, now, `settlement:${settlementId}:${row.conversion_event_id}`, now,
      ),
      db.prepare(
        `INSERT INTO affiliate_settlement_lines
           (id, settlement_id, affiliate_id, entry_id, amount_minor, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'included', ?)`,
      ).bind(
        crypto.randomUUID(), settlementId, row.affiliate_id, entryId,
        amount, now,
      ),
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    // 並行する締めが先に書いた場合は読み直して回収する。同一操作は冪等な
    // duplicateへ、別内容だけ409相当へ。勝者が無い制約違反は投げ直す。
    if (!/UNIQUE|constraint|busy|locked/i.test(error instanceof Error ? error.message : String(error))) throw error;
    const winner = await db.prepare(
      `SELECT id, total_amount_minor, version, closed_at, request_fingerprint,
              (SELECT COUNT(*) FROM affiliate_settlement_lines sl WHERE sl.settlement_id = s.id) AS line_count
         FROM affiliate_settlements s
        WHERE organization_id = ? AND line_account_id = ? AND idempotency_key = ?`,
    ).bind(input.tenantId, input.lineAccountId, input.idempotencyKey).first<{
      id: string; total_amount_minor: number; version: number; closed_at: string;
      request_fingerprint: string; line_count: number;
    }>();
    if (winner) {
      if (winner.request_fingerprint !== input.requestFingerprint) return { kind: 'idempotency_conflict' };
      return {
        kind: 'duplicate', settlementId: winner.id,
        totalAmount: Number(winner.total_amount_minor), conversionCount: Number(winner.line_count),
        version: Number(winner.version), closedAt: winner.closed_at,
      };
    }
    return { kind: 'changed' };
  }
  return {
    kind: 'created', settlementId, totalAmount,
    conversionCount: rows.length, version: 1, closedAt: now,
  };
}

type PayoutBatchRow = {
  id: string; organization_id: string; line_account_id: string; settlement_id: string;
  total_amount_minor: number; currency: string; line_count: number; state: string;
  bank_format: string | null; file_checksum: string | null; version: number;
  idempotency_key: string | null; request_fingerprint: string | null;
  export_object_key: string | null; export_expires_at: string | null;
  download_token_hash: string | null; export_idempotency_key: string | null;
  export_request_fingerprint: string | null; created_at: string;
};

export interface AffiliatePayoutBatch {
  id: string; lineAccountId: string; settlementId: string; totalAmount: number;
  currency: string; lineCount: number; state: string; bankFormat: string | null;
  fileChecksum: string | null; version: number; downloadExpiresAt: string | null;
  createdAt: string;
}

function payoutBatch(row: PayoutBatchRow): AffiliatePayoutBatch {
  return {
    id: row.id, lineAccountId: row.line_account_id, settlementId: row.settlement_id,
    totalAmount: Number(row.total_amount_minor), currency: row.currency,
    lineCount: Number(row.line_count), state: row.state, bankFormat: row.bank_format,
    fileChecksum: row.file_checksum, version: Number(row.version),
    downloadExpiresAt: row.export_expires_at, createdAt: row.created_at,
  };
}

export type CreateAffiliatePayoutBatchResult =
  | { kind: 'created'; batch: AffiliatePayoutBatch }
  | { kind: 'duplicate'; batch: AffiliatePayoutBatch }
  | { kind: 'not_found' }
  | { kind: 'changed' }
  | { kind: 'bank_missing'; missingAffiliateIds: string[] }
  | { kind: 'idempotency_conflict' };

export async function createAffiliatePayoutBatch(
  db: D1Database,
  input: {
    tenantId: string; lineAccountId: string; settlementId: string; expectedVersion: number;
    bankFormat: 'zengin_csv'; actorId: string; idempotencyKey: string;
    requestFingerprint: string; now?: string;
  },
): Promise<CreateAffiliatePayoutBatchResult> {
  const replay = await db.prepare(
    `SELECT * FROM affiliate_payout_batches
      WHERE organization_id = ? AND line_account_id = ? AND idempotency_key = ?`,
  ).bind(input.tenantId, input.lineAccountId, input.idempotencyKey).first<PayoutBatchRow>();
  if (replay) {
    return replay.request_fingerprint === input.requestFingerprint
      ? { kind: 'duplicate', batch: payoutBatch(replay) }
      : { kind: 'idempotency_conflict' };
  }
  const settlement = await db.prepare(
    `SELECT id, version, state, total_amount_minor FROM affiliate_settlements
      WHERE id = ? AND organization_id = ? AND line_account_id = ?`,
  ).bind(input.settlementId, input.tenantId, input.lineAccountId).first<{
    id: string; version: number; state: string; total_amount_minor: number;
  }>();
  if (!settlement) return { kind: 'not_found' };
  if (Number(settlement.version) !== input.expectedVersion || settlement.state !== 'closed') {
    return { kind: 'changed' };
  }
  const lines = await db.prepare(
    `SELECT sl.id AS settlement_line_id, sl.affiliate_id, sl.amount_minor,
            bp.bank_code, bp.bank_name, bp.branch_code, bp.branch_name, bp.account_type,
            bp.account_number_encrypted, bp.account_last4, bp.account_holder_name
       FROM affiliate_settlement_lines sl
       LEFT JOIN affiliate_bank_profiles bp
         ON bp.affiliate_id = sl.affiliate_id AND bp.organization_id = ? AND bp.line_account_id = ?
      WHERE sl.settlement_id = ? AND sl.status = 'included'
      ORDER BY sl.affiliate_id, sl.id`,
  ).bind(input.tenantId, input.lineAccountId, input.settlementId).all<{
    settlement_line_id: string; affiliate_id: string; amount_minor: number;
    bank_code: string | null; bank_name: string | null; branch_code: string | null;
    branch_name: string | null; account_type: AffiliateBankAccountType | null;
    account_number_encrypted: string | null; account_last4: string | null;
    account_holder_name: string | null;
  }>();
  const missing = Array.from(new Set(lines.results
    .filter((line) => !line.account_number_encrypted)
    .map((line) => line.affiliate_id)));
  if (missing.length > 0) return { kind: 'bank_missing', missingAffiliateIds: missing };
  const id = crypto.randomUUID();
  const now = input.now ?? new Date().toISOString();
  const statements: D1PreparedStatement[] = [db.prepare(
    `INSERT INTO affiliate_payout_batches
       (id, organization_id, line_account_id, settlement_id, total_amount_minor,
        currency, line_count, state, bank_format, created_by, created_at,
        version, idempotency_key, request_fingerprint)
     VALUES (?, ?, ?, ?, ?, 'JPY', ?, 'created', ?, ?, ?, 1, ?, ?)`,
  ).bind(
    id, input.tenantId, input.lineAccountId, input.settlementId,
    Number(settlement.total_amount_minor), lines.results.length, input.bankFormat,
    input.actorId, now, input.idempotencyKey, input.requestFingerprint,
  )];
  for (const line of lines.results) {
    statements.push(db.prepare(
      `INSERT INTO affiliate_payout_batch_lines
         (id, batch_id, settlement_line_id, affiliate_id, amount_minor, bank_code,
          bank_name, branch_code, branch_name, account_type, account_number_encrypted,
          account_last4, account_holder_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), id, line.settlement_line_id, line.affiliate_id,
      Number(line.amount_minor), line.bank_code!, line.bank_name!, line.branch_code!,
      line.branch_name!, line.account_type!, line.account_number_encrypted!,
      line.account_last4!, line.account_holder_name!, now,
    ));
  }
  await db.batch(statements);
  const row = await db.prepare('SELECT * FROM affiliate_payout_batches WHERE id = ?').bind(id).first<PayoutBatchRow>();
  if (!row) throw new Error('affiliate payout batch was not created');
  return { kind: 'created', batch: payoutBatch(row) };
}

export async function getAffiliatePayoutBatchExport(
  db: D1Database,
  input: { tenantId: string; lineAccountId: string; batchId: string },
): Promise<{ batch: PayoutBatchRow; lines: Array<{
  affiliateId: string; amount: number; bankCode: string; bankName: string;
  branchCode: string; branchName: string; accountType: AffiliateBankAccountType;
  encryptedAccountNumber: string; accountLast4: string; accountHolderName: string;
}> } | null> {
  const batch = await db.prepare(
    `SELECT * FROM affiliate_payout_batches
      WHERE id = ? AND organization_id = ? AND line_account_id = ?`,
  ).bind(input.batchId, input.tenantId, input.lineAccountId).first<PayoutBatchRow>();
  if (!batch) return null;
  const result = await db.prepare(
    `SELECT affiliate_id, SUM(amount_minor) AS amount_minor, bank_code, bank_name,
            branch_code, branch_name, account_type, account_number_encrypted,
            account_last4, account_holder_name
       FROM affiliate_payout_batch_lines WHERE batch_id = ?
      GROUP BY affiliate_id, bank_code, bank_name, branch_code, branch_name,
               account_type, account_number_encrypted, account_last4, account_holder_name
      ORDER BY affiliate_id`,
  ).bind(input.batchId).all<{
    affiliate_id: string; amount_minor: number; bank_code: string; bank_name: string;
    branch_code: string; branch_name: string; account_type: AffiliateBankAccountType;
    account_number_encrypted: string; account_last4: string; account_holder_name: string;
  }>();
  return {
    batch,
    lines: result.results.map((row) => ({
      affiliateId: row.affiliate_id, amount: Number(row.amount_minor), bankCode: row.bank_code,
      bankName: row.bank_name, branchCode: row.branch_code, branchName: row.branch_name,
      accountType: row.account_type, encryptedAccountNumber: row.account_number_encrypted,
      accountLast4: row.account_last4, accountHolderName: row.account_holder_name,
    })),
  };
}

export type MarkAffiliatePayoutExportedResult =
  | { kind: 'exported'; batch: AffiliatePayoutBatch; objectKey: string }
  | { kind: 'duplicate'; batch: AffiliatePayoutBatch; objectKey: string }
  | { kind: 'changed' }
  | { kind: 'idempotency_conflict' };

export async function markAffiliatePayoutExported(
  db: D1Database,
  input: {
    tenantId: string; lineAccountId: string; batchId: string; expectedVersion: number;
    idempotencyKey: string; requestFingerprint: string; objectKey: string;
    checksum: string; expiresAt: string; downloadTokenHash: string; now?: string;
  },
): Promise<MarkAffiliatePayoutExportedResult> {
  const current = await db.prepare(
    `SELECT * FROM affiliate_payout_batches
      WHERE id = ? AND organization_id = ? AND line_account_id = ?`,
  ).bind(input.batchId, input.tenantId, input.lineAccountId).first<PayoutBatchRow>();
  if (!current) return { kind: 'changed' };
  if (current.export_idempotency_key === input.idempotencyKey) {
    if (current.export_request_fingerprint !== input.requestFingerprint || !current.export_object_key) {
      return { kind: 'idempotency_conflict' };
    }
    await db.prepare(
      `UPDATE affiliate_payout_batches
          SET download_token_hash = ?, export_expires_at = ?
        WHERE id = ? AND organization_id = ? AND line_account_id = ?`,
    ).bind(
      input.downloadTokenHash, input.expiresAt, input.batchId, input.tenantId, input.lineAccountId,
    ).run();
    const replay = await db.prepare('SELECT * FROM affiliate_payout_batches WHERE id = ?')
      .bind(input.batchId).first<PayoutBatchRow>();
    if (!replay) throw new Error('affiliate payout batch disappeared');
    return { kind: 'duplicate', batch: payoutBatch(replay), objectKey: current.export_object_key };
  }
  if (Number(current.version) !== input.expectedVersion || current.state !== 'created') {
    return { kind: 'changed' };
  }
  const now = input.now ?? new Date().toISOString();
  const result = await db.prepare(
    `UPDATE affiliate_payout_batches
        SET state = 'exported', file_checksum = ?, export_object_key = ?,
            export_expires_at = ?, download_token_hash = ?, exported_at = ?,
            export_idempotency_key = ?, export_request_fingerprint = ?, version = version + 1
      WHERE id = ? AND organization_id = ? AND line_account_id = ?
        AND version = ? AND state = 'created'`,
  ).bind(
    input.checksum, input.objectKey, input.expiresAt, input.downloadTokenHash, now,
    input.idempotencyKey, input.requestFingerprint, input.batchId, input.tenantId,
    input.lineAccountId, input.expectedVersion,
  ).run();
  if (Number(result.meta.changes ?? 0) !== 1) return { kind: 'changed' };
  const updated = await db.prepare('SELECT * FROM affiliate_payout_batches WHERE id = ?').bind(input.batchId).first<PayoutBatchRow>();
  if (!updated) throw new Error('affiliate payout batch disappeared');
  return { kind: 'exported', batch: payoutBatch(updated), objectKey: input.objectKey };
}

export async function getAffiliatePayoutDownload(
  db: D1Database,
  input: { tenantId: string; lineAccountId: string; batchId: string; tokenHash: string; now?: string },
): Promise<{ objectKey: string; fileChecksum: string | null } | null> {
  const row = await db.prepare(
    `SELECT export_object_key, file_checksum FROM affiliate_payout_batches
      WHERE id = ? AND organization_id = ? AND line_account_id = ?
        AND state = 'exported' AND download_token_hash = ? AND export_expires_at > ?`,
  ).bind(
    input.batchId, input.tenantId, input.lineAccountId, input.tokenHash,
    input.now ?? new Date().toISOString(),
  ).first<{ export_object_key: string; file_checksum: string | null }>();
  return row ? { objectKey: row.export_object_key, fileChecksum: row.file_checksum } : null;
}

export interface AffiliateStatementSnapshot {
  settlementId: string; settlementVersion: number; affiliateId: string;
  affiliateName: string; affiliateCode: string; periodFrom: string; periodTo: string;
  totalAmount: number; currency: string; lineCount: number;
}

export async function prepareAffiliateStatement(
  db: D1Database,
  input: { tenantId: string; lineAccountId: string; settlementId: string; affiliateId: string },
): Promise<AffiliateStatementSnapshot | null> {
  const row = await db.prepare(
    `SELECT s.id AS settlement_id, s.version, s.period_from, s.period_to, s.currency,
            a.id AS affiliate_id, a.name AS affiliate_name, a.code AS affiliate_code,
            COALESCE(SUM(sl.amount_minor), 0) AS total_amount,
            COUNT(sl.id) AS line_count
       FROM affiliate_settlements s
       JOIN affiliate_settlement_lines sl ON sl.settlement_id = s.id AND sl.affiliate_id = ?
       JOIN affiliates a ON a.id = sl.affiliate_id AND a.tenant_id = s.organization_id
      WHERE s.id = ? AND s.organization_id = ? AND s.line_account_id = ? AND s.state = 'closed'
      GROUP BY s.id, s.version, s.period_from, s.period_to, s.currency, a.id, a.name, a.code`,
  ).bind(input.affiliateId, input.settlementId, input.tenantId, input.lineAccountId).first<{
    settlement_id: string; version: number; period_from: string; period_to: string; currency: string;
    affiliate_id: string; affiliate_name: string; affiliate_code: string;
    total_amount: number; line_count: number;
  }>();
  return row ? {
    settlementId: row.settlement_id, settlementVersion: Number(row.version),
    affiliateId: row.affiliate_id, affiliateName: row.affiliate_name,
    affiliateCode: row.affiliate_code, periodFrom: row.period_from, periodTo: row.period_to,
    totalAmount: Number(row.total_amount), currency: row.currency, lineCount: Number(row.line_count),
  } : null;
}

type StatementRow = {
  id: string; line_account_id: string; affiliate_id: string; settlement_id: string;
  total_amount_minor: number; status: string; version: number; pdf_object_key: string;
  idempotency_key: string | null; request_fingerprint: string | null;
  snapshot_json: string; file_checksum: string | null; expires_at: string | null; created_at: string;
};

export interface AffiliateStatement {
  id: string; lineAccountId: string; affiliateId: string; settlementId: string;
  totalAmount: number; status: string; version: number; expiresAt: string | null; createdAt: string;
}

function affiliateStatement(row: StatementRow): AffiliateStatement {
  return {
    id: row.id, lineAccountId: row.line_account_id, affiliateId: row.affiliate_id,
    settlementId: row.settlement_id, totalAmount: Number(row.total_amount_minor),
    status: row.status, version: Number(row.version), expiresAt: row.expires_at, createdAt: row.created_at,
  };
}

export async function getAffiliateStatementReplay(
  db: D1Database,
  input: { tenantId: string; lineAccountId: string; idempotencyKey: string },
): Promise<{ statement: AffiliateStatement; requestFingerprint: string; objectKey: string } | null> {
  const row = await db.prepare(
    `SELECT * FROM affiliate_statements
      WHERE organization_id = ? AND line_account_id = ? AND idempotency_key = ?`,
  ).bind(input.tenantId, input.lineAccountId, input.idempotencyKey).first<StatementRow>();
  return row ? {
    statement: affiliateStatement(row), requestFingerprint: row.request_fingerprint ?? '', objectKey: row.pdf_object_key,
  } : null;
}

export async function createAffiliateStatement(
  db: D1Database,
  input: {
    tenantId: string; lineAccountId: string; snapshot: AffiliateStatementSnapshot;
    objectKey: string; checksum: string; idempotencyKey: string; requestFingerprint: string;
    actorId: string; expiresAt: string; now?: string;
  },
): Promise<AffiliateStatement> {
  const id = crypto.randomUUID();
  const now = input.now ?? new Date().toISOString();
  await db.prepare(
    `INSERT INTO affiliate_statements
       (id, organization_id, line_account_id, affiliate_id, settlement_id,
        total_amount_minor, status, version, pdf_object_key, generated_by,
        expires_at, created_at, idempotency_key, request_fingerprint, snapshot_json, file_checksum)
     VALUES (?, ?, ?, ?, ?, ?, 'generated', 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, input.tenantId, input.lineAccountId, input.snapshot.affiliateId,
    input.snapshot.settlementId, input.snapshot.totalAmount, input.objectKey,
    input.actorId, input.expiresAt, now, input.idempotencyKey, input.requestFingerprint,
    JSON.stringify(input.snapshot), input.checksum,
  ).run();
  return {
    id, lineAccountId: input.lineAccountId, affiliateId: input.snapshot.affiliateId,
    settlementId: input.snapshot.settlementId, totalAmount: input.snapshot.totalAmount,
    status: 'generated', version: 1, expiresAt: input.expiresAt, createdAt: now,
  };
}

export async function listAffiliateStatementsForSelf(
  db: D1Database,
  input: { tenantId: string; lineAccountId: string; affiliateId: string },
): Promise<AffiliateStatement[]> {
  const rows = await db.prepare(
    `SELECT * FROM affiliate_statements
      WHERE organization_id = ? AND line_account_id = ? AND affiliate_id = ?
        AND status = 'generated'
      ORDER BY created_at DESC, id DESC`,
  ).bind(input.tenantId, input.lineAccountId, input.affiliateId).all<StatementRow>();
  return rows.results.map(affiliateStatement);
}

export async function getAffiliateStatementDownload(
  db: D1Database,
  input: { tenantId: string; lineAccountId: string; affiliateId: string; statementId: string; now?: string },
): Promise<{ statement: AffiliateStatement; objectKey: string; checksum: string | null } | null> {
  const row = await db.prepare(
    `SELECT * FROM affiliate_statements
      WHERE id = ? AND organization_id = ? AND line_account_id = ? AND affiliate_id = ?
        AND status = 'generated' AND (expires_at IS NULL OR expires_at > ?)`,
  ).bind(
    input.statementId, input.tenantId, input.lineAccountId, input.affiliateId,
    input.now ?? new Date().toISOString(),
  ).first<StatementRow>();
  return row ? { statement: affiliateStatement(row), objectKey: row.pdf_object_key, checksum: row.file_checksum } : null;
}
