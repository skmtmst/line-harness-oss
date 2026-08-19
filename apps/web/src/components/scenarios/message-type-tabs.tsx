'use client'

/*
 * 送るものの種別を選ぶタブ。
 *
 * 並びと呼び名は Lステップの「配信内容の設定」に合わせてある。作れないものも
 * **並べたうえで押せなくする**。並びごと消すと「この管理画面ではスタンプを
 * 送れない」ことが分からず、できるはずだと思って探し回ることになる。
 *
 * 押せないものには理由を出す。「まだ」なのか「別の場所でできる」のかで、
 * 次にどうすればいいかが変わる。
 */

/** 送るものの種別。'question' は質問メッセージ（分岐）。 */
export type StepMessageKind =
  | 'text'
  | 'sticker'
  | 'image'
  | 'question'
  | 'carousel'
  | 'location'
  | 'intro'
  | 'audio'
  | 'video'

interface KindDef {
  value: StepMessageKind
  label: string
  /** 押せないときの理由。作れるものは undefined。 */
  disabledReason?: string
}

/**
 * 132 で列を広げ、位置情報・動画・音声・スタンプも送れるようにした。
 *
 * 残るのはカルーセルと紹介。カルーセルはテンプレート側に作成画面があるので、
 * そちらから選ぶ。紹介は LINE に該当する種別が無い。
 */
export const STEP_MESSAGE_KINDS: KindDef[] = [
  { value: 'text', label: 'テキスト' },
  { value: 'sticker', label: 'スタンプ' },
  { value: 'image', label: '画像' },
  { value: 'question', label: '質問' },
  {
    value: 'carousel',
    label: 'カルーセル',
    // テンプレート側にはカルーセルの作成画面がある（/templates/carousel）。
    // 「作れない」ではなく「別の場所で作って選ぶ」なので、そう書く。
    disabledReason:
      'この画面では作れません。「テンプレートから選ぶ」で、カルーセルのテンプレートを選べば送れます。',
  },
  { value: 'location', label: '位置情報' },
  {
    value: 'intro',
    label: '紹介',
    disabledReason:
      '他のLINEアカウントの紹介は、LINE側に該当するメッセージの種別がありません。テキストに友だち追加のURLを書くか、カードタイプのテンプレートにボタンを置いてください。',
  },
  { value: 'audio', label: '音声' },
  { value: 'video', label: '動画' },
]

export function isStepMessageKindAvailable(kind: StepMessageKind): boolean {
  return !STEP_MESSAGE_KINDS.find((k) => k.value === kind)?.disabledReason
}

export interface MessageTypeTabsProps {
  value: StepMessageKind
  onChange: (next: StepMessageKind) => void
  /** タブの下に出すもの（本文の入力欄など）。 */
  children?: React.ReactNode
}

export default function MessageTypeTabs({ value, onChange, children }: MessageTypeTabsProps) {
  const selected = STEP_MESSAGE_KINDS.find((k) => k.value === value)

  return (
    <div>
      {/* 横に9つ並ぶ。狭い画面では折り返す（横スクロールにすると隠れたタブに気づけない）。 */}
      <div role="tablist" className="border-hairline flex flex-wrap gap-1 border-b">
        {STEP_MESSAGE_KINDS.map((kind) => {
          const disabled = Boolean(kind.disabledReason)
          const active = kind.value === value
          return (
            <button
              key={kind.value}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={disabled}
              title={kind.disabledReason}
              onClick={() => !disabled && onChange(kind.value)}
              className={`-mb-px rounded-t-control border border-b-0 px-4 py-2 text-sm transition-colors ${
                active
                  ? 'border-hairline bg-canvas text-ink border-b-canvas font-bold'
                  : disabled
                    ? 'border-transparent text-ink-faint cursor-not-allowed opacity-50'
                    : 'border-transparent text-ink-secondary hover:bg-canvas-sunken'
              }`}
            >
              {kind.label}
            </button>
          )
        })}
      </div>

      {/*
        押せないタブを押したときに何も起きないと、壊れているのか未対応なのかが
        分からない。選ばれている種別の説明を、タブのすぐ下に出しておく。
      */}
      {selected?.disabledReason && (
        <p className="bg-warning-bg text-ink-secondary rounded-card mt-3 px-4 py-3 text-xs">
          {selected.disabledReason}
        </p>
      )}

      <div className="mt-4">{children}</div>
    </div>
  )
}
