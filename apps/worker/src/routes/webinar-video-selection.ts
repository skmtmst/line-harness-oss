import { getMediaById } from '@line-crm/db';


/**
 * videoMediaId（メディア選択）を保存値 video_prefix へ解決する。
 * 選べるのは対象ウェビナーと同じアカウントの kind='video' のメディアだけ。
 * null は動画の解除。返り値はエラーコードで、問題なければ null。
 */
export async function applyVideoMediaSelection(
  db: D1Database,
  input: Record<string, unknown>,
  accountId: string | null,
): Promise<string | null> {
  if (input.videoMediaId === undefined) return null;
  const mediaId = input.videoMediaId;
  delete input.videoMediaId;
  if (mediaId === null) {
    input.videoPrefix = null;
    return null;
  }
  const media = typeof mediaId === 'string' && mediaId
    ? await getMediaById(db, mediaId, accountId)
    : null;
  if (!media) return 'video_media_not_found';
  if (media.kind !== 'video') return 'video_media_not_video';
  input.videoPrefix = media.r2_key;
  return null;
}
