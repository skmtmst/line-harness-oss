'use client'

/*
 * 位置情報・動画・音声・スタンプの入力欄。
 *
 * どれも中身は JSON 1つで、`scenario_steps.message_content` に入る。
 * 組み立ての形は worker の buildMessage と揃えてある（ずれると、保存は
 * できるのに配信でテキストに落ちる）。
 *
 * 動画と音声はURLを受ける。画像のアップローダは JPEG/PNG 専用で、
 * 動画・音声は置けない。**置き場を用意していないのに投稿欄だけ出すと、
 * 選べないファイルを探させることになる**ので、URL欄にして条件を書く。
 */

import { useRef, useState } from 'react'
import type { MediaItem } from '@line-crm/shared'
import MediaSlot from '@/components/shared/media-slot'
import MediaPickerDialog from '@/components/shared/media-picker-dialog'
import { uploadToMediaLibrary } from '@/components/shared/media-library-upload'
import { extractMediaMetadata } from '@/v8/contents/media-direct-upload'
import styles from './message-kind-fields.module.css'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Button from '@/components/shared/button'
import ComposerStickers from '@/components/shared/composer-stickers'
import { SaveErrorField } from '@/components/shared/save-form-errors'

export type MessageKind = 'location' | 'video' | 'audio' | 'sticker'

export interface MessageKindState {
  location: { title: string; address: string; latitude: string; longitude: string }
  video: { originalContentUrl: string; previewImageUrl: string }
  audio: { originalContentUrl: string; duration: string }
  sticker: { packageId: string; stickerId: string }
}

export function emptyMessageKindState(): MessageKindState {
  return {
    location: { title: '', address: '', latitude: '', longitude: '' },
    video: { originalContentUrl: '', previewImageUrl: '' },
    audio: { originalContentUrl: '', duration: '' },
    sticker: { packageId: '', stickerId: '' },
  }
}

/**
 * 緯度・経度の取れる範囲。地図上に無い数字を「入力済み」にしない
 * （監査 R210）。Worker 側の検査とそろえている。
 */
export const LOCATION_LATITUDE_RANGE = { min: -90, max: 90 } as const
export const LOCATION_LONGITUDE_RANGE = { min: -180, max: 180 } as const

/**
 * 位置情報の緯度・経度が範囲外のとき、利用者への直し方を返す。
 * 空文字なら問題なし（「まだ書けていない」は呼ぶ側の文言に任せる）。
 */
export function locationRangeError(state: MessageKindState['location']): string {
  if (state.latitude.trim() === '' || state.longitude.trim() === '') return ''
  const lat = Number(state.latitude)
  const lng = Number(state.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  if (lat < LOCATION_LATITUDE_RANGE.min || lat > LOCATION_LATITUDE_RANGE.max) {
    return `緯度は${LOCATION_LATITUDE_RANGE.min}〜${LOCATION_LATITUDE_RANGE.max}で入力してください`
  }
  if (lng < LOCATION_LONGITUDE_RANGE.min || lng > LOCATION_LONGITUDE_RANGE.max) {
    return `経度は${LOCATION_LONGITUDE_RANGE.min}〜${LOCATION_LONGITUDE_RANGE.max}で入力してください`
  }
  return ''
}

/**
 * まだ送れる形になっていない理由。送れるなら null。
 *
 * R234: 空っぽだけでなく「入っているが送れない」もここで止める。
 * 形式だけの検査（https・番号の形・秒数・緯度経度の範囲）にし、実在の確認
 * （番号の組み合わせが本当に送れるか・URLの先に音声があるか）はしない。
 * 実在は送る直前の検査と LINE 側の応答に任せる。
 */
export function messageKindProblem(kind: MessageKind, state: MessageKindState): string | null {
  switch (kind) {
    case 'location': {
      const v = state.location
      if (v.latitude.trim() === '' || v.longitude.trim() === '') return '位置情報の緯度と経度を入力してください'
      const lat = Number(v.latitude)
      const lng = Number(v.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '位置情報の緯度と経度を数で入力してください'
      // R210: 地図上に無い数字も完成扱いにしない。文言は locationRangeError と同じ。
      return locationRangeError(v) || null
    }
    case 'video': {
      const v = state.video
      if (!v.originalContentUrl.trim() || !v.previewImageUrl.trim()) return '動画のURLとサムネイル画像のURLを入力してください'
      return null
    }
    case 'audio': {
      const v = state.audio
      const url = v.originalContentUrl.trim()
      // LINE は https で公開された音声しか受けない。not-a-url のような値は
      // 保存できても送信で断られるので、書いた時点で止める。
      if (!url) return '音声のURLを入力してください'
      if (!url.toLowerCase().startsWith('https://')) return '音声のURLは https:// から始めてください'
      const duration = Number(v.duration)
      if (v.duration.trim() === '' || !Number.isFinite(duration) || duration <= 0) {
        return '音声の長さ（秒）を 0 より大きい数で入力してください'
      }
      return null
    }
    case 'sticker': {
      const v = state.sticker
      const packageId = v.packageId.trim()
      const stickerId = v.stickerId.trim()
      if (!packageId || !stickerId) return 'スタンプを選んでください'
      // LINE の番号はどちらも数字だけ。not-a-package のような文字は
      // 保存できても送信で断られるので、書いた時点で止める。
      if (!/^\d+$/.test(packageId) || !/^\d+$/.test(stickerId)) {
        return 'スタンプの番号が正しくありません。一覧から選び直してください'
      }
      return null
    }
  }
}

/**
 * 入力欄の値を、配信側が読む形の JSON にする。
 *
 * 足りない・送れないものがあれば null。呼ぶ側は「まだ書けていない」として扱う。
 * 判定は messageKindProblem と同じ（別々に書くと、帯は済みなのに保存で
 * 断られる形になる。broadcast-form.tsx の bubblesError と同じ考え）。
 * 範囲外の緯度・経度も null（R210。地図上に無い数字を完成扱いにしない）。
 */
export function serializeMessageKind(kind: MessageKind, state: MessageKindState): string | null {
  switch (kind) {
    case 'location': {
      if (messageKindProblem(kind, state)) return null
      const v = state.location
      return JSON.stringify({
        title: v.title.trim() || '場所',
        address: v.address.trim(),
        latitude: Number(v.latitude),
        longitude: Number(v.longitude),
      })
    }
    case 'video': {
      if (messageKindProblem(kind, state)) return null
      const v = state.video
      // LINE はサムネイルも必須。片方だけでは送れない。
      return JSON.stringify({
        originalContentUrl: v.originalContentUrl.trim(),
        previewImageUrl: v.previewImageUrl.trim(),
      })
    }
    case 'audio': {
      if (messageKindProblem(kind, state)) return null
      const v = state.audio
      return JSON.stringify({
        originalContentUrl: v.originalContentUrl.trim(),
        // 画面は秒で聞き、LINEはミリ秒で受ける。
        duration: Math.round(Number(v.duration) * 1000),
      })
    }
    case 'sticker': {
      if (messageKindProblem(kind, state)) return null
      const v = state.sticker
      return JSON.stringify({ packageId: v.packageId.trim(), stickerId: v.stickerId.trim() })
    }
  }
}

/*
 * 送れるスタンプ。
 *
 * Messaging API から送れるのは LINE が公開している**基本スタンプだけ**。
 * 買ったスタンプやクリエイターズスタンプは送れない。番号を手で入れさせると
 * 送れないものを入れてしまうので、送れるものから選ばせる。
 *
 * 番号は LINE の「送信可能なスタンプ一覧」に載っているもの。
 */
const BASIC_STICKERS: { packageId: string; stickerId: string; label: string }[] = [
  { packageId: '446', stickerId: '1988', label: 'にっこり' },
  { packageId: '446', stickerId: '1989', label: 'うれしい' },
  { packageId: '446', stickerId: '1990', label: 'ありがとう' },
  { packageId: '446', stickerId: '1991', label: 'よろしく' },
  { packageId: '446', stickerId: '1992', label: 'おねがい' },
  { packageId: '446', stickerId: '1993', label: 'なるほど' },
  { packageId: '446', stickerId: '2000', label: 'ごめんなさい' },
  { packageId: '446', stickerId: '2001', label: 'びっくり' },
  { packageId: '789', stickerId: '10855', label: 'OK' },
  { packageId: '789', stickerId: '10856', label: 'はい' },
  { packageId: '789', stickerId: '10857', label: 'いいね' },
  { packageId: '789', stickerId: '10877', label: 'おつかれさま' },
]

/*
 * LINE が配っているスタンプ画像。選ぶときの目印に使う。
 *
 * **スタンプによって置き場所が違う。** 446 番台は android/sticker.png、
 * 789 番台は iPhone/sticker@2x.png でしか取れない（検証環境で1枚ずつ
 * 確かめた）。どちらか片方に決め打つと、半分が壊れた画像になる。
 *
 * 片方で取れなければもう片方に切り替える。それでも取れなければ、
 * 壊れた画像ではなく文字を出す（下の StickerThumb）。
 */
const STICKER_IMAGE_PATHS = ['android/sticker.png', 'iPhone/sticker@2x.png'] as const

function stickerImageUrl(stickerId: string, attempt: number): string {
  const path = STICKER_IMAGE_PATHS[attempt] ?? STICKER_IMAGE_PATHS[0]
  return `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/${path}`
}

/** スタンプ1枚の絵。取れなければ名前だけ出す。 */
function StickerThumb({ stickerId, label }: { stickerId: string; label: string }) {
  const [attempt, setAttempt] = useState(0)
  const failed = attempt >= STICKER_IMAGE_PATHS.length

  if (failed) {
    return (
      <span className="text-ink-secondary flex h-12 w-12 items-center justify-center text-center text-nano leading-tight">
        {label}
      </span>
    )
  }
  return (
    // 目印なので次の最適化には載せない。
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={stickerImageUrl(stickerId, attempt)}
      alt={label}
      className="h-12 w-12"
      onError={() => setAttempt((n) => n + 1)}
    />
  )
}

const inputClass =
  'border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none'
const labelClass = 'text-ink-secondary mb-1 block text-xs font-medium'
const hintClass = 'text-ink-faint mt-1 text-xs leading-relaxed'

/**
 * 保存されている JSON を入力欄の形に戻す。
 *
 * 編集で開いたときに欄が空だと、書き直しになる。読めない値は無視して
 * 空欄のままにする（壊れた値を欄に出すと、保存し直したときに壊れたまま残る）。
 */
export function parseMessageKind(
  kind: MessageKind,
  content: string | null | undefined,
): MessageKindState {
  const state = emptyMessageKindState()
  if (!content) return state
  let raw: Record<string, unknown>
  try {
    const parsed = JSON.parse(content) as unknown
    if (typeof parsed !== 'object' || parsed === null) return state
    raw = parsed as Record<string, unknown>
  } catch {
    return state
  }
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')

  switch (kind) {
    case 'location':
      state.location = {
        title: str(raw.title),
        address: str(raw.address),
        latitude: str(raw.latitude),
        longitude: str(raw.longitude),
      }
      return state
    case 'video':
      state.video = {
        originalContentUrl: str(raw.originalContentUrl),
        previewImageUrl: str(raw.previewImageUrl),
      }
      return state
    case 'audio': {
      // 保存はミリ秒、画面は秒。
      const ms = Number(raw.duration)
      state.audio = {
        originalContentUrl: str(raw.originalContentUrl),
        duration: Number.isFinite(ms) && ms > 0 ? String(ms / 1000) : '',
      }
      return state
    }
    case 'sticker':
      state.sticker = { packageId: str(raw.packageId), stickerId: str(raw.stickerId) }
      return state
  }
}

export interface MessageKindFieldsProps {
  composer?: boolean
  kind: MessageKind
  value: MessageKindState
  onChange: (next: MessageKindState) => void
  /**
   * 動画・音声・プレビュー画像を入れる先（登録メディア）のアカウント。
   * 省く・null（統括など、どの店にも属さない）はファイルを受け取らず URL だけ。
   */
  mediaAccountId?: string | null
}

/** 音声ファイルの長さ（秒）。読めなければ空。 */
async function readDurationSeconds(file: File): Promise<string> {
  const { durationMs } = await extractMediaMetadata(file)
  return durationMs && durationMs > 0 ? String(durationMs / 1000) : ''
}

export default function MessageKindFields({ kind, value, onChange, composer = false, mediaAccountId }: MessageKindFieldsProps) {
  const [stickerMode, setStickerMode] = useState<'pick' | 'manual'>('pick')
  const pickFrom = mediaAccountId ?? null
  const [picking, setPicking] = useState<{ kind: MediaItem['kind']; apply: (url: string, item?: MediaItem) => void } | null>(null)
  /** 長さをファイル・登録メディアから読んで入れたか（読めたら手で入れる欄は出さない）。 */
  const [autoDuration, setAutoDuration] = useState(false)
  /** 取り込んだ音声から読んだ長さ。返った URL と一緒に入れる。 */
  const readDuration = useRef('')
  /** 登録メディアへ入れる送り先。アカウントが無ければ渡さない（URL だけの形）。 */
  const upload = (mediaKind: MediaItem['kind']) =>
    pickFrom
      ? async (file: File, progress: (percent: number) => void) => (await uploadToMediaLibrary(file, pickFrom, mediaKind, progress)).url
      : undefined
  const picker = (
    <MediaPickerDialog
      open={picking !== null}
      accountId={pickFrom}
      kind={picking?.kind}
      onClose={() => setPicking(null)}
      onSelect={(item) => {
        picking?.apply(item.url, item)
        setPicking(null)
      }}
    />
  )

  if (composer && kind === 'sticker') return <ComposerStickers value={value.sticker} onChange={(sticker) => onChange({ ...value, sticker })} />

  if (kind === 'location') {
    const v = value.location
    const set = (patch: Partial<MessageKindState['location']>) =>
      onChange({ ...value, location: { ...v, ...patch } })
    return (
      <div className="space-y-3">
        <label className="block">
          <span className={labelClass}>見出し</span>
          <SaveErrorField names={["title","v.title"]}><input
            value={v.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="例：本店"
            className={inputClass}
          /></SaveErrorField>
        </label>
        <label className="block">
          <span className={labelClass}>住所</span>
          <SaveErrorField names={["address","v.address"]}><input
            value={v.address}
            onChange={(e) => set({ address: e.target.value })}
            placeholder="例：東京都渋谷区〇〇1-2-3"
            className={inputClass}
          /></SaveErrorField>
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="min-w-0 flex-1">
            <span className={labelClass}>
              緯度 <span className="text-danger">*</span>
            </span>
            <SaveErrorField names={["latitude","v.latitude"]}><input
              value={v.latitude}
              onChange={(e) => set({ latitude: e.target.value })}
              inputMode="decimal"
              placeholder="35.658034"
              className={inputClass}
            /></SaveErrorField>
          </label>
          <label className="min-w-0 flex-1">
            <span className={labelClass}>
              経度 <span className="text-danger">*</span>
            </span>
            <SaveErrorField names={["longitude","v.longitude"]}><input
              value={v.longitude}
              onChange={(e) => set({ longitude: e.target.value })}
              inputMode="decimal"
              placeholder="139.701636"
              className={inputClass}
            /></SaveErrorField>
          </label>
        </div>
        <p className={hintClass}>
          緯度と経度は、Googleマップで場所を右クリックすると出る数字です（左が緯度、右が経度）。
          緯度は-90〜90、経度は-180〜180の範囲で入力してください。
        </p>
      </div>
    )
  }

  if (kind === 'video') {
    const v = value.video
    const set = (patch: Partial<MessageKindState['video']>) =>
      onChange({ ...value, video: { ...v, ...patch } })
    return (
      <div className="space-y-3">
        <div className={styles.videoRow}>
          <SaveErrorField names={["originalContentUrl","v.originalContentUrl","original_content_url","previewImageUrl","v.original_content_url"]}><MediaSlot
            kind="video"
            title="動画を追加"
            value={v.originalContentUrl || null}
            accept="video/mp4"
            maxBytes={200 * 1024 * 1024}
            upload={upload('video')}
            onChange={(url) => set({ originalContentUrl: url ?? '' })}
            onMediaPick={pickFrom ? () => setPicking({ kind: 'video', apply: (url) => set({ originalContentUrl: url }) }) : undefined}
            urlEntry={{ value: v.originalContentUrl, onChange: (url) => set({ originalContentUrl: url }), label: '動画のURL', placeholder: 'https://…/movie.mp4' }}
          /></SaveErrorField>
          <SaveErrorField names={["previewImageUrl","v.previewImageUrl","preview_image_url","v.preview_image_url"]}><MediaSlot
            size="compact"
            title="プレビュー画像を追加"
            previewAlt="動画のプレビュー画像"
            value={v.previewImageUrl || null}
            accept="image/jpeg,image/png"
            maxBytes={1024 * 1024}
            upload={upload('image')}
            onChange={(url) => set({ previewImageUrl: url ?? '' })}
            onMediaPick={pickFrom ? () => setPicking({ kind: 'image', apply: (url) => set({ previewImageUrl: url }) }) : undefined}
            urlEntry={{ value: v.previewImageUrl, onChange: (url) => set({ previewImageUrl: url }), label: 'サムネイル画像のURL', placeholder: 'https://…/thumbnail.jpg' }}
          /></SaveErrorField>
        </div>
        <p className={hintClass}>
          動画は mp4・200MBまで。プレビュー画像（JPEG / PNG・1MBまで）は LINE 側で必須なので、無いと送れません。
        </p>
        {picker}
      </div>
    )
  }

  if (kind === 'audio') {
    const v = value.audio
    const set = (patch: Partial<MessageKindState['audio']>) =>
      onChange({ ...value, audio: { ...v, ...patch } })
    const uploadAudio = upload('audio')
    return (
      <div className="space-y-3">
        <SaveErrorField names={["originalContentUrl","v.originalContentUrl","autoDuration","original_content_url","previewImageUrl","v.original_content_url","auto_duration"]}><MediaSlot
          kind="audio"
          title="音声を追加"
          value={v.originalContentUrl || null}
          valueName={v.originalContentUrl.split('/').pop() || v.originalContentUrl}
          accept="audio/mp4,.m4a"
          maxBytes={200 * 1024 * 1024}
          limitText="1ファイル200メガバイト以内・M4A"
          upload={uploadAudio ? async (file, progress) => {
            // 長さはファイルから読む。読めたら URL と一緒に入れ、手で入れる欄は出さない。
            const seconds = await readDurationSeconds(file)
            const url = await uploadAudio(file, progress)
            readDuration.current = seconds
            return url
          } : undefined}
          onChange={(url) => {
            const seconds = readDuration.current
            readDuration.current = ''
            setAutoDuration(Boolean(url && seconds))
            set(url && seconds ? { originalContentUrl: url, duration: seconds } : { originalContentUrl: url ?? '' })
          }}
          onMediaPick={pickFrom ? () => setPicking({ kind: 'audio', apply: (url: string, item?: MediaItem) => {
            const ms = item?.durationMs
            setAutoDuration(Boolean(ms && ms > 0))
            set(ms && ms > 0 ? { originalContentUrl: url, duration: String(ms / 1000) } : { originalContentUrl: url })
          } }) : undefined}
          urlEntry={{ value: v.originalContentUrl, onChange: (url) => { setAutoDuration(false); set({ originalContentUrl: url }) }, label: '音声のURL', placeholder: 'https://…/voice.m4a' }}
        /></SaveErrorField>
        <p className={hintClass}>m4a、200MBまで。URL で入れるときは https で公開されている必要があります。</p>
        {autoDuration && v.duration ? (
          <p className={hintClass}>
            {`長さ ${v.duration} 秒（ファイルから読みました）`}{' '}
            <button type="button" className="text-action font-semibold" onClick={() => setAutoDuration(false)}>直す</button>
          </p>
        ) : v.originalContentUrl ? (
          <label className="block">
            <span className={labelClass}>
              長さ（秒） <span className="text-danger">*</span>
            </span>
            <SaveErrorField names={["duration","v.duration"]}><input
              value={v.duration}
              onChange={(e) => set({ duration: e.target.value })}
              inputMode="decimal"
              placeholder="30"
              className={`${inputClass} max-w-40`}
            /></SaveErrorField>
            <span className={hintClass}>
              ファイルから長さを読めなかったときに入れます。実際の長さと合っていないと、再生の途中で切れたり、伸びたまま止まったりします。
            </span>
          </label>
        ) : null}
        {picker}
      </div>
    )
  }

  const v = value.sticker
  const set = (patch: Partial<MessageKindState['sticker']>) =>
    onChange({ ...value, sticker: { ...v, ...patch } })
  const selected = BASIC_STICKERS.find(
    (s) => s.packageId === v.packageId && s.stickerId === v.stickerId,
  )

  return (
    <div className="space-y-3">
      <p className={hintClass}>
        送れるのは LINE の基本スタンプだけです。買ったスタンプやクリエイターズスタンプは、
        LINE側の決まりで送れません。
      </p>

      <SaveErrorField names={["stickerMode","value","o.value"]}><RadioCardGroup legend="スタンプの決め方" className="flex flex-wrap gap-4">
        {(
          [
            { value: 'pick' as const, label: '一覧から選ぶ' },
            { value: 'manual' as const, label: '番号を直接入れる' },
          ]
        ).map((o) => (
          <RadioCard
            key={o.value}
            name="stickerMode"
            value={o.value}
            checked={stickerMode === o.value}
            onChange={() => setStickerMode(o.value)}
            title={o.label}
          />
        ))}
      </RadioCardGroup></SaveErrorField>

      {stickerMode === 'pick' ? (
        <div className="flex flex-wrap gap-2">
          {BASIC_STICKERS.map((s) => {
            const on = s.packageId === v.packageId && s.stickerId === v.stickerId
            return (
              <Button variant="secondary" className={(`rounded-card border p-1.5 transition-colors ${
                  on ? 'border-accent bg-accent-soft' : 'border-hairline hover:bg-canvas-sunken'
                }`) + ' h-auto whitespace-normal'} key={`${s.packageId}-${s.stickerId}`} type="button" onClick={() => set({ packageId: s.packageId, stickerId: s.stickerId })} title={s.label} aria-pressed={on}>
                <StickerThumb stickerId={s.stickerId} label={s.label} />
              </Button>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <label className="min-w-0 flex-1">
            <span className={labelClass}>
              パッケージID <span className="text-danger">*</span>
            </span>
            <SaveErrorField names={["packageId","v.packageId","package_id","v.package_id"]}><input
              value={v.packageId}
              onChange={(e) => set({ packageId: e.target.value })}
              inputMode="numeric"
              placeholder="446"
              className={inputClass}
            /></SaveErrorField>
          </label>
          <label className="min-w-0 flex-1">
            <span className={labelClass}>
              スタンプID <span className="text-danger">*</span>
            </span>
            <SaveErrorField names={["stickerId","v.stickerId","sticker_id","v.sticker_id"]}><input
              value={v.stickerId}
              onChange={(e) => set({ stickerId: e.target.value })}
              inputMode="numeric"
              placeholder="1988"
              className={inputClass}
            /></SaveErrorField>
          </label>
        </div>
      )}

      {v.packageId && v.stickerId && (
        <p className="text-ink-secondary text-xs">
          選択中：{selected ? selected.label : `パッケージ ${v.packageId} / スタンプ ${v.stickerId}`}
        </p>
      )}
    </div>
  )
}
