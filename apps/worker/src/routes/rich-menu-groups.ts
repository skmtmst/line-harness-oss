import { Hono, type Context } from 'hono';
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
  acquirePublishLease,
  releasePublishLease,
  renewPublishLease,
  isPublishLeaseHeld,
  setPageRichMenuId,
  markRichMenuGroupPublished,
  markRichMenuGroupUnpublished,
  getLineAccountById,
  getFollowingLineUserIdsByTag,
  getTrackedLinkById,
  getRichMenuTapStats,
  getRichMenuAudienceStats,
  recordRichMenuAssignmentsByLineUserIds,
  clearRichMenuAssignmentsForGroup,
  listRichMenuSchedulesByGroup,
  cancelRichMenuSchedule,
  createRichMenuManualPublishRequestAtomic,
  getRichMenuManualPublishRequest,
  getRichMenuManualPublishRequestById,
  getRichMenuManualPublishShells,
  listRichMenuManualPublishRequests,
  claimRichMenuManualPublishRequest,
  markRichMenuManualPublishFailed,
  markRichMenuManualPublishSucceeded,
  recordRichMenuManualPublishShells,
  restartRichMenuManualPublishRequest,
  listRichMenuGroupIdsByAreaLabel,
  normalizeRichMenuSearchText,
  duplicateRichMenuGroupAtomic,
  createRichMenuTestApplyAtomic,
  getActiveRichMenuTestApply,
  getRichMenuTestApplyById,
  listRichMenuTestApplies,
  captureRichMenuTestApplyPrevious,
  recordRichMenuTestApplyShells,
  markRichMenuTestApplyApplied,
  markRichMenuTestApplyFailed,
  beginRichMenuTestApplyRevert,
  markRichMenuTestApplyReverted,
  markRichMenuTestApplyRevertFailed,
  getStaffById,
  getMediaById,
  recordAuditEvent,
  maskAuditIp,
  auditDeviceFamily,
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
  createRichMenuShells,
  switchRichMenuLive,
  deleteRichMenuShells,
  resolveSwitcherActions,
  validateRichMenuGroupForPublish,
  unpublishRichMenuGroup,
  linkRichMenuBulkChunked,
  PublishLeaseLostError,
  RichMenuValidationError,
  buildAliasId,
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

/**
 * 同じ公開操作かを比べる版。公開の結果として変わるstatus・updatedAt・LINEのIDは
 * 含めない。ここに含めると成功済み応答を再生するだけの押し直しまで409になる。
 */
function manualPublishFingerprint(row: RichMenuGroupWithPages): string {
  return JSON.stringify({
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    chatBarText: row.chat_bar_text,
    size: row.size,
    defaultPageId: row.default_page_id,
    isDefaultForAll: row.is_default_for_all === 1,
    targetingCondition: row.targeting_condition,
    targetingPriority: row.targeting_priority,
    targetingEnabled: row.targeting_enabled === 1,
    folderId: row.folder_id,
    displayOrder: row.display_order,
    pages: row.pages.map((page) => ({
      id: page.id,
      orderIndex: page.order_index,
      name: page.name,
      aliasId: page.alias_id,
      imageR2Key: page.image_r2_key,
      imageContentType: page.image_content_type,
      areas: page.areas.map((area) => ({
        id: area.id,
        boundsX: area.bounds_x,
        boundsY: area.bounds_y,
        boundsWidth: area.bounds_width,
        boundsHeight: area.bounds_height,
        actionType: area.action_type,
        actionData: area.actionData,
        intent: area.intent,
        label: area.label,
        tagIds: area.tagIds,
        scoreChange: area.score_change,
        templateId: area.template_id,
        formId: area.form_id,
        trackedLinkId: area.tracked_link_id,
      })),
    })),
  });
}

/**
 * LINE create の成功とD1 journalの間でWorkerが止まっても、次回のlist照合で
 * 同じshellを回収できる決定名。通常・予約公開の従来名とは接頭辞を分ける。
 * request/page は内部UUIDなので、最大でもLINEの300文字制限を十分下回る。
 */
export function manualPublishShellName(requestId: string, pageId: string): string {
  return `lhm:${requestId}:${pageId}`;
}

async function recoverManualPublishShellsFromLine(
  line: LineRichMenuClient,
  requestId: string,
  pages: Array<{ id: string; order_index: number }>,
): Promise<Array<{ pageId: string; orderIndex: number; newRichMenuId: string }>> {
  const lineMenus = await line.listRichMenus();
  const recovered: Array<{ pageId: string; orderIndex: number; newRichMenuId: string }> = [];
  for (const page of pages) {
    const expectedName = manualPublishShellName(requestId, page.id);
    const matches = lineMenus.filter((menu) => menu.name === expectedName);
    if (matches.length > 1) throw new Error('manual publish recovery found duplicate LINE shells');
    if (matches.length === 1) {
      recovered.push({ pageId: page.id, orderIndex: page.order_index, newRichMenuId: matches[0].richMenuId });
    }
  }
  return recovered;
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
  // #827 (N-155): ボタン名は端末の読み上げ(アクセシビリティ)にも使うため
  // 20 字まで。公開時の必須・上限検査と同じ上限を保存口でも掛けて、
  // 21 字以上の値を DB へ残さない。
  if (typeof r.label === 'string' && [...r.label].length > 20) {
    return { ok: false, error: 'area.label must be 20 characters or fewer' };
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

// N-161: 新規作成でもページ切替を決められるようにする。
// 作成前は page.id が決まっていないため、切替ボタンの行き先は
// `actionData.targetPageIndex`（行き先ページの orderIndex）で受け、
// createRichMenuGroup が採番した実IDへ解決する。実IDを直接送る形
// (targetPageId) は誤解を招くので断る。
function validateRichmenuswitchInCreate(pages: RichMenuPageInput[]): string | null {
  const orderIndexes = new Set(pages.map((p) => p.orderIndex));
  for (const p of pages) {
    for (const a of p.areas) {
      if (a.actionType !== 'richmenuswitch') continue;
      const raw = a.actionData?.targetPageIndex;
      if (a.actionData?.targetPageId !== undefined) {
        return 'create payload must use actionData.targetPageIndex (orderIndex) for richmenuswitch, not targetPageId';
      }
      if (typeof raw !== 'number' || !Number.isInteger(raw) || !orderIndexes.has(raw)) {
        return 'richmenuswitch action requires actionData.targetPageIndex pointing to a page orderIndex in this menu';
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
  // N-161: 既定ページ・配信対象・全員既定を作成時に決められるようにする。
  let defaultPageIndex: number | null = null;
  if (r.defaultPageIndex !== undefined && r.defaultPageIndex !== null) {
    if (
      typeof r.defaultPageIndex !== 'number'
      || !Number.isInteger(r.defaultPageIndex)
      || !pages.value.some((p) => p.orderIndex === r.defaultPageIndex)
    ) {
      return { ok: false, error: 'defaultPageIndex must be an orderIndex of one of the pages' };
    }
    defaultPageIndex = r.defaultPageIndex;
  }
  if (r.isDefaultForAll !== undefined && typeof r.isDefaultForAll !== 'boolean') {
    return { ok: false, error: 'isDefaultForAll must be boolean' };
  }
  if (r.targetingEnabled !== undefined && typeof r.targetingEnabled !== 'boolean') {
    return { ok: false, error: 'targetingEnabled must be boolean' };
  }
  if (r.targetingPriority !== undefined) {
    if (typeof r.targetingPriority !== 'number' || !Number.isInteger(r.targetingPriority)) {
      return { ok: false, error: 'targetingPriority must be an integer' };
    }
  }
  let targetingCondition: string | null = null;
  if (r.targetingCondition !== undefined && r.targetingCondition !== null) {
    if (typeof r.targetingCondition !== 'string') {
      return { ok: false, error: 'targetingCondition must be a JSON string or null' };
    }
    try {
      JSON.parse(r.targetingCondition);
    } catch {
      return { ok: false, error: 'targetingCondition must be valid JSON' };
    }
    targetingCondition = r.targetingCondition;
  }
  // 「条件で出し分ける」を選んだのに条件が空だと、公開しても誰にも出ない
  // 設定が作れる。入口で断る。
  if (r.targetingEnabled === true && !targetingCondition) {
    return { ok: false, error: 'targetingEnabled requires targetingCondition' };
  }
  const switcherRejection = validateRichmenuswitchInCreate(pages.value);
  if (switcherRejection) return { ok: false, error: switcherRejection };
  return {
    ok: true,
    value: {
      accountId: r.accountId,
      name: r.name,
      chatBarText: r.chatBarText,
      size: r.size as 'large' | 'compact',
      pages: pages.value,
      folderId: (r.folderId as string | null | undefined) ?? null,
      defaultPageIndex,
      isDefaultForAll: r.isDefaultForAll === true,
      targetingEnabled: r.targetingEnabled === true,
      targetingCondition,
      targetingPriority: typeof r.targetingPriority === 'number' ? r.targetingPriority : 0,
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
  //    作ったばかりの group だが、group の状態を変える経路は例外なく
  //    同じ lease 契約に乗せる(経路ごとに流儀が違うと穴の元になる)。
  const importOwner = `import-${crypto.randomUUID()}`;
  const importGeneration = await acquirePublishLease(
    c.env.DB, created.id, importOwner, new Date().toISOString(),
  );
  if (importGeneration === null) {
    return c.json({ success: false, error: 'failed to acquire publish lock' }, 409);
  }
  const importFence = { owner: importOwner, generation: importGeneration };
  try {
    // 8. alias を upsert (今後の再 publish 時の安定 ID として)。
    //    外部操作なので lease を持っているうちに済ませ、直前に実時刻で延ばす。
    //    確定のあとに回すと、解放後の無防備な外部操作になる。
    if (!(await renewPublishLease(c.env.DB, created.id, importFence, new Date().toISOString()))) {
      throw new PublishLeaseLostError();
    }
    const aliasId = `lhx-${created.id.slice(0, 8)}-0`;
    try {
      await fetch(`https://api.line.me/v2/bot/richmenu/alias/${aliasId}`, {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
    } catch {
      // 既に無い場合は無視。作り直しは次の POST で行う。
    }
    await fetch('https://api.line.me/v2/bot/richmenu/alias', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
    });

    // 9. line_richmenu_id を埋めて status='published' に。
    //    札付き書込みの false は失権。無視して成功応答にしない。
    if (!(await renewPublishLease(c.env.DB, created.id, importFence, new Date().toISOString()))) {
      throw new PublishLeaseLostError();
    }
    if (!(await setPageRichMenuId(c.env.DB, newPage.id, richMenuId, importFence))) {
      throw new PublishLeaseLostError();
    }
    if (!(await markRichMenuGroupPublished(c.env.DB, created.id, importFence))) {
      throw new PublishLeaseLostError();
    }
    // 確定と解放は別。ここまで来て初めて lease を手放す。
    await releasePublishLease(c.env.DB, created.id, importFence);
    return c.json({ success: true, data: { id: created.id, name: created.name } });
  } catch (e) {
    await releasePublishLease(c.env.DB, created.id, importFence);
    if (e instanceof PublishLeaseLostError) {
      return c.json(
        { success: false, error: '公開の担当が別の処理へ移りました。最新の状態を確認して、もう一度お試しください。' },
        409,
      );
    }
    throw e;
  }
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
    // N-163: 検索はメニュー名・トークバー文言・ボタン名（面のラベル）の3方向へ
    // 当たる。大小文字と空白（半角・全角）を揃えて比較する。ボタン名は別表なので
    // 一致する group の id を先に引き、一覧の絞り込みに合成する。
    const normalizedQuery = normalizeRichMenuSearchText(query);
    const labelMatchedGroupIds = wantsPaging && normalizedQuery
      ? await listRichMenuGroupIdsByAreaLabel(c.env.DB, accountId, normalizedQuery)
      : new Set<string>();
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
          if (
            normalizedQuery
            && !normalizeRichMenuSearchText(item.name).includes(normalizedQuery)
            && !normalizeRichMenuSearchText(item.chatBarText).includes(normalizedQuery)
            && !labelMatchedGroupIds.has(item.id)
          ) return false;
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
    const requestedRestoreGroupId = typeof body.restoreGroupId === 'string' && body.restoreGroupId.length > 0
      ? body.restoreGroupId
      : null;
    // 明示の指定があれば検証して保存する。指定なし(「前のメニューに戻す」)は
    // nullのまま保存し、実行開始直前・切替前に実LINE defaultを固定する(365)。
    // 予約時点では確定しない(期間中の管理画面外の変更にずれないようにする)。
    const restoreGroupId: string | null = requestedRestoreGroupId;
    if (restoreGroupId) {
      const restore = await getRichMenuGroupById(c.env.DB, restoreGroupId);
      if (!restore || restore.account_id !== group.account_id || restore.status !== 'published') {
        return c.json({ success: false, error: 'restoreGroupId must be a published menu in the same account' }, 400);
      }
    }

    // 同時2要求でも片方だけ作るため atomic にINSERTし、同key異内容は成功扱いにしない。
    const { createRichMenuScheduleAtomic } = await import('@line-crm/db');
    const now = jstNow();
    const id = crypto.randomUUID();
    const definitionSnapshot = JSON.stringify(serializeGroupWithPages(group));
    const created = await createRichMenuScheduleAtomic(c.env.DB, {
      id,
      groupId: group.id,
      accountId: group.account_id,
      mode: body.mode,
      startsAt: body.startsAt as string,
      endsAt,
      restoreGroupId,
      definitionSnapshot,
      idempotencyKey,
      requestedByStaffId: c.get('staff').id,
      now,
    });
    if (created.outcome === 'conflict') {
      return c.json(
        { success: false, error: 'Idempotency-Key is already used with different content', id: created.id, status: created.status },
        409,
      );
    }
    if (created.outcome === 'existing') {
      return c.json({ success: true, data: { id: created.id, status: created.status } });
    }
    return c.json({
      success: true,
      data: {
        id,
        status: 'scheduled',
        restoreGroupId,
        // 戻し先の固定は実行開始直前に行う。予約時点では未確定。
        restoreDefaultState: null,
      },
    }, 201);
  },
);

/** 予約一覧と状態確認。実行前取消の判断材料を返す。 */
richMenuGroups.get('/api/rich-menu-groups/:groupId/schedules', async (c) => {
  const group = await getRichMenuGroupWithPages(c.env.DB, c.req.param('groupId'));
  if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
    return c.json({ success: false, error: 'not found' }, 404);
  }
  const rows = await listRichMenuSchedulesByGroup(c.env.DB, group.id, 50);
  return c.json({
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      mode: row.mode,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      restoreGroupId: row.restore_group_id,
      // 実行開始直前に固定した切替前defaultの状態。capturedは固定メニューへ
      // 戻し、no_defaultは明示解除する。nullは未固定(未実行)。
      restoreDefaultState: row.restore_default_state,
      status: row.status,
      attemptCount: row.attempt_count,
      nextRetryAt: row.next_retry_at,
      lastErrorCode: row.last_error_code,
      createdAt: row.created_at,
    })),
  });
});

/** 実行前の取消。publishing/restoring の最中は最新状態付きの409で止める。 */
richMenuGroups.post(
  '/api/rich-menu-groups/:groupId/schedules/:scheduleId/cancel',
  requireRole('owner', 'admin'),
  async (c) => {
    const group = await getRichMenuGroupWithPages(c.env.DB, c.req.param('groupId'));
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const scheduleId = c.req.param('scheduleId');
    const cancelled = await cancelRichMenuSchedule(c.env.DB, scheduleId, group.id, group.account_id);
    if (cancelled) return c.json({ success: true, data: { id: scheduleId, status: 'cancelled' } });
    const rows = await listRichMenuSchedulesByGroup(c.env.DB, group.id, 200);
    const current = rows.find((row) => row.id === scheduleId);
    if (!current) return c.json({ success: false, error: 'not found' }, 404);
    return c.json({ success: false, error: 'already started', status: current.status }, 409);
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
  const created = await createRichMenuGroup(c.env.DB, parsed.value);
  // N-164: 登録メディアを選んで作った場合、既定ページの画像としてここで登録する。
  // 作成と別口の「画像アップロード」を要しないため、作成画面へ戻った選択が
  // そのまま下書きへ反映される。失敗しても下書き自体は残し、編集画面で
  // やり直せることを応答で伝える。
  const imageMediaId = isJsonRecord(body) && typeof body.imageMediaId === 'string' && body.imageMediaId.length > 0
    ? body.imageMediaId
    : null;
  if (imageMediaId) {
    try {
      const media = await getMediaById(c.env.DB, imageMediaId, parsed.value.accountId)
        ?? await getMediaById(c.env.DB, imageMediaId, null);
      if (!media || media.kind !== 'image' || media.archived_at) {
        return c.json(
          { success: false, error: '選ばれたメディアはこのアカウントの画像として使えません', data: serializeGroupWithPages(created) },
          400,
        );
      }
      const obj = await c.env.IMAGES.get(media.r2_key);
      if (!obj) throw new Error('media object not found in storage');
      const buf = new Uint8Array(await new Response(obj.body).arrayBuffer());
      const validation = validateRichMenuImage(buf, buf.byteLength);
      if (!validation.ok) {
        return c.json(
          { success: false, error: `選ばれた画像を使えません: ${validation.error}`, data: serializeGroupWithPages(created) },
          400,
        );
      }
      if (validation.size !== created.size) {
        return c.json(
          {
            success: false,
            error: `選ばれた画像の大きさ（${validation.size === 'large' ? '大きい' : '小さい'}向け）がメニューの大きさと合いません`,
            data: serializeGroupWithPages(created),
          },
          400,
        );
      }
      const defaultPage = created.pages.find((p) => p.id === created.default_page_id)
        ?? created.pages[0];
      const contentType = media.mime_type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      const ext = contentType === 'image/png' ? 'png' : 'jpg';
      const key = `rich-menus/${parsed.value.accountId}/${created.id}/${defaultPage.id}/${Date.now()}.${ext}`;
      await c.env.IMAGES.put(key, buf, { httpMetadata: { contentType } });
      await setRichMenuPageImage(c.env.DB, defaultPage.id, key, contentType);
      const refreshed = await getRichMenuGroupWithPages(c.env.DB, created.id);
      return c.json({ success: true, data: serializeGroupWithPages(refreshed ?? created) });
    } catch (error) {
      console.error('POST /api/rich-menu-groups image apply error:', error);
      return c.json(
        {
          success: false,
          error: '下書きは作成しましたが、画像の登録に失敗しました。編集画面で画像を登録してください。',
          data: serializeGroupWithPages(created),
        },
        500,
      );
    }
  }
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

  // #827 (N-158): 公開中の定義(LINEに出ている形)は直接上書きしない。ページ構成・
  // トークバー文言・全員既定の指定を変えるには、いったん取り下げて下書きへ戻すか、
  // 取り込み/新規作成で別IDの下書きを作る。名前・出し分け条件・フォルダ・並び順は
  // 公開中でも運用変更として従来どおり許す。
  if (
    existing.status === 'published'
    && (parsed.value.pages !== undefined
      || parsed.value.meta.chatBarText !== undefined
      || parsed.value.meta.isDefaultForAll !== undefined)
  ) {
    return c.json(
      {
        success: false,
        error: '公開中のメニューは直接変更できません。LINEから取り下げて下書きに戻してから編集してください',
      },
      409,
    );
  }

  await updateRichMenuGroupMeta(c.env.DB, groupId, parsed.value.meta);
  if (parsed.value.pages) {
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
  // #827 (N-158): ページ画像も公開中の定義の一部。LINE上の表示とずれるだけなので、
  // 本文を読む前・R2へ書く前に断る。
  if (group.status === 'published') {
    return c.json(
      {
        success: false,
        error: '公開中のメニューは直接変更できません。LINEから取り下げて下書きに戻してから編集してください',
      },
      409,
    );
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
    async listRichMenus() {
      const res = await fetch('https://api.line.me/v2/bot/richmenu/list', {
        headers: { Authorization: auth },
      });
      if (!res.ok) throw new Error(`LINE listRichMenus failed: ${res.status} ${await res.text()}`);
      const body = await res.json() as { richmenus?: Array<{ richMenuId?: string; name?: string }> };
      return (body.richmenus ?? []).flatMap((menu) => (
        typeof menu.richMenuId === 'string'
          ? [{ richMenuId: menu.richMenuId, name: typeof menu.name === 'string' ? menu.name : null }]
          : []
      ));
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
    // ----- N-152: 本人LINEへのテスト適用で使う個人宛て操作 -----
    async linkRichMenuToUser(userId, richMenuId) {
      const res = await fetch(
        `https://api.line.me/v2/bot/user/${encodeURIComponent(userId)}/richmenu/${encodeURIComponent(richMenuId)}`,
        { method: 'POST', headers: { Authorization: auth } },
      );
      if (!res.ok) {
        throw new Error(`LINE linkRichMenuToUser failed: ${res.status} ${await res.text()}`);
      }
    },
    async unlinkRichMenuFromUser(userId) {
      const res = await fetch(
        `https://api.line.me/v2/bot/user/${encodeURIComponent(userId)}/richmenu`,
        { method: 'DELETE', headers: { Authorization: auth } },
      );
      if (!res.ok && res.status !== 404) {
        throw new Error(`LINE unlinkRichMenuFromUser failed: ${res.status} ${await res.text()}`);
      }
    },
    async getRichMenuIdOfUser(userId) {
      const res = await fetch(
        `https://api.line.me/v2/bot/user/${encodeURIComponent(userId)}/richmenu`,
        { headers: { Authorization: auth } },
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`LINE getRichMenuIdOfUser failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { richMenuId?: string };
      return body.richMenuId ?? null;
    },
    async listRichMenuAliases() {
      const res = await fetch('https://api.line.me/v2/bot/richmenu/alias/list', {
        headers: { Authorization: auth },
      });
      if (!res.ok) {
        throw new Error(`LINE listRichMenuAliases failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as {
        aliases?: Array<{ richMenuAliasId?: string; richMenuId?: string }>;
      };
      return (body.aliases ?? []).flatMap((alias) =>
        typeof alias.richMenuAliasId === 'string' && typeof alias.richMenuId === 'string'
          ? [{ richMenuAliasId: alias.richMenuAliasId, richMenuId: alias.richMenuId }]
          : [],
      );
    },
  };
}

richMenuGroups.post('/api/rich-menu-groups/:groupId/publish', requireRole('owner', 'admin'), async (c) => {
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
  if (!idempotencyKey) {
    return c.json({ success: false, error: 'Idempotency-Key header required' }, 400);
  }
  return handleManualPublish(c, c.req.param('groupId'), idempotencyKey);
});

/**
 * 手動公開の本体。`/publish` と失敗run再試行 `/publish-runs/:requestId/retry` の
 * 両方がここへ来る。request の存在確定・lease・journal・LINE切替はこの中で行う。
 */
async function handleManualPublish(
  c: Context<Env>,
  groupId: string,
  idempotencyKey: string,
) {
  const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
  if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
    return c.json({ success: false, error: 'not found' }, 404);
  }
  const fingerprint = manualPublishFingerprint(group);
  const requestResult = await createRichMenuManualPublishRequestAtomic(c.env.DB, {
    id: crypto.randomUUID(),
    groupId,
    accountId: group.account_id,
    definitionSnapshot: JSON.stringify(serializeGroupWithPages(group)),
    requestFingerprint: fingerprint,
    idempotencyKey,
    requestedByStaffId: c.get('staff').id,
    now: jstNow(),
  });
  if (requestResult.outcome === 'conflict') {
    return c.json({ success: false, error: 'Idempotency-Key is already used with different content' }, 409);
  }
  let request = requestResult.request;
  if (request.status === 'succeeded') {
    try {
      return c.json({ success: true, data: JSON.parse(request.result_json ?? '') }, 200, {
        'Idempotency-Replayed': 'true',
      });
    } catch {
      // 成功済み行の壊れた応答を直すためにLINEを再実行してはいけない。
      return c.json({ success: false, error: '公開結果を再取得できません。最新状態を確認してください。' }, 500);
    }
  }
  if (request.status === 'failed') await restartRichMenuManualPublishRequest(c.env.DB, request.id);

  // 有効なlease保持中だけ409。ここで止まった同keyは、lease解放後に同じjournalから再開できる。
  if (await isPublishLeaseHeld(c.env.DB, groupId, new Date().toISOString())) {
    return c.json({ success: false, error: 'already publishing' }, 409);
  }
  const account = await getLineAccountById(c.env.DB, group.account_id);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 500);

  const publishOwner = `manual-${request.id}`;
  const publishGeneration = await acquirePublishLease(c.env.DB, groupId, publishOwner, new Date().toISOString());
  if (publishGeneration === null) return c.json({ success: false, error: 'failed to acquire publish lock' }, 409);
  const publishFence = { owner: publishOwner, generation: publishGeneration };
  const executionToken = crypto.randomUUID();

  try {
    // 別要求が「running」を読んだ直後に先行要求が成功・lease解放した場合でも、
    // lease取得後に必ず再読する。古いstatusのままLINE切替をもう一度実行しない。
    const latestRequest = await getRichMenuManualPublishRequest(c.env.DB, group.account_id, idempotencyKey);
    if (!latestRequest) throw new Error('manual publish request disappeared');
    request = latestRequest;
    if (request.status === 'succeeded') {
      try {
        const data = JSON.parse(request.result_json ?? '');
        await releasePublishLease(c.env.DB, groupId, publishFence);
        return c.json({ success: true, data }, 200, { 'Idempotency-Replayed': 'true' });
      } catch {
        throw new Error('manual publish result is invalid');
      }
    }
    if (!await claimRichMenuManualPublishRequest(c.env.DB, request.id, executionToken)) {
      await releasePublishLease(c.env.DB, groupId, publishFence);
      return c.json({ success: false, error: '公開処理の担当が切り替わりました。最新の状態を確認してください。' }, 409);
    }
    // lease取得前後の下書き更新を必ず拒否する。古い版を作成・切替しない。
    const latestGroup = await getRichMenuGroupWithPages(c.env.DB, groupId);
    if (!latestGroup || manualPublishFingerprint(latestGroup) !== fingerprint) {
      await markRichMenuManualPublishFailed(c.env.DB, request.id, executionToken, 'manual publish target changed');
      await releasePublishLease(c.env.DB, groupId, publishFence);
      return c.json({ success: false, error: '公開対象が更新されました。画面を更新してからもう一度お試しください。' }, 409);
    }
    const line = createLineClient(account.channel_access_token);
    const r2Adapter: R2Like = {
      async get(key) {
        const obj = await c.env.IMAGES.get(key);
        if (!obj) return null;
        return { body: obj.body as ReadableStream };
      },
    };
    const trackedLinkUrls = await resolveTrackedLinkUrls(
      c.env.DB,
      () => resolveTrackedLinkBaseUrl(c.env.DB, c.env.WORKER_URL || new URL(c.req.url).origin),
      latestGroup,
    );
    const formBaseUrl = account.liff_id ? `https://liff.line.me/${account.liff_id}` : (c.env.LIFF_URL ?? null);
    const groupInput: GroupInput = {
      id: latestGroup.id,
      size: latestGroup.size,
      chatBarText: latestGroup.chat_bar_text,
      isDefaultForAll: latestGroup.is_default_for_all === 1,
      formBaseUrl,
      pages: latestGroup.pages.map((p) => ({
        id: p.id, orderIndex: p.order_index, name: p.name,
        imageR2Key: p.image_r2_key, imageContentType: p.image_content_type, lineRichMenuId: p.line_richmenu_id,
        areas: p.areas.map((a) => ({
          id: a.id,
          bounds: { x: a.bounds_x, y: a.bounds_y, width: a.bounds_width, height: a.bounds_height },
          actionType: a.action_type, actionData: a.actionData, intent: a.intent, label: a.label,
          tagIds: a.tagIds, scoreChange: a.score_change, templateId: a.template_id, formId: a.form_id,
          trackedLinkUrl: a.tracked_link_id ? (trackedLinkUrls.get(a.tracked_link_id) ?? null) : null,
        })),
      })),
    };
    // LINEの一覧照合より先に、下書きの不備を止める。無効な定義で外部APIを読む必要はない。
    validateRichMenuGroupForPublish({
      ...groupInput,
      pages: resolveSwitcherActions(groupInput.pages, groupInput.id),
    });
    const heartbeat = async () => {
      const alive = await renewPublishLease(c.env.DB, groupId, publishFence, new Date().toISOString());
      if (!alive) throw new PublishLeaseLostError();
    };

    let shells = await getRichMenuManualPublishShells(c.env.DB, request.id);
    const oldByPage = new Map(latestGroup.pages.map((page) => [page.id, page.line_richmenu_id]));
    // create成功後、D1書込前にWorkerが止まっても、決定名のLINE menuを先に回収する。
    // 既にjournal済みの同pageとIDが食い違う場合は別requestを混ぜず停止する。
    const recovered = await recoverManualPublishShellsFromLine(line, request.id, latestGroup.pages);
    const journalByPage = new Map(shells.map((shell) => [shell.page_id, shell]));
    for (const shell of recovered) {
      const journaled = journalByPage.get(shell.pageId);
      if (journaled && journaled.new_richmenu_id !== shell.newRichMenuId) {
        throw new Error('manual publish shell recovery conflicts with journal');
      }
    }
    const recoveredUnjournaled = recovered.filter((shell) => !journalByPage.has(shell.pageId));
    if (recoveredUnjournaled.length > 0) {
      await recordRichMenuManualPublishShells(c.env.DB, request.id, recoveredUnjournaled.map((shell) => ({
        ...shell,
        oldRichMenuId: oldByPage.get(shell.pageId) ?? null,
      })));
      shells = await getRichMenuManualPublishShells(c.env.DB, request.id);
    }
    await createRichMenuShells(groupInput, line, r2Adapter, heartbeat, {
      existingShells: shells.map((shell) => ({
        pageId: shell.page_id,
        orderIndex: shell.order_index,
        newRichMenuId: shell.new_richmenu_id,
      })),
      shellName: (page) => manualPublishShellName(request.id, page.id),
      onShellCreated: async (shell) => {
        await recordRichMenuManualPublishShells(c.env.DB, request.id, [{
          ...shell,
          oldRichMenuId: oldByPage.get(shell.pageId) ?? null,
        }]);
      },
    });
    shells = await getRichMenuManualPublishShells(c.env.DB, request.id);
    if (shells.length !== latestGroup.pages.length || shells.some((shell) => !latestGroup.pages.some((page) => page.id === shell.page_id))) {
      throw new Error('manual publish shell journal does not match the requested version');
    }
    await switchRichMenuLive(line, groupInput, shells.map((shell) => ({
      pageId: shell.page_id, orderIndex: shell.order_index, newRichMenuId: shell.new_richmenu_id,
    })), heartbeat);
    // switch完了後も、D1の確定に入る直前にleaseを延長・照合する。ここで別keyの
    // 実行に引き継がれていたら、古い実行結果を確定/返却してはいけない。
    await heartbeat();
    for (const shell of shells) {
      if (!(await setPageRichMenuId(c.env.DB, shell.page_id, shell.new_richmenu_id, publishFence))) {
        throw new PublishLeaseLostError();
      }
    }
    await heartbeat();
    if (!(await markRichMenuGroupPublished(c.env.DB, groupId, publishFence))) throw new PublishLeaseLostError();
    // 最初の版で控えた旧IDだけを消す。再開時に現在page行の新IDを旧IDと誤認しない。
    await deleteRichMenuShells(line, shells.flatMap((shell) => shell.old_richmenu_id ? [shell.old_richmenu_id] : []));
    const result = { pages: shells.map((shell) => ({ pageId: shell.page_id, newRichMenuId: shell.new_richmenu_id })) };
    // 成功recordは、leaseを最後に延長した直後の同一fenceでのみ確定する。外部切替後に
    // 期限切れ・別keyへの引継ぎが起きた古い実行が、自分の古いpagesを成功応答へ固定しない。
    await heartbeat();
    if (!await markRichMenuManualPublishSucceeded(c.env.DB, request.id, executionToken, JSON.stringify(result), {
      groupId,
      owner: publishFence.owner,
      generation: publishFence.generation,
      nowIso: new Date().toISOString(),
    })) {
      throw new PublishLeaseLostError();
    }
    await releasePublishLease(c.env.DB, groupId, publishFence);
    return c.json({ success: true, data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markRichMenuManualPublishFailed(c.env.DB, request.id, executionToken, message, {
      groupId,
      owner: publishFence.owner,
      generation: publishFence.generation,
      nowIso: new Date().toISOString(),
    });
    await releasePublishLease(c.env.DB, groupId, publishFence);
    if (e instanceof PublishLeaseLostError) {
      return c.json({ success: false, error: '公開の担当が別の処理へ移りました。最新の状態を確認して、もう一度お試しください。' }, 409);
    }
    if (e instanceof RichMenuValidationError) return c.json({ success: false, error: message }, 400);
    return c.json({ success: false, error: message }, 500);
  }
}

// ----- N-151: 公開履歴・失敗だけの再試行・LINEとの照合修復 -----

/**
 * 公開履歴の一覧。各runの版（スナップショットの要約）・状態・試行に使った
 * LINE ID・最終エラーを返す。別アカウントは404で隠す。
 */
richMenuGroups.get(
  '/api/rich-menu-groups/:groupId/publish-runs',
  requireRole('owner', 'admin'),
  async (c) => {
    const group = await getRichMenuGroupById(c.env.DB, c.req.param('groupId'));
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const requests = await listRichMenuManualPublishRequests(c.env.DB, group.id, 50);
    const runs = [];
    for (const request of requests) {
      const shells = await getRichMenuManualPublishShells(c.env.DB, request.id);
      // 版の要約。スナップショットが読めなくても一覧自体は返す。
      let version: { name: string | null; chatBarText: string | null; pageCount: number | null } = {
        name: null, chatBarText: null, pageCount: null,
      };
      try {
        const snapshot = JSON.parse(request.definition_snapshot) as {
          name?: string; chatBarText?: string; pages?: unknown[];
        };
        version = {
          name: typeof snapshot.name === 'string' ? snapshot.name : null,
          chatBarText: typeof snapshot.chatBarText === 'string' ? snapshot.chatBarText : null,
          pageCount: Array.isArray(snapshot.pages) ? snapshot.pages.length : null,
        };
      } catch {
        // 壊れたスナップショットは要約なしで返す。
      }
      runs.push({
        id: request.id,
        status: request.status,
        lastErrorCode: request.last_error_code,
        idempotencyKey: request.idempotency_key,
        requestedByStaffId: request.requested_by_staff_id,
        createdAt: request.created_at,
        updatedAt: request.updated_at,
        version,
        pages: shells.map((shell) => ({
          pageId: shell.page_id,
          orderIndex: shell.order_index,
          newRichMenuId: shell.new_richmenu_id,
          oldRichMenuId: shell.old_richmenu_id,
        })),
      });
    }
    return c.json({ success: true, data: runs });
  },
);

/**
 * 失敗した公開runだけを、その版の鍵で再試行する。
 * - succeeded: 保存済みの結果を再生する（LINEを再実行しない）
 * - running: 409
 * - failed: 同じ idempotency_key で handleManualPublish へ回し、journal の
 *   shell から再開する。鍵の中身が最新の下書きとずれていれば中で 409 になる。
 */
richMenuGroups.post(
  '/api/rich-menu-groups/:groupId/publish-runs/:requestId/retry',
  requireRole('owner', 'admin'),
  async (c) => {
    const groupId = c.req.param('groupId');
    const requestId = c.req.param('requestId');
    const group = await getRichMenuGroupById(c.env.DB, groupId);
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const request = await getRichMenuManualPublishRequestById(c.env.DB, requestId);
    if (!request || request.group_id !== groupId || request.account_id !== group.account_id) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    if (request.status === 'running') {
      return c.json({ success: false, error: 'この公開はまだ実行中です', status: 'running' }, 409);
    }
    if (request.status === 'succeeded') {
      try {
        return c.json(
          { success: true, data: JSON.parse(request.result_json ?? '') },
          200,
          { 'Idempotency-Replayed': 'true' },
        );
      } catch {
        return c.json({ success: false, error: '公開結果を再取得できません。最新状態を確認してください。' }, 500);
      }
    }
    return handleManualPublish(c, groupId, request.idempotency_key);
  },
);

/**
 * DBの記録とLINE上の実体の照合。
 *
 * dryRun=true（既定）: ずれを列挙するだけで何も変えない。
 * dryRun=false        : 列挙したずれを明示的に直す。
 *
 * 直す内容:
 *   - page の line_richmenu_id が LINE に無い → そのIDを外す
 *   - status='published' なのに LINE に実体が1つも無い → draft へ戻す
 *   - is_default_for_all なのに LINE の既定が別を指す → 既定を張り直す
 *     （既定ページの実体が LINE に無いときは張り直せないので、フラグを下ろす）
 *   - 失敗した公開runが残した lhm: メニュー → LINE から消す
 */
richMenuGroups.post(
  '/api/rich-menu-groups/:groupId/reconcile',
  requireRole('owner', 'admin'),
  async (c) => {
    const groupId = c.req.param('groupId');
    const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    let body: { dryRun?: unknown } = {};
    try {
      body = await c.req.json<{ dryRun?: unknown }>();
    } catch {
      // 本文なし = dryRun。
    }
    const dryRun = body.dryRun !== false;

    const account = await getLineAccountById(c.env.DB, group.account_id);
    if (!account) return c.json({ success: false, error: 'line account not found' }, 500);
    const line = createLineClient(account.channel_access_token);

    let lineMenus: Array<{ richMenuId: string; name: string | null }>;
    let currentDefault: string | null;
    try {
      lineMenus = await line.listRichMenus();
      currentDefault = await line.getCurrentDefaultRichMenuId();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: `LINEの状態を確認できませんでした: ${message}` }, 502);
    }
    const lineIds = new Set(lineMenus.map((menu) => menu.richMenuId));

    type ReconcileDiff = {
      kind:
        | 'stale_page_richmenu_id'
        | 'status_mismatch'
        | 'default_mismatch'
        | 'orphan_shell';
      detail: string;
      pageId?: string;
      richMenuId?: string;
    };
    const diffs: ReconcileDiff[] = [];

    // 1) ページが指すLINE IDが実在するか。
    const stalePages = group.pages.filter(
      (page) => page.line_richmenu_id && !lineIds.has(page.line_richmenu_id),
    );
    for (const page of stalePages) {
      diffs.push({
        kind: 'stale_page_richmenu_id',
        pageId: page.id,
        richMenuId: page.line_richmenu_id ?? undefined,
        detail: `ページ「${page.name}」が記録するLINEメニュー ${page.line_richmenu_id} はLINE上にありません`,
      });
    }

    // 2) 公開中なのにLINEに実体が無い。
    const livePages = group.pages.filter(
      (page) => page.line_richmenu_id && lineIds.has(page.line_richmenu_id),
    );
    if (group.status === 'published' && livePages.length === 0) {
      diffs.push({
        kind: 'status_mismatch',
        detail: '公開中と記録されていますが、LINE上にこのメニューの実体がありません',
      });
    }

    // 3) 全員既定の張り先がずれている。
    const defaultPage = group.pages.find((page) => page.id === group.default_page_id)
      ?? [...group.pages].sort((a, b) => a.order_index - b.order_index)[0];
    const expectedDefault = defaultPage?.line_richmenu_id ?? null;
    if (group.is_default_for_all === 1 && expectedDefault !== currentDefault) {
      diffs.push({
        kind: 'default_mismatch',
        richMenuId: currentDefault ?? undefined,
        detail: expectedDefault
          ? `LINEの全員既定がこのメニューを指していません（現在: ${currentDefault ?? 'なし'}）`
          : '全員既定と記録されていますが、既定ページにLINEメニューがありません',
      });
    }

    // 4) 失敗・中断した公開runが残した孤児メニュー。running のrunのものは触らない。
    const requests = await listRichMenuManualPublishRequests(c.env.DB, groupId, 50);
    const orphanShells: Array<{ requestId: string; richMenuId: string }> = [];
    for (const request of requests) {
      if (request.status === 'running') continue;
      const shells = await getRichMenuManualPublishShells(c.env.DB, request.id);
      for (const shell of shells) {
        const stillReferenced = group.pages.some(
          (page) => page.line_richmenu_id === shell.new_richmenu_id,
        );
        if (!stillReferenced && lineIds.has(shell.new_richmenu_id)) {
          orphanShells.push({ requestId: request.id, richMenuId: shell.new_richmenu_id });
        }
      }
    }
    for (const orphan of orphanShells) {
      diffs.push({
        kind: 'orphan_shell',
        richMenuId: orphan.richMenuId,
        detail: `完了・失敗した公開runが残したLINEメニュー ${orphan.richMenuId} が残っています`,
      });
    }

    if (dryRun) {
      return c.json({ success: true, data: { dryRun: true, diffs } });
    }

    // --- 修復 ---
    const applied: ReconcileDiff[] = [];
    const failed: Array<{ diff: ReconcileDiff; error: string }> = [];

    if (orphanShells.length > 0) {
      await deleteRichMenuShells(line, orphanShells.map((o) => o.richMenuId));
      applied.push(...diffs.filter((d) => d.kind === 'orphan_shell'));
    }

    const defaultDiff = diffs.find((d) => d.kind === 'default_mismatch');
    if (defaultDiff) {
      if (expectedDefault && lineIds.has(expectedDefault)) {
        try {
          await line.setDefaultRichMenu(expectedDefault);
          applied.push(defaultDiff);
        } catch (error) {
          failed.push({ diff: defaultDiff, error: error instanceof Error ? error.message : String(error) });
        }
      } else {
        // 既定へ張るべき実体が無い。フラグだけ下ろす。
        await c.env.DB
          .prepare(`UPDATE rich_menu_groups SET is_default_for_all = 0, updated_at = ? WHERE id = ?`)
          .bind(jstNow(), groupId)
          .run();
        applied.push(defaultDiff);
      }
    }

    const statusDiff = diffs.find((d) => d.kind === 'status_mismatch');
    if (statusDiff) {
      await c.env.DB
        .prepare(
          `UPDATE rich_menu_groups SET status = 'draft', is_default_for_all = 0, updated_at = ? WHERE id = ?`,
        )
        .bind(jstNow(), groupId)
        .run();
      applied.push(statusDiff);
    }

    for (const page of stalePages) {
      await c.env.DB
        .prepare(`UPDATE rich_menu_pages SET line_richmenu_id = NULL, updated_at = ? WHERE id = ?`)
        .bind(jstNow(), page.id)
        .run();
    }
    applied.push(...diffs.filter((d) => d.kind === 'stale_page_richmenu_id'));

    const staff = c.get('staff');
    c.set('auditRecorded', true);
    try {
      await recordAuditEvent(c.env.DB, {
        tenantId: staff?.tenantId,
        lineAccountId: group.account_id,
        category: 'business',
        actorPrincipalId: staff?.id,
        actorRole: staff?.role,
        action: 'rich_menu.reconcile',
        targetKind: 'rich_menu_group',
        targetId: groupId,
        result: failed.length > 0 ? 'failed' : 'success',
        after: {
          diffCount: diffs.length,
          applied: applied.map((d) => d.kind),
          failed: failed.map((f) => f.diff.kind),
        },
        requestTraceId: c.req.header('cf-ray') ?? c.req.header('x-request-id') ?? null,
        ipPrefix: maskAuditIp(c.req.header('cf-connecting-ip')),
        deviceFamily: auditDeviceFamily(c.req.header('user-agent')),
      });
    } catch (auditError) {
      console.error('rich_menu.reconcile audit insert failed:', auditError);
    }

    return c.json({
      success: failed.length === 0,
      data: { dryRun: false, diffs, applied: applied.length, failed },
    });
  },
);

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

  // 停止も group の状態を変える経路なので、公開と同じ lease 契約で行う。
  // lease なしで畳むと、同じ group を公開中の実行の owner と期限を消してしまう。
  const unpublishOwner = `unpublish-${crypto.randomUUID()}`;
  const unpublishGeneration = await acquirePublishLease(
    c.env.DB, groupId, unpublishOwner, new Date().toISOString(),
  );
  if (unpublishGeneration === null) {
    return c.json({ success: false, error: 'already publishing' }, 409);
  }
  const unpublishFence = { owner: unpublishOwner, generation: unpublishGeneration };

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
    // ページ数ぶんの削除で時間がかかる。外部呼び出しの直前ごとに実時刻で延ばす。
    const heartbeat = async () => {
      const alive = await renewPublishLease(
        c.env.DB, groupId, unpublishFence, new Date().toISOString(),
      );
      if (!alive) throw new PublishLeaseLostError();
    };
    const result = await unpublishRichMenuGroup(groupInput, line, heartbeat);
    // false は失権。書けていないのに成功と返さない。
    if (!(await markRichMenuGroupUnpublished(c.env.DB, groupId, unpublishFence))) {
      throw new PublishLeaseLostError();
    }
    await clearRichMenuAssignmentsForGroup(c.env.DB, groupId);
    // 確定と解放は別。ここまで来て初めて lease を手放す。
    await releasePublishLease(c.env.DB, groupId, unpublishFence);
    return c.json({ success: true, data: result });
  } catch (e) {
    await releasePublishLease(c.env.DB, groupId, unpublishFence);
    if (e instanceof PublishLeaseLostError) {
      return c.json(
        { success: false, error: '公開の担当が別の処理へ移りました。最新の状態を確認して、もう一度お試しください。' },
        409,
      );
    }
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

// ----- N-154: 下書き複製 -----

/**
 * メニュー全体（ページ・ボタン・画像参照・出し分け条件）を別IDの下書きとして
 * 複製する。公開状態・予約・LINE richMenu ID・実行台帳は引き継がない。
 * Idempotency-Key で同じ操作を1回に数える。
 */
richMenuGroups.post(
  '/api/rich-menu-groups/:groupId/duplicate',
  requireRole('owner', 'admin'),
  async (c) => {
    const groupId = c.req.param('groupId');
    const group = await getRichMenuGroupById(c.env.DB, groupId);
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!idempotencyKey) {
      return c.json({ success: false, error: 'Idempotency-Key header required' }, 400);
    }
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      // 名前の指定が無ければ「○○ のコピー」。本文なしも許す。
    }
    const requestedName = isJsonRecord(body) && typeof body.name === 'string' ? body.name : undefined;

    const result = await duplicateRichMenuGroupAtomic(c.env.DB, {
      requestId: crypto.randomUUID(),
      accountId: group.account_id,
      sourceGroupId: groupId,
      idempotencyKey,
      name: requestedName,
    });
    if (result.outcome === 'conflict') {
      return c.json(
        { success: false, error: 'Idempotency-Key is already used with different content' },
        409,
      );
    }
    const created = await getRichMenuGroupWithPages(c.env.DB, result.groupId);
    if (!created) return c.json({ success: false, error: 'duplicate target not found' }, 500);

    const staff = c.get('staff');
    c.set('auditRecorded', true);
    try {
      await recordAuditEvent(c.env.DB, {
        tenantId: staff?.tenantId,
        lineAccountId: group.account_id,
        category: 'business',
        actorPrincipalId: staff?.id,
        actorRole: staff?.role,
        action: 'rich_menu.duplicate',
        targetKind: 'rich_menu_group',
        targetId: groupId,
        result: 'success',
        after: { createdGroupId: result.groupId, replayed: result.outcome === 'existing' },
        requestTraceId: c.req.header('cf-ray') ?? c.req.header('x-request-id') ?? null,
        ipPrefix: maskAuditIp(c.req.header('cf-connecting-ip')),
        deviceFamily: auditDeviceFamily(c.req.header('user-agent')),
      });
    } catch (auditError) {
      console.error('rich_menu.duplicate audit insert failed:', auditError);
    }

    return c.json(
      { success: true, data: serializeGroupWithPages(created) },
      result.outcome === 'existing' ? 200 : 201,
      result.outcome === 'existing' ? { 'Idempotency-Replayed': 'true' } : undefined,
    );
  },
);

// ----- N-156: staffへは合計だけ見せる影響人数 -----

/**
 * 「実際にこのメニューが出る人」の集計だけを返す読み取り口。
 * preview-targets（owner/admin）は友だち条件の内訳や上位メニュー名を返すが、
 * staff へは件数だけを出す。友だち個人の情報・条件の中身・他メニュー名は
 * ここには一切載せない。
 */
richMenuGroups.get('/api/rich-menu-groups/:groupId/audience-summary', async (c) => {
  const group = await getRichMenuGroupById(c.env.DB, c.req.param('groupId'));
  if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
    return c.json({ success: false, error: 'not found' }, 404);
  }
  try {
    const condition = group.targeting_enabled === 1
      ? parseCondition(group.targeting_condition)
      : null;
    if (group.targeting_enabled === 1 && group.targeting_condition && !condition) {
      return c.json({ success: false, error: '保存済みの対象条件を読み取れませんでした' }, 503);
    }
    const targetWhere = condition ? buildSegmentWhere(condition) : { sql: '1=1', bindings: [] };

    const [totalRow, matchedRow, higher] = await Promise.all([
      c.env.DB
        .prepare(
          `SELECT COUNT(*) AS count FROM friends f
            WHERE f.line_account_id = ? AND f.is_following = 1`,
        )
        .bind(group.account_id)
        .first<{ count: number }>(),
      c.env.DB
        .prepare(
          `SELECT COUNT(*) AS count
             FROM friends f
            WHERE f.line_account_id = ?
              AND f.is_following = 1
              AND (${targetWhere.sql})`,
        )
        .bind(group.account_id, ...targetWhere.bindings)
        .first<{ count: number }>(),
      c.env.DB
        .prepare(
          `SELECT targeting_condition
             FROM rich_menu_groups
            WHERE account_id = ?
              AND id <> ?
              AND status = 'published'
              AND targeting_enabled = 1
              AND targeting_priority < ?`,
        )
        .bind(group.account_id, group.id, group.targeting_priority)
        .all<{ targeting_condition: string | null }>(),
    ]);

    const higherParts: Array<{ sql: string; bindings: unknown[] }> = [];
    let unreadableHigher = false;
    for (const row of higher.results ?? []) {
      const parsed = parseCondition(row.targeting_condition);
      if (!parsed) {
        unreadableHigher = true;
        continue;
      }
      higherParts.push(buildSegmentWhere(parsed));
    }

    let excluded: number | null = 0;
    if (!unreadableHigher && higherParts.length > 0) {
      const higherSql = higherParts.map((part) => `(${part.sql})`).join(' OR ');
      const result = await c.env.DB
        .prepare(
          `SELECT COUNT(*) AS count
             FROM friends f
            WHERE f.line_account_id = ?
              AND f.is_following = 1
              AND (${targetWhere.sql})
              AND (${higherSql})`,
        )
        .bind(group.account_id, ...targetWhere.bindings, ...higherParts.flatMap((p) => p.bindings))
        .first<{ count: number }>();
      excluded = result?.count ?? 0;
    } else if (unreadableHigher) {
      excluded = null;
    }

    const matched = matchedRow?.count ?? 0;
    return c.json({
      success: true,
      data: {
        // 件数だけ。個人・条件・他メニューの名前は返さない。
        total: { value: totalRow?.count ?? 0, state: 'available', reason: null },
        targeted: { value: matched, state: 'available', reason: null },
        excluded: excluded === null
          ? { value: null, state: 'unavailable', reason: 'higher_condition_unreadable' }
          : { value: excluded, state: 'available', reason: null },
        effective: excluded === null
          ? { value: null, state: 'unavailable', reason: 'higher_condition_unreadable' }
          : { value: Math.max(0, matched - excluded), state: 'available', reason: null },
      },
    });
  } catch (error) {
    console.error('GET /api/rich-menu-groups/:groupId/audience-summary error:', error);
    return c.json({ success: false, error: '対象人数を確認できませんでした' }, 503);
  }
});

// ----- N-152: 本人LINEへのテスト適用 -----

function serializeTestApply(row: {
  id: string; status: string; previous_richmenu_id: string | null;
  applied_richmenu_id: string | null; last_error_code: string | null;
  created_at: string; updated_at: string;
}) {
  return {
    id: row.id,
    status: row.status,
    previousRichMenuId: row.previous_richmenu_id,
    appliedRichMenuId: row.applied_richmenu_id,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** テスト適用の現在状態。本人LINEが連携済みかもここで返す。 */
richMenuGroups.get('/api/rich-menu-groups/:groupId/test-apply', async (c) => {
  const group = await getRichMenuGroupById(c.env.DB, c.req.param('groupId'));
  if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
    return c.json({ success: false, error: 'not found' }, 404);
  }
  const staff = c.get('staff');
  const member = await getStaffById(c.env.DB, staff.id);
  const lineUserId = member?.line_user_id ?? null;
  const active = lineUserId
    ? await getActiveRichMenuTestApply(c.env.DB, group.id, staff.id)
    : null;
  const recent = await listRichMenuTestApplies(c.env.DB, group.id, 10);
  return c.json({
    success: true,
    data: {
      linked: Boolean(lineUserId),
      // 連携方法の案内。未連携のとき画面はこの案内を出して適用ボタンを止める。
      linkGuidance: lineUserId
        ? null
        : 'テスト適用には、あなたのLINEアカウントとの連携が必要です。スタッフ設定からLINE連携を行ってください。',
      active: active ? serializeTestApply(active) : null,
      recent: recent
        .filter((row) => row.staff_id === staff.id)
        .map(serializeTestApply),
    },
  });
});

/**
 * 本人確認済みのLINE（スタッフ連携済みの line_user_id）だけへテスト適用する。
 * 任意の友だちIDや他アカウントのユーザーを指定する口は作らない。
 *
 * - published なら既定ページの公開済みメニューをそのまま本人へリンク
 * - draft なら lht: 名のテスト専用メニューを LINE 上に作り、lhx- alias を
 *   張って切替が動く状態にしてから本人へリンク。戻す時に消す。
 */
richMenuGroups.post(
  '/api/rich-menu-groups/:groupId/test-apply',
  requireRole('owner', 'admin'),
  async (c) => {
    const groupId = c.req.param('groupId');
    const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!idempotencyKey) {
      return c.json({ success: false, error: 'Idempotency-Key header required' }, 400);
    }
    let body: { confirm?: unknown } = {};
    try {
      body = await c.req.json<{ confirm?: unknown }>();
    } catch {
      return c.json({ success: false, error: 'invalid JSON body' }, 400);
    }
    // 自分のLINE表示を変える操作なので、明示の確認を必須にする。
    if (body.confirm !== true) {
      return c.json({ success: false, error: 'テスト適用には確認（confirm: true）が必要です' }, 400);
    }

    const staff = c.get('staff');
    const member = await getStaffById(c.env.DB, staff.id);
    const lineUserId = member?.line_user_id ?? null;
    if (!lineUserId) {
      return c.json(
        {
          success: false,
          code: 'line_not_linked',
          error: 'あなたのLINEアカウントが連携されていません。スタッフ設定からLINE連携を行ってください。',
        },
        400,
      );
    }

    const applyResult = await createRichMenuTestApplyAtomic(c.env.DB, {
      id: crypto.randomUUID(),
      groupId: group.id,
      accountId: group.account_id,
      staffId: staff.id,
      lineUserId,
      idempotencyKey,
    });
    if (applyResult.outcome === 'conflict') {
      return c.json({ success: false, error: 'Idempotency-Key is already used with different content' }, 409);
    }
    let apply = applyResult.apply;
    if (apply.status === 'applied') {
      return c.json(
        { success: true, data: serializeTestApply(apply) },
        200,
        { 'Idempotency-Replayed': 'true' },
      );
    }
    if (apply.status === 'reverted') {
      return c.json({ success: false, error: 'このテスト適用はすでに取り消されました' }, 409);
    }
    if (apply.status === 'reverting') {
      return c.json({ success: false, error: 'このテスト適用は取り消し処理中です' }, 409);
    }
    // 同じ鍵の2本目が走っている途中（running）なら畳む。LINE操作の二重実行を防ぐ。
    if (apply.status === 'running' && applyResult.outcome === 'existing') {
      return c.json({ success: false, error: 'テスト適用を実行中です。少し待ってから確認してください。' }, 409);
    }
    // running でも、同じ担当者の別の進行中テストがあれば止める（二重適用防止）。
    if (applyResult.outcome === 'created') {
      const other = await getActiveRichMenuTestApply(c.env.DB, group.id, staff.id);
      if (other && other.id !== apply.id) {
        // 立てたばかりの行を running のまま残さない。
        await markRichMenuTestApplyFailed(c.env.DB, apply.id, 'superseded by existing active test apply');
        return c.json(
          { success: false, error: 'すでにこのメニューのテスト適用が進行中です。先に取り消してください。', data: serializeTestApply(other) },
          409,
        );
      }
    }

    const account = await getLineAccountById(c.env.DB, group.account_id);
    if (!account) return c.json({ success: false, error: 'line account not found' }, 500);
    const line = createLineClient(account.channel_access_token);
    if (!line.getRichMenuIdOfUser || !line.linkRichMenuToUser) {
      return c.json({ success: false, error: 'LINE client does not support per-user rich menu operations' }, 500);
    }

    try {
      // 1) 適用前の表示を一度だけ記録する。これが無いと戻せない。
      if (apply.previous_captured !== 1) {
        const previous = await line.getRichMenuIdOfUser(lineUserId);
        await captureRichMenuTestApplyPrevious(c.env.DB, apply.id, previous);
        apply = (await getRichMenuTestApplyById(c.env.DB, apply.id))!;
      }

      // 2) 出すメニューを決める。
      let appliedRichMenuId: string;
      if (group.status === 'published') {
        const defaultPage = group.pages.find((p) => p.id === group.default_page_id)
          ?? [...group.pages].sort((a, b) => a.order_index - b.order_index)[0];
        if (!defaultPage?.line_richmenu_id) {
          throw new Error('このメニューのLINE上の実体が見つかりません。公開状態を確認してください。');
        }
        appliedRichMenuId = defaultPage.line_richmenu_id;
      } else {
        // 下書き: テスト専用メニュー（lht:）を作る。画像・切替を含めて実際の見え方を確かめられる。
        let testShellIds: string[] = [];
        try {
          testShellIds = JSON.parse(apply.test_shell_ids ?? '[]') as string[];
        } catch {
          testShellIds = [];
        }
        const r2Adapter: R2Like = {
          async get(key) {
            const obj = await c.env.IMAGES.get(key);
            if (!obj) return null;
            return { body: obj.body as ReadableStream };
          },
        };
        const trackedLinkUrls = await resolveTrackedLinkUrls(
          c.env.DB,
          () => resolveTrackedLinkBaseUrl(c.env.DB, c.env.WORKER_URL || new URL(c.req.url).origin),
          group,
        );
        const formBaseUrl = account.liff_id ? `https://liff.line.me/${account.liff_id}` : (c.env.LIFF_URL ?? null);
        const groupInput: GroupInput = {
          id: group.id,
          size: group.size,
          chatBarText: group.chat_bar_text,
          isDefaultForAll: false,
          formBaseUrl,
          pages: group.pages.map((p) => ({
            id: p.id, orderIndex: p.order_index, name: p.name,
            imageR2Key: p.image_r2_key, imageContentType: p.image_content_type,
            lineRichMenuId: null,
            areas: p.areas.map((a) => ({
              id: a.id,
              bounds: { x: a.bounds_x, y: a.bounds_y, width: a.bounds_width, height: a.bounds_height },
              actionType: a.action_type, actionData: a.actionData, intent: a.intent, label: a.label,
              tagIds: a.tagIds, scoreChange: a.score_change, templateId: a.template_id, formId: a.form_id,
              trackedLinkUrl: a.tracked_link_id ? (trackedLinkUrls.get(a.tracked_link_id) ?? null) : null,
            })),
          })),
        };
        const orderedPages = [...group.pages].sort((a, b) => a.order_index - b.order_index);
        const existingShells = orderedPages.flatMap((page, index) => {
          const shellId = testShellIds[index];
          return shellId ? [{ pageId: page.id, orderIndex: page.order_index, newRichMenuId: shellId }] : [];
        });
        const { shells } = await createRichMenuShells(groupInput, line, r2Adapter, undefined, {
          existingShells,
          shellName: (page) => `lht:${apply.id}:${page.id}`,
          onShellCreated: async (shell) => {
            testShellIds.push(shell.newRichMenuId);
            await recordRichMenuTestApplyShells(c.env.DB, apply.id, testShellIds);
          },
        });
        // 切替ボタンが参照する lhx- alias をテストメニューへ張る。
        for (const shell of shells) {
          await line.upsertRichMenuAlias(buildAliasId(group.id, shell.orderIndex), shell.newRichMenuId);
        }
        const defaultShell = shells.find((shell) => shell.pageId === (group.default_page_id ?? orderedPages[0]?.id))
          ?? shells[0];
        if (!defaultShell) throw new Error('テスト用メニューを作成できませんでした');
        appliedRichMenuId = defaultShell.newRichMenuId;
      }

      // 3) 本人へリンク。ここが最後の外側操作。
      await line.linkRichMenuToUser(lineUserId, appliedRichMenuId);
      await markRichMenuTestApplyApplied(c.env.DB, apply.id, appliedRichMenuId);

      const staffForAudit = c.get('staff');
      c.set('auditRecorded', true);
      try {
        await recordAuditEvent(c.env.DB, {
          tenantId: staffForAudit?.tenantId,
          lineAccountId: group.account_id,
          category: 'business',
          actorPrincipalId: staffForAudit?.id,
          actorRole: staffForAudit?.role,
          action: 'rich_menu.test_apply',
          targetKind: 'rich_menu_group',
          targetId: group.id,
          result: 'success',
          after: { applyId: apply.id, appliedRichMenuId },
          requestTraceId: c.req.header('cf-ray') ?? c.req.header('x-request-id') ?? null,
          ipPrefix: maskAuditIp(c.req.header('cf-connecting-ip')),
          deviceFamily: auditDeviceFamily(c.req.header('user-agent')),
        });
      } catch (auditError) {
        console.error('rich_menu.test_apply audit insert failed:', auditError);
      }

      const updated = await getRichMenuTestApplyById(c.env.DB, apply.id);
      return c.json({ success: true, data: serializeTestApply(updated ?? apply) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await markRichMenuTestApplyFailed(c.env.DB, apply.id, message);
      if (e instanceof RichMenuValidationError) {
        return c.json({ success: false, error: message }, 400);
      }
      return c.json({ success: false, error: message, data: { applyId: apply.id } }, 500);
    }
  },
);

/**
 * テスト適用を取り消し、適用前のメニューへ戻す。
 * 何度呼んでも同じ結果になる。戻す必要が無い（すでに戻した）場合も成功。
 */
richMenuGroups.post(
  '/api/rich-menu-groups/:groupId/test-apply/revert',
  requireRole('owner', 'admin'),
  async (c) => {
    const groupId = c.req.param('groupId');
    const group = await getRichMenuGroupById(c.env.DB, groupId);
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!idempotencyKey) {
      return c.json({ success: false, error: 'Idempotency-Key header required' }, 400);
    }
    let body: { confirm?: unknown; applyId?: unknown } = {};
    try {
      body = await c.req.json<{ confirm?: unknown; applyId?: unknown }>();
    } catch {
      return c.json({ success: false, error: 'invalid JSON body' }, 400);
    }
    if (body.confirm !== true) {
      return c.json({ success: false, error: '取り消しには確認（confirm: true）が必要です' }, 400);
    }

    const staff = c.get('staff');
    const apply = typeof body.applyId === 'string' && body.applyId
      ? await getRichMenuTestApplyById(c.env.DB, body.applyId)
      : await getActiveRichMenuTestApply(c.env.DB, group.id, staff.id);
    if (!apply || apply.group_id !== group.id || apply.staff_id !== staff.id) {
      return c.json({ success: false, error: '取り消せるテスト適用がありません' }, 404);
    }

    const claim = await beginRichMenuTestApplyRevert(c.env.DB, apply.id, idempotencyKey);
    if (claim === 'already') {
      const done = await getRichMenuTestApplyById(c.env.DB, apply.id);
      return c.json(
        { success: true, data: serializeTestApply(done ?? apply) },
        200,
        { 'Idempotency-Replayed': 'true' },
      );
    }
    if (claim === 'conflict' || claim === 'missing') {
      return c.json({ success: false, error: '取り消し処理が別の操作と重なりました。最新の状態を確認してください。' }, 409);
    }

    const account = await getLineAccountById(c.env.DB, group.account_id);
    if (!account) return c.json({ success: false, error: 'line account not found' }, 500);
    const line = createLineClient(account.channel_access_token);
    if (!line.linkRichMenuToUser || !line.unlinkRichMenuFromUser) {
      return c.json({ success: false, error: 'LINE client does not support per-user rich menu operations' }, 500);
    }

    try {
      // 1) 本人の表示を適用前へ戻す。
      if (apply.previous_richmenu_id) {
        await line.linkRichMenuToUser(apply.line_user_id, apply.previous_richmenu_id);
      } else {
        await line.unlinkRichMenuFromUser(apply.line_user_id);
      }

      // 2) 下書きテストで作ったメニューと、それを指している alias を掃除する。
      let testShellIds: string[] = [];
      try {
        testShellIds = JSON.parse(apply.test_shell_ids ?? '[]') as string[];
      } catch {
        testShellIds = [];
      }
      if (testShellIds.length > 0 && line.listRichMenuAliases) {
        const shellSet = new Set(testShellIds);
        try {
          const aliases = await line.listRichMenuAliases();
          for (const alias of aliases) {
            // 公開済みへ張り替わった alias（別のIDを指す）は消さない。
            if (shellSet.has(alias.richMenuId) && alias.richMenuAliasId.startsWith(`lhx-${group.id.slice(0, 8)}-`)) {
              await line.deleteRichMenuAlias(alias.richMenuAliasId);
            }
          }
        } catch (aliasError) {
          console.warn('[test-apply revert] alias cleanup failed (non-fatal):', aliasError);
        }
      }
      await deleteRichMenuShells(line, testShellIds);

      await markRichMenuTestApplyReverted(c.env.DB, apply.id);

      const staffForAudit = c.get('staff');
      c.set('auditRecorded', true);
      try {
        await recordAuditEvent(c.env.DB, {
          tenantId: staffForAudit?.tenantId,
          lineAccountId: group.account_id,
          category: 'business',
          actorPrincipalId: staffForAudit?.id,
          actorRole: staffForAudit?.role,
          action: 'rich_menu.test_apply_revert',
          targetKind: 'rich_menu_group',
          targetId: group.id,
          result: 'success',
          after: { applyId: apply.id, restoredRichMenuId: apply.previous_richmenu_id },
          requestTraceId: c.req.header('cf-ray') ?? c.req.header('x-request-id') ?? null,
          ipPrefix: maskAuditIp(c.req.header('cf-connecting-ip')),
          deviceFamily: auditDeviceFamily(c.req.header('user-agent')),
        });
      } catch (auditError) {
        console.error('rich_menu.test_apply_revert audit insert failed:', auditError);
      }

      const updated = await getRichMenuTestApplyById(c.env.DB, apply.id);
      return c.json({ success: true, data: serializeTestApply(updated ?? apply) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await markRichMenuTestApplyRevertFailed(c.env.DB, apply.id, message);
      return c.json({ success: false, error: message, data: { applyId: apply.id } }, 500);
    }
  },
);
