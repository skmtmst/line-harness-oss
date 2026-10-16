'use client'

import { LinePreviewFlex } from '@/components/shared/line-preview';
import { useRef, useState } from 'react';
import { api, type BroadcastBubble, type BroadcastBubbleType, type BroadcastMessageButton } from '@/lib/api';
import MediaSlot from '@/components/shared/media-slot';
import MediaPickerDialog from '@/components/shared/media-picker-dialog';
import styles from './broadcast-form-v8.module.css';
import BroadcastTextBubble from './broadcast-text-bubble';
import { type MessageKindState } from '@/components/scenarios/message-kind-fields';
import Button from '@/components/shared/button';
import { ComposerCarouselPreview } from '@/components/shared/message-composer';
import { SaveErrorField } from '@/components/shared/save-form-errors';


/** 選んだ時点で止める文。上限と今の大きさを両方言う（例「動画は200MBまでです。今のファイルは350MBです」）。 */
export function mediaTooLargeMessage(isVideo: boolean, bytes: number): string {
  const mb = bytes / (1024 * 1024)
  const size = mb >= 10 ? `${Math.round(mb)}MB` : `${Math.round(mb * 10) / 10}MB`
  return isVideo ? `動画は200MBまでです。今のファイルは${size}です` : `画像は10MBまでです。今のファイルは${size}です`
}


/**
 * 画像・動画のアップロード欄。統括の一括配信（v8/hq-broadcasts）も同じ欄を使う。
 * lineAccountId を渡すと動画の置き場をそのアカウントにする（null＝どの店にも属さない。統括）。省けば今選んでいる店。
 */
export function MediaUpload({ bubble, onChange, lineAccountId, mediaAccountId = null }: { bubble: BroadcastBubble; onChange: (content: Record<string, unknown>) => void; lineAccountId?: string | null; /** 渡すと「登録メディアから選ぶ」を出す（そのアカウントの登録メディア）。 */ mediaAccountId?: string | null }) {
  const latest = useRef({ bubble, onChange })
  latest.current = { bubble, onChange }
  // 登録メディアから選ぶ先。統括（null）はどの店にも属さないので出さない。
  const pickFrom = mediaAccountId
  const [picking, setPicking] = useState<'main' | 'preview' | null>(null)
  const isVideo = bubble.type === 'video' || bubble.type === 'rich_video'
  const noun = isVideo ? '動画' : '画像'
  const scope = `${bubble.id}-${bubble.type}-${lineAccountId ?? ''}`
  const content = bubble.content
  const original = typeof content.originalContentUrl === 'string' ? content.originalContentUrl : ''
  const preview = typeof content.previewImageUrl === 'string' ? content.previewImageUrl : ''
  const sendFile = async (file: File) => {
    const res = await api.broadcastMessageAssets.upload(file, lineAccountId)
    if (!res.success) throw new Error(res.error)
    return res.data.url
  }
  const setMain = (url: string) => {
    const now = latest.current.bubble.content
    latest.current.onChange({ ...now, originalContentUrl: url, previewImageUrl: isVideo ? (now.previewImageUrl ?? '') : url })
  }
  const setPreview = (url: string) => latest.current.onChange({ ...latest.current.bubble.content, previewImageUrl: url })
  const main = (
    <SaveErrorField names={["original","main"]}><MediaSlot
      kind={isVideo ? 'video' : 'image'}
      title={`${noun}を追加`}
      value={original || null}
      accept={isVideo ? 'video/mp4' : 'image/jpeg,image/png'}
      limitText={isVideo ? '1ファイル200メガバイト以内・MP4' : '1ファイル10メガバイト以内・JPEG・PNG'}
      validate={(file) => {
        const allowed = isVideo ? ['video/mp4'] : ['image/jpeg', 'image/png']
        const max = isVideo ? 200 * 1024 * 1024 : 10 * 1024 * 1024
        if (!allowed.includes(file.type)) return isVideo ? 'MP4のみ対応しています' : 'JPEG・PNGのみ対応しています'
        if (file.size > max) return mediaTooLargeMessage(isVideo, file.size)
        return ''
      }}
      upload={sendFile}
      scope={scope}
      onChange={(url) => setMain(url ?? '')}
      onMediaPick={pickFrom ? () => setPicking('main') : undefined}
    /></SaveErrorField>
  )
  return <div className="space-y-3">
    {isVideo ? (
      <div className={styles.mediaRow}>
        {main}
        <SaveErrorField names={["preview"]}><MediaSlot
          size="compact"
          title="プレビュー画像を追加"
          previewAlt="動画のプレビュー画像"
          value={preview || null}
          accept="image/jpeg,image/png"
          maxBytes={1024 * 1024}
          upload={sendFile}
          scope={scope}
          onChange={(url) => setPreview(url ?? '')}
          onMediaPick={pickFrom ? () => setPicking('preview') : undefined}
          urlEntry={{ value: preview, onChange: setPreview, label: '動画のプレビュー画像のURL', placeholder: 'https://…（JPEG/PNG・1MBまで）' }}
        /></SaveErrorField>
      </div>
    ) : main}
    {isVideo ? <p className="text-xs text-ink-faint">プレビュー画像は LINE 側で必須です（https・JPEG/PNG・1MBまで）。</p> : null}
    {bubble.type === 'rich_video' && <SaveErrorField names={["actionUrl","content.actionUrl","action_url","content.action_url"]}><input value={String(content.actionUrl ?? '')} onChange={(e) => onChange({ ...content, actionUrl: e.target.value })} placeholder="再生終了後に開くURL" className="w-full rounded-control border border-hairline px-3 py-2 text-sm" /></SaveErrorField>}
    <MediaPickerDialog
      open={picking !== null}
      accountId={pickFrom}
      kind={picking === 'main' && isVideo ? 'video' : 'image'}
      onClose={() => setPicking(null)}
      onSelect={(item) => {
        if (picking === 'preview') setPreview(item.url)
        else setMain(item.url)
        setPicking(null)
      }}
    />
  </div>
}
