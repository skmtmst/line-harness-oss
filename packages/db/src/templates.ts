import { jstNow } from './utils.js';
// テンプレート管理クエリヘルパー

export interface TemplateRow {
  id: string;
  name: string;
  category: string;
  message_type: string;
  message_content: string;
  /** テンプレートの置き場（099 で追加）。未分類は null。 */
  folder_id: string | null;
  /** 162: カルーセルの選択肢を押したときの動き。{ パネル番号: { 選択肢番号: [...] } } */
  carousel_actions_json: string | null;
  /** 162: 選択肢の押せる回数。'none'（制限なし）／'once'（全体で1回） */
  carousel_tap_limit_mode: string;
  /** 162: 制限を超えたときに返すテキスト。空なら何も返さない。 */
  carousel_tap_limit_text: string | null;
  /** 質問テンプレート。scenario_steps.question_json と同じ形。 */
  question_json: string | null;
  question_status: 'draft' | 'published';
  created_at: string;
  updated_at: string;
  line_account_id: string | null;
  /**
   * 347: 公開版の版番号。公開操作でだけ +1 する。
   * 送信側が読む live 列(message_type / message_content / carousel_* /
   * question_*)は公開版そのものなので、版番号と live 列は常に一致する。
   */
  published_version: number;
  /** 347: 最後に公開した日時。既存行は移行時に updated_at を入れる。 */
  published_at: string | null;
  /**
   * 347: 編集中の下書き。PUT はここへだけ書く。
   * どれか1つでも入っていれば「公開待ちの下書きあり」。
   */
  draft_message_type: string | null;
  draft_message_content: string | null;
  draft_carousel_actions_json: string | null;
  draft_carousel_tap_limit_mode: string | null;
  draft_carousel_tap_limit_text: string | null;
  draft_question_json: string | null;
  draft_question_status: 'draft' | 'published' | null;
  /**
   * 347(差し戻し対応): 下書きの版。保存のたびに +1 し、公開で 0 に戻す。
   * 公開口はこの番号も確認し、検査後に書き換わった下書きを出さない。
   */
  draft_revision: number;
  /** 347: 公開の再試行を見分ける確認キー。auto_reply_versions と同じ使い方。 */
  publish_idempotency_key: string | null;
}

/** 下書きがあるかどうか。どれか1列でも入っていれば true。 */
export function hasTemplateDraft(row: Pick<TemplateRow,
  'draft_message_type' | 'draft_message_content' |
  'draft_carousel_actions_json' | 'draft_carousel_tap_limit_mode' |
  'draft_carousel_tap_limit_text' | 'draft_question_json' |
  'draft_question_status'> | null | undefined,
): boolean {
  if (!row) return false;
  // `!= null` で見る。347 より前の形の行や、一部の列だけ取る SELECT でも
  // 「下書きなし」と正しく判定するため。
  return row.draft_message_type != null
    || row.draft_message_content != null
    || row.draft_carousel_actions_json != null
    || row.draft_carousel_tap_limit_mode != null
    || row.draft_carousel_tap_limit_text != null
    || row.draft_question_json != null
    || row.draft_question_status != null;
}

export async function getTemplates(db: D1Database, category?: string): Promise<TemplateRow[]> {
  if (category) {
    const result = await db.prepare(`SELECT * FROM templates WHERE category = ? ORDER BY created_at DESC`)
      .bind(category).all<TemplateRow>();
    return result.results;
  }
  const result = await db.prepare(`SELECT * FROM templates ORDER BY created_at DESC`).all<TemplateRow>();
  return result.results;
}

export async function getTemplateById(db: D1Database, id: string): Promise<TemplateRow | null> {
  return db.prepare(`SELECT * FROM templates WHERE id = ?`).bind(id).first<TemplateRow>();
}

/**
 * 独立審査対応(P1): 下書き全文の指紋(SHA-256 hex)。同じ内容なら同じ値に
 * なり、1文字でも違えば(削除も含めて)変わる。同キー再試行が別操作か
 * どうかの見分けに使う(成功時の控えと比べる)。32bit 非暗号ハッシュは不可。
 */
export async function templateDraftFingerprint(
  draft: Pick<TemplateRow,
    'draft_message_type' | 'draft_message_content' |
    'draft_carousel_actions_json' | 'draft_carousel_tap_limit_mode' |
    'draft_carousel_tap_limit_text' | 'draft_question_json' |
    'draft_question_status'>,
): Promise<string> {
  const canonical = JSON.stringify([
    draft.draft_message_type ?? null,
    draft.draft_message_content ?? null,
    draft.draft_carousel_actions_json ?? null,
    draft.draft_carousel_tap_limit_mode ?? null,
    draft.draft_carousel_tap_limit_text ?? null,
    draft.draft_question_json ?? null,
    draft.draft_question_status ?? null,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 独立審査P2相当(指摘3): いま送ってよいテンプレートかどうか。
 * 公開版があること(版1以上)に加え、送る側と持ち主の両方が分かり、
 * 完全一致すること。どちらかが null の wildcard 照合はしない(fail-close)。
 * 未公開・別アカウント・持ち主不明は送らない。
 */
export function isTemplateSendable(
  row: Pick<TemplateRow, 'published_version' | 'line_account_id'> | null | undefined,
  lineAccountId?: string | null,
): boolean {
  if (!row) return false;
  if (Number(row.published_version ?? 0) < 1) return false;
  if (lineAccountId == null || row.line_account_id == null) return false;
  return row.line_account_id === lineAccountId;
}

/** 送ってよいテンプレートだけを返す。未公開・別アカウント・持ち主不明は null。 */
export async function getSendableTemplate(
  db: D1Database,
  id: string,
  lineAccountId?: string | null,
): Promise<TemplateRow | null> {
  const row = await getTemplateById(db, id);
  return row && isTemplateSendable(row, lineAccountId) ? row : null;
}

/**
 * 独立審査P2相当(指摘3): 結びつけてよいテンプレートかどうか。
 * 公開版があり、結びつける側と完全一致すること。持ち主不明は通さない
 * (fail-close)。持ち主未定のシナリオに結ぶと、送る側で別アカウントの
 * 公開版が混ざる。送信時と同じ条件にする。
 */
export function isTemplateAssociable(
  row: Pick<TemplateRow, 'published_version' | 'line_account_id'> | null | undefined,
  lineAccountId?: string | null,
): boolean {
  if (!row) return false;
  if (Number(row.published_version ?? 0) < 1) return false;
  if (lineAccountId == null || row.line_account_id == null) return false;
  return row.line_account_id === lineAccountId;
}

/** 結びつけてよいテンプレートだけを返す。 */
export async function getAssociableTemplate(
  db: D1Database,
  id: string,
  lineAccountId?: string | null,
): Promise<TemplateRow | null> {
  const row = await getTemplateById(db, id);
  return row && isTemplateAssociable(row, lineAccountId) ? row : null;
}

export interface CarouselOptions {
  /** 162: 選択肢を押したときの動き。{ パネル番号: { 選択肢番号: [...] } } */
  carouselActions?: unknown | null;
  /** 162: 'none'（制限なし）／'once'（カルーセル全体で1回） */
  carouselTapLimitMode?: 'none' | 'once';
  /** 162: 制限を超えたときに返すテキスト。 */
  carouselTapLimitText?: string | null;
}

export interface QuestionOptions {
  /** JSON文字列。null は通常テンプレート。 */
  questionJson?: string | null;
  questionStatus?: 'draft' | 'published';
}

export async function createTemplate(
  db: D1Database,
  input: {
    name: string;
    category?: string;
    messageType: string;
    messageContent: string;
    lineAccountId?: string | null;
    /** 置き場。省略・null は「未分類」。 */
    folderId?: string | null;
  } & CarouselOptions & QuestionOptions,
): Promise<TemplateRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  /*
   * 347(差し戻し対応・要件4): 新規作成は未公開の下書きで始める。
   * live 列には初期内容を入れる(NOT NULL のため)が、版は 0・公開日時は空にし、
   * 初回の明示 publish でだけ公開版 1 になる。作った直後は送信候補に出さない。
   */
  const carouselActionsJson = input.carouselActions ? JSON.stringify(input.carouselActions) : null;
  const tapLimitMode = input.carouselTapLimitMode ?? 'none';
  const tapLimitText = input.carouselTapLimitText ?? null;
  const questionJson = input.questionJson ?? null;
  const questionStatus = input.questionStatus ?? 'published';
  await db
    .prepare(
      `INSERT INTO templates
         (id, name, category, message_type, message_content,
          carousel_actions_json, carousel_tap_limit_mode, carousel_tap_limit_text,
          question_json, question_status, created_at, updated_at, line_account_id,
          folder_id, published_version, published_at,
          draft_message_type, draft_message_content,
          draft_carousel_actions_json, draft_carousel_tap_limit_mode, draft_carousel_tap_limit_text,
          draft_question_json, draft_question_status, draft_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL,
               ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .bind(
      id,
      input.name,
      input.category ?? 'general',
      input.messageType,
      input.messageContent,
      carouselActionsJson,
      tapLimitMode,
      tapLimitText,
      questionJson,
      questionStatus,
      now,
      now,
      input.lineAccountId ?? null,
      input.folderId ?? null,
      input.messageType,
      input.messageContent,
      carouselActionsJson,
      tapLimitMode,
      tapLimitText,
      questionJson,
      questionStatus,
    )
    .run();
  return (await getTemplateById(db, id))!;
}

/**
 * live 列(公開版)への直接書き込み。
 *
 * 347 以降、送信文(message_type / message_content / carousel_* /
 * question_*)は公開操作でしか live 列へ書かない。編集画面の保存は
 * {@link saveTemplateDraft} を使う。ここへ送信文を渡すのは、
 * 名前・置き場だけを直す整理操作など、送信文を変えない場合に限る。
 */
export async function updateTemplate(
  db: D1Database,
  id: string,
  updates: Partial<{
    name: string;
    category: string;
    messageType: string;
    messageContent: string;
    /** 置き場。`null` を渡すと未分類へ戻す。 */
    folderId: string | null;
  }> &
    CarouselOptions & QuestionOptions,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.category !== undefined) { sets.push('category = ?'); values.push(updates.category); }
  if (updates.messageType !== undefined) { sets.push('message_type = ?'); values.push(updates.messageType); }
  if (updates.messageContent !== undefined) { sets.push('message_content = ?'); values.push(updates.messageContent); }
  if (updates.carouselActions !== undefined) {
    sets.push('carousel_actions_json = ?');
    values.push(updates.carouselActions ? JSON.stringify(updates.carouselActions) : null);
  }
  if (updates.carouselTapLimitMode !== undefined) {
    sets.push('carousel_tap_limit_mode = ?');
    values.push(updates.carouselTapLimitMode);
  }
  if (updates.carouselTapLimitText !== undefined) {
    sets.push('carousel_tap_limit_text = ?');
    values.push(updates.carouselTapLimitText);
  }
  if (updates.questionJson !== undefined) {
    sets.push('question_json = ?');
    values.push(updates.questionJson);
  }
  if (updates.questionStatus !== undefined) {
    sets.push('question_status = ?');
    values.push(updates.questionStatus);
  }
  /*
    置き場。**`null` は「値が来なかった」ではなく「未分類へ戻す」。**
    だから `undefined` と `null` を分けて見る。
  */
  if (updates.folderId !== undefined) {
    sets.push('folder_id = ?');
    values.push(updates.folderId);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteTemplate(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM templates WHERE id = ?`).bind(id).run();
}

export interface TemplateDraftUpdates {
  messageType?: string;
  messageContent?: string;
  /** 162: 選択肢を押したときの動き。`null` は動きの削除。 */
  carouselActions?: unknown | null;
  carouselTapLimitMode?: 'none' | 'once';
  /** 制限超過時の返信。`null` は返さない。 */
  carouselTapLimitText?: string | null;
  /** JSON文字列。`null` は通常テンプレートへ戻す。 */
  questionJson?: string | null;
  questionStatus?: 'draft' | 'published';
}

/**
 * 347: 編集内容を下書き(draft_* 列)へだけ書く。live 列(公開版)は触らない。
 *
 * 渡されなかった項目は「いま編集中の下書きがあればそれ、なければ公開版」
 * を引き継いで全文のスナップショットにする。部分的な下書きを作らないのは、
 * 公開時に「どの版が出るか」が1行で決まるようにするため。
 */
export async function saveTemplateDraft(
  db: D1Database,
  id: string,
  updates: TemplateDraftUpdates,
): Promise<TemplateRow> {
  const current = await getTemplateById(db, id);
  if (!current) throw new Error('TEMPLATE_NOT_FOUND');
  /*
   * 差し戻し対応(要件2): 下書きがある行の draft 列 NULL は「削除した」。
   * 下書きがない行の NULL は「下書きなし」。`??` で一列ずつ落とすと、
   * 削除したはずの値が公開版から復活して新しい下書きへ混入する。
   * 下書きは全文スナップショットなので、行単位でどちらかを見る。
   */
  const snapshot = hasTemplateDraft(current);
  const draftMessageType = updates.messageType ?? current.draft_message_type ?? current.message_type;
  const draftMessageContent = updates.messageContent ?? current.draft_message_content ?? current.message_content;
  const draftCarouselActionsJson = updates.carouselActions !== undefined
    ? (updates.carouselActions ? JSON.stringify(updates.carouselActions) : null)
    : (snapshot ? current.draft_carousel_actions_json : current.carousel_actions_json);
  const draftCarouselTapLimitMode = updates.carouselTapLimitMode
    ?? current.draft_carousel_tap_limit_mode
    ?? current.carousel_tap_limit_mode;
  const draftCarouselTapLimitText = updates.carouselTapLimitText !== undefined
    ? updates.carouselTapLimitText
    : (snapshot ? current.draft_carousel_tap_limit_text : current.carousel_tap_limit_text);
  const draftQuestionJson = updates.questionJson !== undefined
    ? updates.questionJson
    : (snapshot ? current.draft_question_json : current.question_json);
  const draftQuestionStatus = updates.questionStatus
    ?? current.draft_question_status
    ?? current.question_status;
  await db.prepare(
    `UPDATE templates
        SET draft_message_type = ?,
            draft_message_content = ?,
            draft_carousel_actions_json = ?,
            draft_carousel_tap_limit_mode = ?,
            draft_carousel_tap_limit_text = ?,
            draft_question_json = ?,
            draft_question_status = ?,
            draft_revision = draft_revision + 1,
            updated_at = ?
      WHERE id = ?`,
  ).bind(
    draftMessageType,
    draftMessageContent,
    draftCarouselActionsJson,
    draftCarouselTapLimitMode,
    draftCarouselTapLimitText,
    draftQuestionJson,
    draftQuestionStatus,
    jstNow(),
    id,
  ).run();
  return (await getTemplateById(db, id))!;
}

export interface TemplatePublishResult {
  row: TemplateRow;
  /** 下書きを公開版へ写したかどうか。 */
  published: boolean;
  /** 同じ確認キーでの再試行を、そのままの結果で返したかどうか。 */
  replayed: boolean;
}

interface TemplatePublishKeyRecord {
  published_version: number;
  draft_revision: number;
  created_at: string;
  draft_fingerprint: string | null;
  message_type: string | null;
  message_content: string | null;
}

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
export async function publishTemplate(
  db: D1Database,
  id: string,
  options: { expectedVersion?: number; expectedDraftRevision?: number; idempotencyKey?: string } = {},
): Promise<TemplatePublishResult> {
  const current = await getTemplateById(db, id);
  if (!current) throw new Error('TEMPLATE_NOT_FOUND');
  if (options.idempotencyKey) {
    const prior = await db.prepare(
      `SELECT published_version, draft_revision, created_at,
              draft_fingerprint, message_type, message_content
         FROM template_publish_keys
        WHERE template_id = ? AND idempotency_key = ?`,
    ).bind(id, options.idempotencyKey).first<TemplatePublishKeyRecord>();
    if (prior) {
      // 成功済みの操作。新しい下書きがあり、その指紋が記録と違えば、
      // 別操作の使い回しとして409。下書きがなければ同じ操作の再試行。
      if (hasTemplateDraft(current)
        && (await templateDraftFingerprint(current)) !== (prior.draft_fingerprint ?? '')) {
        throw new Error('TEMPLATE_PUBLISH_KEY_CONFLICT');
      }
      // 同じ内容の再試行。記録時の版・本文をそのまま返す(固定応答)。
      // 後に別キーで版が進んでいても、記録時の結果は変えない。
      const fixed: TemplateRow = {
        ...current,
        message_type: prior.message_type ?? current.message_type,
        message_content: prior.message_content ?? current.message_content,
        published_version: Number(prior.published_version),
        published_at: prior.created_at,
        draft_message_type: null,
        draft_message_content: null,
        draft_carousel_actions_json: null,
        draft_carousel_tap_limit_mode: null,
        draft_carousel_tap_limit_text: null,
        draft_question_json: null,
        draft_question_status: null,
        draft_revision: 0,
      };
      return { row: fixed, published: false, replayed: true };
    }
  }
  if (options.expectedVersion !== undefined
    && Number(current.published_version) !== options.expectedVersion) {
    throw new Error('TEMPLATE_VERSION_CONFLICT');
  }
  if (options.expectedDraftRevision !== undefined
    && Number(current.draft_revision ?? 0) !== options.expectedDraftRevision) {
    throw new Error('TEMPLATE_DRAFT_CONFLICT');
  }
  if (!hasTemplateDraft(current)) {
    if (options.idempotencyKey) {
      const now = jstNow();
      await db.prepare(
        `INSERT OR IGNORE INTO template_publish_keys
           (template_id, idempotency_key, published_version, draft_revision, created_at,
            draft_fingerprint, message_type, message_content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, options.idempotencyKey, Number(current.published_version ?? 0),
        Number(current.draft_revision ?? 0), now, '',
        current.message_type, current.message_content).run();
    }
    return { row: current, published: false, replayed: false };
  }
  const now = jstNow();
  const publishedDraftRevision = Number(current.draft_revision ?? 0);
  const publishedFingerprint = await templateDraftFingerprint(current);
  const nextVersion = Number(current.published_version) + 1;
  /*
   * 独立審査P1: 公開版の更新とキー記録は単一の原子操作にする。
   * 記録に載せる版・本文は、下書き(成功すれば消える)から先に決める。
   * 2文の間で落ちても版だけ進むことはない。
   */
  const publishBatch = [
    db.prepare(
      `UPDATE templates
          SET message_type = draft_message_type,
              message_content = draft_message_content,
              carousel_actions_json = draft_carousel_actions_json,
              carousel_tap_limit_mode = draft_carousel_tap_limit_mode,
              carousel_tap_limit_text = draft_carousel_tap_limit_text,
              question_json = draft_question_json,
              question_status = draft_question_status,
              draft_message_type = NULL,
              draft_message_content = NULL,
              draft_carousel_actions_json = NULL,
              draft_carousel_tap_limit_mode = NULL,
              draft_carousel_tap_limit_text = NULL,
              draft_question_json = NULL,
              draft_question_status = NULL,
              draft_revision = 0,
              published_version = published_version + 1,
              published_at = ?,
              publish_idempotency_key = ?,
              updated_at = ?
        WHERE id = ? AND published_version = ? AND draft_revision = ?`,
    ).bind(
      now,
      options.idempotencyKey ?? current.publish_idempotency_key,
      now,
      id,
      current.published_version,
      current.draft_revision ?? 0,
    ),
  ];
  if (options.idempotencyKey) {
    /*
     * 同じ原子操作の中で、UPDATE が1行に当たったときだけ記録する。
     * `changes()` は直前文の更新行数。無条件 INSERT にすると、
     * 同時負けの側まで記録が残り、再試行の見分けが壊れる。
     */
    publishBatch.push(
      db.prepare(
        `INSERT OR IGNORE INTO template_publish_keys
           (template_id, idempotency_key, published_version, draft_revision, created_at,
            draft_fingerprint, message_type, message_content)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
      ).bind(id, options.idempotencyKey, nextVersion, publishedDraftRevision, now,
        publishedFingerprint, current.draft_message_type, current.draft_message_content),
    );
  }
  const [updated] = await db.batch(publishBatch) as Array<{ meta?: { changes?: number } }>;
  if ((updated?.meta?.changes ?? 0) === 0) {
    // 同時公開の負け。同じ確認キーで相手が勝っていたら再試行として返す。
    // 履歴表への記録より先に相手の UPDATE が終わっている場合があるので、
    // 行の確認キー列も見る(同じ UPDATE 文で書かれるため順序が保証される)。
    if (options.idempotencyKey) {
      const winner = await db.prepare(
        `SELECT published_version FROM template_publish_keys
          WHERE template_id = ? AND idempotency_key = ?`,
      ).bind(id, options.idempotencyKey).first<{ published_version: number }>();
      const raced = await getTemplateById(db, id);
      if (winner && raced) return { row: raced, published: false, replayed: true };
      if (raced && raced.publish_idempotency_key === options.idempotencyKey) {
        return { row: raced, published: false, replayed: true };
      }
    }
    // 版と下書き版のどちらが進んだかで落とし分ける。
    const raced = await getTemplateById(db, id);
    if (!raced) throw new Error('TEMPLATE_NOT_FOUND');
    if (Number(raced.published_version) !== Number(current.published_version)) {
      throw new Error('TEMPLATE_VERSION_CONFLICT');
    }
    if (Number(raced.draft_revision ?? 0) !== publishedDraftRevision) {
      throw new Error('TEMPLATE_DRAFT_CONFLICT');
    }
    throw new Error('TEMPLATE_VERSION_CONFLICT');
  }
  // 原子操作で版が1つ進んだことが確定している。読み直して返す。
  const next = await getTemplateById(db, id);
  if (!next || Number(next.published_version) !== nextVersion) {
    throw new Error('TEMPLATE_VERSION_CONFLICT');
  }
  return { row: next, published: true, replayed: false };
}

export interface TemplateUsage {
  autoReplies: Array<{
    id: string;
    keyword: string;
    matchType: 'exact' | 'contains';
    lineAccountId: string | null;
  }>;
  automations: Array<{
    id: string;
    name: string;
    eventType: string;
  }>;
  scenarioSteps: Array<{
    scenarioId: string;
    scenarioName: string;
    stepId: string;
    stepOrder: number;
  }>;
  reminderSteps: Array<{
    reminderId: string;
    reminderName: string;
    stepId: string;
  }>;
  richMenuAreas: Array<{
    groupId: string;
    groupName: string;
    pageName: string;
    areaId: string;
    label: string | null;
  }>;
  trackedLinks: Array<{
    id: string;
    name: string;
  }>;
}

/**
 * Template の参照箇所を返す。
 * 現行の templates.id を参照する運用中の設定をすべて返す。
 * messages_log.template_id_at_send は送信済み履歴なので、削除を止める参照には含めない。
 *   automations は数十件規模なので LIKE で十分高速。
 */
export async function getTemplateUsage(db: D1Database, templateId: string): Promise<TemplateUsage> {
  const arRes = await db
    .prepare(
      `SELECT id, keyword, match_type, line_account_id
       FROM auto_replies WHERE template_id = ? ORDER BY created_at DESC`,
    )
    .bind(templateId)
    .all<{ id: string; keyword: string; match_type: 'exact' | 'contains'; line_account_id: string | null }>();

  // automations の actions JSON を全件取って JS 側で template_id をマッチさせる。
  // SQL LIKE で "%\"template_id\":\"<id>\"%" を投げると D1 SQLite の
  // "pattern too complex" 上限に当たるので JS 処理にしている。
  const autRes = await db
    .prepare(`SELECT id, name, event_type, actions FROM automations ORDER BY created_at DESC`)
    .all<{ id: string; name: string; event_type: string; actions: string }>();
  const matchedAutomations: Array<{ id: string; name: string; event_type: string }> = [];
  for (const r of autRes.results ?? []) {
    try {
      const actions = JSON.parse(r.actions) as Array<{ params?: { template_id?: string } }>;
      if (actions.some((a) => a.params?.template_id === templateId)) {
        matchedAutomations.push({ id: r.id, name: r.name, event_type: r.event_type });
      }
    } catch {
      // ignore malformed
    }
  }

  const scenarioRes = await db
    .prepare(
      `SELECT ss.id AS step_id, ss.step_order, ss.scenario_id, s.name AS scenario_name
       FROM scenario_steps ss
       JOIN scenarios s ON s.id = ss.scenario_id
       WHERE ss.template_id = ?
       ORDER BY s.name, ss.step_order`,
    )
    .bind(templateId)
    .all<{ step_id: string; step_order: number; scenario_id: string; scenario_name: string }>();

  const reminderRes = await db
    .prepare(
      `SELECT rs.id AS step_id, r.id AS reminder_id, r.name AS reminder_name
       FROM reminder_steps rs
       JOIN reminders r ON r.id = rs.reminder_id
       WHERE rs.template_id = ?
       ORDER BY r.name, rs.offset_minutes`,
    )
    .bind(templateId)
    .all<{ step_id: string; reminder_id: string; reminder_name: string }>();

  const richMenuRes = await db
    .prepare(
      `SELECT a.id AS area_id, a.label, p.name AS page_name,
              g.id AS group_id, g.name AS group_name
       FROM rich_menu_areas a
       JOIN rich_menu_pages p ON p.id = a.page_id
       JOIN rich_menu_groups g ON g.id = p.group_id
       WHERE a.template_id = ?
       ORDER BY g.name, p.order_index, a.id`,
    )
    .bind(templateId)
    .all<{
      area_id: string;
      label: string | null;
      page_name: string;
      group_id: string;
      group_name: string;
    }>();

  const trackedLinkRes = await db
    .prepare(`SELECT id, name FROM tracked_links WHERE template_id = ? ORDER BY name`)
    .bind(templateId)
    .all<{ id: string; name: string }>();

  return {
    autoReplies: (arRes.results ?? []).map((r) => ({
      id: r.id,
      keyword: r.keyword,
      matchType: r.match_type,
      lineAccountId: r.line_account_id,
    })),
    automations: matchedAutomations.map((r) => ({
      id: r.id,
      name: r.name,
      eventType: r.event_type,
    })),
    scenarioSteps: (scenarioRes.results ?? []).map((r) => ({
      scenarioId: r.scenario_id,
      scenarioName: r.scenario_name,
      stepId: r.step_id,
      stepOrder: r.step_order,
    })),
    reminderSteps: (reminderRes.results ?? []).map((r) => ({
      reminderId: r.reminder_id,
      reminderName: r.reminder_name,
      stepId: r.step_id,
    })),
    richMenuAreas: (richMenuRes.results ?? []).map((r) => ({
      groupId: r.group_id,
      groupName: r.group_name,
      pageName: r.page_name,
      areaId: r.area_id,
      label: r.label,
    })),
    trackedLinks: (trackedLinkRes.results ?? []).map((r) => ({ id: r.id, name: r.name })),
  };
}

export interface TemplateRowWithUsage extends TemplateRow {
  usage_count: number;
}

export interface TemplateListScope {
  accountIds: string[];
  includeUnassigned: boolean;
}

export interface TemplateSendCounts {
  thisMonth: number;
  total: number;
}

/**
 * テンプレートを使って実際に送った数を、一覧1回ぶんまとめて数える。
 * 見えてよいテンプレートIDだけを受け取り、別アカウントの集計を返さない。
 */
export async function getTemplateSendCounts(
  db: D1Database,
  templateIds: string[],
  nowJst = jstNow(),
): Promise<Map<string, TemplateSendCounts>> {
  if (templateIds.length === 0) return new Map();
  const month = nowJst.slice(0, 7);
  const placeholders = templateIds.map(() => '?').join(',');
  const result = await db.prepare(
    `SELECT template_id_at_send AS template_id,
            COUNT(*) AS total_count,
            SUM(CASE WHEN substr(created_at, 1, 7) = ? THEN 1 ELSE 0 END) AS month_count
      FROM messages_log
      WHERE direction = 'outgoing'
        AND COALESCE(delivery_type, '') != 'test'
        AND template_id_at_send IN (${placeholders})
      GROUP BY template_id_at_send`,
  ).bind(month, ...templateIds).all<{
    template_id: string;
    total_count: number;
    month_count: number;
  }>();

  return new Map((result.results ?? []).map((row) => [
    row.template_id,
    { thisMonth: Number(row.month_count ?? 0), total: Number(row.total_count ?? 0) },
  ]));
}

/**
 * 一覧画面用に template + 使用数を返す。
 * - auto_replies は indexed lookup (1 SQL)
 * - automations は actions JSON 全件取って JS で template_id を抽出 (LIKE が
 *   D1 SQLite の "pattern too complex" 上限に当たるので避ける)
 */
export async function getTemplatesWithUsageCount(
  db: D1Database,
  category?: string,
  scope?: TemplateListScope,
  paging?: { limit: number; offset: number },
): Promise<{ items: TemplateRowWithUsage[]; total: number }> {
  // 1. templates 本体
  const filters: string[] = [];
  const values: unknown[] = [];
  if (category) {
    filters.push('category = ?');
    values.push(category);
  }
  if (scope) {
    if (scope.accountIds.length > 0) {
      filters.push(
        `(line_account_id IN (${scope.accountIds.map(() => '?').join(',')})${scope.includeUnassigned ? ' OR line_account_id IS NULL' : ''})`,
      );
      values.push(...scope.accountIds);
    } else {
      filters.push(scope.includeUnassigned ? 'line_account_id IS NULL' : '1 = 0');
    }
  }
  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const totalStmt = values.length > 0
    ? db.prepare(`SELECT COUNT(*) AS total FROM templates${where}`).bind(...values)
    : db.prepare(`SELECT COUNT(*) AS total FROM templates${where}`);
  const totalRow = await totalStmt.first<{ total: number }>();
  const pageSql = `SELECT * FROM templates${where} ORDER BY created_at DESC, id ASC`
    + (paging ? ' LIMIT ? OFFSET ?' : '');
  const pageValues = paging ? [...values, paging.limit, paging.offset] : values;
  const tplStmt = pageValues.length > 0 ? db.prepare(pageSql).bind(...pageValues) : db.prepare(pageSql);
  const templates = await tplStmt.all<TemplateRow>();

  // 2. 列で参照している設定は1回の問い合わせでまとめて数える。
  const relationalRes = await db.prepare(
    `SELECT template_id, SUM(cnt) AS cnt
     FROM (
       SELECT template_id, COUNT(*) AS cnt FROM auto_replies WHERE template_id IS NOT NULL GROUP BY template_id
       UNION ALL
       SELECT template_id, COUNT(*) AS cnt FROM scenario_steps WHERE template_id IS NOT NULL GROUP BY template_id
       UNION ALL
       SELECT template_id, COUNT(*) AS cnt FROM reminder_steps WHERE template_id IS NOT NULL GROUP BY template_id
       UNION ALL
       SELECT template_id, COUNT(*) AS cnt FROM rich_menu_areas WHERE template_id IS NOT NULL GROUP BY template_id
       UNION ALL
       SELECT template_id, COUNT(*) AS cnt FROM tracked_links WHERE template_id IS NOT NULL GROUP BY template_id
     ) references_by_kind
     GROUP BY template_id`,
  ).all<{ template_id: string; cnt: number }>();
  const relationalCount = new Map<string, number>();
  for (const r of relationalRes.results ?? []) relationalCount.set(r.template_id, r.cnt);

  // 3. automations の actions JSON を取って template_id を抽出
  const autRes = await db
    .prepare(`SELECT actions FROM automations`)
    .all<{ actions: string }>();
  const automationCount = new Map<string, number>();
  for (const r of autRes.results ?? []) {
    try {
      const actions = JSON.parse(r.actions) as Array<{ params?: { template_id?: string } }>;
      for (const a of actions) {
        const tid = a.params?.template_id;
        if (tid) automationCount.set(tid, (automationCount.get(tid) ?? 0) + 1);
      }
    } catch {
      // ignore malformed JSON rows
    }
  }

  return {
    items: (templates.results ?? []).map((t) => ({
      ...t,
      usage_count: (relationalCount.get(t.id) ?? 0) + (automationCount.get(t.id) ?? 0),
    })),
    total: Number(totalRow?.total ?? 0),
  };
}
