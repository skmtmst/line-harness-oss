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

import { buildTapPostbackData } from './rich-menu-tap.js';

export type Bounds = { x: number; y: number; width: number; height: number };

export type ActionType = 'uri' | 'message' | 'postback' | 'richmenuswitch';

/**
 * 運用者から見た「何をするボタンか」。
 *
 * LINE が持てる action は上の4つだけなので、「電話をかける」「テンプレートを送る」
 * 「回答フォームを開く」はここで受けて、publish のときに4つのどれかへ変換する。
 * 未設定 (null) の area は、この仕組みが入る前に作られたもの。今までどおり
 * actionType と actionData をそのまま LINE に渡す。
 */
export type AreaIntent = 'url' | 'tel' | 'text' | 'template' | 'form' | 'switch' | 'postback';

export type AreaInput = {
  id?: string;
  bounds: Bounds;
  actionType: ActionType;
  actionData: Record<string, unknown>;
  intent?: AreaIntent | null;
  /** 管理用のボタン名。エラー文で「どのボタンか」を示すのに使う。 */
  label?: string | null;
  /** 押されたときに付けるタグ。あると postback 経由になる。 */
  tagIds?: string[];
  /** 押されたときに足すスコア。あると postback 経由になる。 */
  scoreChange?: number | null;
  templateId?: string | null;
  formId?: string | null;
  /** intent='url' で計測リンクを選んだ場合の、解決済み URL。 */
  trackedLinkUrl?: string | null;
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
  /**
   * 「回答フォームを開く」ボタンの飛び先。アカウントの LIFF URL を渡す。
   * これが無いと intent='form' のボタンは publish できない (どこへ飛ばせばいいか
   * 決められないため)。
   */
  formBaseUrl?: string | null;
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
  /** 既存 alias は切れ目なく更新し、存在しない場合だけ新規作成する。 */
  upsertRichMenuAlias(aliasId: string, richMenuId: string): Promise<void>;
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
      const inner = `switch-to-${targetPageId}`;
      return {
        ...area,
        actionData: {
          richMenuAliasId: alias,
          // intent が付いている area は、押されたことをこちらで受け取れるように
          // 目印を足す。旧データ (intent なし) は今までどおりの data のまま。
          data: area.intent && area.id ? buildTapPostbackData(area.id, inner) : inner,
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
function limited(value: string, max: number): boolean {
  return [...value].length <= max;
}

/**
 * intent が設定された area の検証。運用者が画面で直せる言葉で返す。
 */
function validateAreaByIntent(area: AreaInput, prefix: string, group: GroupInput): void {
  const data = area.actionData ?? {};
  switch (area.intent) {
    case 'tel': {
      const raw = String(data.tel ?? data.uri ?? '');
      if (!requiredString(raw)) {
        throw new RichMenuValidationError(`${prefix}: 電話番号を入力してください`);
      }
      if (!/[0-9]/.test(raw)) {
        throw new RichMenuValidationError(`${prefix}: 電話番号に数字が入っていません`);
      }
      return;
    }
    case 'form': {
      const formId = area.formId ?? String(data.formId ?? '');
      if (!requiredString(formId)) {
        throw new RichMenuValidationError(`${prefix}: 開く回答フォームを選んでください`);
      }
      if (!requiredString(group.formBaseUrl ?? '')) {
        throw new RichMenuValidationError(
          `${prefix}: このLINEアカウントにLIFFが設定されていないため、回答フォームを開くボタンは使えません`,
        );
      }
      return;
    }
    case 'template': {
      if (!requiredString(area.templateId ?? '')) {
        throw new RichMenuValidationError(`${prefix}: 送るテンプレートを選んでください`);
      }
      return;
    }
    case 'url': {
      const uri = area.trackedLinkUrl ?? String(data.uri ?? '');
      if (!requiredString(uri)) {
        throw new RichMenuValidationError(`${prefix}: URLを入力してください`);
      }
      if (!limited(uri, 1000)) {
        throw new RichMenuValidationError(`${prefix}: URLは1000文字以内にしてください`);
      }
      return;
    }
    case 'text': {
      const text = String(data.text ?? '');
      if (!requiredString(text)) {
        throw new RichMenuValidationError(`${prefix}: 送信テキストを入力してください`);
      }
      if (!limited(text, 300)) {
        throw new RichMenuValidationError(`${prefix}: 送信テキストは300文字以内にしてください`);
      }
      return;
    }
    case 'switch': {
      if (!requiredString(data.richMenuAliasId) || !requiredString(data.data)) {
        throw new RichMenuValidationError(`${prefix}: 遷移先ページを選択してください`);
      }
      return;
    }
    case 'postback': {
      const inner = String(data.data ?? '');
      if (!requiredString(inner)) {
        throw new RichMenuValidationError(`${prefix}: postback dataを入力してください`);
      }
      if (!limited(inner, 200)) {
        // 目印 (rma=<id>) を足した後に LINE の 300 文字上限へ収める必要がある。
        throw new RichMenuValidationError(`${prefix}: postback dataは200文字以内にしてください`);
      }
      const displayText = data.displayText;
      if (typeof displayText === 'string' && !limited(displayText, 300)) {
        throw new RichMenuValidationError(`${prefix}: displayTextは300文字以内にしてください`);
      }
      return;
    }
  }
}

export function validateRichMenuGroupForPublish(group: GroupInput): void {
  for (const page of group.pages) {
    for (let i = 0; i < page.areas.length; i++) {
      const area = page.areas[i];
      const label = area.label?.trim();
      const prefix = label
        ? `ページ「${page.name}」の「${label}」`
        : `ページ「${page.name}」のタップ領域${i + 1}`;

      // intent がある area は intent で見る。無いものは今までどおり actionType で見る。
      if (area.intent) {
        validateAreaByIntent(area, prefix, group);
        continue;
      }

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

/** 押されたときに、こちら側で何かする設定が入っているか。 */
export function hasTapSideEffects(area: AreaInput): boolean {
  if ((area.tagIds?.length ?? 0) > 0) return true;
  return typeof area.scoreChange === 'number' && area.scoreChange !== 0;
}

/** 「電話をかける」の入力を tel: の形に整える。 */
export function normalizeTelUri(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith('tel:')) return trimmed;
  // ハイフンや括弧は落とす。先頭の + は国番号なので残す。
  return `tel:${trimmed.replace(/[^0-9+]/g, '')}`;
}

/** 「回答フォームを開く」の飛び先を組み立てる。 */
export function buildFormUri(base: string, formId: string): string {
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}form=${encodeURIComponent(formId)}`;
}

function toLineAction(area: AreaInput, group: GroupInput): Record<string, unknown> {
  const data = area.actionData ?? {};
  const intent = area.intent ?? null;

  // intent が無いのは、この仕組みが入る前に作られた area。挙動を変えない。
  if (!intent) {
    const action: Record<string, unknown> = { type: area.actionType, ...data };
    // displayText は任意項目。エディタの初期値 "" を LINE に送らない。
    if (action.displayText === '') delete action.displayText;
    return action;
  }

  const areaId = area.id ?? '';

  switch (intent) {
    case 'tel':
      return { type: 'uri', uri: normalizeTelUri(String(data.tel ?? data.uri ?? '')) };

    case 'form':
      return {
        type: 'uri',
        uri: buildFormUri(group.formBaseUrl ?? '', area.formId ?? String(data.formId ?? '')),
      };

    case 'url':
      // 計測リンクを選んでいればそちらを開く。クリック数もタグ付けも、
      // 計測リンク側の仕組みがそのまま面倒を見てくれる。
      return { type: 'uri', uri: area.trackedLinkUrl ?? String(data.uri ?? '') };

    case 'template': {
      const action: Record<string, unknown> = {
        type: 'postback',
        data: buildTapPostbackData(areaId),
      };
      if (typeof data.displayText === 'string' && data.displayText !== '') {
        action.displayText = data.displayText;
      }
      return action;
    }

    case 'text': {
      const text = String(data.text ?? '');
      if (!hasTapSideEffects(area)) {
        // 何もしないならメッセージ送信のまま。トークの見え方がいちばん自然。
        return { type: 'message', text };
      }
      // タグやスコアを付けるには、押されたことがこちらに届かないといけない。
      // postback に displayText を添えると、トークの見え方はメッセージ送信と
      // ほぼ同じまま、押されたことを受け取れる。
      return {
        type: 'postback',
        data: buildTapPostbackData(areaId, text),
        displayText: text,
      };
    }

    case 'switch':
      // data は resolveSwitcherActions が解決済み。
      return { type: 'richmenuswitch', ...data };

    case 'postback': {
      const inner = String(data.data ?? '');
      const action: Record<string, unknown> = {
        type: 'postback',
        data: areaId ? buildTapPostbackData(areaId, inner) : inner,
      };
      if (typeof data.displayText === 'string' && data.displayText !== '') {
        action.displayText = data.displayText;
      }
      return action;
    }
  }
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

  // LINE 側へ変更を加える前に、全ページの画像が読めることを確認する。
  // 2ページ目の画像不備で1ページ目だけ公開される事故を防ぐ。
  const imageBytes = new Map<string, Uint8Array>();
  for (const page of resolvedPages) {
    if (!page.imageR2Key || !page.imageContentType) {
      throw new Error(`page ${page.id} (${page.name}) has no image`);
    }
    imageBytes.set(page.id, await readR2Object(r2, page.imageR2Key));
  }

  const cleanupNewMenus = async (keepPageIds = new Set<string>()) => {
    for (const result of results) {
      // alias の復旧を確認できなかったページは、新メニューを消さない。
      // LINE上の alias が新IDを指していた場合にリンク切れになるほうが危険なため。
      if (keepPageIds.has(result.pageId)) continue;
      try {
        await line.deleteRichMenu(result.newRichMenuId);
      } catch {
        // 元の公開状態を守る処理なので、新規メニューの後片付け失敗は元のエラーを隠さない。
      }
    }
  };

  // 1. 全ページを作成し、全画像を upload する。ここが完走するまで alias は触らない。
  try {
    for (const page of resolvedPages) {
      const created = await line.createRichMenu({
        size: dimensions,
        selected: false,
        name: `${group.id.slice(0, 8)} - ${page.name}`,
        chatBarText: group.chatBarText,
        areas: page.areas.map((a) => ({
          bounds: a.bounds,
          action: toLineAction(a, group),
        })),
      });
      results.push({ pageId: page.id, newRichMenuId: created.richMenuId });
      await line.uploadRichMenuImage(
        created.richMenuId,
        imageBytes.get(page.id)!,
        page.imageContentType!,
      );
    }
  } catch (error) {
    await cleanupNewMenus();
    throw error;
  }

  // 2. alias を更新する。DELETE→CREATE の空白時間を作らない。
  // 途中失敗時は切替済み alias を旧IDへ戻し、新規メニューを片付ける。
  const switchedPages: PageInput[] = [];
  const rollbackPublish = async () => {
    const keepNewMenuFor = new Set<string>();
    for (const page of [...switchedPages].reverse()) {
      const aliasId = buildAliasId(group.id, page.orderIndex);
      try {
        if (page.lineRichMenuId) {
          await line.upsertRichMenuAlias(aliasId, page.lineRichMenuId);
        } else {
          await line.deleteRichMenuAlias(aliasId);
        }
      } catch {
        // alias が新IDを指している可能性があるため、このページの新メニューは消さない。
        keepNewMenuFor.add(page.id);
      }
    }
    await cleanupNewMenus(keepNewMenuFor);
  };

  try {
    for (let index = 0; index < resolvedPages.length; index++) {
      const page = resolvedPages[index];
      const result = results[index];
      // 通信結果が不明な失敗でも旧IDへ戻せるよう、試行前にロールバック対象へ入れる。
      switchedPages.push(page);
      await line.upsertRichMenuAlias(
        buildAliasId(group.id, page.orderIndex),
        result.newRichMenuId,
      );
    }

    // 3. default 設定。失敗時は alias も元へ戻す。
    if (group.isDefaultForAll && results.length > 0) {
      await line.setDefaultRichMenu(results[0].newRichMenuId);
    }
  } catch (error) {
    await rollbackPublish();
    throw error;
  }

  // 4. default 解除
  // 有効化時は order_index=0 ページの richMenuId を default に設定。
  // 無効化 (false) 時は **この group の richMenu が現在 LINE の default に設定されている
  // 場合のみ** 解除する。同一 account に別の isDefaultForAll=true group がある状態で
  // 無条件に DELETE すると、その別 group の default まで壊してしまうため。
  if (!group.isDefaultForAll) {
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

  // 5. 公開切替がすべて終わってから旧メニューを削除する。
  for (const page of resolvedPages) {
    if (!page.lineRichMenuId) continue;
    try {
      await line.deleteRichMenu(page.lineRichMenuId);
    } catch {
      // alias は新メニューへ切替済み。旧メニューの削除失敗は次回の清掃対象とする。
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
