


/**
 * 347: 下書きを公開版(live 列)へ写す。送信側は live 列だけを読むので、
 * この関数を通らない編集が実送信文へ混入することはない。
 *
 * 差し戻し対応(#645 6要件 + 再審査5点 + 独立審査P1):
 * - 下書きは全文スナップショットなので、下書き列をそのまま写す。
 *   `COALESCE(下書き, 公開版)` にしない。NULL は「削除した」であり、
 *   削除したはずの古い公開値が復活してはいけない(要件2)。
 * - `expectedDraftRevision` がいまの下書き版と違えば
 *   'TEMPLATE_DRAFT_CONFLICT'。検査後に別人が書き換えた内容を、
 *   確認なしに公開しない(要件3)。事前確認だけでなく UPDATE 文の条件にも
 *   版を入れ、確認と書き込みの間に挟まった保存から守る(再審査1)。
 * - `expectedVersion` がいまの公開版と違えば 'TEMPLATE_VERSION_CONFLICT'。
 *   同時更新は版番号付きの UPDATE 1文で直列化し、負けた側は落とす。
 * - 同じ `idempotencyKey` の再試行は、成功時の記録と下書き指紋(SHA-256)を
 *   比べる。指紋が違えば別操作の使い回しとして
 *   'TEMPLATE_PUBLISH_KEY_CONFLICT'。同じ内容なら記録時の版・本文を
 *   そのまま返す(固定応答)(再審査5)。
 *   下書きなしの成功も記録し、古い複数の成功キーも残る(要件5)。
 * - 公開版の更新とキー記録は `db.batch` の単一原子操作で行う。
 *   途中障害・並行要求で版だけ進むことはない(独立審査P1)。
 */
/** 公開本体のUPDATE直後に、不変の版履歴を同じ原子操作へ入れる。 */
export function publishedVersionStatement(
  db: D1Database,
  id: string,
  versionNumber: number,
  options: { effectiveFrom?: string; createdByStaffId?: string | null },
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO template_versions
       (id, template_id, version_number, message_type, message_content,
        carousel_actions_json, carousel_tap_limit_mode, carousel_tap_limit_text,
        question_json, question_status, effective_from, created_by_staff_id, created_at)
     SELECT ?, id, published_version, message_type, message_content,
            carousel_actions_json, carousel_tap_limit_mode, carousel_tap_limit_text,
            question_json, question_status, ?, ?, ?
       FROM templates WHERE id = ? AND published_version = ? AND changes() = 1`,
  ).bind(crypto.randomUUID(), options.effectiveFrom ?? now,
    options.createdByStaffId ?? null, now, id, versionNumber);
}
