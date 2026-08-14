// Rich menu publish flow — D1 ドラフトを LINE Messaging API に冪等に反映する。
//
// LINE API は richmenu の更新ができず、作成のみ。なので alias を経由して
// 「同一 alias を別 richmenu に張替」という間接参照で更新を実現する。
//
// 流れ (各 page につき):
//   1. POST /v2/bot/richmenu                  → 新 richmenuId 取得
//   2. POST /v2/bot/richmenu/{id}/content     ← R2 から画像 stream
//   3. alias upsert (DELETE → POST)
//   4. 旧 richmenu があれば DELETE
// 最後に isDefaultForAll なら 1 ページ目を全友だち default に。

export type Bounds = { x: number; y: number; width: number; height: number };

export type ActionType = 'uri' | 'message' | 'postback' | 'richmenuswitch';

export type AreaInput = {
  bounds: Bounds;
  actionType: ActionType;
  actionData: Record<string, unknown>;
};

export type PageInput = {
  id: string;
  orderIndex: number;
  name: string;
  imageR2Key: string | null;
  imageContentType: string | null;
  lineRichMenuId: string | null;
  areas: AreaInput[];
};

export type GroupInput = {
  id: string;
  size: 'large' | 'compact';
  chatBarText: string;
  isDefaultForAll: boolean;
  pages: PageInput[];
};

export class RichMenuValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RichMenuValidationError';
  }
}

export interface LineRichMenuClient {
  createRichMenu(payload: unknown): Promise<{ richMenuId: string }>;
  uploadRichMenuImage(richMenuId: string, image: Uint8Array, contentType: string): Promise<void>;
  deleteRichMenuAlias(aliasId: string): Promise<void>;
  createRichMenuAlias(aliasId: string, richMenuId: string): Promise<void>;
  deleteRichMenu(richMenuId: string): Promise<void>;
  setDefaultRichMenu(richMenuId: string): Promise<void>;
  // LINE 側のアカウント全体デフォルトを解除する。冪等 — 設定がなくてもエラーにしない実装にする。
  clearDefaultRichMenu(): Promise<void>;
  // LINE 側の現在のアカウント全体デフォルト richMenuId を返す。設定なしなら null。
  getCurrentDefaultRichMenuId(): Promise<string | null>;
  // bulk link: 指定 richMenuId を userIds (最大 500 件 / リクエスト) に link。
  // 500 超は呼出側で chunk して順次呼ぶ。
  linkRichMenuBulk(richMenuId: string, userIds: string[]): Promise<void>;
}

export interface R2Like {
  get(key: string): Promise<{ body: Uint8Array | ReadableStream } | null>;
}

const SIZE_DIMENSIONS = {
  large: { width: 2500, height: 1686 },
  compact: { width: 2500, height: 843 },
};

export function buildAliasId(groupId: string, orderIndex: number): string {
  return `lhx-${groupId.slice(0, 8)}-${orderIndex}`;
}

export function resolveSwitcherActions(pages: PageInput[], groupId: string): PageInput[] {
  const aliasByPageId = new Map(pages.map((p) => [p.id, buildAliasId(groupId, p.orderIndex)]));
  return pages.map((page) => ({
    ...page,
    areas: page.areas.map((area) => {
      if (area.actionType !== 'richmenuswitch') return area;
      const targetPageId = area.actionData.targetPageId as string | undefined;
      if (!targetPageId) {
        throw new Error(`richmenuswitch action missing targetPageId on page ${page.id}`);
      }
      const alias = aliasByPageId.get(targetPageId);
      if (!alias) {
        throw new Error(`richmenuswitch target page ${targetPageId} not found in group ${groupId}`);
      }
      return {
        ...area,
        actionData: {
          richMenuAliasId: alias,
          data: `switch-to-${targetPageId}`,
        },
      };
    }),
  }));
}

function requiredString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * LINE API を呼ぶ前に、アクションの必須値を検証する。
 *
 * エディタのテンプレート領域は空の message action で作られるため、未設定のまま
 * publish すると LINE API が 400 を返す。外部 API を呼ぶ前に、管理画面で修正可能な
 * 日本語メッセージとして返す。
 */
export function validateRichMenuGroupForPublish(group: GroupInput): void {
  for (const page of group.pages) {
    for (let i = 0; i < page.areas.length; i++) {
      const area = page.areas[i];
      const prefix = `ページ「${page.name}」のタップ領域${i + 1}`;

      if (area.actionType === 'message') {
        const text = area.actionData.text;
        if (!requiredString(text)) {
          throw new RichMenuValidationError(`${prefix}: 送信テキストを入力してください`);
        }
        if ([...text].length > 300) {
          throw new RichMenuValidationError(`${prefix}: 送信テキストは300文字以内にしてください`);
        }
      } else if (area.actionType === 'uri') {
        const uri = area.actionData.uri;
        if (!requiredString(uri)) {
          throw new RichMenuValidationError(`${prefix}: URLを入力してください`);
        }
        if ([...uri].length > 1000) {
          throw new RichMenuValidationError(`${prefix}: URLは1000文字以内にしてください`);
        }
      } else if (area.actionType === 'postback') {
        const data = area.actionData.data;
        if (!requiredString(data)) {
          throw new RichMenuValidationError(`${prefix}: postback dataを入力してください`);
        }
        if ([...data].length > 300) {
          throw new RichMenuValidationError(`${prefix}: postback dataは300文字以内にしてください`);
        }
        const displayText = area.actionData.displayText;
        if (typeof displayText === 'string' && [...displayText].length > 300) {
          throw new RichMenuValidationError(`${prefix}: displayTextは300文字以内にしてください`);
        }
      } else if (area.actionType === 'richmenuswitch') {
        if (!requiredString(area.actionData.richMenuAliasId) || !requiredString(area.actionData.data)) {
          throw new RichMenuValidationError(`${prefix}: 遷移先ページを選択してください`);
        }
      }
    }
  }
}

function toLineAction(area: AreaInput): Record<string, unknown> {
  const action: Record<string, unknown> = { type: area.actionType, ...area.actionData };
  // displayText は任意項目。エディタの初期値 "" を LINE に送らない。
  if (action.displayText === '') delete action.displayText;
  return action;
}

export type PublishResult = {
  pages: { pageId: string; newRichMenuId: string }[];
};

async function readR2Object(r2: R2Like, key: string): Promise<Uint8Array> {
  const obj = await r2.get(key);
  if (!obj) throw new Error(`R2 image missing: ${key}`);
  if (obj.body instanceof Uint8Array) return obj.body;
  return new Uint8Array(await new Response(obj.body).arrayBuffer());
}

export async function publishRichMenuGroup(
  group: GroupInput,
  line: LineRichMenuClient,
  r2: R2Like,
): Promise<PublishResult> {
  const resolvedPages = resolveSwitcherActions(group.pages, group.id);
  resolvedPages.sort((a, b) => a.orderIndex - b.orderIndex);
  validateRichMenuGroupForPublish({ ...group, pages: resolvedPages });

  const dimensions = SIZE_DIMENSIONS[group.size];
  const results: { pageId: string; newRichMenuId: string }[] = [];

  for (const page of resolvedPages) {
    if (!page.imageR2Key || !page.imageContentType) {
      throw new Error(`page ${page.id} (${page.name}) has no image`);
    }

    // 1. richmenu 作成
    const created = await line.createRichMenu({
      size: dimensions,
      selected: false,
      name: `${group.id.slice(0, 8)} - ${page.name}`,
      chatBarText: group.chatBarText,
      areas: page.areas.map((a) => ({
        bounds: a.bounds,
        action: toLineAction(a),
      })),
    });
    const newRichMenuId = created.richMenuId;

    // 2. 画像 upload
    const bytes = await readR2Object(r2, page.imageR2Key);
    await line.uploadRichMenuImage(newRichMenuId, bytes, page.imageContentType);

    // 3. alias upsert (DELETE は 404 なら無視、CREATE は失敗時 throw)
    const aliasId = buildAliasId(group.id, page.orderIndex);
    try {
      await line.deleteRichMenuAlias(aliasId);
    } catch {
      // 404 等は無視
    }
    await line.createRichMenuAlias(aliasId, newRichMenuId);

    // 4. 旧 richmenu 削除 (alias 切替後にだけ。失敗しても致命的ではない)
    if (page.lineRichMenuId) {
      try {
        await line.deleteRichMenu(page.lineRichMenuId);
      } catch {
        // 旧削除失敗は無視
      }
    }

    results.push({ pageId: page.id, newRichMenuId });
  }

  // 5. default 設定
  // 有効化時は order_index=0 ページの richMenuId を default に設定。
  // 無効化 (false) 時は **この group の richMenu が現在 LINE の default に設定されている
  // 場合のみ** 解除する。同一 account に別の isDefaultForAll=true group がある状態で
  // 無条件に DELETE すると、その別 group の default まで壊してしまうため。
  if (group.isDefaultForAll && results.length > 0) {
    await line.setDefaultRichMenu(results[0].newRichMenuId);
  } else {
    // ベストエフォート: ここまで来た時点で新 richmenu はすでに live。LINE 側 default
    // 判定や解除に失敗しても publish 全体を失敗させない (D1 の status 更新が呼出側で
    // 走らず状態不整合になるため)。default 解除がスキップされた場合は次回 publish で
    // 再試行されるか、運用側で明示的に解除されることを期待する。
    try {
      const currentDefault = await line.getCurrentDefaultRichMenuId();
      if (currentDefault) {
        const ownIds = new Set<string>();
        for (const p of group.pages) {
          if (p.lineRichMenuId) ownIds.add(p.lineRichMenuId);
        }
        for (const r of results) ownIds.add(r.newRichMenuId);
        if (ownIds.has(currentDefault)) {
          await line.clearDefaultRichMenu();
        }
      }
    } catch (e) {
      console.warn(`[publishRichMenuGroup] default lookup/clear failed (non-fatal):`, e);
    }
  }

  return { pages: results };
}

/**
 * LINE bulk link API は 1 リクエスト最大 500 ユーザー。500 超は分割。
 * 全 chunk 完走で resolve。途中失敗時は throw (呼出側で部分成功は扱わない)。
 * 多重リクエスト時の rate limit 配慮として chunk 間で意図的なスリープは入れない —
 * LINE 側は基本 200 RPS まで許容する想定 (Worker の単発処理なので重複もない)。
 */
export async function linkRichMenuBulkChunked(
  line: LineRichMenuClient,
  richMenuId: string,
  userIds: string[],
): Promise<{ chunks: number; total: number }> {
  const CHUNK = 500;
  const total = userIds.length;
  if (total === 0) return { chunks: 0, total: 0 };
  let chunks = 0;
  for (let i = 0; i < total; i += CHUNK) {
    const slice = userIds.slice(i, i + CHUNK);
    await line.linkRichMenuBulk(richMenuId, slice);
    chunks++;
  }
  return { chunks, total };
}

export type UnpublishResult = {
  pages: { pageId: string; clearedRichMenuId: string | null }[];
  warnings: string[];
};

/**
 * Group を LINE 上から完全に解除する (DB は markRichMenuGroupUnpublished で別途更新)。
 *   1. 各 page の alias を delete (404 無視 — 既に消えてる場合)
 *   2. 各 page の richmenu を delete (404 無視)
 *   3. 現 default が own group の richmenu なら default unlink
 *
 * 削除は 404 を許容することで複数回呼ばれても安全 (idempotent)。alias / richmenu の
 * 削除そのものが失敗 (5xx 等) した場合は warnings に記録するが処理を続行する。
 * 完全失敗時は最後に throw。
 */
export async function unpublishRichMenuGroup(
  group: GroupInput,
  line: LineRichMenuClient,
): Promise<UnpublishResult> {
  const warnings: string[] = [];
  const pages: UnpublishResult['pages'] = [];

  for (const page of group.pages) {
    // alias 削除
    const aliasId = buildAliasId(group.id, page.orderIndex);
    try {
      await line.deleteRichMenuAlias(aliasId);
    } catch (e) {
      warnings.push(`delete alias ${aliasId} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    // richmenu 削除
    if (page.lineRichMenuId) {
      try {
        await line.deleteRichMenu(page.lineRichMenuId);
      } catch (e) {
        warnings.push(
          `delete richmenu ${page.lineRichMenuId} failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    pages.push({ pageId: page.id, clearedRichMenuId: page.lineRichMenuId });
  }

  // default が own group のものなら unlink。ベストエフォート (失敗しても unpublish 全体は成功扱い)。
  try {
    const currentDefault = await line.getCurrentDefaultRichMenuId();
    if (currentDefault) {
      const ownIds = new Set<string>();
      for (const p of group.pages) {
        if (p.lineRichMenuId) ownIds.add(p.lineRichMenuId);
      }
      if (ownIds.has(currentDefault)) {
        await line.clearDefaultRichMenu();
      }
    }
  } catch (e) {
    warnings.push(
      `default lookup/clear failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return { pages, warnings };
}
