import type { MediaItem } from '@line-crm/shared'
import type { MediaUploadSession } from '@/lib/api'

const MEBIBYTE = 1024 * 1024

export const MEDIA_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,video/mp4,audio/mpeg,audio/mp4,application/pdf'

export function mediaFileLimitBytes(file: Pick<File, 'type'>): number | null {
  if (file.type.startsWith('image/')) return 10 * MEBIBYTE
  if (file.type.startsWith('audio/')) return 200 * MEBIBYTE
  if (file.type === 'video/mp4') return 200 * MEBIBYTE
  if (file.type === 'application/pdf') return 20 * MEBIBYTE
  return null
}

export function validateMediaFile(file: Pick<File, 'name' | 'size' | 'type'>): string {
  const limit = mediaFileLimitBytes(file)
  if (limit == null) return 'この形式は登録できません'
  if (file.size < 1) return '中身が空のファイルは登録できません'
  if (file.size > limit) return `${Math.round(limit / MEBIBYTE)}MBを超えています`
  return ''
}

export function mediaAcceptForKind(kind: MediaItem['kind']): string {
  if (kind === 'image') return 'image/png,image/jpeg,image/gif,image/webp'
  if (kind === 'video') return 'video/mp4'
  if (kind === 'audio') return 'audio/mpeg,audio/mp4'
  return 'application/pdf'
}

export function fileMatchesMediaKind(file: Pick<File, 'type'>, kind: MediaItem['kind']): boolean {
  if (kind === 'image') return file.type.startsWith('image/')
  if (kind === 'video') return file.type === 'video/mp4'
  if (kind === 'audio') return file.type.startsWith('audio/')
  return file.type === 'application/pdf'
}

/**
 * 署名URLは秘密値なので保持・記録せず、この1回のPUTにだけ使う。
 * XMLHttpRequestを使うのはファイル単位の送信進捗を表示するため。
 */
export function putMediaFile(
  session: MediaUploadSession,
  file: File,
  onProgress: (progress: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(session.method, session.uploadUrl)
    for (const [name, value] of Object.entries(session.requiredHeaders)) {
      request.setRequestHeader(name, value)
    }
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
    }
    request.onerror = () => reject(new Error('ファイルを送信できませんでした'))
    request.onabort = () => reject(new Error('ファイルの送信を取り消しました'))
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error('ファイルを送信できませんでした'))
        return
      }
      const etag = request.getResponseHeader('ETag')?.trim()
      if (!etag) {
        reject(new Error('送信したファイルを確認できませんでした'))
        return
      }
      onProgress(100)
      resolve(etag)
    }
    request.send(file)
  })
}
