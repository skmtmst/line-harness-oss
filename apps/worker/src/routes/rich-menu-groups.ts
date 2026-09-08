import { Hono } from 'hono';
import {
  getRichMenuGroups,
  getRichMenuGroupById,
  getRichMenuGroupWithPages,
  getRichMenuDeleteImpact,
  createRichMenuGroup,
  updateRichMenuGroupMeta,
  replaceRichMenuPages,
  deleteRichMenuGroup,
  setRichMenuPageImage,
  pageBelongsToGroup,
  acquirePublishLock,
  releasePublishLock,
  setPageRichMenuId,
  markRichMenuGroupPublished,
  markRichMenuGroupUnpublished,
  getLineAccountById,
  getFollowingLineUserIdsByTag,
  getTrackedLinkById,
  getRichMenuTapStats,
  getRichMenuAudienceStats,
  getAssociableTemplate,
  recordRichMenuAssignmentsByLineUserIds,
  clearRichMenuAssignmentsForGroup,
  jstNow,
  type RichMenuGroup,
  type RichMenuGroupWithPages,
  type RichMenuPageInput,
  type RichMenuAreaInput,
  type CreateRichMenuGroupInput,
  type UpdateRichMenuGroupMetaInput,
} from '@line-crm/db';
import {
  RICH_MENU_ACTION_TYPE_BY_INTENT,
  RICH_MENU_DIMENSIONS,
  type RichMenuAreaIntent,
} from '@line-crm/shared';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { validateRichMenuImage } from '../lib/image-validator.js';
import { resolveTrackedLinkBaseUrl } from '../lib/link-base-url.js';
import { currentMonthRange } from '../lib/jst-range.js';
import { buildOffsetListResponse, parseOffsetPaging } from '../lib/list-paging.js';
import {
  buildSegmentWhere,
  parseCondition,
  type SegmentCondition,
} from '../services/segment-query.js';
import {
  publishRichMenuGroup,
  unpublishRichMenuGroup,
  linkRichMenuBulkChunked,
  RichMenuValidationError,
  type LineRichMenuClient,
  type R2Like,
  type GroupInput,
} from '../lib/rich-menu-publisher.js';

export const richMenuGroups = new Hono<Env>();

// ----- Serialization (snake_case row → camelCase response) -----

function serializeGroup(row: RichMenuGroup) {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    chatBarText: row.chat_bar_text,
    size: row.size,
    defaultPageId: row.default_page_id,
    isDefaultForAll: row.is_default_for_all === 1,
    status: row.status,
    publishingAt: row.publishing_at,
    targetingCondition: row.targeting_condition,
    targetingPriority: row.targeting_priority,
    targetingEnabled: row.targeting_enabled === 1,
    folderId: row.folder_id,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeGroupWithPages(row: RichMenuGroupWithPages) {
  return {
    ...serializeGroup(row),
    pages: row.pages.map((p) => ({
      id: p.id,
      orderIndex: p.order_index,
      name: p.name,
      aliasId: p.alias_id,
      lineRichmenuId: p.line_richmenu_id,
      imageR2Key: p.image_r2_key,
      imageContentType: p.image_content_type,
      areas: p.areas.map((a) => ({
        id: a.id,
        boundsX: a.bounds_x,
        boundsY: a.bounds_y,
        boundsWidth: a.bounds_width,
        boundsHeight: a.bounds_height,
        actionType: a.action_type,
        actionData: a.actionData,
        intent: a.intent,
        label: a.label,
        tagIds: a.tagIds,
        scoreChange: a.score_change,
        templateId: a.template_id,
        formId: a.form_id,
        trackedLinkId: a.tracked_link_id,
      })),
    })),
  };
}

type ExternalLineArea = {
  bounds?: { x?: number; y?: number; width?: number; height?: number };
  action?: {
    type?: string;
    label?: string;
    uri?: string;
    text?: string;
    displayText?: string;
    richMenuAliasId?: string;
  };
};

/** LINE 未管理メニューの動きを、画面が安全に説明できる最小形へ絞る。 */
function serializeExternalArea(area: ExternalLineArea) {
  const type = typeof area.action?.type === 'string' ? area.action.type : 'unknown';
  const supported = type === 'uri'
    ? typeof area.action?.uri === 'string'
    : type === 'message'
      ? typeof area.action?.text === 'string'
      : type === 'postback' || type === 'richmenuswitch';
  return {
    bounds: {
      x: typeof area.bounds?.x === 'number' ? area.bounds.x : null,
      y: typeof area.bounds?.y === 'number' ? area.bounds.y : null,
      width: typeof area.bounds?.width === 'number' ? area.bounds.width : null,
      height: typeof area.bounds?.height === 'number' ? area.bounds.height : null,
    },
    action: {
      type,
      label: typeof area.action?.label === 'string' ? area.action.label : null,
      url: type === 'uri' && typeof area.action?.uri === 'string' ? area.action.uri : null,
      text: type === 'message' && typeof area.action?.text === 'string' ? area.action.text : null,
      displayText: type === 'postback' && typeof area.action?.displayText === 'string'
        ? area.action.displayText
        : null,
      richMenuAliasId: type === 'richmenuswitch' && typeof area.action?.richMenuAliasId === 'string'
        ? area.action.richMenuAliasId
        : null,
      supported,
      unsupportedReason: supported ? null : 'unsupported_or_incomplete_action',
    },
  };
}

// ----- Input parsing / validation -----

const VALID_SIZES = new Set(['large', 'compact']);
const VALID_ACTION_TYPES = new Set(['uri', 'message', 'postback', 'richmenuswitch']);
// intent が決まれば、LINE に登録するときの種類も決まる。
// 取りこぼしがあればここでコンパイルが落ちる。
// （db 側の定数をそのまま使わないのは、この経路を試験するとき db 全体を
//   差し替えることがあり、実行時の値が消えるため）
const VALID_INTENTS = new Set<string>(Object.keys(RICH_MENU_ACTION_TYPE_BY_INTENT));

/** 受けたJSONが `{...}` の形かを確かめる（`as` 断定の代わり）。 */
function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseAreaInput(raw: unknown): Parsed<RichMenuAreaInput> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'area must be object' };
  const r = raw as Record<string, unknown>;
  const fields: (keyof RichMenuAreaInput)[] = ['boundsX', 'boundsY', 'boundsWidth', 'boundsHeight'];
  for (const f of fields) {
    if (typeof r[f] !== 'number' || !Number.isFinite(r[f]) || (r[f] as number) < 0) {
      return { ok: false, error: `area.${f} must be a non-negative number` };
    }
  }
  if ((r.boundsWidth as number) <= 0 || (r.boundsHeight as number) <= 0) {
    return { ok: false, error: 'area width/height must be positive' };
  }
  if (typeof r.actionType !== 'string' || !VALID_ACTION_TYPES.has(r.actionType)) {
    return { ok: false, error: `area.actionType must be one of ${[...VALID_ACTION_TYPES].join('/')}` };
  }
  if (!r.actionData || typeof r.actionData !== 'object') {
    return { ok: false, error: 'area.actionData must be object' };
  }
  if (r.id !== undefined && r.id !== null && (typeof r.id !== 'string' || r.id.length === 0)) {
    return { ok: false, error: 'area.id must be non-empty string when present' };
  }
  if (
    r.intent !== undefined &&
    r.intent !== null &&
    (typeof r.intent !== 'string' || !VALID_INTENTS.has(r.intent))
  ) {
    return { ok: false, error: `area.intent must be one of ${[...VALID_INTENTS].join('/')}` };
  }
  if (r.label !== undefined && r.label !== null && typeof r.label !== 'string') {
    return { ok: false, error: 'area.label must be string' };
  }
  if (typeof r.label === 'string' && [...r.label].length > 60) {
    return { ok: false, error: 'area.label must be 60 characters or fewer' };
  }
  if (r.tagIds !== undefined && r.tagIds !== null) {
    if (!Array.isArray(r.tagIds) || r.tagIds.some((t) => typeof t !== 'string' || t.length === 0)) {
      return { ok: false, error: 'area.tagIds must be an array of non-empty strings' };
    }
    if (r.tagIds.length > 20) {
      return { ok: false, error: 'area.tagIds must be 20 items or fewer' };
    }
  }
  if (
    r.scoreChange !== undefined &&
    r.scoreChange !== null &&
    (typeof r.scoreChange !== 'number' || !Number.isInteger(r.scoreChange))
  ) {
    return { ok: false, error: 'area.scoreChange must be an integer' };
  }
  for (const key of ['templateId', 'formId', 'trackedLinkId'] as const) {
    const v = r[key];
    if (v !== undefined && v !== null && (typeof v !== 'string' || v.length === 0)) {
      return { ok: false, error: `area.${key} must be non-empty string when present` };
    }
  }
  // intent が来ているなら、LINE に登録するときの種類は intent から決め直す。
  // 画面が送ってくる actionType とずれていると、publish の途中で
  // 「切り替え先の解決」などが素通りして LINE 側が 400 を返す。
  const intent = (typeof r.intent === 'string' ? r.intent : null) as RichMenuAreaIntent | null;
  const actionType = intent
    ? RICH_MENU_ACTION_TYPE_BY_INTENT[intent]
    : (r.actionType as RichMenuAreaInput['actionType']);

  return {
    ok: true,
    value: {
      id: typeof r.id === 'string' ? r.id : undefined,
      boundsX: r.boundsX as number,
      boundsY: r.boundsY as number,
      boundsWidth: r.boundsWidth as number,
      boundsHeight: r.boundsHeight as number,
      actionType,
      actionData: r.actionData as Record<string, unknown>,
      intent,
      label: typeof r.label === 'string' ? r.label : null,
      tagIds: Array.isArray(r.tagIds) ? (r.tagIds as string[]) : null,
      scoreChange: typeof r.scoreChange === 'number' ? r.scoreChange : null,
      templateId: typeof r.templateId === 'string' ? r.templateId : null,
      formId: typeof r.formId === 'string' ? r.formId : null,
      trackedLinkId: typeof r.trackedLinkId === 'string' ? r.trackedLinkId : null,
    },
  };
}

function parsePageInput(raw: unknown): Parsed<RichMenuPageInput> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'page must be object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.length === 0) return { ok: false, error: 'page.name required' };
  if (typeof r.orderIndex !== 'number' || !Number.isInteger(r.orderIndex) || r.orderIndex < 0) {
    return { ok: false, error: 'page.orderIndex must be non-negative integer' };
  }
  if (r.id !== undefined && (typeof r.id !== 'string' || r.id.length === 0)) {
    return { ok: false, error: 'page.id must be non-empty string when present' };
  }
  if (!Array.isArray(r.areas)) return { ok: false, error: 'page.areas must be array' };
  if (r.areas.length > 20) return { ok: false, error: 'page.areas exceeds LINE limit of 20' };
  const areas: RichMenuAreaInput[] = [];
  for (const a of r.areas) {
    const parsed = parseAreaInput(a);
    if (!parsed.ok) return parsed;
    areas.push(parsed.value);
  }
  return {
    ok: true,
    value: {
      id: r.id as string | undefined,
      name: r.name,
      orderIndex: r.orderIndex,
      areas,
    },
  };
}

function parsePages(raw: unknown): Parsed<RichMenuPageInput[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'pages must be a non-empty array' };
  const pages: RichMenuPageInput[] = [];
  for (const p of raw) {
    const parsed = parsePageInput(p);
    if (!parsed.ok) return parsed;
    pages.push(parsed.value);
  }
  // order_index は 0..N-1 で重複なしを必須化。
  const orders = pages.map((p) => p.orderIndex).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i) return { ok: false, error: 'page.orderIndex must be 0..N-1 with no duplicates' };
  }
  // page.id (任意) が指定されている場合、payload 内で重複していないことを保証。
  // 重複していると PATCH の id 維持で existingMap が同じ row を 2 回返し PK 衝突する。
  const seen = new Set<string>();
  for (const p of pages) {
    if (p.id !== undefined) {
      if (seen.has(p.id)) {
        return { ok: false, error: `page.id "${p.id}" is duplicated in pages array` };
      }
      seen.add(p.id);
    }
  }
  return { ok: true, value: pages };
}

/**
 * 再審査対応(#645): ボタンに結びつけるテンプレートは、同一アカウントかつ
 * 公開版であること。未公開・別アカウントは結びつけられない。
 */
async function validateAreaTemplates(
  db: D1Database,
  accountId: string,
  pages: RichMenuPageInput[],
): Promise<string | null> {
  for (const page of pages) {
    for (const area of page.areas ?? []) {
      if (area.intent === 'template' && area.templateId) {
        const tpl = await getAssociableTemplate(db, area.templateId, accountId);
        if (!tpl) return '選んだテンプレートを確認できません';
      }
    }
  }
  return null;
}

// create では input.page.id がそのまま DB 投入されない (新 UUID で再生成) ため、
// area.actionData.targetPageId が input.page.id を指していても publish 時に解決できない。
// 段階的なフローを促すため、create 時の richmenuswitch action は明示的に拒否する。
// switcher を組みたい場合は作成後 PATCH で追加する。
function rejectRichmenuswitchInCreate(pages: RichMenuPageInput[]): string | null {
  for (const p of pages) {
    for (const a of p.areas) {
      if (a.actionType === 'richmenuswitch') {
        return 'create payload may not include richmenuswitch actions; create the group first, then PATCH with switcher actions';
      }
    }
  }
  return null;
}

function parseCreateBody(raw: unknown): Parsed<CreateRichMenuGroupInput> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.accountId !== 'string' || r.accountId.length === 0) return { ok: false, error: 'accountId required' };
  if (typeof r.name !== 'string' || r.name.length === 0) return { ok: false, error: 'name required' };
  if (typeof r.chatBarText !== 'string' || r.chatBarText.length === 0 || r.chatBarText.length > 14) {
    return { ok: false, error: 'chatBarText required (1..14 chars)' };
  }
  if (typeof r.size !== 'string' || !VALID_SIZES.has(r.size)) return { ok: false, error: 'size must be large or compact' };
  const pages = parsePages(r.pages);
  if (!pages.ok) return pages;
  // #502中: 作成直後のフォルダ付けupdate握りつぶしをなくすため、作成口で直接受け付ける。
  if (r.folderId !== undefined && r.folderId !== null && typeof r.folderId !== 'string') {
    return { ok: false, error: 'folderId must be a string or null' };
  }
  return {
    ok: true,
    value: {
      accountId: r.accountId,
      name: r.name,
      chatBarText: r.chatBarText,
      size: r.size as 'large' | 'compact',
      pages: pages.value,
      folderId: (r.folderId as string | null | undefined) ?? null,
    },
  };
}

function parsePatchBody(raw: unknown): Parsed<{ meta: UpdateRichMenuGroupMetaInput; pages?: RichMenuPageInput[] }> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be object' };
  const r = raw as Record<string, unknown>;
  const meta: UpdateRichMenuGroupMetaInput = {};
  if (r.name !== undefined) {
    if (typeof r.name !== 'string' || r.name.length === 0) return { ok: false, error: 'name must be non-empty string' };
    meta.name = r.name;
  }
  if (r.chatBarText !== undefined) {
    if (typeof r.chatBarText !== 'string' || r.chatBarText.length === 0 || r.chatBarText.length > 14) {
      return { ok: false, error: 'chatBarText must be 1..14 chars' };
    }
    meta.chatBarText = r.chatBarText;
  }
  if (r.isDefaultForAll !== undefined) {
    if (typeof r.isDefaultForAll !== 'boolean') return { ok: false, error: 'isDefaultForAll must be boolean' };
    meta.isDefaultForAll = r.isDefaultForAll;
  }
  if (r.targetingCondition !== undefined) {
    if (r.targetingCondition === null) {
      meta.targetingCondition = null;
    } else if (typeof r.targetingCondition !== 'string') {
      return { ok: false, error: 'targetingCondition must be a JSON string or null' };
    } else {
      // 読めない JSON をそのまま保存すると、出し分けのたびに黙って飛ばされる。
      // 入り口で断る。
      try {
        JSON.parse(r.targetingCondition);
      } catch {
        return { ok: false, error: 'targetingCondition must be valid JSON' };
      }
      meta.targetingCondition = r.targetingCondition;
    }
  }
  if (r.targetingPriority !== undefined) {
    if (typeof r.targetingPriority !== 'number' || !Number.isInteger(r.targetingPriority)) {
      return { ok: false, error: 'targetingPriority must be an integer' };
    }
    meta.targetingPriority = r.targetingPriority;
  }
  if (r.targetingEnabled !== undefined) {
    if (typeof r.targetingEnabled !== 'boolean') {
      return { ok: false, error: 'targetingEnabled must be boolean' };
    }
    meta.targetingEnabled = r.targetingEnabled;
  }
  if (r.folderId !== undefined) {
    if (r.folderId === null || r.folderId === '') {
      meta.folderId = null;
    } else if (typeof r.folderId !== 'string') {
      return { ok: false, error: 'folderId must be a string' };
    } else {
      meta.folderId = r.folderId;
    }
  }
  if (r.displayOrder !== undefined) {
    if (typeof r.displayOrder !== 'number' || !Number.isInteger(r.displayOrder)) {
      return { ok: false, error: 'displayOrder must be an integer' };
    }
    meta.displayOrder = r.displayOrder;
  }
  let pages: RichMenuPageInput[] | undefined;
  if (r.pages !== undefined) {
    const p = parsePages(r.pages);
    if (!p.ok) return p;
    pages = p.value;
  }
  return { ok: true, value: { meta, pages } };
}

// ----- Routes -----

// LINE 上の rich menu の画像をプロキシで返す (Authorization が必要なため
// admin 経由で取得して画面に流す)。
richMenuGroups.get('/api/rich-menu-groups/external/:richMenuId/image', async (c) => {
  const richMenuId = c.req.param('richMenuId');
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'line account not found' }, 404);
  }
  const account = await getLineAccountById(c.env.DB, accountId);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 404);
  const res = await fetch(
    `https://api-data.line.me/v2/bot/richmenu/${encodeURIComponent(richMenuId)}/content`,
    { headers: { Authorization: `Bearer ${account.channel_access_token}` } },
  );
  if (!res.ok) {
    // #502中: 不正なIDでURLが化けないよう符号化し、外部の応答本文は利用者に出さない。
    return c.json(
      {
        success: false,
        error: res.status === 404
          ? 'LINE上に画像が見つかりませんでした'
          : 'LINEから画像を取得できませんでした',
      },
      res.status === 404 ? 404 : 500,
    );
  }
  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/png',
      'Cache-Control': 'private, max-age=300',
    },
  });
});

// LINE 上の admin 管理外 rich menu を D1 に取り込んで管理対象にする。
// 取り込み後は通常の編集画面で操作できる。
//
// query: { accountId, richMenuId }
richMenuGroups.post('/api/rich-menu-groups/import', requireRole('owner', 'admin'), async (c) => {
  const accountId = c.req.query('accountId');
  const richMenuId = c.req.query('richMenuId');
  if (!accountId || !richMenuId) {
    return c.json({ success: false, error: 'accountId and richMenuId query params required' }, 400);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'line account not found' }, 404);
  }
  const account = await getLineAccountById(c.env.DB, accountId);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 404);

  // 既に admin 管理下にあるかチェック
  const existing = await c.env.DB
    .prepare(
      `SELECT g.id, g.name FROM rich_menu_pages p
         JOIN rich_menu_groups g ON g.id = p.group_id
        WHERE g.account_id = ? AND p.line_richmenu_id = ?`,
    )
    .bind(accountId, richMenuId)
    .first<{ id: string; name: string }>();
  if (existing) {
    return c.json(
      { success: false, error: `既に管理画面で管理中のメニューです: ${existing.name}` },
      409,
    );
  }

  const auth = `Bearer ${account.channel_access_token}`;

  // 1. LINE から rich menu 詳細を取得
  const detailRes = await fetch(`https://api.line.me/v2/bot/richmenu/${encodeURIComponent(richMenuId)}`, {
    headers: { Authorization: auth },
  });
  if (!detailRes.ok) {
    // #502中: 外部の応答本文をそのまま利用者に返さない。固定の日本語に置き換える。
    return c.json(
      {
        success: false,
        error: detailRes.status === 404
          ? 'LINE上にメニューが見つかりませんでした'
          : 'LINEからメニューを取得できませんでした',
      },
      detailRes.status === 404 ? 404 : 500,
    );
  }
  type LineArea = {
    bounds: { x: number; y: number; width: number; height: number };
    action: {
      type: string;
      uri?: string;
      text?: string;
      data?: string;
      displayText?: string;
      richMenuAliasId?: string;
    };
  };
  const detail = (await detailRes.json()) as {
    name: string;
    chatBarText: string;
    size: { width: number; height: number };
    areas: LineArea[];
  };

  // 2. size 判定
  const size: 'large' | 'compact' | null =
    detail.size.width === RICH_MENU_DIMENSIONS.large.width
      && detail.size.height === RICH_MENU_DIMENSIONS.large.height
      ? 'large'
      : detail.size.width === RICH_MENU_DIMENSIONS.compact.width
        && detail.size.height === RICH_MENU_DIMENSIONS.compact.height
        ? 'compact'
        : null;
  if (!size) {
    return c.json(
      {
        success: false,
        error: `非対応サイズ ${detail.size.width}x${detail.size.height}。管理画面は ${RICH_MENU_DIMENSIONS.large.width}×${RICH_MENU_DIMENSIONS.large.height} (Large) と ${RICH_MENU_DIMENSIONS.compact.width}×${RICH_MENU_DIMENSIONS.compact.height} (Compact) のみ対応しています。`,
      },
      400,
    );
  }

  // 3. action 変換 (LINE → admin)
  const convertedAreas: RichMenuAreaInput[] = [];
  for (const a of detail.areas ?? []) {
    if (a.action.type === 'uri' && typeof a.action.uri === 'string') {
      convertedAreas.push({
        boundsX: a.bounds.x, boundsY: a.bounds.y,
        boundsWidth: a.bounds.width, boundsHeight: a.bounds.height,
        actionType: 'uri',
        actionData: { uri: a.action.uri },
      });
    } else if (a.action.type === 'message' && typeof a.action.text === 'string') {
      convertedAreas.push({
        boundsX: a.bounds.x, boundsY: a.bounds.y,
        boundsWidth: a.bounds.width, boundsHeight: a.bounds.height,
        actionType: 'message',
        actionData: { text: a.action.text },
      });
    } else if (a.action.type === 'postback' && typeof a.action.data === 'string') {
      convertedAreas.push({
        boundsX: a.bounds.x, boundsY: a.bounds.y,
        boundsWidth: a.bounds.width, boundsHeight: a.bounds.height,
        actionType: 'postback',
        actionData: {
          data: a.action.data,
          ...(a.action.displayText ? { displayText: a.action.displayText } : {}),
        },
      });
    } else if (a.action.type === 'richmenuswitch') {
      return c.json(
        {
          success: false,
          error:
            'タブ切替 (richmenuswitch) を含むリッチメニューは現在インポートできません。タブ切替は管理画面で複数ページとして新規作成してください。',
        },
        400,
      );
    } else {
      return c.json(
        {
          success: false,
          error: `非対応アクション「${a.action.type}」を含むリッチメニューはインポートできません。`,
        },
        400,
      );
    }
  }

  // 4. 画像を LINE から取得して R2 に保存
  const imgRes = await fetch(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    { headers: { Authorization: auth } },
  );
  if (!imgRes.ok) {
    return c.json(
      { success: false, error: `LINE 画像取得失敗: ${imgRes.status}` },
      500,
    );
  }
  const contentType = imgRes.headers.get('content-type') ?? 'image/png';
  const ext = contentType.includes('jpeg') ? 'jpg' : 'png';
  const imageBytes = new Uint8Array(await imgRes.arrayBuffer());

  // 5. D1 に group + page + areas を作成
  const created = await createRichMenuGroup(c.env.DB, {
    accountId,
    name: detail.name,
    chatBarText: detail.chatBarText,
    size,
    pages: [
      {
        name: 'ページ 1',
        orderIndex: 0,
        areas: convertedAreas,
      },
    ],
  });
  const newPage = created.pages[0];

  // 6. 画像を R2 に保存して page に紐付け
  const r2Key = `rich-menus/${accountId}/${created.id}/${newPage.id}/${Date.now()}.${ext}`;
  await c.env.IMAGES.put(r2Key, imageBytes, { httpMetadata: { contentType } });
  await setRichMenuPageImage(c.env.DB, newPage.id, r2Key, contentType);

  // 7. line_richmenu_id を埋めて status='published' に
  await setPageRichMenuId(c.env.DB, newPage.id, richMenuId);
  await markRichMenuGroupPublished(c.env.DB, created.id);

  // 8. alias を upsert (今後の再 publish 時の安定 ID として)
  const aliasId = `lhx-${created.id.slice(0, 8)}-0`;
  try {
    await fetch(`https://api.line.me/v2/bot/richmenu/alias/${aliasId}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    });
  } catch {
    // 無視
  }
  await fetch('https://api.line.me/v2/bot/richmenu/alias', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
  });

  return c.json({ success: true, data: { id: created.id, name: created.name } });
});

// LINE 公式アカウント上のリッチメニュー実態と admin 管理状態を突き合わせて返す。
// 一覧画面で「LINE 上には登録されているが admin 外」「現在の default」を可視化するために使う。
richMenuGroups.get('/api/rich-menu-groups/external', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'line account not found' }, 404);
  }
  const account = await getLineAccountById(c.env.DB, accountId);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 404);
  const auth = `Bearer ${account.channel_access_token}`;

  type LineMenu = {
    richMenuId: string;
    name: string;
    chatBarText: string;
    selected: boolean;
    size: { width: number; height: number };
    areas: ExternalLineArea[];
  };

  // 並列に問い合わせる
  const [listRes, defRes] = await Promise.all([
    fetch('https://api.line.me/v2/bot/richmenu/list', { headers: { Authorization: auth } }),
    fetch('https://api.line.me/v2/bot/user/all/richmenu', { headers: { Authorization: auth } }),
  ]);
  if (!listRes.ok) {
    return c.json(
      { success: false, error: `LINE rich menu list failed: ${listRes.status}` },
      500,
    );
  }
  const listJson = (await listRes.json()) as { richmenus?: LineMenu[] };
  const lineMenus = listJson.richmenus ?? [];

  let currentDefault: string | null = null;
  if (defRes.status === 200) {
    const j = (await defRes.json()) as { richMenuId?: string };
    currentDefault = j.richMenuId ?? null;
  }
  // 404 = default 未設定、それ以外の error は warn として無視 (画面が止まらないように)

  // admin 管理の line_richmenu_id を引いて、各 line menu に admin 情報を付与
  const adminRows = (
    await c.env.DB
      .prepare(
        `SELECT p.line_richmenu_id, p.name AS page_name,
                g.id AS group_id, g.name AS group_name, g.status AS group_status
           FROM rich_menu_pages p
           JOIN rich_menu_groups g ON g.id = p.group_id
          WHERE g.account_id = ? AND p.line_richmenu_id IS NOT NULL`,
      )
      .bind(accountId)
      .all<{
        line_richmenu_id: string;
        page_name: string;
        group_id: string;
        group_name: string;
        group_status: string;
      }>()
  ).results ?? [];
  const adminByRichMenuId = new Map(adminRows.map((r) => [r.line_richmenu_id, r]));

  return c.json({
    success: true,
    data: {
      currentDefault,
      lineMenus: lineMenus.map((m) => {
        const admin = adminByRichMenuId.get(m.richMenuId);
        return {
          richMenuId: m.richMenuId,
          name: m.name,
          chatBarText: m.chatBarText,
          size: m.size,
          areasCount: Array.isArray(m.areas) ? m.areas.length : 0,
          areas: Array.isArray(m.areas) ? m.areas.map(serializeExternalArea) : [],
          isCurrentDefault: currentDefault === m.richMenuId,
          adminManaged: !!admin,
          adminInfo: admin
            ? {
                groupId: admin.group_id,
                groupName: admin.group_name,
                pageName: admin.page_name,
                groupStatus: admin.group_status,
              }
            : null,
        };
      }),
    },
  });
});

// LINE 上の rich menu を直接削除する (admin 管理外の orphan を片付ける用)。
// admin 管理されている richMenuId を渡された場合は 409 で拒否
// (Unpublish 経由で消すべき)。
richMenuGroups.delete('/api/rich-menu-groups/external/:richMenuId', requireRole('owner', 'admin'), async (c) => {
  const richMenuId = c.req.param('richMenuId');
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'line account not found' }, 404);
  }
  const account = await getLineAccountById(c.env.DB, accountId);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 404);

  // admin 管理下の richmenu はここでは削除させない
  const adminRow = await c.env.DB
    .prepare(
      `SELECT g.id, g.name FROM rich_menu_pages p
         JOIN rich_menu_groups g ON g.id = p.group_id
        WHERE g.account_id = ? AND p.line_richmenu_id = ?`,
    )
    .bind(accountId, richMenuId)
    .first<{ id: string; name: string }>();
  if (adminRow) {
    return c.json(
      {
        success: false,
        error: `この richMenu は admin 管理下のメニュー「${adminRow.name}」に紐づいています。編集画面の「LINE から取り下げ」を使ってください。`,
      },
      409,
    );
  }

  const auth = `Bearer ${account.channel_access_token}`;
  const res = await fetch(`https://api.line.me/v2/bot/richmenu/${encodeURIComponent(richMenuId)}`, {
    method: 'DELETE',
    headers: { Authorization: auth },
  });
  if (!res.ok && res.status !== 404) {
    // #502中: 外部の応答本文をそのまま利用者に返さない。固定の日本語に置き換える。
    return c.json(
      { success: false, error: 'LINE上のメニューを削除できませんでした' },
      500,
    );
  }
  return c.json({ success: true });
});

// 押された回数。既定はその月（日本時間）。from / to を渡せば任意の期間。
// ルートの並び順に注意 — `/:groupId` より前に置かないと "tap-stats" が
// リッチメニューの id として拾われる。
richMenuGroups.get('/api/rich-menu-groups/tap-stats', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'line account not found' }, 404);
  }
  const range = currentMonthRange(jstNow());
  const from = c.req.query('from') || range.from;
  const to = c.req.query('to') || range.to;
  try {
    const stats = await getRichMenuTapStats(c.env.DB, accountId, from, to);
    return c.json({ success: true, data: stats });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

richMenuGroups.get('/api/rich-menu-groups', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'line account not found' }, 404);
  }
  try {
    const wantsPaging = c.req.query('page') !== undefined || c.req.query('limit') !== undefined;
    const paging = wantsPaging
      ? parseOffsetPaging({ page: c.req.query('page'), limit: c.req.query('limit') })
      : undefined;
    const groups = await getRichMenuGroups(c.env.DB, accountId);
    const range = currentMonthRange(jstNow());
    const [audienceStats, tapStats] = groups.length > 0
      ? await Promise.all([
          getRichMenuAudienceStats(c.env.DB, accountId, range.from, range.to, groups),
          getRichMenuTapStats(c.env.DB, accountId, range.from, range.to),
        ])
      : [[], { byGroup: [] }];
    const audienceByGroup = new Map(audienceStats.map((item) => [item.groupId, item]));
    const tapsByGroup = new Map(tapStats.byGroup.map((item) => [item.groupId, item.taps]));
    const query = (c.req.query('query') ?? '').trim();
    const folderId = c.req.query('folderId') ?? '';
    const savedFilter = c.req.query('filter') ?? '';
    const sortKey = c.req.query('sort') ?? 'priority';
    const allItems = groups.map((g) => ({
      ...serializeGroup(g),
      thumbnailR2Key: null as string | null,
      monthlyStats: {
        from: range.from,
        to: range.to,
        taps: tapsByGroup.get(g.id) ?? 0,
        uniqueAudience: {
          value: audienceByGroup.get(g.id)?.monthlyUniqueAudience ?? 0,
          state: 'partial' as const,
          reason: 'preexisting_assignments_not_backfilled' as const,
        },
      },
    }));
    const facets = {
      total: allItems.length,
      published: allItems.filter((item) => item.status === 'published').length,
      targeting: allItems.filter((item) => item.targetingEnabled && item.targetingCondition).length,
      folderCounts: allItems.reduce<Record<string, number>>((counts, item) => {
        const key = item.folderId ?? '__unfiled__';
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
    };
    const filtered = wantsPaging
      ? allItems.filter((item) => {
          if (query && !item.name.includes(query) && !item.chatBarText.includes(query)) return false;
          if (folderId === '__unfiled__' && item.folderId) return false;
          if (folderId && folderId !== '__unfiled__' && item.folderId !== folderId) return false;
          if (savedFilter === 'published' && item.status !== 'published') return false;
          if (savedFilter === 'scheduled' && !item.publishingAt) return false;
          if (savedFilter === 'draft' && (item.status !== 'draft' || item.publishingAt)) return false;
          if (savedFilter === 'targeting' && (!item.targetingEnabled || !item.targetingCondition)) return false;
          return true;
        })
      : allItems;
    const sorted = wantsPaging ? [...filtered].sort((a, b) => {
      if (sortKey === 'taps') return b.monthlyStats.taps - a.monthlyStats.taps || a.id.localeCompare(b.id);
      if (sortKey === 'updated') return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id);
      return a.targetingPriority - b.targetingPriority
        || a.createdAt.localeCompare(b.createdAt)
        || a.id.localeCompare(b.id);
    }) : filtered;
    const pageItems = paging ? sorted.slice(paging.offset, paging.offset + paging.limit) : sorted;
    // 各 group の代表画像 (default_page_id の image_r2_key、なければ order_index=0 の page) を取得。
    // 一覧カードでサムネを出すために 1 クエリで JOIN する。
    const imageByGroupId = new Map<string, { key: string; contentType: string | null }>();
    if (pageItems.length > 0) {
      const placeholders = pageItems.map(() => '?').join(',');
      const result = await c.env.DB
        .prepare(
          `SELECT
            g.id AS group_id,
            COALESCE(
              (SELECT image_r2_key FROM rich_menu_pages WHERE id = g.default_page_id),
              (SELECT image_r2_key FROM rich_menu_pages WHERE group_id = g.id ORDER BY order_index LIMIT 1)
            ) AS image_r2_key,
            COALESCE(
              (SELECT image_content_type FROM rich_menu_pages WHERE id = g.default_page_id),
              (SELECT image_content_type FROM rich_menu_pages WHERE group_id = g.id ORDER BY order_index LIMIT 1)
            ) AS image_content_type
           FROM rich_menu_groups g
          WHERE g.id IN (${placeholders})`,
        )
        .bind(...pageItems.map((g) => g.id))
        .all<{ group_id: string; image_r2_key: string | null; image_content_type: string | null }>();
      for (const r of result.results ?? []) {
        if (r.image_r2_key) {
          imageByGroupId.set(r.group_id, {
            key: r.image_r2_key,
            contentType: r.image_content_type,
          });
        }
      }
    }
    const items = pageItems.map((g) => ({
        ...g,
        thumbnailR2Key: imageByGroupId.get(g.id)?.key ?? null,
      }));
    if (paging) {
      const sort = sortKey === 'taps'
        ? [{ field: 'monthlyStats.taps', direction: 'desc' as const }, { field: 'id', direction: 'asc' as const }]
        : sortKey === 'updated'
          ? [{ field: 'updatedAt', direction: 'desc' as const }, { field: 'id', direction: 'asc' as const }]
          : sortKey === 'name'
            ? [{ field: 'name', direction: 'asc' as const }, { field: 'id', direction: 'asc' as const }]
            : [
                { field: 'targetingPriority', direction: 'asc' as const },
                { field: 'createdAt', direction: 'asc' as const },
                { field: 'id', direction: 'asc' as const },
              ];
      return c.json({
        success: true,
        data: {
          ...buildOffsetListResponse({ items, total: filtered.length, paging, sort }),
          facets,
        },
      });
    }
    return c.json({ success: true, data: items });
  } catch (error) {
    console.error('GET /api/rich-menu-groups error:', error);
    return c.json({ success: false, error: 'リッチメニュー一覧を取得できませんでした' }, 503);
  }
});

richMenuGroups.get(
  '/api/rich-menu-groups/:groupId/delete-impact',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const impact = await getRichMenuDeleteImpact(c.env.DB, c.req.param('groupId'));
      if (
        !impact
        || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [impact.group.accountId])
      ) {
        return c.json({ success: false, error: 'not found' }, 404);
      }
      return c.json({ success: true, data: impact });
    } catch (error) {
      console.error('GET /api/rich-menu-groups/:groupId/delete-impact error:', error);
      return c.json(
        { success: false, error: '削除したときの影響を確認できませんでした' },
        503,
      );
    }
  },
);

/** 条件の複雑さの上限 (#502中)。重い条件の連打でDB負荷になるため入り口で断る。 */
const PREVIEW_MAX_RULES = 50;
const PREVIEW_MAX_DEPTH = 5;

function countPreviewRules(condition: SegmentCondition, depth: number): number {
  if (depth > PREVIEW_MAX_DEPTH) return Number.POSITIVE_INFINITY;
  let count = Array.isArray(condition.rules) ? condition.rules.length : 0;
  for (const nested of condition.groups ?? []) {
    count += countPreviewRules(nested, depth + 1);
  }
  return count;
}

/**
 * 「誰に出すか」の件数。取得できない値を0へ丸めず、state/reasonを返す。
 * 上位条件のどれかにも一致する人を重複として1回だけ数える。
 * 保存(PATCH)と同じく owner/admin のみ。人数の列挙を権限の弱い職員に開かない。
 */
richMenuGroups.post('/api/rich-menu-groups/:groupId/preview-targets', requireRole('owner', 'admin'), async (c) => {
  const group = await getRichMenuGroupById(c.env.DB, c.req.param('groupId'));
  if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
    return c.json({ success: false, error: 'not found' }, 404);
  }

  let body: { conditions?: unknown } = {};
  try {
    body = await c.req.json<{ conditions?: unknown }>();
  } catch {
    // 本文を省いたときは保存済み条件を使う。
  }
  const supplied = body.conditions;
  const condition = supplied === undefined
    ? parseCondition(group.targeting_condition)
    : supplied as SegmentCondition;
  if (supplied === undefined && group.targeting_condition && !condition) {
    return c.json({ success: false, error: '保存済みの対象条件を読み取れませんでした' }, 503);
  }
  if (
    condition
    && (typeof condition !== 'object'
      || (condition.operator !== 'AND' && condition.operator !== 'OR')
      || !Array.isArray(condition.rules))
  ) {
    return c.json({ success: false, error: 'conditions are invalid' }, 400);
  }
  if (condition && countPreviewRules(condition, 1) > PREVIEW_MAX_RULES) {
    return c.json({ success: false, error: '条件が複雑すぎます。条件を減らしてください' }, 400);
  }

  try {
    const targetWhere = condition ? buildSegmentWhere(condition) : { sql: '1=1', bindings: [] };
    const matched = await c.env.DB
      .prepare(
        `SELECT COUNT(*) AS count
           FROM friends f
          WHERE f.line_account_id = ?
            AND f.is_following = 1
            AND (${targetWhere.sql})`,
      )
      .bind(group.account_id, ...targetWhere.bindings)
      .first<{ count: number }>();

    const higher = await c.env.DB
      .prepare(
        `SELECT id, name, targeting_condition
           FROM rich_menu_groups
          WHERE account_id = ?
            AND id <> ?
            AND status = 'published'
            AND targeting_enabled = 1
            AND targeting_priority < ?
          ORDER BY targeting_priority ASC, created_at ASC`,
      )
      .bind(group.account_id, group.id, group.targeting_priority)
      .all<{ id: string; name: string; targeting_condition: string | null }>();

    const higherParts: Array<{ sql: string; bindings: unknown[] }> = [];
    const higherNames: string[] = [];
    let unreadableHigherCondition = false;
    for (const row of higher.results ?? []) {
      higherNames.push(row.name);
      const parsed = parseCondition(row.targeting_condition);
      if (!parsed) {
        unreadableHigherCondition = true;
        continue;
      }
      higherParts.push(buildSegmentWhere(parsed));
    }

    let overlap: number | null = 0;
    let overlapReason: string | null = null;
    if (unreadableHigherCondition) {
      overlap = null;
      overlapReason = 'higher_condition_unreadable';
    } else if (higherParts.length > 0) {
      const higherSql = higherParts.map((part) => `(${part.sql})`).join(' OR ');
      const higherBindings = higherParts.flatMap((part) => part.bindings);
      const result = await c.env.DB
        .prepare(
          `SELECT COUNT(*) AS count
             FROM friends f
            WHERE f.line_account_id = ?
              AND f.is_following = 1
              AND (${targetWhere.sql})
              AND (${higherSql})`,
        )
        .bind(group.account_id, ...targetWhere.bindings, ...higherBindings)
        .first<{ count: number }>();
      overlap = result?.count ?? 0;
    }

    const matchedValue = matched?.count ?? 0;
    return c.json({
      success: true,
      data: {
        matched: { value: matchedValue, state: 'available', reason: null },
        overlap: overlap === null
          ? { value: null, state: 'unavailable', reason: overlapReason }
          : { value: overlap, state: 'available', reason: null },
        effective: overlap === null
          ? { value: null, state: 'unavailable', reason: overlapReason }
          : { value: Math.max(0, matchedValue - overlap), state: 'available', reason: null },
        higherMenus: higherNames,
        priority: group.targeting_priority + 1,
      },
    });
  } catch (error) {
    console.error('POST /api/rich-menu-groups/:groupId/preview-targets error:', error);
    return c.json({ success: false, error: '対象人数を確認できませんでした' }, 503);
  }
});

/** 削除確認と外部の参照一覧で同じ正本を使う。 */
richMenuGroups.get('/api/rich-menu-groups/:groupId/usages', async (c) => {
  try {
    const impact = await getRichMenuDeleteImpact(c.env.DB, c.req.param('groupId'));
    if (!impact || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [impact.group.accountId])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    return c.json({
      success: true,
      data: {
        currentAudience: impact.currentAudience,
        nextDisplay: impact.nextDisplay,
        incomingSwitches: impact.incomingSwitches,
        operationalReferences: impact.operationalReferences,
      },
    });
  } catch (error) {
    console.error('GET /api/rich-menu-groups/:groupId/usages error:', error);
    return c.json({ success: false, error: '使用先を確認できませんでした' }, 503);
  }
});

/** 公開予約。予約時点のメニュー定義を固定して保存する。 */
richMenuGroups.post(
  '/api/rich-menu-groups/:groupId/schedule',
  requireRole('owner', 'admin'),
  async (c) => {
    const group = await getRichMenuGroupWithPages(c.env.DB, c.req.param('groupId'));
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!idempotencyKey) {
      return c.json({ success: false, error: 'Idempotency-Key header required' }, 400);
    }

    let body: { mode?: unknown; startsAt?: unknown; endsAt?: unknown; restoreGroupId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'invalid JSON body' }, 400);
    }
    if (body.mode !== 'scheduled' && body.mode !== 'period') {
      return c.json({ success: false, error: 'mode must be scheduled or period' }, 400);
    }
    if (typeof body.startsAt !== 'string' || !Number.isFinite(Date.parse(body.startsAt))) {
      return c.json({ success: false, error: 'startsAt must be ISO 8601' }, 400);
    }
    const endsAt = typeof body.endsAt === 'string' && body.endsAt.length > 0 ? body.endsAt : null;
    if (body.mode === 'period') {
      if (!endsAt || !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(body.startsAt)) {
        return c.json({ success: false, error: 'endsAt must be later than startsAt' }, 400);
      }
    }
    const restoreGroupId = typeof body.restoreGroupId === 'string' && body.restoreGroupId.length > 0
      ? body.restoreGroupId
      : null;
    if (restoreGroupId) {
      const restore = await getRichMenuGroupById(c.env.DB, restoreGroupId);
      if (!restore || restore.account_id !== group.account_id || restore.status !== 'published') {
        return c.json({ success: false, error: 'restoreGroupId must be a published menu in the same account' }, 400);
      }
    }

    const existing = await c.env.DB
      .prepare('SELECT id, status FROM rich_menu_schedules WHERE account_id = ? AND idempotency_key = ?')
      .bind(group.account_id, idempotencyKey)
      .first<{ id: string; status: string }>();
    if (existing) return c.json({ success: true, data: existing });

    const now = jstNow();
    const id = crypto.randomUUID();
    await c.env.DB
      .prepare(
        `INSERT INTO rich_menu_schedules
           (id, group_id, account_id, mode, starts_at, ends_at, restore_group_id,
            definition_snapshot, status, idempotency_key, requested_by_staff_id,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        group.id,
        group.account_id,
        body.mode,
        body.startsAt,
        endsAt,
        restoreGroupId,
        JSON.stringify(serializeGroupWithPages(group)),
        idempotencyKey,
        c.get('staff').id,
        now,
        now,
      )
      .run();
    return c.json({ success: true, data: { id, status: 'scheduled' } }, 201);
  },
);

richMenuGroups.get('/api/rich-menu-groups/:groupId', async (c) => {
  const groupId = c.req.param('groupId');
  const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
  if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
    return c.json({ success: false, error: 'not found' }, 404);
  }
  return c.json({ success: true, data: serializeGroupWithPages(group) });
});

richMenuGroups.post('/api/rich-menu-groups', requireRole('owner', 'admin'), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid JSON body' }, 400);
  }
  const parsed = parseCreateBody(body);
  if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [parsed.value.accountId])) {
    return c.json({ success: false, error: 'line account not found' }, 404);
  }
  const switcherRejection = rejectRichmenuswitchInCreate(parsed.value.pages);
  if (switcherRejection) return c.json({ success: false, error: switcherRejection }, 400);
  const areaTemplateError = await validateAreaTemplates(c.env.DB, parsed.value.accountId, parsed.value.pages);
  if (areaTemplateError) return c.json({ success: false, error: areaTemplateError }, 400);
  const created = await createRichMenuGroup(c.env.DB, parsed.value);
  return c.json({ success: true, data: serializeGroupWithPages(created) });
});

richMenuGroups.patch('/api/rich-menu-groups/:groupId', requireRole('owner', 'admin'), async (c) => {
  const groupId = c.req.param('groupId');
  const existing = await getRichMenuGroupById(c.env.DB, groupId);
  if (!existing || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [existing.account_id])) {
    return c.json({ success: false, error: 'not found' }, 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid JSON body' }, 400);
  }
  const parsed = parsePatchBody(body);
  if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);

  await updateRichMenuGroupMeta(c.env.DB, groupId, parsed.value.meta);
  if (parsed.value.pages) {
    const areaTemplateError = await validateAreaTemplates(c.env.DB, existing.account_id, parsed.value.pages);
    if (areaTemplateError) return c.json({ success: false, error: areaTemplateError }, 400);
    await replaceRichMenuPages(c.env.DB, groupId, parsed.value.pages);
  }
  const refreshed = await getRichMenuGroupWithPages(c.env.DB, groupId);
  if (!refreshed) return c.json({ success: false, error: 'group disappeared after update' }, 500);
  return c.json({ success: true, data: serializeGroupWithPages(refreshed) });
});

/**
 * 優先順と自分で決めた並び順の一括更新 (#502中)。
 * 全件ぶん PATCH を並列に投げると台数比例で増え、途中失敗で順番が
 * 中途半端に残る。id 配列を1回で受け、1 batch で 0,1,2…へそろえる。
 * 全部入りでなければ 400 (隠れているメニューの優先関係を壊さない)。
 */
richMenuGroups.post(
  '/api/rich-menu-groups/reorder-priorities',
  requireRole('owner', 'admin'),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'invalid JSON body' }, 400);
    }
    const r = isJsonRecord(body) ? body : {};
    if (typeof r.accountId !== 'string' || r.accountId.length === 0) {
      return c.json({ success: false, error: 'accountId required' }, 400);
    }
    if (!Array.isArray(r.orderedIds) || r.orderedIds.some((id) => typeof id !== 'string')) {
      return c.json({ success: false, error: 'orderedIds must be string array' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [r.accountId])) {
      return c.json({ success: false, error: 'line account not found' }, 404);
    }
    const current = await getRichMenuGroups(c.env.DB, r.accountId);
    const currentIds = new Set(current.map((g) => g.id));
    const seen = new Set<string>();
    const hasAll = r.orderedIds.length === current.length
      && r.orderedIds.every((id) => {
        if (seen.has(id) || !currentIds.has(id)) return false;
        seen.add(id);
        return true;
      });
    if (!hasAll) {
      return c.json(
        { success: false, error: 'orderedIds must contain every group of the account exactly once' },
        400,
      );
    }
    const now = jstNow();
    await c.env.DB.batch(
      r.orderedIds.map((id, index) =>
        c.env.DB
          .prepare(
            `UPDATE rich_menu_groups
                SET targeting_priority = ?, display_order = ?, updated_at = ?
              WHERE id = ? AND account_id = ?`,
          )
          .bind(index, index, now, id, r.accountId),
      ),
    );
    return c.json({ success: true, data: { updated: r.orderedIds.length } });
  },
);

richMenuGroups.delete('/api/rich-menu-groups/:groupId', requireRole('owner', 'admin'), async (c) => {
  const groupId = c.req.param('groupId');
  let impact: Awaited<ReturnType<typeof getRichMenuDeleteImpact>>;
  try {
    impact = await getRichMenuDeleteImpact(c.env.DB, groupId);
  } catch (error) {
    console.error('DELETE /api/rich-menu-groups/:groupId impact error:', error);
    return c.json(
      { success: false, error: '削除したときの影響を確認できませんでした' },
      503,
    );
  }
  if (
    !impact
    || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [impact.group.accountId])
  ) {
    return c.json({ success: false, error: 'not found' }, 404);
  }
  // query に force=true が残っていても、影響確認を迂回させない。公開中、LINE上に
  // 実体が残る、別設定から参照される、のどれかなら必ず止める。
  if (!impact.canDelete) {
    return c.json(
      {
        success: false,
        code: 'rich_menu_delete_blocked',
        error: '削除する前に、公開状態と使われている場所を確認してください',
        data: impact,
      },
      409,
    );
  }
  const ok = await deleteRichMenuGroup(c.env.DB, groupId);
  if (!ok) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true });
});

// ----- Image upload -----

richMenuGroups.post('/api/rich-menu-groups/:groupId/pages/:pageId/image', requireRole('owner', 'admin'), async (c) => {
  const { groupId, pageId } = c.req.param();
  const group = await getRichMenuGroupById(c.env.DB, groupId);
  if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
    return c.json({ success: false, error: 'group not found' }, 404);
  }
  const contentType = c.req.header('content-type') ?? '';
  if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
    return c.json({ success: false, error: 'content-type must be image/png or image/jpeg' }, 400);
  }

  const exists = await pageBelongsToGroup(c.env.DB, groupId, pageId);
  if (!exists) return c.json({ success: false, error: 'page not found in group' }, 404);

  // 巨大ファイルは全量読む前に断る（上限1MBは image-validator と同じ）。
  const declaredBytes = Number.parseInt(c.req.header('content-length') ?? '', 10);
  if (Number.isFinite(declaredBytes) && declaredBytes > 1024 * 1024) {
    return c.json({ success: false, error: '画像が大きすぎます。1MB以下の画像を選んでください' }, 413);
  }

  const buf = new Uint8Array(await c.req.arrayBuffer());
  const validation = validateRichMenuImage(buf, buf.byteLength);
  if (!validation.ok) return c.json({ success: false, error: validation.error }, 400);

  // group.size と画像サイズが一致してないと publish 時に LINE API でコンテンツアップロードが
  // 弾かれる (richmenu の宣言サイズと content の dimensions は一致必須)。事前に拒否する。
  if (validation.size !== group.size) {
    return c.json(
      {
        success: false,
        error: `image size '${validation.size}' does not match group size '${group.size}'`,
      },
      400,
    );
  }

  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  const key = `rich-menus/${group.account_id}/${groupId}/${pageId}/${Date.now()}.${ext}`;
  await c.env.IMAGES.put(key, buf, { httpMetadata: { contentType } });
  await setRichMenuPageImage(c.env.DB, pageId, key, contentType);

  return c.json({
    success: true,
    data: { imageR2Key: key, imageContentType: contentType, size: validation.size },
  });
});

// 画像取得 — エディタからの <img src="..."> 用。private cache でアクセス制御は auth に委ねる。
richMenuGroups.get('/api/rich-menu-images/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const [root, accountId] = key.split('/');
  if (
    root !== 'rich-menus'
    || !accountId
    || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])
  ) {
    return c.notFound();
  }
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=60',
    },
  });
});

// ----- Publish -----

/**
 * 「URLを開く」で計測リンクを選んだボタンの、実際の飛び先を引く。
 *
 * 計測リンクは押された回数を数え、設定されていればタグ付けやシナリオ開始まで
 * やってくれる。リッチメニュー側で同じ仕組みを作り直さず、そのまま乗せる。
 */
async function resolveTrackedLinkUrls(
  db: D1Database,
  resolveBaseUrl: () => Promise<string>,
  group: RichMenuGroupWithPages,
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const page of group.pages) {
    for (const area of page.areas) {
      if (area.tracked_link_id) ids.add(area.tracked_link_id);
    }
  }
  const urls = new Map<string, string>();
  // 計測リンクを使うボタンが1つも無ければ、ベースURLを引く必要もない。
  if (ids.size === 0) return urls;
  const baseUrl = await resolveBaseUrl();
  for (const id of ids) {
    const link = await getTrackedLinkById(db, id);
    if (!link) continue;
    // 短縮コードがあればそちらを使う (baseUrl が独自の短縮ドメインのことがある)。
    urls.set(id, `${baseUrl}/t/${link.short_code ?? link.id}`);
  }
  return urls;
}

function createLineClient(channelAccessToken: string): LineRichMenuClient {
  const auth = `Bearer ${channelAccessToken}`;
  return {
    async createRichMenu(payload) {
      const res = await fetch('https://api.line.me/v2/bot/richmenu', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`LINE createRichMenu failed: ${res.status} ${await res.text()}`);
      return res.json() as Promise<{ richMenuId: string }>;
    },
    async uploadRichMenuImage(richMenuId, image, contentType) {
      const res = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': contentType },
        body: image,
      });
      if (!res.ok) throw new Error(`LINE uploadRichMenuImage failed: ${res.status} ${await res.text()}`);
    },
    async deleteRichMenuAlias(aliasId) {
      const res = await fetch(`https://api.line.me/v2/bot/richmenu/alias/${aliasId}`, {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`LINE deleteRichMenuAlias failed: ${res.status} ${await res.text()}`);
      }
    },
    async createRichMenuAlias(aliasId, richMenuId) {
      const res = await fetch('https://api.line.me/v2/bot/richmenu/alias', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
      });
      if (!res.ok) throw new Error(`LINE createRichMenuAlias failed: ${res.status} ${await res.text()}`);
    },
    async upsertRichMenuAlias(aliasId, richMenuId) {
      const res = await fetch(`https://api.line.me/v2/bot/richmenu/alias/${aliasId}`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ richMenuId }),
      });
      if (res.ok) return;
      if (res.status === 404) {
        const createRes = await fetch('https://api.line.me/v2/bot/richmenu/alias', {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
        });
        if (createRes.ok) return;
        throw new Error(`LINE createRichMenuAlias failed: ${createRes.status} ${await createRes.text()}`);
      }
      throw new Error(`LINE updateRichMenuAlias failed: ${res.status} ${await res.text()}`);
    },
    async deleteRichMenu(richMenuId) {
      const res = await fetch(`https://api.line.me/v2/bot/richmenu/${richMenuId}`, {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`LINE deleteRichMenu failed: ${res.status} ${await res.text()}`);
      }
    },
    async setDefaultRichMenu(richMenuId) {
      const res = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
        method: 'POST',
        headers: { Authorization: auth },
      });
      if (!res.ok) throw new Error(`LINE setDefaultRichMenu failed: ${res.status} ${await res.text()}`);
    },
    async clearDefaultRichMenu() {
      // 既存 default を解除。default 未設定でも LINE は 200 を返すので冪等。
      const res = await fetch('https://api.line.me/v2/bot/user/all/richmenu', {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`LINE clearDefaultRichMenu failed: ${res.status} ${await res.text()}`);
      }
    },
    async getCurrentDefaultRichMenuId() {
      const res = await fetch('https://api.line.me/v2/bot/user/all/richmenu', {
        method: 'GET',
        headers: { Authorization: auth },
      });
      // 設定なしは 404 が返る — null として返す。
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`LINE getCurrentDefaultRichMenu failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { richMenuId?: string };
      return body.richMenuId ?? null;
    },
    async linkRichMenuBulk(richMenuId, userIds) {
      // POST /v2/bot/richmenu/bulk/link  — 1 リクエスト最大 500 ユーザー
      const res = await fetch('https://api.line.me/v2/bot/richmenu/bulk/link', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ richMenuId, userIds }),
      });
      if (!res.ok) {
        throw new Error(`LINE linkRichMenuBulk failed: ${res.status} ${await res.text()}`);
      }
    },
  };
}

richMenuGroups.post('/api/rich-menu-groups/:groupId/publish', requireRole('owner', 'admin'), async (c) => {
  const groupId = c.req.param('groupId');
  const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
  if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
    return c.json({ success: false, error: 'not found' }, 404);
  }
  if (group.publishing_at) return c.json({ success: false, error: 'already publishing' }, 409);

  const account = await getLineAccountById(c.env.DB, group.account_id);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 500);

  const locked = await acquirePublishLock(c.env.DB, groupId);
  if (!locked) return c.json({ success: false, error: 'failed to acquire publish lock' }, 409);

  try {
    const line = createLineClient(account.channel_access_token);
    const r2Adapter: R2Like = {
      async get(key) {
        const obj = await c.env.IMAGES.get(key);
        if (!obj) return null;
        return { body: obj.body as ReadableStream };
      },
    };
    // 「URLを開く」で計測リンクを選んでいるボタンの、実際の飛び先をまとめて引く。
    const trackedLinkUrls = await resolveTrackedLinkUrls(
      c.env.DB,
      () =>
        resolveTrackedLinkBaseUrl(c.env.DB, c.env.WORKER_URL || new URL(c.req.url).origin),
      group,
    );
    // 「回答フォームを開く」の飛び先。アカウント固有の LIFF を優先する
    // (共通 LIFF に飛ばすと、未同意のチャネルで同意画面が出てしまう)。
    const formBaseUrl = account.liff_id
      ? `https://liff.line.me/${account.liff_id}`
      : (c.env.LIFF_URL ?? null);

    const groupInput: GroupInput = {
      id: group.id,
      size: group.size,
      chatBarText: group.chat_bar_text,
      isDefaultForAll: group.is_default_for_all === 1,
      formBaseUrl,
      pages: group.pages.map((p) => ({
        id: p.id,
        orderIndex: p.order_index,
        name: p.name,
        imageR2Key: p.image_r2_key,
        imageContentType: p.image_content_type,
        lineRichMenuId: p.line_richmenu_id,
        areas: p.areas.map((a) => ({
          id: a.id,
          bounds: { x: a.bounds_x, y: a.bounds_y, width: a.bounds_width, height: a.bounds_height },
          actionType: a.action_type,
          actionData: a.actionData,
          intent: a.intent,
          label: a.label,
          tagIds: a.tagIds,
          scoreChange: a.score_change,
          templateId: a.template_id,
          formId: a.form_id,
          trackedLinkUrl: a.tracked_link_id
            ? (trackedLinkUrls.get(a.tracked_link_id) ?? null)
            : null,
        })),
      })),
    };
    const result = await publishRichMenuGroup(groupInput, line, r2Adapter);
    for (const r of result.pages) {
      await setPageRichMenuId(c.env.DB, r.pageId, r.newRichMenuId);
    }
    await markRichMenuGroupPublished(c.env.DB, groupId);
    return c.json({ success: true, data: result });
  } catch (e) {
    await releasePublishLock(c.env.DB, groupId);
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof RichMenuValidationError) {
      return c.json({ success: false, error: message }, 400);
    }
    return c.json({ success: false, error: message }, 500);
  }
});

// ----- Unpublish -----

// LINE 上の alias / richmenu / default を全削除して draft に戻す。
// 削除フローや、別 group を default にしたい時に使う。idempotent (既に消えてる
// alias / richmenu は 404 を許容)。
richMenuGroups.post('/api/rich-menu-groups/:groupId/unpublish', requireRole('owner', 'admin'), async (c) => {
  const groupId = c.req.param('groupId');
  const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
  if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
    return c.json({ success: false, error: 'not found' }, 404);
  }

  const account = await getLineAccountById(c.env.DB, group.account_id);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 500);

  const line = createLineClient(account.channel_access_token);
  const groupInput: GroupInput = {
    id: group.id,
    size: group.size,
    chatBarText: group.chat_bar_text,
    isDefaultForAll: group.is_default_for_all === 1,
    pages: group.pages.map((p) => ({
      id: p.id,
      orderIndex: p.order_index,
      name: p.name,
      imageR2Key: p.image_r2_key,
      imageContentType: p.image_content_type,
      lineRichMenuId: p.line_richmenu_id,
      areas: [],
    })),
  };
  try {
    const result = await unpublishRichMenuGroup(groupInput, line);
    await markRichMenuGroupUnpublished(c.env.DB, groupId);
    await clearRichMenuAssignmentsForGroup(c.env.DB, groupId);
    return c.json({ success: true, data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ success: false, error: message }, 500);
  }
});

// ----- Bulk apply by tag / set as account default -----

// 指定タグに紐づく友だち全員に、この group の default page の richmenu を割り当てる。
// LINE bulk link API (最大 500 ユーザー / リクエスト) を必要に応じて分割実行。
//
// body:
//   { mode?: 'bulk-link', tagId: string | null }
//     bulk-link (デフォルト): 該当 friends 全員に link。tagId=null は account 内全 follower。
//   { mode: 'set-default' }
//     LINE 公式アカウントの「全員のデフォルト」に設定。新規 follower にも自動で表示される。
//     同 account 内の他 group の is_default_for_all は 0 にリセット。
//
// 前提: group が published かつ default_page に line_richmenu_id がセット済み。
richMenuGroups.post('/api/rich-menu-groups/:groupId/apply-to-tag', requireRole('owner', 'admin'), async (c) => {
  const groupId = c.req.param('groupId');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid JSON body' }, 400);
  }
  const r = isJsonRecord(body) ? body : {};
  const mode = typeof r.mode === 'string' ? r.mode : 'bulk-link';
  if (mode !== 'bulk-link' && mode !== 'set-default') {
    return c.json({ success: false, error: "mode must be 'bulk-link' or 'set-default'" }, 400);
  }
  if (mode === 'bulk-link') {
    if (r.tagId !== null && r.tagId !== undefined && typeof r.tagId !== 'string') {
      return c.json({ success: false, error: 'tagId must be string or null' }, 400);
    }
  }
  const tagId = (r.tagId as string | null | undefined) ?? null;

  const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
  if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
    return c.json({ success: false, error: 'not found' }, 404);
  }
  if (group.status !== 'published') {
    return c.json(
      { success: false, error: 'group must be published before applying to friends' },
      400,
    );
  }
  // default_page の line_richmenu_id を採用 (未設定なら order_index=0 の page)
  const targetPage =
    group.pages.find((p) => p.id === group.default_page_id) ??
    [...group.pages].sort((a, b) => a.order_index - b.order_index)[0];
  if (!targetPage?.line_richmenu_id) {
    return c.json(
      { success: false, error: 'no published rich menu found for default page' },
      400,
    );
  }

  const account = await getLineAccountById(c.env.DB, group.account_id);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 500);

  // ---- mode: set-default (LINE 全員のデフォルトに設定) ----
  if (mode === 'set-default') {
    try {
      const line = createLineClient(account.channel_access_token);
      await line.setDefaultRichMenu(targetPage.line_richmenu_id);
      // 同 account 内の他 group の is_default_for_all をリセットして、自分だけ true に。
      const now = new Date().toISOString();
      await c.env.DB.batch([
        c.env.DB
          .prepare(
            `UPDATE rich_menu_groups SET is_default_for_all = 0, updated_at = ?
              WHERE account_id = ? AND id != ?`,
          )
          .bind(now, group.account_id, groupId),
        c.env.DB
          .prepare(
            `UPDATE rich_menu_groups SET is_default_for_all = 1, updated_at = ? WHERE id = ?`,
          )
          .bind(now, groupId),
      ]);
      return c.json({
        success: true,
        data: { mode: 'set-default', total: 0, chunks: 0, message: '全員のデフォルトに設定しました' },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ success: false, error: message }, 500);
    }
  }

  // ---- mode: bulk-link (タグ or 全 follower に link) ----
  // #502中: 予約口と同じく Idempotency-Key を必須にする。同じ鍵での
  // やり直しは同じ runId になり、台帳への記録は ON CONFLICT で重複しない。
  // LINE への link 自体は同じメニューの付け直しで無害。
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
  if (!idempotencyKey) {
    return c.json({ success: false, error: 'Idempotency-Key header required' }, 400);
  }
  const userIds = await getFollowingLineUserIdsByTag(
    c.env.DB,
    group.account_id,
    tagId,
  );
  if (userIds.length === 0) {
    return c.json({
      success: true,
      data: { chunks: 0, total: 0, runId: idempotencyKey, message: 'no matching followers' },
    });
  }

  let completedChunks = 0;
  try {
    const line = createLineClient(account.channel_access_token);
    const result = await linkRichMenuBulkChunked(
      line,
      targetPage.line_richmenu_id,
      userIds,
      async (linkedUserIds, chunkIndex) => {
        await recordRichMenuAssignmentsByLineUserIds(c.env.DB, {
          lineAccountId: group.account_id,
          groupId,
          lineRichMenuId: targetPage.line_richmenu_id!,
          lineUserIds: linkedUserIds,
          reasonKind: tagId ? 'tag_bulk_apply' : 'all_followers_bulk_apply',
          reasonEventId: idempotencyKey,
          idempotencyPrefix: `${idempotencyKey}:${chunkIndex}`,
        });
        completedChunks = chunkIndex + 1;
      },
    );
    return c.json({ success: true, data: { ...result, runId: idempotencyKey } });
  } catch (e) {
    // どこまで届いたか分からないままにしない。同じ鍵でやり直せるよう
    // runId と済んだ chunk 数を返す (途中からの再開には未対応)。
    return c.json({
      success: false,
      error: '一括適用の途中で失敗しました。同じ操作でやり直せます',
      data: { runId: idempotencyKey, completedChunks, total: userIds.length },
    }, 500);
  }
});
