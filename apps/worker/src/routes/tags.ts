import { Hono, type Context } from 'hono';
import {
  getTags,
  getTagsWithUsage,
  getTagDeleteImpact,
  createTag,
  createTagsBulk,
  deleteTag,
  updateTagMileageSettings,
  enqueueHistoricTagMileage,
  getTagGroups,
  createTagGroup,
  updateTagGroup,
  deleteTagGroup,
  assignTagToGroup,
  updateTag,
  reorderTags,
  normalizeTagNameForCleanup,
  createTagDefinition,
  getScopedTagDeleteImpact,
  getTagDefinition,
  TagDefinitionError,
  updateTagDefinition,
} from '@line-crm/db';
import type { Tag as DbTag, TagGroup as DbTagGroup, TagWithUsage } from '@line-crm/db';
import type {
  TagCsvImportInputRow,
  TagCsvImportPreview,
  TagCsvImportResult,
  TagCsvImportRowResult,
  TagCsvImportSummary,
} from '@line-crm/shared';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { CommonActionValidationError, validateActionShape } from '../services/common-actions.js';

const tags = new Hono<Env>();

/**
 * 色を持たないタグ・色を付けていないフォルダのタグに出す灰色。
 *
 * 画面側の `--color-ink-faint` と同じ値。ここで確定した色を返さないと、
 * 受け取る側それぞれで「色が無いときどうするか」を決めることになり、
 * 画面ごとに違う灰色が出る。
 */
const TAG_NEUTRAL_COLOR = '#8b938d';

function serializeTag(row: DbTag & Partial<TagWithUsage>) {
  return {
    id: row.id,
    name: row.name,
    /*
     * 印の色は「属するフォルダの色」。tags.color は 115 以前の名残で、
     * 読まない（画面からも書かない）。フォルダを JOIN していない読み方
     * （作成・更新の戻り）では undefined になるので、そのときは灰色。
     * 一覧を読み直した時点で正しい色に入れ替わる。
     */
    color: row.folder_color ?? TAG_NEUTRAL_COLOR,
    // 099以降はfoldersが正本。group_idは旧tag_groups時代の互換列で、
    // 新しい分類操作では更新されないため参照しない。
    groupId: row.folder_id ?? null,
    mileageReward: Number(row.mileage_reward ?? 0),
    referralMileageReward: Number(row.referral_mileage_reward ?? 0),
    mileageMultiplierBps: row.mileage_multiplier_bps == null
      ? null
      : Number(row.mileage_multiplier_bps),
    mileageMultiplierPriority: Number(row.mileage_multiplier_priority ?? 0),
    // 友だち一覧の「★つきタグ」列に出すか。列が無い環境でも 0 として返す。
    isStarred: Number(row.is_starred ?? 0) === 1,
    displayOrder: Number(row.display_order ?? 0),
    lineAccountId: row.line_account_id ?? null,
    description: row.description ?? null,
    manualAssignmentAllowed: Number(row.manual_assignment_allowed ?? 1) === 1,
    reapplyPolicy: row.reapply_policy ?? 'first_only',
    linkedEnabled: Number(row.linked_enabled ?? 0) === 1,
    status: row.status ?? 'active',
    version: Number(row.version ?? 1),
    updatedAt: row.updated_at ?? row.created_at,
    createdAt: row.created_at,
    ...(row.friend_count !== undefined ? { friendCount: row.friend_count } : {}),
    ...(row.assign_source ? { assignSource: row.assign_source } : {}),
    ...((row.used_in_broadcasts ?? 0) > 0
      || (row.used_in_forms ?? 0) > 0
      || (row.used_in_scenarios ?? 0) > 0
      || (row.used_in_auto_replies ?? 0) > 0
      || (row.used_in_saved_searches ?? 0) > 0
      ? {
          usedIn: {
            ...((row.used_in_broadcasts ?? 0) > 0
              ? { broadcasts: Number(row.used_in_broadcasts) } : {}),
            ...((row.used_in_forms ?? 0) > 0
              ? { forms: Number(row.used_in_forms) } : {}),
            ...((row.used_in_scenarios ?? 0) > 0
              ? { scenarios: Number(row.used_in_scenarios) } : {}),
            ...((row.used_in_auto_replies ?? 0) > 0
              ? { autoReplies: Number(row.used_in_auto_replies) } : {}),
            ...((row.used_in_saved_searches ?? 0) > 0
              ? { savedSearches: Number(row.used_in_saved_searches) } : {}),
          },
        }
      : {}),
    ...((row.other_action_count ?? 0) > 0
      ? { otherActionCount: Number(row.other_action_count) }
      : {}),
    ...(row.cleanup_reasons !== undefined
      ? { cleanupReasons: row.cleanup_reasons }
      : {}),
  };
}

function requestedLineAccountId(c: Context<Env>, body?: Record<string, unknown>): string | null {
  const value = body?.lineAccountId
    ?? body?.accountId
    ?? c.req.query('lineAccountId')
    ?? c.req.query('account_id');
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function requireVisibleLineAccount(c: Context<Env>, id: string): Promise<Response | null> {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!scope.ids.includes(id)) {
    return c.json({ success: false, error: '対象のLINE公式アカウントが見つかりません' }, 404);
  }
  return null;
}

function tagDefinitionError(c: Context<Env>, error: unknown): Response | null {
  if (error instanceof TagDefinitionError) {
    const status = error.code === 'not_found' || error.code === 'folder_not_found' ? 404 : 409;
    return c.json({ success: false, code: error.code, error: error.message }, status);
  }
  if (error instanceof CommonActionValidationError) {
    return c.json({
      success: false,
      code: error.code,
      error: error.message,
      ...(error.field ? { field: error.field } : {}),
    }, 422);
  }
  if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
    return c.json({ success: false, code: 'name_conflict', error: '同じ名前のタグがあります' }, 409);
  }
  return null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function nullableText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === 'string' ? value.trim() || null : undefined;
}

function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CommonActionValidationError(
      'value_invalid',
      `${field}は${minimum}〜${maximum}の整数で指定してください`,
      field,
    );
  }
  return parsed;
}

function parseMileage(value: unknown, required: boolean) {
  if (value === undefined && !required) return undefined;
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const multiplierRaw = source.multiplier;
  const multiplier = multiplierRaw === undefined || multiplierRaw === null || multiplierRaw === ''
    ? null
    : integer(multiplierRaw, 0, 1000, 100000, 'mileage.multiplier');
  return {
    self: integer(source.self, 0, 0, 1_000_000, 'mileage.self'),
    referrer: integer(source.referrer, 0, 0, 1_000_000, 'mileage.referrer'),
    multiplier,
    priority: integer(source.priority, 0, 0, 1000, 'mileage.priority'),
  };
}

function parseActions(value: unknown) {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.length === 0) return [];
  return validateActionShape(value);
}

function tagDefinitionResponse(detail: Awaited<ReturnType<typeof getTagDefinition>>) {
  if (!detail) return null;
  const tag = serializeTag(detail.tag);
  return {
    // 旧画面は data.id を読む。新契約は data.tag.id を読むため両方を返す。
    ...tag,
    tag,
    automation: detail.automation,
  };
}

function serializeTagGroup(row: DbTagGroup) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: Number(row.sort_order ?? 0),
    // 色はフォルダに付く。属するタグの印にこの色を出す。
    color: row.color ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 色は #RRGGBB だけ。名前付きの色を混ぜると画面での見た目が揃わない。 */
const GROUP_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const TAG_IMPORT_MAX_ROWS = 500;
const TAG_NAME_MAX_LENGTH = 60;
const TAG_NAME_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;

type PlannedTagImportRow = TagCsvImportRowResult & { groupId?: string | null };

function importSummary(rows: TagCsvImportRowResult[]): TagCsvImportSummary {
  return {
    total: rows.length,
    ready: rows.filter((row) => row.status === 'ready').length,
    created: rows.filter((row) => row.status === 'created').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
    invalid: rows.filter((row) => row.status === 'invalid').length,
    failed: rows.filter((row) => row.status === 'failed').length,
  };
}

function importOutcome(summary: TagCsvImportSummary): TagCsvImportResult['outcome'] {
  const rejected = summary.invalid + summary.failed;
  if (summary.created > 0 && rejected > 0) return 'partial';
  if (summary.created === 0 && rejected > 0) return 'failed';
  return 'success';
}

function parseImportRows(body: unknown):
  | { ok: true; rows: TagCsvImportInputRow[] }
  | { ok: false; status: 400 | 422; error: string } {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { rows?: unknown }).rows)) {
    return { ok: false, status: 400, error: 'rows is required' };
  }
  const rows = (body as { rows: unknown[] }).rows;
  if (rows.length === 0) {
    return { ok: false, status: 400, error: 'rows must not be empty' };
  }
  if (rows.length > TAG_IMPORT_MAX_ROWS) {
    return {
      ok: false,
      status: 422,
      error: `一度に登録できるのは${TAG_IMPORT_MAX_ROWS}件までです`,
    };
  }
  return {
    ok: true,
    rows: rows.map((raw, index) => {
      const source = raw && typeof raw === 'object'
        ? raw as { line?: unknown; name?: unknown; folderName?: unknown }
        : {};
      const line = Number(source.line);
      return {
        line: Number.isInteger(line) && line > 0 ? line : index + 2,
        name: typeof source.name === 'string' ? source.name : '',
        folderName: typeof source.folderName === 'string' ? source.folderName : '',
      };
    }),
  };
}

function planTagImport(
  inputRows: TagCsvImportInputRow[],
  existingTags: DbTag[],
  groups: DbTagGroup[],
): PlannedTagImportRow[] {
  const existingNames = new Set(
    existingTags.map((tag) => normalizeTagNameForCleanup(tag.name)).filter(Boolean),
  );
  const groupsByName = new Map<string, DbTagGroup[]>();
  for (const group of groups) {
    const key = normalizeTagNameForCleanup(group.name);
    groupsByName.set(key, [...(groupsByName.get(key) ?? []), group]);
  }
  const acceptedNames = new Set<string>();

  return inputRows.map((input, index) => {
    const line = input.line ?? index + 2;
    const name = input.name.trim();
    const folderName = (input.folderName ?? '').trim();
    const base = { line, name, folderName };
    if (!name) {
      return { ...base, status: 'invalid', code: 'name_required', message: 'タグ名を入力してください' };
    }
    const nameCharacters = Array.from(name);
    if (nameCharacters.length > TAG_NAME_MAX_LENGTH) {
      return {
        ...base,
        status: 'invalid',
        code: 'name_too_long',
        message: `タグ名は${TAG_NAME_MAX_LENGTH}文字以内にしてください`,
      };
    }
    const invalidCharacterIndex = nameCharacters.findIndex((character) =>
      TAG_NAME_CONTROL_CHARACTER_PATTERN.test(character));
    if (invalidCharacterIndex >= 0) {
      return {
        ...base,
        status: 'invalid',
        code: 'invalid_character',
        message: `改行や制御文字はタグ名に使えません（${invalidCharacterIndex + 1}文字目）`,
      };
    }

    const normalizedName = normalizeTagNameForCleanup(name);
    if (existingNames.has(normalizedName)) {
      return {
        ...base,
        status: 'skipped',
        code: 'already_exists',
        message: '同じ名前のタグがすでにあります',
      };
    }
    if (acceptedNames.has(normalizedName)) {
      return {
        ...base,
        status: 'skipped',
        code: 'duplicate_in_file',
        message: 'CSV内で同じタグ名が重複しています',
      };
    }

    let groupId: string | null = null;
    if (folderName) {
      const matches = groupsByName.get(normalizeTagNameForCleanup(folderName)) ?? [];
      if (matches.length === 0) {
        acceptedNames.add(normalizedName);
        return {
          ...base,
          status: 'ready',
          code: 'folder_not_found',
          message: 'フォルダが見つからないため、未分類として登録します',
          groupId: null,
        };
      }
      if (matches.length > 1) {
        return {
          ...base,
          status: 'invalid',
          code: 'folder_ambiguous',
          message: '同じ名前のフォルダが複数あるため選べません',
        };
      }
      groupId = matches[0].id;
    }

    acceptedNames.add(normalizedName);
    return { ...base, status: 'ready', groupId };
  });
}

async function loadTagImportPlan(
  db: D1Database,
  inputRows: TagCsvImportInputRow[],
): Promise<PlannedTagImportRow[]> {
  const [existingTags, groups] = await Promise.all([getTags(db), getTagGroups(db)]);
  return planTagImport(inputRows, existingTags, groups);
}

function publicImportRow(row: PlannedTagImportRow): TagCsvImportRowResult {
  const { groupId: _groupId, ...result } = row;
  return result;
}

async function readImportRows(c: Context<Env>): Promise<
  | { ok: true; rows: TagCsvImportInputRow[] }
  | { ok: false; status: 400 | 422; error: string }
> {
  try {
    return parseImportRows(await c.req.json<unknown>());
  } catch {
    return { ok: false, status: 400, error: 'JSON形式のrowsを送ってください' };
  }
}

// --- タグの親分類 ---------------------------------------------------------
//
// 分類そのものの読み書き。個々のタグの所属は PATCH /api/tags/:id/group で扱う。
// 経路を /api/tag-groups にしているのは、/api/tags/:id と衝突させないため
// （Hono は先に登録した方が勝つので、/api/tags/groups だと :id に食われる）。

// GET /api/tag-groups
tags.get('/api/tag-groups', async (c) => {
  try {
    const items = await getTagGroups(c.env.DB);
    return c.json({ success: true, data: items.map(serializeTagGroup) });
  } catch (err) {
    console.error('GET /api/tag-groups error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tag-groups
tags.post('/api/tag-groups', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name?: unknown; sortOrder?: unknown; color?: unknown }>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: 'name is required' }, 400);
    let color: string | null = null;
    if (body.color !== undefined && body.color !== null && body.color !== '') {
      const raw = String(body.color);
      if (!GROUP_COLOR_PATTERN.test(raw)) {
        return c.json({ success: false, error: '色は #RRGGBB の形で指定してください' }, 400);
      }
      color = raw;
    }
    if (name.length > 60) {
      return c.json({ success: false, error: 'name must be 60 characters or fewer' }, 400);
    }
    const sortOrder = body.sortOrder === undefined ? 0 : Number(body.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000) {
      return c.json(
        { success: false, error: 'sortOrder must be an integer between 0 and 10000' },
        400,
      );
    }
    const group = await createTagGroup(c.env.DB, { name, sortOrder, color });
    return c.json({ success: true, data: serializeTagGroup(group) }, 201);
  } catch (err) {
    console.error('POST /api/tag-groups error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tag-groups/:id
tags.patch('/api/tag-groups/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name?: unknown; sortOrder?: unknown; color?: unknown }>();
    const patch: { name?: string; sortOrder?: number; color?: string | null } = {};
    if ('color' in body) {
      const raw = body.color;
      if (raw === null || raw === '') {
        patch.color = null;
      } else {
        const value = String(raw);
        if (!GROUP_COLOR_PATTERN.test(value)) {
          return c.json({ success: false, error: '色は #RRGGBB の形で指定してください' }, 400);
        }
        patch.color = value;
      }
    }
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return c.json({ success: false, error: 'name must not be empty' }, 400);
      if (name.length > 60) {
        return c.json({ success: false, error: 'name must be 60 characters or fewer' }, 400);
      }
      patch.name = name;
    }
    if (body.sortOrder !== undefined) {
      const sortOrder = Number(body.sortOrder);
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000) {
        return c.json(
          { success: false, error: 'sortOrder must be an integer between 0 and 10000' },
          400,
        );
      }
      patch.sortOrder = sortOrder;
    }
    const group = await updateTagGroup(c.env.DB, c.req.param('id'), patch);
    if (!group) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeTagGroup(group) });
  } catch (err) {
    console.error('PATCH /api/tag-groups/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/tag-groups/:id
// 属していたタグは消えず「未分類」に戻る（tags.folder_id は ON DELETE SET NULL）。
tags.delete('/api/tag-groups/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    await deleteTagGroup(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/tag-groups/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tags/:id/group - move one tag into a group (null = 未分類)
tags.patch('/api/tags/:id/group', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ groupId?: unknown }>();
    const raw = body.groupId;
    const groupId = raw === null || raw === '' || raw === undefined ? null : String(raw);
    const tag = await assignTagToGroup(c.env.DB, c.req.param('id'), groupId);
    if (!tag) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeTag(tag) });
  } catch (err) {
    // 存在しない分類を指定した場合。500 にすると原因が分からない。
    if (err instanceof Error && err.message.includes('FOREIGN KEY constraint')) {
      return c.json({ success: false, error: 'group not found' }, 400);
    }
    console.error('PATCH /api/tags/:id/group error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/tags - list all tags
// ?withCounts=1 adds friendCount and usage aggregates — admin UI only, so
// the many picker/filter consumers keep the cheap plain SELECT.
tags.get('/api/tags', async (c) => {
  try {
    const withCounts = c.req.query('withCounts') === '1';
    const items = withCounts
      ? await getTagsWithUsage(c.env.DB)
      : await getTags(c.env.DB);
    return c.json({ success: true, data: items.map(serializeTag) });
  } catch (err) {
    console.error('GET /api/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tags/import/preview - CSVから読み取った行を保存せずに検査する
tags.post('/api/tags/import/preview', requireRole('owner', 'admin'), async (c) => {
  try {
    const input = await readImportRows(c);
    if (!input.ok) {
      return c.json({ success: false, error: input.error }, input.status);
    }
    const planned = await loadTagImportPlan(c.env.DB, input.rows);
    const rows = planned.map(publicImportRow);
    const data: TagCsvImportPreview = { summary: importSummary(rows), rows };
    return c.json({ success: true, data });
  } catch (err) {
    console.error('POST /api/tags/import/preview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tags/import - 検査をやり直し、登録可能な行だけを登録する
tags.post('/api/tags/import', requireRole('owner', 'admin'), async (c) => {
  try {
    const input = await readImportRows(c);
    if (!input.ok) {
      return c.json({ success: false, error: input.error }, input.status);
    }
    const planned = await loadTagImportPlan(c.env.DB, input.rows);
    const readyRows = planned.filter((row) => row.status === 'ready');
    const created = readyRows.length > 0
      ? await createTagsBulk(
          c.env.DB,
          readyRows.map((row) => ({ name: row.name, groupId: row.groupId ?? null })),
        )
      : [];
    let createIndex = 0;
    const rows: TagCsvImportRowResult[] = planned.map((row) => {
      if (row.status !== 'ready') return publicImportRow(row);
      const result = created[createIndex++];
      if (result?.status === 'created') {
        return { ...publicImportRow(row), status: 'created', tagId: result.tagId };
      }
      if (result?.status === 'skipped') {
        return {
          ...publicImportRow(row),
          status: 'skipped',
          code: 'already_exists',
          message: '同じ名前のタグが先に登録されたため見送りました',
        };
      }
      return {
        ...publicImportRow(row),
        status: 'failed',
        code: 'create_failed',
        message: 'タグを登録できませんでした',
      };
    });

    const summary = importSummary(rows);
    const data: TagCsvImportResult = { summary, rows, outcome: importOutcome(summary) };
    return c.json({ success: true, data });
  } catch (err) {
    console.error('POST /api/tags/import error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/tags/:id/delete-impact - 削除前に失われる付与と設定を確認する
tags.get(
  '/api/tags/:id/delete-impact',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const lineAccountId = requestedLineAccountId(c);
      if (lineAccountId) {
        const denied = await requireVisibleLineAccount(c, lineAccountId);
        if (denied) return denied;
      }
      const impact = lineAccountId
        ? await getScopedTagDeleteImpact(c.env.DB, c.req.param('id'), lineAccountId)
        : await getTagDeleteImpact(c.env.DB, c.req.param('id'));
      if (!impact) return c.json({ success: false, error: 'Not found' }, 404);
      return c.json({ success: true, data: impact });
    } catch (err) {
      console.error('GET /api/tags/:id/delete-impact error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// 正本名。旧画面の delete-impact は件数オブジェクトを維持し、こちらは明細配列を返す。
tags.get('/api/tags/:id/dependencies', requireRole('owner', 'admin'), async (c) => {
  try {
    const lineAccountId = requestedLineAccountId(c);
    if (!lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    const denied = await requireVisibleLineAccount(c, lineAccountId);
    if (denied) return denied;
    const impact = await getScopedTagDeleteImpact(c.env.DB, c.req.param('id'), lineAccountId);
    if (!impact) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: {
        ...impact,
        referenceCounts: impact.references,
        references: impact.referenceItems,
      },
    });
  } catch (error) {
    console.error('GET /api/tags/:id/dependencies error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/tags/:id?withActions=1 - タグ設定と共通アクション下書きを同時に読む
tags.get('/api/tags/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const lineAccountId = requestedLineAccountId(c);
    if (!lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    const denied = await requireVisibleLineAccount(c, lineAccountId);
    if (denied) return denied;
    const detail = await getTagDefinition(c.env.DB, c.req.param('id'), lineAccountId);
    if (!detail) return c.json({ success: false, error: 'tag not found' }, 404);
    return c.json({
      success: true,
      data: c.req.query('withActions') === '1'
        ? tagDefinitionResponse(detail)
        : serializeTag(detail.tag),
    });
  } catch (error) {
    console.error('GET /api/tags/:id error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * PATCH /api/tags/reorder — 並び順をまとめて書く。
 *
 * 経路が /api/tags/:id より前にあるのは、:id に "reorder" として
 * 食われないようにするため。/api/tag-groups を分けているのと同じ理由。
 */
tags.patch('/api/tags/reorder', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ ids?: unknown }>();
    if (!Array.isArray(body.ids) || body.ids.some((v) => typeof v !== 'string')) {
      return c.json({ success: false, error: 'ids must be an array of tag ids' }, 400);
    }
    // 画面に出ている数より極端に多い並びは受けない。取り違えか壊れた要求。
    if (body.ids.length > 500) {
      return c.json({ success: false, error: 'too many ids' }, 400);
    }
    if (new Set(body.ids).size !== body.ids.length) {
      return c.json({ success: false, error: 'ids must not contain duplicates' }, 400);
    }
    await reorderTags(c.env.DB, body.ids as string[]);
    return c.json({ success: true, data: { updated: body.ids.length } });
  } catch (err) {
    console.error('PATCH /api/tags/reorder error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * PATCH /api/tags/:id — 名前と色を変える。
 *
 * 一覧の表からマイルの列を外して編集画面へ移したときに要るようになった。
 * それまでは作るときにしか決められず、打ち間違えたタグは消して作り直す
 * しかなかった。作り直すと、付いていた友だちの分がすべて外れる。
 *
 * 分類の付け替えは /group、マイルは /mileage が持っている。ここでは
 * 触らない。
 */
tags.patch('/api/tags/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    if (body.expectedVersion !== undefined) {
      const lineAccountId = requestedLineAccountId(c, body);
      if (!lineAccountId) {
        return c.json({ success: false, error: 'lineAccountId is required' }, 400);
      }
      const denied = await requireVisibleLineAccount(c, lineAccountId);
      if (denied) return denied;
      const expectedVersion = integer(body.expectedVersion, 0, 1, Number.MAX_SAFE_INTEGER, 'expectedVersion');
      const name = text(body.name);
      if (body.name !== undefined && (!name || name.length > 80)) {
        return c.json({ success: false, error: 'name must be between 1 and 80 characters' }, 400);
      }
      const reapplyPolicy = body.reapplyPolicy;
      if (reapplyPolicy !== undefined
        && reapplyPolicy !== 'first_only'
        && reapplyPolicy !== 'every_time') {
        return c.json({ success: false, error: 'reapplyPolicy is invalid' }, 400);
      }
      const actions = parseActions(
        body.actions ?? (body.automationDraft as Record<string, unknown> | undefined)?.actions,
      );
      const detail = await updateTagDefinition(c.env.DB, {
        tagId: c.req.param('id'),
        lineAccountId,
        expectedVersion,
        ...(body.name !== undefined ? { name } : {}),
        ...(body.description !== undefined ? { description: nullableText(body.description) } : {}),
        ...(body.groupId !== undefined
          ? { groupId: body.groupId === null || body.groupId === '' ? null : String(body.groupId) }
          : {}),
        ...(body.isStarred !== undefined ? { isStarred: body.isStarred === true } : {}),
        ...(body.manualAssignmentAllowed !== undefined
          ? { manualAssignmentAllowed: body.manualAssignmentAllowed === true }
          : {}),
        ...(reapplyPolicy !== undefined ? { reapplyPolicy } : {}),
        ...(body.linkedEnabled !== undefined ? { linkedEnabled: body.linkedEnabled === true } : {}),
        ...(body.mileage !== undefined ? { mileage: parseMileage(body.mileage, true)! } : {}),
        automationId: body.automationId === undefined
          ? undefined
          : body.automationId === null ? null : String(body.automationId),
        automationDraftVersion: body.automationDraftVersion === undefined
          ? undefined
          : body.automationDraftVersion === null ? null : String(body.automationDraftVersion),
        actions,
        actorId: c.get('staff')?.id ?? null,
      });
      const applyToExisting = body.applyToExisting === true;
      const mileage = body.mileage === undefined ? null : parseMileage(body.mileage, true)!;
      const queued = applyToExisting && mileage && (mileage.self > 0 || mileage.referrer > 0)
        ? await enqueueHistoricTagMileage(c.env.DB, detail.tag.id)
        : 0;
      return c.json({
        success: true,
        data: { ...tagDefinitionResponse(detail), queued },
      });
    }

    const legacyBody = body as { name?: unknown; color?: unknown; isStarred?: unknown };
    const patch: { name?: string; color?: string; isStarred?: boolean } = {};

    if (legacyBody.isStarred !== undefined) {
      patch.isStarred = legacyBody.isStarred === true || legacyBody.isStarred === 1;
    }

    if (legacyBody.name !== undefined) {
      const name = typeof legacyBody.name === 'string' ? legacyBody.name.trim() : '';
      if (!name) return c.json({ success: false, error: 'name must not be empty' }, 400);
      patch.name = name;
    }
    if (legacyBody.color !== undefined) {
      const color = typeof legacyBody.color === 'string' ? legacyBody.color.trim() : '';
      // 画面の色見本と自由入力の両方から来る。形だけ見て通す。
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        return c.json({ success: false, error: 'color must be #RRGGBB' }, 400);
      }
      patch.color = color;
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ success: false, error: 'name, color or isStarred is required' }, 400);
    }

    const tag = await updateTag(c.env.DB, c.req.param('id'), patch);
    if (!tag) return c.json({ success: false, error: 'tag not found' }, 404);
    return c.json({ success: true, data: serializeTag(tag) });
  } catch (err) {
    const handled = tagDefinitionError(c, err);
    if (handled) return handled;
    // tags.name は UNIQUE。重複は 500 ではなく 409 で返す。
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: 'tag name already exists' }, 409);
    }
    console.error('PATCH /api/tags/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tags/:id/mileage - configure a one-time tag reward and/or tier multiplier.
tags.patch('/api/tags/:id/mileage', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      rewardMiles?: unknown;
      referralRewardMiles?: unknown;
      multiplierBps?: unknown;
      multiplierPriority?: unknown;
      applyToExisting?: unknown;
    }>();
    const rewardMiles = Number(body.rewardMiles ?? 0);
    const referralRewardMiles = Number(body.referralRewardMiles ?? 0);
    const multiplierBps = body.multiplierBps === null || body.multiplierBps === ''
      ? null
      : Number(body.multiplierBps);
    const multiplierPriority = Number(body.multiplierPriority ?? 0);
    const applyToExisting = body.applyToExisting === true;
    if (!Number.isInteger(rewardMiles) || rewardMiles < 0 || rewardMiles > 1_000_000) {
      return c.json({ success: false, error: 'rewardMiles must be an integer between 0 and 1000000' }, 400);
    }
    if (!Number.isInteger(referralRewardMiles) || referralRewardMiles < 0 || referralRewardMiles > 1_000_000) {
      return c.json({ success: false, error: 'referralRewardMiles must be an integer between 0 and 1000000' }, 400);
    }
    if (multiplierBps !== null && (
      !Number.isInteger(multiplierBps) || multiplierBps < 1000 || multiplierBps > 100000
    )) {
      return c.json({ success: false, error: 'multiplierBps must be null or an integer between 1000 and 100000' }, 400);
    }
    if (!Number.isInteger(multiplierPriority) || multiplierPriority < 0 || multiplierPriority > 1000) {
      return c.json({ success: false, error: 'multiplierPriority must be an integer between 0 and 1000' }, 400);
    }

    const tag = await updateTagMileageSettings(c.env.DB, c.req.param('id'), {
      rewardMiles,
      referralRewardMiles,
      multiplierBps,
      multiplierPriority,
    });
    if (!tag) return c.json({ success: false, error: 'Not found' }, 404);
    // 保存しただけで既存ユーザーへ付与しない。運用中アカウントでは影響が
    // 大きいため、画面で遡及を明示したときだけキューへ積む。
    const queued = applyToExisting && (rewardMiles > 0 || referralRewardMiles > 0)
      ? await enqueueHistoricTagMileage(c.env.DB, tag.id)
      : 0;
    return c.json({ success: true, data: { tag: serializeTag(tag), queued } });
  } catch (err) {
    console.error('PATCH /api/tags/:id/mileage error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tags - create tag
tags.post('/api/tags', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();

    const lineAccountId = requestedLineAccountId(c, body);
    const usesV6Contract = lineAccountId !== null
      || body.reapplyPolicy !== undefined
      || body.linkedEnabled !== undefined
      || body.mileage !== undefined
      || body.automationDraft !== undefined;
    if (usesV6Contract) {
      if (!lineAccountId) {
        return c.json({ success: false, error: 'lineAccountId is required' }, 400);
      }
      const denied = await requireVisibleLineAccount(c, lineAccountId);
      if (denied) return denied;
      const name = text(body.name) ?? '';
      if (!name || name.length > 80) {
        return c.json({ success: false, error: 'name must be between 1 and 80 characters' }, 400);
      }
      const reapplyPolicy = body.reapplyPolicy ?? 'first_only';
      if (reapplyPolicy !== 'first_only' && reapplyPolicy !== 'every_time') {
        return c.json({ success: false, error: 'reapplyPolicy is invalid' }, 400);
      }
      if (body.applyToExisting === true) {
        return c.json({ success: false, error: 'new tags cannot be applied retroactively' }, 400);
      }
      const automationDraft = body.automationDraft && typeof body.automationDraft === 'object'
        && !Array.isArray(body.automationDraft)
        ? body.automationDraft as Record<string, unknown>
        : {};
      const actions = parseActions(automationDraft.actions ?? body.actions) ?? [];
      const detail = await createTagDefinition(c.env.DB, {
        lineAccountId,
        name,
        description: nullableText(body.description),
        groupId: body.groupId === null || body.groupId === '' || body.groupId === undefined
          ? null
          : String(body.groupId),
        isStarred: body.isStarred === true,
        manualAssignmentAllowed: body.manualAssignmentAllowed !== false,
        reapplyPolicy,
        linkedEnabled: body.linkedEnabled === true,
        mileage: parseMileage(body.mileage, true)!,
        actions,
        actorId: c.get('staff')?.id ?? null,
      });
      return c.json({ success: true, data: tagDefinitionResponse(detail) }, 201);
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    const tag = await createTag(c.env.DB, {
      name,
      color: typeof body.color === 'string' ? body.color : undefined,
      groupId:
        body.groupId === null || body.groupId === '' || body.groupId === undefined
          ? null
          : String(body.groupId),
    });

    return c.json({ success: true, data: serializeTag(tag) }, 201);
  } catch (err) {
    const handled = tagDefinitionError(c, err);
    if (handled) return handled;
    // tags.name has a UNIQUE constraint — surface duplicates as 409, not 500
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: 'tag name already exists' }, 409);
    }
    if (err instanceof Error && err.message.includes('FOREIGN KEY constraint')) {
      return c.json({ success: false, error: 'group not found' }, 400);
    }
    console.error('POST /api/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/tags/:id - delete tag
// 画面を通さず直接APIを呼ばれても、運用設定から参照中のタグは消さない。
// friend_tags rows cascade via FK (ON DELETE CASCADE) and do not block deletion;
// the delete-impact response still reports their count as a warning.
// The FK error remains a second guard for references created between this check
// and the DELETE, or references that are not yet covered by the impact query.
tags.delete('/api/tags/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const impact = await getTagDeleteImpact(c.env.DB, id);
    if (!impact) {
      return c.json({ success: false, error: 'tag not found' }, 404);
    }
    if (!impact.canDelete) {
      return c.json({
        success: false,
        code: 'TAG_IN_USE',
        error: 'tag is referenced by active settings',
        data: {
          blockingReferenceCount: impact.blockingReferenceCount,
          references: impact.references,
        },
      }, 409);
    }
    await deleteTag(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    if (err instanceof Error && err.message.includes('FOREIGN KEY constraint')) {
      return c.json(
        { success: false, error: 'tag is referenced by other records (e.g. affiliate offers)' },
        409,
      );
    }
    console.error('DELETE /api/tags/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { tags };
