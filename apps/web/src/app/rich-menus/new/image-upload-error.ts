import { ApiError } from '@/lib/api'
import { SIZE_LABEL } from './create-options'

/** 画像エラーのサーバ原文（英語）を日本語に写す。 */
export function imageUploadErrorText(err: unknown): string {
  const fallback = '画像を読み込めませんでした。もう一度お試しください。'
  if (!(err instanceof ApiError)) return fallback
  const message =
    err.status === 400 && err.message && !/^API error: /.test(err.message) ? err.message : ''
  if (!message) return fallback
  if (
    message.includes('content-type must be image/png or image/jpeg') ||
    message.includes('unrecognized image format')
  ) {
    return '画像の形式はPNGかJPEGにしてください。'
  }
  if (message.includes('exceeds 1MB limit')) {
    return '画像が大きすぎます。1MB以下の画像を選んでください。'
  }
  if (message.includes('dimensions ')) {
    return `画像の大きさが合いません。${SIZE_LABEL.large}（大）か${SIZE_LABEL.compact}（小）の画像を選んでください。`
  }
  return message
}
