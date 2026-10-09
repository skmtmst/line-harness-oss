import type { MediaItem } from '@line-crm/shared'
import { api } from '@/lib/api'
import { extractMediaMetadata, putMediaFile, validateMediaFile } from '@/v8/contents/media-direct-upload'

/**
 * 登録メディアへ入れて、その URL を返す（画像を入れる所 MediaSlot の送り先の1つ）。
 * 登録メディアと同じ「準備→直接送信→登録完了」の口。URL は完了後の正本から読む。
 * 音声・動画は長さ（ミリ秒）も返す（読めたときだけ）。
 */
export async function uploadToMediaLibrary(
  file: File,
  accountId: string,
  kind: MediaItem['kind'],
  onProgress: (percent: number) => void = () => {},
): Promise<{ url: string; durationMs?: number }> {
  const invalid = validateMediaFile(file)
  if (invalid) throw new Error(invalid)
  const metadata = await extractMediaMetadata(file)
  const prepared = await api.media.prepareUploads({
    accountId,
    files: [{ filename: file.name, mimeType: file.type, sizeBytes: file.size, folderId: null, metadata }],
  })
  if (!prepared.success || prepared.data.sessions.length !== 1) {
    throw new Error((!prepared.success && prepared.error) || 'ファイルを送る準備ができませんでした。')
  }
  const session = prepared.data.sessions[0]
  const etag = await putMediaFile(session, file, onProgress)
  const completed = await api.media.completeUpload(session.id, { accountId, etag })
  if (!completed.success) throw new Error(completed.error || '登録を完了できませんでした。')
  if (completed.data.status !== 'completed' || !completed.data.mediaId) throw new Error('登録を完了できませんでした。')
  const media = await api.media.detail(completed.data.mediaId, accountId)
  if (!media.success || media.data.item.kind !== kind || !media.data.item.url) {
    throw new Error('登録したファイルを確認できませんでした。登録メディアから選び直してください。')
  }
  return { url: media.data.item.url, durationMs: metadata.durationMs }
}
