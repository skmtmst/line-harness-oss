import { serializeGroup } from './rich-menu-group-display.js';
import { type ExternalLineArea } from './rich-menu-external-types.js';
import { type RichMenuGroupWithPages, type RichMenuPageInput, type RichMenuAreaInput, type CreateRichMenuGroupInput, type UpdateRichMenuGroupMetaInput } from '@line-crm/db';
import { RICH_MENU_ACTION_TYPE_BY_INTENT, RICH_MENU_DB_ACTION_TYPE_BY_INTENT, RICH_MENU_MAX_PAGES } from '@line-crm/shared';
import { type RichMenuAreaIntent } from '@line-crm/shared';
import { type SegmentCondition } from '@line-crm/shared';
import { type LineRichMenuClient } from '../lib/rich-menu-publisher.js';

export function serializeGroupWithPages(row: RichMenuGroupWithPages) {
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

export /**
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
    defaultOpen: row.default_open === 1,
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

export /**
 * definition_snapshot（serializeGroupWithPages 形）から fingerprint と同じ
 * 項目だけを取り出す。公開結果として変わる status・updatedAt・LINEのIDは
 * 除くので、「いまの下書き」と「最後に公開した版」の差分判定に使える。
 */
function fingerprintFromSnapshot(snapshot: unknown): string | null {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const s = snapshot as Record<string, unknown>;
  const rawPages = Array.isArray(s.pages) ? s.pages : [];
  const pages = rawPages.map((raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const rawAreas = Array.isArray(p.areas) ? p.areas : [];
    return {
      id: p.id,
      orderIndex: p.orderIndex,
      name: p.name,
      aliasId: p.aliasId,
      imageR2Key: p.imageR2Key,
      imageContentType: p.imageContentType,
      areas: rawAreas.map((rawArea) => {
        const a = (rawArea ?? {}) as Record<string, unknown>;
        return {
          id: a.id,
          boundsX: a.boundsX,
          boundsY: a.boundsY,
          boundsWidth: a.boundsWidth,
          boundsHeight: a.boundsHeight,
          actionType: a.actionType,
          actionData: a.actionData,
          intent: a.intent,
          label: a.label,
          tagIds: a.tagIds,
          scoreChange: a.scoreChange,
          templateId: a.templateId,
          formId: a.formId,
          trackedLinkId: a.trackedLinkId,
        };
      }),
    };
  });
  return JSON.stringify({
    id: s.id,
    accountId: s.accountId,
    name: s.name,
    chatBarText: s.chatBarText,
    size: s.size,
    defaultPageId: s.defaultPageId,
    isDefaultForAll: s.isDefaultForAll === true,
    targetingCondition: s.targetingCondition,
    targetingPriority: s.targetingPriority,
    targetingEnabled: s.targetingEnabled === true,
    folderId: s.folderId,
    displayOrder: s.displayOrder,
    defaultOpen: s.defaultOpen === true,
    pages,
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

export async function recoverManualPublishShellsFromLine(
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

export /** LINE 未管理メニューの動きを、画面が安全に説明できる最小形へ絞る。 */
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

export // ----- Input parsing / validation -----

const VALID_SIZES = new Set(['large', 'compact']);

export // DB の action_type は CHECK で4つのまま。datetimepicker・clipboard は
// 画面が送ってきても受け、DB へは postback に載せて保存する
//（RICH_MENU_DB_ACTION_TYPE_BY_INTENT）。intent が真実で action_type は容れ物。
const VALID_ACTION_TYPES = new Set([
  'uri',
  'message',
  'postback',
  'richmenuswitch',
  'datetimepicker',
  'clipboard',
]);

export const DB_ACTION_TYPES = new Set(['uri', 'message', 'postback', 'richmenuswitch']);

export // intent が決まれば、LINE に登録するときの種類も決まる。
// 取りこぼしがあればここでコンパイルが落ちる。
// （db 側の定数をそのまま使わないのは、この経路を試験するとき db 全体を
//   差し替えることがあり、実行時の値が消えるため）
const VALID_INTENTS = new Set<string>(Object.keys(RICH_MENU_ACTION_TYPE_BY_INTENT));

export /** 受けたJSONが `{...}` の形かを確かめる（`as` 断定の代わり）。 */
function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

export function parseAreaInput(raw: unknown): Parsed<RichMenuAreaInput> {
  if (!raw || typeof raw !== 'object') return { field: 'pages', ok: false, error: 'area must be object' };
  const r = raw as Record<string, unknown>;
  const fields: (keyof RichMenuAreaInput)[] = ['boundsX', 'boundsY', 'boundsWidth', 'boundsHeight'];
  for (const f of fields) {
    if (typeof r[f] !== 'number' || !Number.isFinite(r[f]) || (r[f] as number) < 0) {
      return { field: 'pages', ok: false, error: `area.${f} must be a non-negative number` };
    }
  }
  if ((r.boundsWidth as number) <= 0 || (r.boundsHeight as number) <= 0) {
    return { field: 'pages', ok: false, error: 'area width/height must be positive' };
  }
  if (typeof r.actionType !== 'string' || !VALID_ACTION_TYPES.has(r.actionType)) {
    return { field: 'pages', ok: false, error: `area.actionType must be one of ${[...VALID_ACTION_TYPES].join('/')}` };
  }
  if (!r.actionData || typeof r.actionData !== 'object') {
    return { field: 'pages', ok: false, error: 'area.actionData must be object' };
  }
  if (r.id !== undefined && r.id !== null && (typeof r.id !== 'string' || r.id.length === 0)) {
    return { field: 'pages', ok: false, error: 'area.id must be non-empty string when present' };
  }
  if (
    r.intent !== undefined &&
    r.intent !== null &&
    (typeof r.intent !== 'string' || !VALID_INTENTS.has(r.intent))
  ) {
    return { field: 'pages', ok: false, error: `area.intent must be one of ${[...VALID_INTENTS].join('/')}` };
  }
  if (r.label !== undefined && r.label !== null && typeof r.label !== 'string') {
    return { field: 'pages', ok: false, error: 'area.label must be string' };
  }
  // #827 (N-155): ボタン名は端末の読み上げ(アクセシビリティ)にも使うため
  // 20 字まで。公開時の必須・上限検査と同じ上限を保存口でも掛けて、
  // 21 字以上の値を DB へ残さない。
  if (typeof r.label === 'string' && [...r.label].length > 20) {
    return { field: 'pages', ok: false, error: 'area.label must be 20 characters or fewer' };
  }
  if (r.tagIds !== undefined && r.tagIds !== null) {
    if (!Array.isArray(r.tagIds) || r.tagIds.some((t) => typeof t !== 'string' || t.length === 0)) {
      return { field: 'pages', ok: false, error: 'area.tagIds must be an array of non-empty strings' };
    }
    if (r.tagIds.length > 20) {
      return { field: 'pages', ok: false, error: 'area.tagIds must be 20 items or fewer' };
    }
  }
  if (
    r.scoreChange !== undefined &&
    r.scoreChange !== null &&
    (typeof r.scoreChange !== 'number' || !Number.isInteger(r.scoreChange))
  ) {
    return { field: 'pages', ok: false, error: 'area.scoreChange must be an integer' };
  }
  for (const key of ['templateId', 'formId', 'trackedLinkId'] as const) {
    const v = r[key];
    if (v !== undefined && v !== null && (typeof v !== 'string' || v.length === 0)) {
      return { field: 'pages', ok: false, error: `area.${key} must be non-empty string when present` };
    }
  }
  for (const key of ['menuId', 'cardId']) {
    const selected = (r.actionData as Record<string, unknown>)[key];
    if (selected !== undefined && (typeof selected !== 'string' || (selected !== '' && !/^[A-Za-z0-9_-]{1,128}$/.test(selected)))) {
      return { field: 'pages', ok: false, error: `area.actionData.${key} must be a valid identifier` };
    }
  }
  // intent が来ているなら、DB へ載せる種類は intent から決め直す。
  // 画面が送ってくる actionType とずれていると、publish の途中で
  // 「切り替え先の解決」などが素通りして LINE 側が 400 を返す。
  // intent が無い古い行は actionType をそのまま使い、新しい2種
  // （datetimepicker・clipboard）は intent へ読み替える。
  let intent = (typeof r.intent === 'string' ? r.intent : null) as RichMenuAreaIntent | null;
  if (!intent && (r.actionType === 'datetimepicker' || r.actionType === 'clipboard')) {
    intent = r.actionType === 'datetimepicker' ? 'datetime' : 'clipboard';
  }
  const actionType = intent
    ? RICH_MENU_DB_ACTION_TYPE_BY_INTENT[intent]
    : (r.actionType as RichMenuAreaInput['actionType']);
  if (!DB_ACTION_TYPES.has(actionType)) {
    return { field: 'pages', ok: false, error: `area.actionType must be one of ${[...DB_ACTION_TYPES].join('/')}` };
  }

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

export function parsePageInput(raw: unknown): Parsed<RichMenuPageInput> {
  if (!raw || typeof raw !== 'object') return { field: 'pages', ok: false, error: 'page must be object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.length === 0) return { field: 'pages', ok: false, error: 'page.name required' };
  if (typeof r.orderIndex !== 'number' || !Number.isInteger(r.orderIndex) || r.orderIndex < 0) {
    return { field: 'pages', ok: false, error: 'page.orderIndex must be non-negative integer' };
  }
  if (r.id !== undefined && (typeof r.id !== 'string' || r.id.length === 0)) {
    return { field: 'pages', ok: false, error: 'page.id must be non-empty string when present' };
  }
  if (!Array.isArray(r.areas)) return { field: 'pages', ok: false, error: 'page.areas must be array' };
  if (r.areas.length > 20) return { field: 'pages', ok: false, error: 'page.areas exceeds LINE limit of 20' };
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

export function parsePages(raw: unknown): Parsed<RichMenuPageInput[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { field: 'pages', ok: false, error: 'pages must be a non-empty array' };
  // O(公開前の確認): ページは10まで。保存口で止め、公開前の検査でも見る。
  if (raw.length > RICH_MENU_MAX_PAGES) {
    return { field: 'pages', ok: false, error: `pages exceeds limit of ${RICH_MENU_MAX_PAGES}` };
  }
  const pages: RichMenuPageInput[] = [];
  for (const p of raw) {
    const parsed = parsePageInput(p);
    if (!parsed.ok) return parsed;
    pages.push(parsed.value);
  }
  // order_index は 0..N-1 で重複なしを必須化。
  const orders = pages.map((p) => p.orderIndex).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i) return { field: 'pages', ok: false, error: 'page.orderIndex must be 0..N-1 with no duplicates' };
  }
  // page.id (任意) が指定されている場合、payload 内で重複していないことを保証。
  // 重複していると PATCH の id 維持で existingMap が同じ row を 2 回返し PK 衝突する。
  const seen = new Set<string>();
  for (const p of pages) {
    if (p.id !== undefined) {
      if (seen.has(p.id)) {
        return { field: 'pages', ok: false, error: `page.id "${p.id}" is duplicated in pages array` };
      }
      seen.add(p.id);
    }
  }
  return { ok: true, value: pages };
}

export // N-161: 新規作成でもページ切替を決められるようにする。
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

export function parseCreateBody(raw: unknown): Parsed<CreateRichMenuGroupInput> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.accountId !== 'string' || r.accountId.length === 0) return { field: 'accountId', ok: false, error: 'accountId required' };
  if (typeof r.name !== 'string' || r.name.length === 0) return { field: 'name', ok: false, error: 'name required' };
  if (typeof r.chatBarText !== 'string' || r.chatBarText.length === 0 || r.chatBarText.length > 14) {
    return { field: 'chatBarText', ok: false, error: 'chatBarText required (1..14 chars)' };
  }
  if (typeof r.size !== 'string' || !VALID_SIZES.has(r.size)) return { field: 'size', ok: false, error: 'size must be large or compact' };
  const pages = parsePages(r.pages);
  if (!pages.ok) return pages;
  // #502中: 作成直後のフォルダ付けupdate握りつぶしをなくすため、作成口で直接受け付ける。
  if (r.folderId !== undefined && r.folderId !== null && typeof r.folderId !== 'string') {
    return { field: 'folderId', ok: false, error: 'folderId must be a string or null' };
  }
  // N-161: 既定ページ・配信対象・全員既定を作成時に決められるようにする。
  let defaultPageIndex: number | null = null;
  if (r.defaultPageIndex !== undefined && r.defaultPageIndex !== null) {
    if (
      typeof r.defaultPageIndex !== 'number'
      || !Number.isInteger(r.defaultPageIndex)
      || !pages.value.some((p) => p.orderIndex === r.defaultPageIndex)
    ) {
      return { field: 'defaultPageIndex', ok: false, error: 'defaultPageIndex must be an orderIndex of one of the pages' };
    }
    defaultPageIndex = r.defaultPageIndex;
  }
  if (r.isDefaultForAll !== undefined && typeof r.isDefaultForAll !== 'boolean') {
    return { field: 'isDefaultForAll', ok: false, error: 'isDefaultForAll must be boolean' };
  }
  if (r.targetingEnabled !== undefined && typeof r.targetingEnabled !== 'boolean') {
    return { field: 'targetingEnabled', ok: false, error: 'targetingEnabled must be boolean' };
  }
  if (r.defaultOpen !== undefined && typeof r.defaultOpen !== 'boolean') {
    return { field: 'defaultOpen', ok: false, error: 'defaultOpen must be boolean' };
  }
  if (r.targetingPriority !== undefined) {
    if (typeof r.targetingPriority !== 'number' || !Number.isInteger(r.targetingPriority)) {
      return { field: 'targetingPriority', ok: false, error: 'targetingPriority must be an integer' };
    }
  }
  let targetingCondition: string | null = null;
  if (r.targetingCondition !== undefined && r.targetingCondition !== null) {
    if (typeof r.targetingCondition !== 'string') {
      return { field: 'targetingCondition', ok: false, error: 'targetingCondition must be a JSON string or null' };
    }
    try {
      JSON.parse(r.targetingCondition);
    } catch {
      return { field: 'targetingCondition', ok: false, error: 'targetingCondition must be valid JSON' };
    }
    targetingCondition = r.targetingCondition;
  }
  // 「条件で出し分ける」を選んだのに条件が空だと、公開しても誰にも出ない
  // 設定が作れる。入口で断る。
  if (r.targetingEnabled === true && !targetingCondition) {
    return { field: 'targetingCondition', ok: false, error: 'targetingEnabled requires targetingCondition' };
  }
  const switcherRejection = validateRichmenuswitchInCreate(pages.value);
  if (switcherRejection) return { field: 'pages', ok: false, error: switcherRejection };
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
      defaultOpen: r.defaultOpen === true,
    },
  };
}

export function parsePatchBody(raw: unknown): Parsed<{ meta: UpdateRichMenuGroupMetaInput; pages?: RichMenuPageInput[] }> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be object' };
  const r = raw as Record<string, unknown>;
  const meta: UpdateRichMenuGroupMetaInput = {};
  if (r.name !== undefined) {
    if (typeof r.name !== 'string' || r.name.length === 0) return { field: 'name', ok: false, error: 'name must be non-empty string' };
    meta.name = r.name;
  }
  if (r.chatBarText !== undefined) {
    if (typeof r.chatBarText !== 'string' || r.chatBarText.length === 0 || r.chatBarText.length > 14) {
      return { field: 'chatBarText', ok: false, error: 'chatBarText must be 1..14 chars' };
    }
    meta.chatBarText = r.chatBarText;
  }
  if (r.isDefaultForAll !== undefined) {
    if (typeof r.isDefaultForAll !== 'boolean') return { field: 'isDefaultForAll', ok: false, error: 'isDefaultForAll must be boolean' };
    meta.isDefaultForAll = r.isDefaultForAll;
  }
  if (r.targetingCondition !== undefined) {
    if (r.targetingCondition === null) {
      meta.targetingCondition = null;
    } else if (typeof r.targetingCondition !== 'string') {
      return { field: 'targetingCondition', ok: false, error: 'targetingCondition must be a JSON string or null' };
    } else {
      // 読めない JSON をそのまま保存すると、出し分けのたびに黙って飛ばされる。
      // 入り口で断る。
      try {
        JSON.parse(r.targetingCondition);
      } catch {
        return { field: 'targetingCondition', ok: false, error: 'targetingCondition must be valid JSON' };
      }
      meta.targetingCondition = r.targetingCondition;
    }
  }
  if (r.targetingPriority !== undefined) {
    if (typeof r.targetingPriority !== 'number' || !Number.isInteger(r.targetingPriority)) {
      return { field: 'targetingPriority', ok: false, error: 'targetingPriority must be an integer' };
    }
    meta.targetingPriority = r.targetingPriority;
  }
  if (r.targetingEnabled !== undefined) {
    if (typeof r.targetingEnabled !== 'boolean') {
      return { field: 'targetingEnabled', ok: false, error: 'targetingEnabled must be boolean' };
    }
    meta.targetingEnabled = r.targetingEnabled;
  }
  if (r.folderId !== undefined) {
    if (r.folderId === null || r.folderId === '') {
      meta.folderId = null;
    } else if (typeof r.folderId !== 'string') {
      return { field: 'folderId', ok: false, error: 'folderId must be a string' };
    } else {
      meta.folderId = r.folderId;
    }
  }
  if (r.displayOrder !== undefined) {
    if (typeof r.displayOrder !== 'number' || !Number.isInteger(r.displayOrder)) {
      return { field: 'displayOrder', ok: false, error: 'displayOrder must be an integer' };
    }
    meta.displayOrder = r.displayOrder;
  }
  if (r.defaultOpen !== undefined) {
    if (typeof r.defaultOpen !== 'boolean') return { field: 'defaultOpen', ok: false, error: 'defaultOpen must be boolean' };
    meta.defaultOpen = r.defaultOpen;
  }
  let pages: RichMenuPageInput[] | undefined;
  if (r.pages !== undefined) {
    const p = parsePages(r.pages);
    if (!p.ok) return p;
    pages = p.value;
  }
  return { ok: true, value: { meta, pages } };
}

export /** 条件の複雑さの上限 (#502中)。重い条件の連打でDB負荷になるため入り口で断る。 */
const PREVIEW_MAX_RULES = 50;

export const PREVIEW_MAX_DEPTH = 5;

export function countPreviewRules(condition: SegmentCondition, depth: number): number {
  if (depth > PREVIEW_MAX_DEPTH) return Number.POSITIVE_INFINITY;
  let count = Array.isArray(condition.rules) ? condition.rules.length : 0;
  for (const nested of condition.groups ?? []) {
    count += countPreviewRules(nested, depth + 1);
  }
  return count;
}
