import {
  getTrackedLinkById,
  type LineAccount,
  type RichMenuGroupWithPages,
} from '@line-crm/db';
import { resolveTrackedLinkBaseUrl } from '../lib/link-base-url.js';
import type { AreaInput, GroupInput } from '../lib/rich-menu-publisher.js';

/** The fixed camelCase content already persisted by schedule/manual snapshots. */
export type RichMenuSnapshotArea = Omit<AreaInput, 'bounds' | 'trackedLinkUrl'> & {
  boundsX: number;
  boundsY: number;
  boundsWidth: number;
  boundsHeight: number;
  trackedLinkId?: string | null;
};

export type RichMenuGroupSnapshot = {
  id?: string;
  size?: GroupInput['size'];
  chatBarText?: string;
  isDefaultForAll?: boolean;
  defaultOpen?: boolean;
  pages?: Array<{
    id: string;
    orderIndex: number;
    name: string;
    imageR2Key: string | null;
    imageContentType: string | null;
    lineRichmenuId: string | null;
    areas: RichMenuSnapshotArea[];
  }>;
};

export type RichMenuGroupInputOptions = {
  fallbackGroupId: string;
  /** Worker URL, or the Worker request origin for a manual publish request. */
  workerBaseUrl?: string | null;
  /** Compatibility fallback when the account has no individual LIFF ID. */
  liffUrl?: string | null;
};

/** Normalize live DB content for the same assembler used by a fixed snapshot. */
export function richMenuLiveToSnapshot(group: RichMenuGroupWithPages): RichMenuGroupSnapshot {
  return {
    id: group.id,
    size: group.size,
    chatBarText: group.chat_bar_text,
    isDefaultForAll: group.is_default_for_all === 1,
    defaultOpen: group.default_open === 1,
    pages: group.pages.map((page) => ({
      id: page.id,
      orderIndex: page.order_index,
      name: page.name,
      imageR2Key: page.image_r2_key,
      imageContentType: page.image_content_type,
      lineRichmenuId: page.line_richmenu_id,
      areas: page.areas.map((area) => ({
        id: area.id,
        boundsX: area.bounds_x,
        boundsY: area.bounds_y,
        boundsWidth: area.bounds_width,
        boundsHeight: area.bounds_height,
        actionType: area.action_type,
        actionData: { ...area.actionData },
        intent: area.intent,
        label: area.label,
        tagIds: [...(area.tagIds ?? [])],
        scoreChange: area.score_change,
        templateId: area.template_id,
        formId: area.form_id,
        trackedLinkId: area.tracked_link_id,
      })),
    })),
  };
}

/**
 * Manual, scheduled and restore publishes share this input boundary. The given
 * snapshot supplies all page/area content; the live draft is never reread here.
 * LIFF is only the form base. Selected tracked links use the Worker/branded base.
 */
export async function assembleRichMenuGroupInput(
  db: D1Database,
  snapshot: RichMenuGroupSnapshot,
  account: Partial<Pick<LineAccount, 'liff_id'>> | null,
  options: RichMenuGroupInputOptions,
): Promise<GroupInput> {
  const ids = new Set<string>();
  for (const page of snapshot.pages ?? []) {
    for (const area of page.areas ?? []) {
      if (area.trackedLinkId) ids.add(area.trackedLinkId);
    }
  }
  const trackedUrls = new Map<string, string>();
  if (ids.size > 0) {
    const base = await resolveTrackedLinkBaseUrl(db, options.workerBaseUrl?.trim() ?? '');
    // Cron has no request origin. Fail before creating LINE menus rather than
    // silently baking a relative /t/code or a LIFF /t/code into their actions.
    let parsed: URL;
    try {
      parsed = new URL(base);
    } catch {
      throw new Error('Tracked link base URL is not configured; set WORKER_URL or tracked_link_base_url');
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('Tracked link base URL must be an absolute HTTP(S) URL');
    }
    const normalizedBase = base.replace(/\/+$/, '');
    for (const id of ids) {
      const link = await getTrackedLinkById(db, id);
      // Preserve existing behavior when a selected link has disappeared: the
      // publisher can use actionData.uri; do not alter snapshot definitions.
      if (link) trackedUrls.set(id, `${normalizedBase}/t/${link.short_code ?? link.id}`);
    }
  }
  const formBaseUrl = account?.liff_id
    ? `https://liff.line.me/${account.liff_id}`
    : (options.liffUrl ?? null);
  return {
    id: typeof snapshot.id === 'string' ? snapshot.id : options.fallbackGroupId,
    size: snapshot.size ?? 'large',
    chatBarText: snapshot.chatBarText ?? '',
    isDefaultForAll: snapshot.isDefaultForAll ?? false,
    defaultOpen: snapshot.defaultOpen === true,
    formBaseUrl,
    pages: (snapshot.pages ?? []).map((page) => ({
      id: page.id,
      orderIndex: page.orderIndex,
      name: page.name,
      imageR2Key: page.imageR2Key,
      imageContentType: page.imageContentType,
      lineRichMenuId: page.lineRichmenuId,
      areas: (page.areas ?? []).map((area): AreaInput => ({
        id: area.id,
        bounds: { x: area.boundsX, y: area.boundsY, width: area.boundsWidth, height: area.boundsHeight },
        actionType: area.actionType,
        actionData: { ...area.actionData },
        intent: area.intent,
        label: area.label,
        tagIds: [...(area.tagIds ?? [])],
        scoreChange: area.scoreChange,
        templateId: area.templateId,
        formId: area.formId,
        trackedLinkUrl: area.trackedLinkId ? (trackedUrls.get(area.trackedLinkId) ?? null) : null,
      })),
    })),
  };
}
