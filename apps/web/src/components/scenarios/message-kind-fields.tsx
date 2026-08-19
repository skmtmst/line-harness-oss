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

import { useState } from 'react'

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
 * 入力欄の値を、配信側が読む形の JSON にする。
 *
 * 足りないものがあれば null。呼ぶ側は「まだ書けていない」として扱う。
 */
export function serializeMessageKind(kind: MessageKind, state: MessageKindState): string | null {
  switch (kind) {
    case 'location': {
      const v = state.location
      const lat = Number(v.latitude)
      const lng = Number(v.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      if (v.latitude.trim() === '' || v.longitude.trim() === '') return null
      return JSON.stringify({
        title: v.title.trim() || '場所',
        address: v.address.trim(),
        latitude: lat,
        longitude: lng,
      })
    }
    case 'video': {
      const v = state.video
      // LINE はサムネイルも必須。片方だけでは送れない。
      if (!v.originalContentUrl.trim() || !v.previewImageUrl.trim()) return null
      return JSON.stringify({
        originalContentUrl: v.originalContentUrl.trim(),
        previewImageUrl: v.previewImageUrl.trim(),
      })
    }
    case 'audio': {
      const v = state.audio
      const duration = Number(v.duration)
      if (!v.originalContentUrl.trim()) return null
      if (!Number.isFinite(duration) || duration <= 0) return null
      return JSON.stringify({
        originalContentUrl: v.originalContentUrl.trim(),
        // 画面は秒で聞き、LINEはミリ秒で受ける。
        duration: Math.round(duration * 1000),
      })
    }
    case 'sticker': {
      const v = state.sticker
      if (!v.packageId.trim() || !v.stickerId.trim()) return null
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

/** LINE が配っているスタンプ画像。選ぶときの目印に使う。 */
function stickerImageUrl(stickerId: string): string {
  return `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/iPhone/sticker@2x.png`
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
  kind: MessageKind
  value: MessageKindState
  onChange: (next: MessageKindState) => void
}

export default function MessageKindFields({ kind, value, onChange }: MessageKindFieldsProps) {
  const [stickerMode, setStickerMode] = useState<'pick' | 'manual'>('pick')

  if (kind === 'location') {
    const v = value.location
    const set = (patch: Partial<MessageKindState['location']>) =>
      onChange({ ...value, location: { ...v, ...patch } })
    return (
      <div className="space-y-3">
        <label className="block">
          <span className={labelClass}>見出し</span>
          <input
            value={v.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="例：然-NEN- 本店"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>住所</span>
          <input
            value={v.address}
            onChange={(e) => set({ address: e.target.value })}
            placeholder="例：東京都渋谷区〇〇1-2-3"
            className={inputClass}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="min-w-0 flex-1">
            <span className={labelClass}>
              緯度 <span className="text-danger">*</span>
            </span>
            <input
              value={v.latitude}
              onChange={(e) => set({ latitude: e.target.value })}
              inputMode="decimal"
              placeholder="35.658034"
              className={inputClass}
            />
          </label>
          <label className="min-w-0 flex-1">
            <span className={labelClass}>
              経度 <span className="text-danger">*</span>
            </span>
            <input
              value={v.longitude}
              onChange={(e) => set({ longitude: e.target.value })}
              inputMode="decimal"
              placeholder="139.701636"
              className={inputClass}
            />
          </label>
        </div>
        <p className={hintClass}>
          緯度と経度は、Googleマップで場所を右クリックすると出る数字です（左が緯度、右が経度）。
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
        <label className="block">
          <span className={labelClass}>
            動画のURL <span className="text-danger">*</span>
          </span>
          <input
            value={v.originalContentUrl}
            onChange={(e) => set({ originalContentUrl: e.target.value })}
            placeholder="https://…/movie.mp4"
            className={inputClass}
          />
          <span className={hintClass}>mp4、200MBまで。https で公開されている必要があります。</span>
        </label>
        <label className="block">
          <span className={labelClass}>
            サムネイル画像のURL <span className="text-danger">*</span>
          </span>
          <input
            value={v.previewImageUrl}
            onChange={(e) => set({ previewImageUrl: e.target.value })}
            placeholder="https://…/thumbnail.jpg"
            className={inputClass}
          />
          <span className={hintClass}>
            JPEG / PNG、1MBまで。LINE側で必須なので、無いと送れません。
          </span>
        </label>
      </div>
    )
  }

  if (kind === 'audio') {
    const v = value.audio
    const set = (patch: Partial<MessageKindState['audio']>) =>
      onChange({ ...value, audio: { ...v, ...patch } })
    return (
      <div className="space-y-3">
        <label className="block">
          <span className={labelClass}>
            音声のURL <span className="text-danger">*</span>
          </span>
          <input
            value={v.originalContentUrl}
            onChange={(e) => set({ originalContentUrl: e.target.value })}
            placeholder="https://…/voice.m4a"
            className={inputClass}
          />
          <span className={hintClass}>m4a、200MBまで。https で公開されている必要があります。</span>
        </label>
        <label className="block">
          <span className={labelClass}>
            長さ（秒） <span className="text-danger">*</span>
          </span>
          <input
            value={v.duration}
            onChange={(e) => set({ duration: e.target.value })}
            inputMode="decimal"
            placeholder="30"
            className={`${inputClass} max-w-40`}
          />
          <span className={hintClass}>
            実際の長さと合っていないと、再生の途中で切れたり、伸びたまま止まったりします。
          </span>
        </label>
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

      <div className="flex flex-wrap gap-4">
        {(
          [
            { value: 'pick' as const, label: '一覧から選ぶ' },
            { value: 'manual' as const, label: '番号を直接入れる' },
          ]
        ).map((o) => (
          <label key={o.value} className="text-ink flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="stickerMode"
              checked={stickerMode === o.value}
              onChange={() => setStickerMode(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>

      {stickerMode === 'pick' ? (
        <div className="flex flex-wrap gap-2">
          {BASIC_STICKERS.map((s) => {
            const on = s.packageId === v.packageId && s.stickerId === v.stickerId
            return (
              <button
                key={`${s.packageId}-${s.stickerId}`}
                type="button"
                onClick={() => set({ packageId: s.packageId, stickerId: s.stickerId })}
                title={s.label}
                aria-pressed={on}
                className={`rounded-card border p-1.5 transition-colors ${
                  on ? 'border-accent bg-accent-soft' : 'border-hairline hover:bg-canvas-sunken'
                }`}
              >
                {/* 目印なので次の最適化には載せない。 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={stickerImageUrl(s.stickerId)} alt={s.label} className="h-12 w-12" />
              </button>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <label className="min-w-0 flex-1">
            <span className={labelClass}>
              パッケージID <span className="text-danger">*</span>
            </span>
            <input
              value={v.packageId}
              onChange={(e) => set({ packageId: e.target.value })}
              inputMode="numeric"
              placeholder="446"
              className={inputClass}
            />
          </label>
          <label className="min-w-0 flex-1">
            <span className={labelClass}>
              スタンプID <span className="text-danger">*</span>
            </span>
            <input
              value={v.stickerId}
              onChange={(e) => set({ stickerId: e.target.value })}
              inputMode="numeric"
              placeholder="1988"
              className={inputClass}
            />
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
