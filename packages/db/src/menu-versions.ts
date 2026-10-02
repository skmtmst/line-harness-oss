import { jstNow } from './utils.js';

/**
 * 予約メニューの版履歴 (T: 予約の設定の版と予約の写し)。
 *
 * 保存のたびに1行足し、前の版は変えない（追記だけ）。
 * 「この版に戻す」は昔の行を変えず、その中身で新しい版を作る。
 * 予約は予約時点の版番号と写しを持ち、あとの変更に引っ張られない。
 */

export interface MenuVersionRow {
  versionNumber: number;
  name: string;
  categoryLabel: string | null;
  description: string | null;
  durationMinutes: number;
  bufferAfterMinutes: number;
  basePrice: number;
  priceMode: string;
  sortOrder: number;
  isActive: number;
  rulesJson: string;
  createdByStaffId: string | null;
  createdAt: string;
}

interface MenusContentRow {
  id: string;
  name: string;
  category_label: string | null;
  description: string | null;
  duration_minutes: number;
  buffer_after_minutes: number;
  base_price: number;
  price_mode: string;
  sort_order: number;
  is_active: number;
  version: number;
  booking_window_days: number | null;
  cutoff_hours_before: number | null;
  cancel_deadline_hours_before: number | null;
  intake_question: string | null;
  concurrent_capacity: number | null;
}

function rulesJsonOf(row: MenusContentRow): string {
  return JSON.stringify({
    booking_window_days: row.booking_window_days,
    cutoff_hours_before: row.cutoff_hours_before,
    cancel_deadline_hours_before: row.cancel_deadline_hours_before,
    intake_question: row.intake_question,
    concurrent_capacity: row.concurrent_capacity,
  });
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * いまのメニュー行を、その版番号で1行残す。
 * 同じ版が既にあれば何もしない（二重実行でも履歴は1行）。
 */
export async function recordMenuVersion(
  db: D1Database,
  input: { menuId: string; staffId?: string | null },
): Promise<{ version: number } | null> {
  const row = await db.prepare(
    `SELECT id, name, category_label, description,
            duration_minutes, buffer_after_minutes, base_price, price_mode,
            sort_order, is_active, version,
            booking_window_days, cutoff_hours_before,
            cancel_deadline_hours_before, intake_question, concurrent_capacity
       FROM menus WHERE id = ? AND deleted_at IS NULL`,
  ).bind(input.menuId).first<MenusContentRow>();
  if (!row) return null;
  await db.prepare(
    `INSERT OR IGNORE INTO menu_versions
      (id, menu_id, version_number, name, category_label, description,
       duration_minutes, buffer_after_minutes, base_price, price_mode,
       sort_order, is_active, rules_json, created_by_staff_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    randomId(),
    row.id,
    Number(row.version),
    row.name,
    row.category_label,
    row.description,
    Number(row.duration_minutes),
    Number(row.buffer_after_minutes),
    Number(row.base_price),
    row.price_mode,
    Number(row.sort_order),
    Number(row.is_active),
    rulesJsonOf(row),
    input.staffId ?? null,
    jstNow(),
  ).run();
  return { version: Number(row.version) };
}

export type MenuVersionStatus = 'in_use' | 'past';

export interface MenuVersionEntry extends MenuVersionRow {
  status: MenuVersionStatus;
  /** ひとこと。「値段 1,000円→8,000円」など。いちばん古い版は「最初の版」。 */
  summary: string;
}

function priceLabel(basePrice: number, priceMode: string): string {
  if (priceMode === 'free') return '無料';
  if (priceMode === 'inquiry') return 'お問い合わせ';
  return `${Number(basePrice).toLocaleString()}円`;
}

function yen(value: number): string {
  return `${Number(value).toLocaleString()}円`;
}

/** ひとつ前の版と比べて、変わった所だけをひとことで出す。 */
export function summarizeMenuVersionChange(
  current: MenuVersionRow,
  previous: MenuVersionRow | null,
): string {
  if (!previous) return '最初の版';
  const parts: string[] = [];
  if (current.name !== previous.name) parts.push(`名前 ${previous.name}→${current.name}`);
  if (Number(current.durationMinutes) !== Number(previous.durationMinutes)) {
    parts.push(`時間 ${previous.durationMinutes}分→${current.durationMinutes}分`);
  }
  if (Number(current.bufferAfterMinutes) !== Number(previous.bufferAfterMinutes)) {
    parts.push(`後片付け ${previous.bufferAfterMinutes}分→${current.bufferAfterMinutes}分`);
  }
  if (current.priceMode !== previous.priceMode
    || Number(current.basePrice) !== Number(previous.basePrice)) {
    parts.push(`値段 ${priceLabel(Number(previous.basePrice), previous.priceMode)}→${priceLabel(Number(current.basePrice), current.priceMode)}`);
  }
  if (Number(current.isActive) !== Number(previous.isActive)) {
    parts.push(Number(current.isActive) === 1 ? '休止中→公開中' : '公開中→休止中');
  }
  let rulesChanged = false;
  try {
    rulesChanged = JSON.stringify(JSON.parse(current.rulesJson)) !== JSON.stringify(JSON.parse(previous.rulesJson));
  } catch {
    rulesChanged = current.rulesJson !== previous.rulesJson;
  }
  if (rulesChanged) parts.push('受付の決まりを変更');
  if ((current.description ?? '') !== (previous.description ?? '')) parts.push('説明文を変更');
  if ((current.categoryLabel ?? '') !== (previous.categoryLabel ?? '')) parts.push('分類を変更');
  return parts.length > 0 ? parts.join('・') : '版番号だけ更新';
}

/**
 * 版の一覧。新しい順。いちばん新しい版だけ「使用中」、ほかは「過去」。
 * 別アカウントのメニューは存在を漏らさない（null）。
 */
export async function listMenuVersions(
  db: D1Database,
  input: { menuId: string; lineAccountId: string },
): Promise<MenuVersionEntry[] | null> {
  const owner = await db.prepare(
    `SELECT id, version FROM menus WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`,
  ).bind(input.menuId, input.lineAccountId).first<{ id: string; version: number }>();
  if (!owner) return null;
  const rows = await db.prepare(
    `SELECT version_number, name, category_label, description,
            duration_minutes, buffer_after_minutes, base_price, price_mode,
            sort_order, is_active, rules_json, created_by_staff_id, created_at
       FROM menu_versions WHERE menu_id = ? ORDER BY version_number DESC`,
  ).bind(input.menuId).all<{
    version_number: number; name: string; category_label: string | null;
    description: string | null; duration_minutes: number; buffer_after_minutes: number;
    base_price: number; price_mode: string; sort_order: number; is_active: number;
    rules_json: string; created_by_staff_id: string | null; created_at: string;
  }>();
  const versions: MenuVersionRow[] = (rows.results ?? []).map((row) => ({
    versionNumber: Number(row.version_number),
    name: row.name,
    categoryLabel: row.category_label,
    description: row.description,
    durationMinutes: Number(row.duration_minutes),
    bufferAfterMinutes: Number(row.buffer_after_minutes),
    basePrice: Number(row.base_price),
    priceMode: row.price_mode,
    sortOrder: Number(row.sort_order),
    isActive: Number(row.is_active),
    rulesJson: row.rules_json,
    createdByStaffId: row.created_by_staff_id,
    createdAt: row.created_at,
  }));
  const byNumber = new Map(versions.map((v) => [v.versionNumber, v]));
  const currentVersion = Number(owner.version);
  return versions.map((version) => ({
    ...version,
    status: version.versionNumber === currentVersion ? 'in_use' : 'past',
    summary: summarizeMenuVersionChange(version, byNumber.get(version.versionNumber - 1) ?? null),
  }));
}

export async function getMenuVersion(
  db: D1Database,
  input: { menuId: string; lineAccountId: string; versionNumber: number },
): Promise<MenuVersionEntry | null> {
  const versions = await listMenuVersions(db, { menuId: input.menuId, lineAccountId: input.lineAccountId });
  return versions?.find((v) => v.versionNumber === input.versionNumber) ?? null;
}

/** 版の中身を比べる画面に出す行。「名前：カット」の形で順に並べる。 */
export function menuVersionContentLines(version: MenuVersionRow): string[] {
  let rules: Record<string, unknown> = {};
  try {
    rules = JSON.parse(version.rulesJson) as Record<string, unknown>;
  } catch {
    rules = {};
  }
  const windowDays = rules.booking_window_days as number | null;
  const cutoff = rules.cutoff_hours_before as number | null;
  const cancel = rules.cancel_deadline_hours_before as number | null;
  const windowLabel = windowDays == null ? '店舗の決まり' : windowDays + '日先まで';
  const cutoffLabel = cutoff == null ? '直前まで' : cutoff + '時間前締切';
  const cancelLabel = cancel == null ? '取消期限なし' : cancel + '時間前まで取消可';
  return [
    `名前：${version.name}`,
    `分類：${version.categoryLabel || '—'}`,
    `説明：${version.description || '—'}`,
    `時間：${version.durationMinutes}分（後片付け${version.bufferAfterMinutes}分）`,
    `値段：${version.priceMode === 'fixed' ? yen(version.basePrice) : priceLabel(version.basePrice, version.priceMode)}`,
    `受付：${windowLabel}・${cutoffLabel}・${cancelLabel}`,
    `状態：${Number(version.isActive) === 1 ? '公開中' : '休止中'}`,
  ];
}

/**
 * この版の中身で新しい版を作る（過去は書き換えない）。
 * 読み直さずに送った古い版は 409 で止める（PUT と同じ守り）。
 */
export async function revertMenuToVersion(
  db: D1Database,
  input: {
    menuId: string;
    lineAccountId: string;
    versionNumber: number;
    expectedVersion: number;
    staffId?: string | null;
  },
): Promise<
  | { status: 'reverted'; version: number }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'not_found' }
> {
  const target = await getMenuVersion(db, {
    menuId: input.menuId,
    lineAccountId: input.lineAccountId,
    versionNumber: input.versionNumber,
  });
  if (!target) return { status: 'not_found' };
  // 版に無い項目（古い形の rules_json など）は、いまの値を残す。
  const currentRow = await db.prepare(
    `SELECT booking_window_days, cutoff_hours_before,
            cancel_deadline_hours_before, intake_question, concurrent_capacity
       FROM menus WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`,
  ).bind(input.menuId, input.lineAccountId).first<{
    booking_window_days: number | null; cutoff_hours_before: number | null;
    cancel_deadline_hours_before: number | null; intake_question: string | null;
    concurrent_capacity: number | null;
  }>();
  if (!currentRow) return { status: 'not_found' };
  let rules: Record<string, unknown> = {};
  try {
    rules = JSON.parse(target.rulesJson) as Record<string, unknown>;
  } catch {
    rules = {};
  }
  const ruleValue = (key: string, fallback: unknown) =>
    (rules[key] === undefined ? fallback : rules[key]);
  const result = await db.prepare(
    `UPDATE menus
        SET name = ?, category_label = ?, description = ?,
            duration_minutes = ?, buffer_after_minutes = ?,
            base_price = ?, price_mode = ?,
            sort_order = ?, is_active = ?,
            booking_window_days = ?, cutoff_hours_before = ?,
            cancel_deadline_hours_before = ?, intake_question = ?,
            concurrent_capacity = ?,
            version = version + 1,
            updated_at = ?
      WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL AND version = ?`,
  ).bind(
    target.name,
    target.categoryLabel,
    target.description,
    target.durationMinutes,
    target.bufferAfterMinutes,
    target.basePrice,
    target.priceMode,
    target.sortOrder,
    target.isActive,
    ruleValue('booking_window_days', currentRow.booking_window_days),
    ruleValue('cutoff_hours_before', currentRow.cutoff_hours_before),
    ruleValue('cancel_deadline_hours_before', currentRow.cancel_deadline_hours_before),
    ruleValue('intake_question', currentRow.intake_question),
    ruleValue('concurrent_capacity', currentRow.concurrent_capacity),
    jstNow(),
    input.menuId,
    input.lineAccountId,
    input.expectedVersion,
  ).run();
  if ((result.meta.changes ?? 0) > 0) {
    await recordMenuVersion(db, { menuId: input.menuId, staffId: input.staffId ?? null });
    return { status: 'reverted', version: input.expectedVersion + 1 };
  }
  const current = await db.prepare(`SELECT version FROM menus
    WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`)
    .bind(input.menuId, input.lineAccountId)
    .first<{ version: number }>();
  if (!current) return { status: 'not_found' };
  return { status: 'conflict', currentVersion: Number(current.version) };
}
