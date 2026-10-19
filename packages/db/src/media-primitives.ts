


/**
 * メディアライブラリ。
 *
 * これまで画像は使う場所ごとにアップロードしていて、同じ画像が
 * 何本も R2 に積み上がっていた。1か所に集めて、使い回せるようにする。
 */

export const MEDIA_KINDS = ['image', 'video', 'audio', 'file'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_REF_KINDS = [
  'template',
  'broadcast',
  'rich_menu',
  'scenario_step',
  'nen_column',
  'event',
  'webinar',
  'booking_menu',
  'booking_staff',
  'booking_settings',
] as const;
export type MediaRefKind = (typeof MEDIA_REF_KINDS)[number];

export interface Media {
  revision?: number;
  id: string;
  line_account_id: string | null;
  folder_id: string | null;
  kind: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  r2_key: string;
  public_url: string | null;
  uploaded_by: string | null;
  created_at: string;
  /**
   * アーカイブ済みなら退避した時刻。一覧・選択では既定で外すが、
   * 本文や過去配信からの参照はそのまま使える（消去ではない）。
   */
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
  /**
   * 運用者が確認して記録した利用期限（YYYY-MM-DD）と同意・権利の記録。
   * NULL は「記録なし＝不明」。根拠のない権利情報を推定で埋めないため、
   * コード側が値を補うことはない。
   */
  usage_expires_at?: string | null;
  usage_consent_note?: string | null;
  /** 一覧取得時だけ付く。使用先をカードごとに再取得しないための集計値。 */
  usage_count?: number;
}

export type MediaUsageMutationResult = { meta?: { changes?: number } };

/** アーカイブ・復元の結果。状態が既に目的側なら冪等に 'already' を返す。 */
export type MediaArchiveResult =
  | { status: 'archived' | 'restored'; media: Media }
  | { status: 'already_archived' | 'already_active' }
  | { status: 'not_found' };

/**
 * 置き換え文をD1のbind上限内に収める。
 *
 * 置き換え対が少ない通常時は表ごとに1文（従来どおり、行は1回だけ数える）。
 * 版数が多くて対が膨らんだときだけ列・対ごとに分け、含有判定(instr)で実際に
 * そのトークンを含む行だけを対象にする。
 */
export const USAGE_REPLACE_PAIR_CHUNK = 24;

/**
 * ライブ参照の公開パス。
 *
 * 使用先本文には「版ごとのr2_key」か、このメディアIDのパスを
 * `/media/<id>/content` の形で埋め込む。版のr2_keyはその版を指し続け
 * （固定参照）、メディアIDのパスは配信時に最新版へ解決される
 * （ライブ参照）。どちらも本文内の文字列として表せるため、使用先の
 * 記録へ列を足さずに使用先ごとの切り替えができる。
 */
export function mediaLiveContentPath(mediaId: string): string {
  return `/media/${mediaId}/content`;
}
