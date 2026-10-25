import {
  getTrackedLinkById,
  type LineAccount,
  type RichMenuGroupWithPages,
} from '@line-crm/db';


import { resolveTrackedLinkBaseUrl } from '../../lib/link-base-url.js';
import type { AreaInput, GroupInput } from '../../lib/rich-menu-publisher.js';

/** 保存済みの予約・手動スナップショットと同じ camelCase の内容を保つ。 */
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
  /** 手動公開では Worker URL がなければ要求元を使う。 */
  workerBaseUrl?: string | null;
  /** アカウント個別の LIFF ID がない場合の互換用代替値。 */
  liffUrl?: string | null;
};

/** 固定スナップショットと同じ組立を使えるよう、DB の現在値を正規化する。 */
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

/** 手動・予約・復元の公開で入力境界を共有し、渡されたスナップショットだけを使って下書きを読み直さない。LIFF はフォームの基底に限定し、選択した計測リンクは Worker または独自ドメインを使う。 */
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
    // cron には要求元がないため、不正な相対 URL を LINE メニューへ埋め込む前に拒む。
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
      // 選択したリンクが消えていてもスナップショットを変更せず、公開処理が actionData.uri を使える形を保つ。
      if (link) trackedUrls.set(id, `${normalizedBase}/t/${link.short_code ?? link.id}`);
    }
  }
  const formBaseUrl = account?.liff_id
    ? `https://liff.line.me/${account.liff_id}`
    : null;
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
