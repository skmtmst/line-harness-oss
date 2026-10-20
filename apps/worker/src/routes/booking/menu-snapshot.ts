

/**
 * 予約の写し (T)。予約した時点のメニューの内容（値段・時間）を残す。
 * あとでメニューを変えても、この予約の写しは変わらない。
 */
export function buildMenuSnapshot(menuRow: {
  version: number;
  name: string;
  dur: number;
  buffer_after_minutes: number;
  price: number;
  price_mode: string;
}): { version: number; json: string } {
  return {
    version: Number(menuRow.version),
    json: JSON.stringify({
      version: Number(menuRow.version),
      name: menuRow.name,
      duration_minutes: Number(menuRow.dur),
      buffer_after_minutes: Number(menuRow.buffer_after_minutes),
      base_price: Number(menuRow.price),
      price_mode: menuRow.price_mode,
    }),
  };
}

/**
 * 公開フラグの正規化。画面は 1/0 の数値、他は true/false で送る。
 * どちらも「止める = 0」に倒す。書いていなければ出す(1)側に倒す。
 */
export function toMenuActiveFlag(value: unknown): number {
  return value === false || value === 0 ? 0 : 1;
}

export type AutoTagIdRead =
  | { ok: true; present: boolean; value: string | null }
  | { ok: false; error: 'invalid_auto_tag_id' };

/**
 * auto_tag_id は「文字列」か「null / 未送信」だけを受け付ける。
 * 数値・真偽値・配列・オブジェクトをそのまま `.trim` へ流すと TypeError になり、
 * 入力の不備が 500(サーバ障害)として返ってしまう。呼び手が直せる誤りなので
 * ここで型を見て 400 に倒す。
 *
 * PUT は「送られた項目だけ更新する」ため、未送信(`present: false`)と
 * 明示的な null(`present: true, value: null`)を呼び出し側で区別できるようにする。
 */
export function readAutoTagId(body: Record<string, unknown>): AutoTagIdRead {
  if (!Object.prototype.hasOwnProperty.call(body, 'auto_tag_id')) {
    return { ok: true, present: false, value: null };
  }
  const raw = body.auto_tag_id;
  if (raw === null || raw === undefined) return { ok: true, present: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_auto_tag_id' };
  const trimmed = raw.trim();
  return { ok: true, present: true, value: trimmed === '' ? null : trimmed };
}

/**
 * 自動タグとして結び付けてよいタグかを、対象アカウント内かつ status='active' で確かめる。
 *
 * 整理済み(archived)のタグを受け付けると、二度と使わないタグへメニューが繋がったままになり、
 * 予約のたびに「付いたはずのタグで絞り込めない」状態を作る。保存時(POST/PUT)と
 * 実行時(予約成立時)の両方でここを通し、設定した後に整理されたタグも止める。
 */
export async function isAssignableAutoTag(
  db: D1Database,
  tagId: string,
  accountId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM tags WHERE id = ? AND line_account_id = ? AND status = 'active'`)
    .bind(tagId, accountId)
    .first<{ 1: number }>();
  return row != null;
}
