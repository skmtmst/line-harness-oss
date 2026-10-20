import { expandDateVariables } from './interpolation-date.js';
/**
 * Replace template variables in message content.
 *
 * Supported variables:
 * - {{name}}                → friend's display name
 * - {{uid}}                 → friend's user UUID
 * - {{friend_id}}           → friend's internal ID
 * - {{auth_url:CHANNEL_ID}} → full /auth/line URL with uid for cross-account linking
 * - {{metadata.KEY}}       → friend's metadata value (from form responses etc.)
 */
/**
 * 差し込みの記法について。
 *
 * 友だち情報欄は {{field.pet_name}}、共通情報は {{var.shop_hours}} で書く。
 * 要件定義書は {pet_name} という単一の波括弧を想定していたが、それは採れない。
 * Flex メッセージの本文は JSON で、{ が至るところに出てくる。単一の波括弧で
 * 置換すると、差し込みのつもりが無い箇所まで書き換えて本文を壊す。
 *
 * 既存の {{metadata.KEY}} と同じ形にそろえたので、書き方も1つで済む。
 */
/** 中身を JSON で持つ種類。差し込みの値を JSON の文字列として安全な形にする。 */
const JSON_CONTENT_TYPES = new Set(['flex', 'carousel', 'location', 'image', 'video', 'audio', 'sticker']);


export function expandVariables(
  content: string,
  friend: { id: string; display_name: string | null; user_id: string | null; ref_code?: string | null; metadata?: Record<string, unknown> | string | null },
  apiOrigin?: string,
  messageType?: string,
  extra?: {
    /** 友だち情報欄。field_key => 値 */
    fields?: Record<string, string>;
    /** 共通情報。var_key => 値 */
    vars?: Record<string, string>;
    /**
     * この通が届く日時。{{date}} や {{days_until:…}} の起点。
     * 省略したら「いま」。テスト送信やプレビューはそれでよい。
     */
    deliveredAt?: Date;
  },
): string {
  let result = content;

  /*
   * 日付の差し込みを先に処理する。
   *
   * 後にすると、{{field.x}} に入っていた文字列が偶然 {{date}} の形を
   * していた場合に二重に置き換わる。差し込みの値は利用者が入れたもので、
   * それが差し込みとして解釈されるのは事故のもと。
   */
  result = expandDateVariables(result, extra?.deliveredAt ?? new Date());
  /*
   * カード（Flex・カルーセル）や位置情報などの中身は JSON。名前や友だち情報に
   * " や \ や改行が入っていると、そのまま埋めると JSON が壊れ、送る形にできずに
   * 中身の JSON が文字のままお客さまへ届く（2026-10-07 点検）。JSON の文字列の
   * 中で安全な形にしてから入れる。置き換えは関数で渡し、値の中の $& などを
   * 置き換えの記号として読ませない。
   */
  const put = (value: string): string =>
    messageType && JSON_CONTENT_TYPES.has(messageType) ? JSON.stringify(value).slice(1, -1) : value;
  result = result.replace(/\{\{name\}\}/g, () => put(friend.display_name || ''));
  result = result.replace(/\{\{uid\}\}/g, () => put(friend.user_id || ''));
  result = result.replace(/\{\{friend_id\}\}/g, () => put(friend.id));
  result = result.replace(/\{\{ref\}\}/g, () => put(friend.ref_code || ''));
  // Conditional block: {{#if_ref}}...{{/if_ref}} — only shown if ref_code exists
  if (friend.ref_code) {
    result = result.replace(/\{\{#if_ref\}\}([\s\S]*?)\{\{\/if_ref\}\}/g, '$1');
  } else {
    result = result.replace(/\{\{#if_ref\}\}[\s\S]*?\{\{\/if_ref\}\}/g, '');
  }
  // Metadata variables: {{metadata.KEY}} → value from friend's metadata
  const meta = friend.metadata
    ? (typeof friend.metadata === 'string' ? JSON.parse(friend.metadata) as Record<string, unknown> : friend.metadata)
    : {};
  // Conditional block: {{#if_metadata.KEY}}...{{/if_metadata.KEY}} — only shown if metadata key has a value
  // When inside JSON arrays, removes the element and fixes trailing/leading commas
  result = result.replace(/\{\{#if_metadata\.([^}]+)\}\}([\s\S]*?)\{\{\/if_metadata\.\1\}\}/g, (_match, key, inner) => {
    const val = meta[key];
    if (val == null || val === '') return '';
    return inner;
  });
  // Clean up broken JSON commas from removed conditional blocks (e.g. ",," or "[," or ",]").
  // Flex only: this is JSON repair — running it on plain text silently rewrote
  // user-authored bodies containing ",," / "[," / ",]" (bug present since initial release).
  if (messageType === 'flex') {
    result = result.replace(/,\s*,/g, ',');
    result = result.replace(/\[\s*,/g, '[');
    result = result.replace(/,\s*\]/g, ']');
  }
  result = result.replace(/\{\{metadata\.([^}]+)\}\}/g, (_match, key) => {
    const val = meta[key];
    if (val == null) return '';
    return put(Array.isArray(val) ? val.join(', ') : String(val));
  });

  // 友だち情報欄。{{#if_field.KEY}}...{{/if_field.KEY}} で「値があるときだけ」も書ける。
  // 条件ブロックを先に処理するのは、中の {{field.KEY}} を消してからでは
  // 判定できないため。
  const fields = extra?.fields ?? {};
  result = result.replace(
    /\{\{#if_field\.([a-z][a-z0-9_]*)\}\}([\s\S]*?)\{\{\/if_field\.\1\}\}/g,
    (_match, key: string, inner: string) => {
      const val = fields[key];
      return val == null || val === '' ? '' : inner;
    },
  );
  result = result.replace(/\{\{field\.([a-z][a-z0-9_]*)\}\}/g, (_match, key: string) => {
    // 未設定の項目は空文字にする。「未設定」と書くと、そのまま送られて
    // お客様に見えてしまう。空にしておけば文として不自然でも意味は壊れない。
    return put(fields[key] ?? '');
  });

  // 共通情報。営業時間や電話番号のように、全テンプレートで同じ値を使うもの。
  // スキャン側（commonVarKeysInContent）と同じ空白許容の表記で拾う。
  const vars = extra?.vars ?? {};
  result = result.replace(/\{\{\s*var\.([a-z][a-z0-9_]*)\s*\}\}/g, (_match, key: string) => {
    return put(vars[key] ?? '');
  });
  if (apiOrigin) {
    result = result.replace(/\{\{auth_url:([^}]+)\}\}/g, (_match, channelId) => {
      const params = new URLSearchParams({ account: channelId, ref: 'cross-link' });
      if (friend.user_id) params.set('uid', friend.user_id);
      return `${apiOrigin}/auth/line?${params.toString()}`;
    });
  }
  return result;
}
