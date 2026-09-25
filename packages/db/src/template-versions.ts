import { jstNow } from './utils.js';
import {
  getTemplateById,
  publishTemplate,
  saveTemplateDraft,
} from './templates.js';

// テンプレートの版履歴と参照表 (#820)。
//
// 版 (template_versions) は公開のたびに1行足す。前の版は変えない。
// 「この版に戻す」は過去の行を書き換えず、その中身で新しい版を作る。
//
// 参照 (template_references) は「どの利用先がどの版を使っているか」の正本。
// JSON の文字列検索ではなくこの表を見る。利用先の保存時に書き換える。

export type TemplateVersionStatus = 'in_use' | 'reserved' | 'past';

export interface TemplateVersionRow {
  id: string;
  template_id: string;
  version_number: number;
  message_type: string;
  message_content: string;
  carousel_actions_json: string | null;
  carousel_tap_limit_mode: string | null;
  carousel_tap_limit_text: string | null;
  question_json: string | null;
  question_status: string | null;
  /** 使い始めの日時。空は「公開と同時」。 */
  effective_from: string | null;
  created_by_staff_id: string | null;
  created_at: string;
}

export interface TemplateVersionView extends TemplateVersionRow {
  status: TemplateVersionStatus;
}

export type TemplateReferenceConsumerKind = 'broadcast' | 'scenario' | 'auto_reply';

export interface TemplateReferenceRow {
  id: string;
  template_id: string;
  template_version_number: number | null;
  consumer_kind: TemplateReferenceConsumerKind;
  consumer_id: string;
  reference_mode: 'fixed' | 'latest';
  created_at: string;
}

export interface BroadcastTemplateReference {
  broadcastId: string;
  title: string;
  status: string;
  scheduledAt: string | null;
  templateVersionNumber: number | null;
  referenceMode: 'fixed' | 'latest';
}

/**
 * 版の一覧。新しい版から返す。札（status）はここで1か所だけ決める。
 *
 * 未来の使い始めを持つ最新の版だけが「予約」。使い始めを過ぎた
 * （または持たない）最新の版が「いま使っている」。それより前は「過去」。
 */
export async function listTemplateVersions(
  db: D1Database,
  templateId: string,
): Promise<TemplateVersionView[]> {
  const result = await db
    .prepare(
      `SELECT * FROM template_versions
        WHERE template_id = ?
        ORDER BY version_number DESC`,
    )
    .bind(templateId)
    .all<TemplateVersionRow>();
  const rows = (result.results ?? []).map((row) => ({
    ...row,
    version_number: Number(row.version_number),
  }));
  const now = jstNow();
  let currentFound = false;
  return rows.map((row) => {
    if (!currentFound && (!row.effective_from || row.effective_from <= now)) {
      currentFound = true;
      return { ...row, status: 'in_use' as const };
    }
    if (!currentFound) return { ...row, status: 'reserved' as const };
    return { ...row, status: 'past' as const };
  });
}

export async function getTemplateVersion(
  db: D1Database,
  templateId: string,
  versionNumber: number,
): Promise<TemplateVersionRow | null> {
  const row = await db
    .prepare(
      `SELECT * FROM template_versions
        WHERE template_id = ? AND version_number = ?`,
    )
    .bind(templateId, versionNumber)
    .first<TemplateVersionRow>();
  if (!row) return null;
  return { ...row, version_number: Number(row.version_number) };
}

/**
 * 「この版に戻す」。過去の版は変えず、その中身で新しい版を作る
 * （下書きへ写して公開する）。同時編集は公開口と同じ版確認で落とす。
 */
export async function revertTemplateToVersion(
  db: D1Database,
  templateId: string,
  versionNumber: number,
  options: {
    expectedVersion?: number;
    idempotencyKey: string;
    staffId?: string | null;
  },
): Promise<{ row: Awaited<ReturnType<typeof getTemplateById>>; publishedVersion: number }> {
  const current = await getTemplateById(db, templateId);
  if (!current) throw new Error('TEMPLATE_NOT_FOUND');
  if (options.expectedVersion !== undefined
    && Number(current.published_version) !== options.expectedVersion) {
    throw new Error('TEMPLATE_VERSION_CONFLICT');
  }
  const version = await getTemplateVersion(db, templateId, versionNumber);
  if (!version) throw new Error('TEMPLATE_VERSION_NOT_FOUND');
  let carouselActions: unknown = null;
  if (version.carousel_actions_json) {
    try {
      carouselActions = JSON.parse(version.carousel_actions_json);
    } catch {
      carouselActions = null;
    }
  }
  const tapLimitMode = version.carousel_tap_limit_mode === 'once' ? 'once' as const : 'none' as const;
  const saved = await saveTemplateDraft(db, templateId, {
    messageType: version.message_type,
    messageContent: version.message_content,
    carouselActions: carouselActions ?? null,
    carouselTapLimitMode: tapLimitMode,
    carouselTapLimitText: version.carousel_tap_limit_text,
    questionJson: version.question_json,
    questionStatus: (version.question_status ?? undefined) as 'draft' | 'published' | undefined,
  });
  const published = await publishTemplate(db, templateId, {
    expectedVersion: Number(current.published_version),
    expectedDraftRevision: Number(saved.draft_revision ?? 0),
    idempotencyKey: options.idempotencyKey,
    createdByStaffId: options.staffId ?? null,
  });
  return { row: published.row, publishedVersion: Number(published.row.published_version) };
}

/** 参照の版止め。いまの公開版の番号を写す。未公開なら空のまま。 */
async function pinnedVersionNumber(
  db: D1Database,
  templateId: string,
): Promise<number | null> {
  const row = await db
    .prepare(`SELECT published_version, published_at FROM templates WHERE id = ?`)
    .bind(templateId)
    .first<{ published_version: number; published_at: string | null }>();
  if (!row || row.published_at === null) return null;
  return Number(row.published_version);
}

/**
 * 利用先の参照を書き換える（全消し→全入れ）。保存のたびに呼ぶ。
 * 存在しないテンプレートは書かない。本文の写しは残るので送りは壊れない。
 */
export async function syncTemplateReferences(
  db: D1Database,
  consumerKind: TemplateReferenceConsumerKind,
  consumerId: string,
  templateIds: string[],
): Promise<void> {
  const unique = [...new Set(templateIds.filter(Boolean))];
  await db
    .prepare(
      `DELETE FROM template_references WHERE consumer_kind = ? AND consumer_id = ?`,
    )
    .bind(consumerKind, consumerId)
    .run();
  for (const templateId of unique) {
    const versionNumber = await pinnedVersionNumber(db, templateId);
    if (versionNumber === null) {
      const exists = await db
        .prepare(`SELECT id FROM templates WHERE id = ?`)
        .bind(templateId)
        .first<{ id: string }>();
      if (!exists) continue;
    }
    await db
      .prepare(
        `INSERT OR IGNORE INTO template_references
           (id, template_id, template_version_number, consumer_kind, consumer_id, reference_mode, created_at)
         VALUES (?, ?, ?, ?, ?, 'fixed', ?)`,
      )
      .bind(crypto.randomUUID(), templateId, versionNumber, consumerKind, consumerId, jstNow())
      .run();
  }
}

/** テンプレートを使う利用先の参照を全部返す。版の表示に使う。 */
export async function listTemplateReferences(
  db: D1Database,
  templateId: string,
): Promise<TemplateReferenceRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM template_references WHERE template_id = ?`,
    )
    .bind(templateId)
    .all<TemplateReferenceRow>();
  return (result.results ?? []).map((row) => ({
    ...row,
    template_version_number: row.template_version_number === null
      ? null
      : Number(row.template_version_number),
  }));
}

/** 利用先を消したら参照も消す。残すと削除の止めが誤作動する。 */
export async function removeConsumerReferences(
  db: D1Database,
  consumerKind: TemplateReferenceConsumerKind,
  consumerId: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM template_references WHERE consumer_kind = ? AND consumer_id = ?`,
    )
    .bind(consumerKind, consumerId)
    .run();
}

/** シナリオの手順から、そのシナリオが使うテンプレートを数え直す。 */
export async function refreshScenarioReferences(
  db: D1Database,
  scenarioId: string,
): Promise<void> {
  const result = await db
    .prepare(
      `SELECT DISTINCT template_id FROM scenario_steps
        WHERE scenario_id = ? AND template_id IS NOT NULL`,
    )
    .bind(scenarioId)
    .all<{ template_id: string }>();
  await syncTemplateReferences(
    db,
    'scenario',
    scenarioId,
    (result.results ?? []).map((row) => row.template_id),
  );
}

/**
 * 一斉配信の保存から、使ったテンプレートを数え直す。
 * 吹き出し (message_bubbles_json) が持つ templateId を読む。本文の写しは
 * 別に残るので、読めない形でも送りは壊れない（参照だけ残さない）。
 */
export function extractBroadcastTemplateIds(bubblesJson: string | null): string[] {
  if (!bubblesJson) return [];
  try {
    const bubbles = JSON.parse(bubblesJson) as Array<{
      content?: { templateId?: unknown };
    }>;
    if (!Array.isArray(bubbles)) return [];
    const ids = bubbles
      .map((bubble) => bubble?.content?.templateId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

export async function refreshBroadcastReferences(
  db: D1Database,
  broadcastId: string,
  bubblesJson: string | null,
): Promise<void> {
  await syncTemplateReferences(
    db,
    'broadcast',
    broadcastId,
    extractBroadcastTemplateIds(bubblesJson),
  );
}

/** 参照している一斉配信を、表に出す形で返す（送った時の版のまま）。 */
export async function listBroadcastReferences(
  db: D1Database,
  templateId: string,
): Promise<BroadcastTemplateReference[]> {
  const result = await db
    .prepare(
      `SELECT r.consumer_id AS broadcast_id, b.title, b.status, b.scheduled_at,
              r.template_version_number, r.reference_mode
         FROM template_references r
         JOIN broadcasts b ON b.id = r.consumer_id
        WHERE r.template_id = ? AND r.consumer_kind = 'broadcast'
        ORDER BY b.created_at DESC`,
    )
    .bind(templateId)
    .all<{
      broadcast_id: string;
      title: string;
      status: string;
      scheduled_at: string | null;
      template_version_number: number | null;
      reference_mode: 'fixed' | 'latest';
    }>();
  return (result.results ?? []).map((row) => ({
    broadcastId: row.broadcast_id,
    title: row.title,
    status: row.status,
    scheduledAt: row.scheduled_at,
    templateVersionNumber: row.template_version_number === null
      ? null
      : Number(row.template_version_number),
    referenceMode: row.reference_mode,
  }));
}

/**
 * 削除を止める一斉配信。予約済み・送信中だけ。送った配信は送った時の
 * 版のまま残り、下書きは本文の写しで作り直せるので止めない。
 */
export async function getBroadcastDeleteBlockers(
  db: D1Database,
  templateId: string,
): Promise<BroadcastTemplateReference[]> {
  const refs = await listBroadcastReferences(db, templateId);
  return refs.filter((ref) => ref.status === 'scheduled' || ref.status === 'sending');
}
