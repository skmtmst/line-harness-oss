/*
 * 一斉配信の本文の差し込みを置き換える。
 *
 * LINE 側の textV2.substitution はメンションと絵文字しか置き換えられない
 * ので、送る前にこちらで置き換えてから渡す。
 *
 * どの差し込みを置き換えられるか・どれが相手ごとに変わるかは
 * `@line-crm/shared` に置いてある。画面と同じものを見ないと、
 * 画面では入れられるのに配信時刻になって初めて弾かれる、という壊れ方をする。
 */
import {
  findUnsupportedInterpolations,
  listInterpolations,
  needsPerRecipientDelivery,
} from '@line-crm/shared';
import { expandDateVariables } from './interpolation-date.js';

export function getBroadcastVariables(content: string): string[] {
  return listInterpolations(content);
}

export function getUnsupportedBroadcastVariables(content: string): string[] {
  return findUnsupportedInterpolations(content);
}

/** 1人ずつ送らないといけないか（相手ごとに変わる差し込みがあるか）。 */
export function hasRecipientVariables(content: string): boolean {
  return needsPerRecipientDelivery(content);
}

export interface BroadcastRenderContext {
  liffId?: string | null;
  displayName?: string | null;
  /** 友だち情報欄。field_key => 値 */
  fields?: Record<string, string>;
  /** 共通情報。var_key => 値 */
  vars?: Record<string, string>;
  /** 配信日の起点。省略したら「いま」。 */
  deliveredAt?: Date;
}

export function renderMessageContent(
  content: string,
  liffIdOrContext: string | null | BroadcastRenderContext,
): string {
  const context: BroadcastRenderContext = typeof liffIdOrContext === 'object'
    ? liffIdOrContext ?? {}
    : { liffId: liffIdOrContext };

  /*
   * 日付を先に置き換える。
   *
   * 後にすると、友だち情報欄に入っていた値が偶然 `{{date}}` の形をして
   * いた場合に二重に置き換わる。差し込みの値は利用者が入れたもので、
   * それが差し込みとして解釈されるのは事故のもと。
   */
  let result = expandDateVariables(content, context.deliveredAt ?? new Date());

  if (context.liffId) result = result.replace(/\{\{\s*liff_id\s*\}\}/g, context.liffId);
  if (context.displayName) result = result.replace(/\{\{\s*name\s*\}\}/g, context.displayName);

  /*
   * 未設定の項目は空文字にする。
   *
   * 「未設定」と書くとそのまま相手に届く。空にしておけば、文として
   * 不格好でも意味は壊れない。差し込みを本文に残すのがいちばん困る。
   */
  const fields = context.fields;
  if (fields) {
    result = result.replace(/\{\{\s*field\.([a-z][a-z0-9_]*)\s*\}\}/g, (_m, key: string) => fields[key] ?? '');
  }
  const vars = context.vars;
  if (vars) {
    result = result.replace(/\{\{\s*var\.([a-z][a-z0-9_]*)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
  }

  return result;
}

function renderJsonValue(value: unknown, context: BroadcastRenderContext): unknown {
  if (typeof value === 'string') return renderMessageContent(value, context);
  if (Array.isArray(value)) return value.map((item) => renderJsonValue(item, context));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        renderMessageContent(key, context),
        renderJsonValue(item, context),
      ]),
    );
  }
  return value;
}

/**
 * Flex content is JSON. Replacing raw bytes would break the JSON when a LINE
 * display name contains a quote, backslash, or newline, so render parsed string
 * values and serialize them again. Text content remains unchanged except for
 * the requested variables.
 */
export function renderBroadcastMessageContent(
  messageType: string,
  content: string,
  context: BroadcastRenderContext,
): string {
  if (messageType !== 'flex') return renderMessageContent(content, context);
  const parsed = JSON.parse(content) as unknown;
  return JSON.stringify(renderJsonValue(parsed, context));
}

export function assertNoUnresolvedBroadcastVariables(content: string): void {
  const unresolved = getBroadcastVariables(content);
  if (unresolved.length > 0) {
    throw new Error(`Unresolved broadcast variables: ${unresolved.map((v) => `{{${v}}}`).join(', ')}`);
  }
}
