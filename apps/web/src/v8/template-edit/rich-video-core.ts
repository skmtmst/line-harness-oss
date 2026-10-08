import { validateImagemapMessage, validRichVideoUrl } from '@line-crm/shared'

export const RICH_VIDEO_BUTTON_LABELS = ['詳しく見る', '予約する', '購入する', '申し込む', 'お問い合わせ', 'ほかの動画を見る']
export interface RichVideoDraft {
  name: string
  folderId: string
  originalContentUrl: string
  previewImageUrl: string
  height: number
  buttonEnabled: boolean
  actionLabel: string
  actionUrl: string
  altText: string
}
export function richVideoContent(draft: RichVideoDraft) {
  return {
    baseUrl: '', // 保存口が検査済みのプレビューから5サイズを作る。
    baseSize: { width: 1040, height: draft.height },
    altText: draft.altText.trim(),
    actions: [],
    video: {
      originalContentUrl: draft.originalContentUrl,
      previewImageUrl: draft.previewImageUrl,
      area: { x: 0, y: 0, width: 1040, height: draft.height },
      ...(draft.buttonEnabled ? { externalLink: { linkUri: draft.actionUrl.trim(), label: draft.actionLabel } } : {}),
    },
  }
}
export type RichVideoIssue = { field: 'name' | 'video' | 'preview' | 'actionUrl' | 'altText'; message: string }
export function richVideoDraftIssue(draft: RichVideoDraft): RichVideoIssue | null {
  if (!draft.name.trim()) return {field:'name',message:'テンプレート名を入力してください。'}
  if (!draft.originalContentUrl) return {field:'video',message:'動画を選んでください。'}
  if (!draft.previewImageUrl) return {field:'preview',message:'プレビュー画像を選んでください。'}
  if (draft.buttonEnabled && !validRichVideoUrl(draft.actionUrl.trim(),1000)) return {field:'actionUrl',message:'リンク先URLはHTTPS・1,000文字以内で入力してください。'}
  if (!draft.altText.trim() || Array.from(draft.altText).length>1500) return {field:'altText',message:'通知に出る文は1〜1,500文字で入力してください。'}
  const message=validateImagemapMessage({ ...richVideoContent(draft), baseUrl: 'https://example.test/images/pending' })
  return message ? {field:'video',message} : null
}
export function richVideoDraftError(draft: RichVideoDraft): string | null {
  return richVideoDraftIssue(draft)?.message ?? null
}

/** 本物の動画の先頭から、同じ縦横比の1MB以下の画像を作る。失敗は画像選択へ。 */
export async function videoPreviewFile(file: File): Promise<{ file: File; height: number }> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('動画の画像を作れませんでした')), 15000)
      video.onloadeddata = () => { clearTimeout(timer); resolve() }
      video.onerror = () => { clearTimeout(timer); reject(new Error('動画を読み取れませんでした')) }
      video.src = url
      video.load()
    })
    if (!video.videoWidth || !video.videoHeight) throw new Error('動画の大きさを読み取れませんでした')
    const scale = Math.min(1, 1040 / video.videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('プレビュー画像を作れませんでした')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('プレビュー画像を作れませんでした')), 'image/jpeg', 0.8))
    if (blob.size > 1024 * 1024) throw new Error('画像は1MBまでです')
    return { file: new File([blob], 'video-preview.jpg', { type: 'image/jpeg' }), height: Math.max(1, Math.round(1040 * video.videoHeight / video.videoWidth)) }
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}
