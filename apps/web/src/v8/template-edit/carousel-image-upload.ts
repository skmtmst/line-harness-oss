import { api } from '@/lib/api'
import { extractMediaMetadata, putMediaFile, validateMediaFile } from '../contents/media-direct-upload'

export function validateCarouselImage(file: File, maxMB = 10): string {
  if (!['image/jpeg', 'image/png'].includes(file.type)) return 'JPEG・PNGの画像を選んでください。'
  const invalid = validateMediaFile(file)
  if (invalid) return invalid
  if (file.size > maxMB * 1024 * 1024) return `統括の画像は${maxMB}MBまでです。小さくして選び直してください。`
  return ''
}

type Session = Extract<Awaited<ReturnType<typeof api.media.prepareUploads>>, { success: true }>['data']['sessions'][number]
// 同じ選択ファイルの再試行は、完了の返事を失っても同じ送信を確認する。
const attempts = new WeakMap<File, Map<string, { session: Session; etag?: string; mediaId?: string }>>()

/** 登録メディアと同じ「準備→直接送信→登録完了」の口。URLは完了後の正本から読む。 */
export async function uploadCarouselImage(file: File, accountId: string): Promise<string> {
  const invalid = validateCarouselImage(file)
  if (invalid) throw new Error(invalid)
  let scoped = attempts.get(file)
  if (!scoped) { scoped = new Map(); attempts.set(file, scoped) }
  let attempt = scoped.get(accountId)
  if (!attempt) {
    const prepared = await api.media.prepareUploads({ accountId, files: [{
      filename: file.name, mimeType: file.type, sizeBytes: file.size,
      folderId: null, metadata: await extractMediaMetadata(file),
    }] })
    if (!prepared.success) throw new Error(prepared.error || '画像を送る準備ができませんでした。')
    if (prepared.data.sessions.length !== 1) throw new Error('画像を送る準備ができませんでした。')
    attempt = { session: prepared.data.sessions[0] }
    scoped.set(accountId, attempt)
  }
  if (!attempt.etag) attempt.etag = await putMediaFile(attempt.session, file, () => {})
  const { session, etag } = attempt
  const completed = await api.media.completeUpload(session.id, { accountId, etag })
  if (!completed.success) throw new Error(completed.error || '画像の登録を完了できませんでした。')
  if (completed.data.status !== 'completed' || !completed.data.mediaId) throw new Error('画像の登録を完了できませんでした。')
  const media = await api.media.detail(completed.data.mediaId, accountId)
  if (!media.success) throw new Error(media.error || '登録した画像を確認できませんでした。登録メディアから選び直してください。')
  if (media.data.item.kind !== 'image' || !media.data.item.url) throw new Error('登録した画像を確認できませんでした。登録メディアから選び直してください。')
  return media.data.item.url
}
