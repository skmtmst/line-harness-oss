import { dbTableExists, jstNow } from '../utils.js';
import { type MileageLedgerEntry, type MileageAdjustmentResult, type PostMileageAdjustmentInput, type AdjustmentLotConsumption } from './types.js';
import { DEFAULT_MILEAGE_PROGRAM_ID, ensureBuiltInProgram } from './program.js';
import { FRIEND_WALLET_SCOPE_SQL } from './wallet.js';
import { buildAdjustmentFingerprint, adjustmentResult, repairAdjustmentLotShortfall, MileageAdjustmentError, adjustmentLotSpendOrderSql, lotRepairLiveExcessGateSql, recordLotConsumed } from './adjustments-lots.js';


export async function postMileageAdjustment(
  db: D1Database,
  input: PostMileageAdjustmentInput,
): Promise<MileageAdjustmentResult> {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw new Error('Mileage adjustment amount must be a non-zero integer');
  }
  const programId = input.programId ?? DEFAULT_MILEAGE_PROGRAM_ID;
  await ensureBuiltInProgram(db, programId);

  const fingerprint = buildAdjustmentFingerprint(input);
  const existing = await db
    .prepare(`SELECT * FROM mileage_ledger WHERE program_id = ? AND idempotency_key = ?`)
    .bind(programId, input.idempotencyKey)
    .first<MileageLedgerEntry>();
  if (existing) {
    const result = adjustmentResult(existing, fingerprint, true);
    // R359: 初回の取り直し batch が落ちた再送は、ここで残りを取り直す。
    // 台帳・残高には触らない。印と残高超過の上限で二重消費しない。
    if (input.amount < 0) {
      await repairAdjustmentLotShortfall(db, existing, -input.amount);
    }
    return result;
  }

  const friend = await db
    .prepare(`SELECT id, user_id FROM friends WHERE id = ? AND line_account_id = ?`)
    .bind(input.friendId, input.lineAccountId)
    .first<{ id: string; user_id: string | null }>();
  if (!friend) throw new MileageAdjustmentError('friend_not_found');

  const id = crypto.randomUUID();
  const now = input.occurredAt ?? jstNow();
  const baseMetadata = JSON.stringify({
    adjustmentFingerprint: fingerprint,
    reasonCategory: input.reasonCategory,
    sourceReferenceId: input.sourceReferenceId ?? null,
    lineAccountId: input.lineAccountId,
    executedByStaffId: input.executedByStaffId,
    executedByStaffName: input.executedByStaffName,
    expiresAt: input.expiresAt ?? null,
    // R380: 通知記録の作成自体が落ちたとき、あとから「通知だけ」を再送
    // できるよう、依頼されたかどうかを台帳へ残す。
    notifyFriend: input.notifyFriend === true,
  });

  // m25d R359: 減算は台帳だけでなく付与内訳も同じ処理で減らす。
  // 増額は 275 の trigger がロットを作るが、減額は台帳だけでは
  // ロットが残り「残高100・使用可能ロット200」の不整合になる。
  // 期限切れは使えない分なので消費対象から外す（交換の予約と同じ）。
  // ロット不足（期限切れ・過去の不整合）はある分だけ消費し、
  // 台帳の残高検査は従来どおり台帳が決める。
  const lotSpends: Array<{ lotId: string; amount: number }> = [];
  if (input.amount < 0 && (await dbTableExists(db, 'mileage_grant_lots'))) {
    const beneficiaryKey = friend.user_id ? `user:${friend.user_id}` : `friend:${friend.id}`;
    const lots = await db
      .prepare(
        `SELECT ledger_entry_id, remaining_amount FROM mileage_grant_lots
          WHERE program_id = ? AND beneficiary_key = ? AND status = 'available'
            AND remaining_amount > 0 AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY ${adjustmentLotSpendOrderSql()}`,
      )
      .bind(programId, beneficiaryKey, now)
      .all<{ ledger_entry_id: string; remaining_amount: number }>();
    let remaining = -input.amount;
    for (const lot of lots.results) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lot.remaining_amount);
      lotSpends.push({ lotId: lot.ledger_entry_id, amount: take });
      remaining -= take;
    }
  }

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `WITH identity AS (
         SELECT id, user_id FROM friends WHERE id = ? AND line_account_id = ?
       ), wallet AS (
         SELECT COALESCE(SUM(CASE WHEN ml.status = 'available' THEN ml.amount ELSE 0 END), 0) AS available
           FROM mileage_ledger ml
           LEFT JOIN identity ON 1 = 1
          WHERE ml.program_id = ?
            AND ${FRIEND_WALLET_SCOPE_SQL}
       )
       INSERT OR IGNORE INTO mileage_ledger
         (id, program_id, beneficiary_user_id, beneficiary_friend_id,
          engagement_event_id, mileage_rule_id, entry_type, status, amount, reason, source,
          source_event_id, idempotency_key, reverses_entry_id, metadata,
          occurred_at, created_at)
       SELECT ?, ?, identity.user_id, identity.id,
              NULL, NULL, 'adjustment', 'available', ?, ?, 'admin_adjustment',
              NULL, ?, NULL,
              json_set(?, '$.balanceBefore', wallet.available,
                          '$.balanceAfter', wallet.available + ?),
              ?, ?
         FROM identity CROSS JOIN wallet
        WHERE ? > 0 OR wallet.available + ? >= 0`,
    ).bind(
      input.friendId,
      input.lineAccountId,
      programId,
      input.friendId,
      id,
      programId,
      input.amount,
      input.reason,
      input.idempotencyKey,
      baseMetadata,
      input.amount,
      now,
      now,
      input.amount,
      input.amount,
    ),
  ];
  for (const spend of lotSpends) {
    statements.push(
      db.prepare(
        `UPDATE mileage_grant_lots
            SET remaining_amount = remaining_amount - ?,
                status = CASE WHEN remaining_amount - ? = 0 THEN 'exhausted' ELSE status END
          WHERE ledger_entry_id = ? AND remaining_amount >= ?
            AND EXISTS (SELECT 1 FROM mileage_ledger WHERE id = ?)`,
      ).bind(spend.amount, spend.amount, spend.lotId, spend.amount, id),
    );
  }
  const batchResults = (await db.batch(statements)) as Array<{
    meta?: { changes?: unknown };
  }>;
  const ledgerChanges = Number(batchResults[0]?.meta?.changes ?? 0);

  // R359: 同時減算で古い内訳を読んだ側は、条件付きのロット更新が
  // 効かず（changes 0）残高だけが減る。足りなかった分を取り直して
  // 消費し直す。取り直しも条件付きで、無ければある分だけにする
  // （期限切れ・過去の不整合の不足受容は従来どおり）。
  // 台帳を書かなかった再送（ledgerChanges 0）は直した本人が直している
  // ため、ここでは何もしない（二重消費防止）。
  if (input.amount < 0 && ledgerChanges > 0 && lotSpends.length > 0) {
    // R359: 確定した消費の印。再送の請求はこの印の残りだけにする。
    const consumed: AdjustmentLotConsumption[] = [];
    let shortfall = 0;
    for (let index = 0; index < lotSpends.length; index += 1) {
      if (Number(batchResults[1 + index]?.meta?.changes ?? 0) === 0) {
        shortfall += lotSpends[index].amount;
      } else {
        consumed.push(lotSpends[index]);
      }
    }
    const friendKey = friend.user_id ? `user:${friend.user_id}` : `friend:${friend.id}`;
    let guard = 0;
    while (shortfall > 0 && guard < 8) {
      guard += 1;
      const fresh = await db
        .prepare(
          `SELECT ledger_entry_id, remaining_amount FROM mileage_grant_lots
            WHERE program_id = ? AND beneficiary_key = ? AND status = 'available'
              AND remaining_amount > 0 AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY ${adjustmentLotSpendOrderSql()}`,
        )
        .bind(programId, friendKey, now)
        .all<{ ledger_entry_id: string; remaining_amount: number }>();
      const retry: Array<{ lotId: string; amount: number }> = [];
      let need = shortfall;
      for (const lot of fresh.results) {
        if (need <= 0) break;
        const take = Math.min(need, lot.remaining_amount);
        retry.push({ lotId: lot.ledger_entry_id, amount: take });
        need -= take;
      }
      if (retry.length === 0) break;
      const retryResults = (await db.batch(
        retry.map((spend) =>
          db.prepare(
            `UPDATE mileage_grant_lots
                SET remaining_amount = remaining_amount - ?,
                    status = CASE WHEN remaining_amount - ? = 0 THEN 'exhausted' ELSE status END
              WHERE ledger_entry_id = ? AND remaining_amount >= ?
                AND EXISTS (SELECT 1 FROM mileage_ledger WHERE id = ?)
                ${lotRepairLiveExcessGateSql()}`,
          ).bind(
            spend.amount, spend.amount, spend.lotId, spend.amount, id,
            spend.amount, programId, friendKey, now,
            programId, friend.user_id, friend.id,
          ),
        ),
      )) as Array<{ meta?: { changes?: unknown } }>;
      let progressed = 0;
      for (let index = 0; index < retry.length; index += 1) {
        if (Number(retryResults[index]?.meta?.changes ?? 0) > 0) {
          progressed += retry[index].amount;
          consumed.push(retry[index]);
        }
      }
      if (progressed === 0) break;
      shortfall -= progressed;
    }
    // R359: 確定分を台帳へ刻む。再送はこの印の残りだけを請求するため、
    // 印が無くても残高超過の上限で二重消費しない。
    await recordLotConsumed(db, id, programId, input.idempotencyKey, consumed);
  }

  const inserted = await db
    .prepare(`SELECT * FROM mileage_ledger WHERE program_id = ? AND idempotency_key = ?`)
    .bind(programId, input.idempotencyKey)
    .first<MileageLedgerEntry>();
  if (inserted) return adjustmentResult(inserted, fingerprint, ledgerChanges === 0);

  throw new MileageAdjustmentError('insufficient_balance');
}
