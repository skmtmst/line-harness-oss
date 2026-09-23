'use client'

/**
 * 回答画面のプレビュー。
 *
 * 友だちが実際に見る画面を、編集中のまま横に出す。ブロックの並び替えや
 * 必須の付け外しは、出来上がりを見ないと判断できない。
 *
 * ここは**見た目だけ**で、押しても何も起きない。入力を受け付けると、
 * 「プレビューで入れた値が保存されるのか」という誤解を生む。
 */

import { useEffect, useState } from 'react'
import {
  PREFECTURES,
  formThemeButtonText,
  normalizeFormTheme,
  type FormBlock,
  type FormLayout,
  type FormTheme,
} from '@line-crm/shared'

function Label({ text, required, theme }: { text: string; required?: boolean; theme: FormTheme }) {
  return (
    <p className="text-sm font-medium" style={{ color: theme.text }}>
      {text || '（タイトル未設定）'}
      {required && (
        <span className="bg-danger-bg text-danger rounded-pill ml-1.5 px-1.5 py-0.5 text-[10px]">
          必須
        </span>
      )}
    </p>
  )
}

/** 入力欄の枠だけを描く。中身は入らない。 */
function Box({ children }: { children?: React.ReactNode }) {
  return (
    <div className="border-hairline bg-canvas text-ink-faint rounded-control mt-1 border px-3 py-2 text-xs">
      {children ?? <span>&nbsp;</span>}
    </div>
  )
}

/**
 * 画像ブロックのプレビュー。
 *
 * URLが無い・読み込み中・読み込み失敗を分けて出す。失敗したときに
 * 画像が消えるだけだと、URLの間違いに気付かないまま保存してしまう。
 */
function PreviewImage({ block }: { block: FormBlock & { kind: 'image' } }) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  useEffect(() => setStatus('loading'), [block.mediaUrl])

  if (!block.mediaUrl) {
    return (
      <div className="border-hairline text-ink-faint rounded-control border border-dashed py-6 text-center text-xs">
        画像のURLを入れると、ここに出ます
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="border-hairline rounded-control border border-dashed py-4 text-center text-xs">
        <p className="text-danger">画像を読み込めませんでした。URLを確認してください。</p>
        <button
          type="button"
          onClick={() => setStatus('loading')}
          className="text-accent-deep mt-1 underline"
        >
          再試行
        </button>
      </div>
    )
  }
  return (
    <div>
      {status === 'loading' && (
        <p className="text-ink-faint mb-1 text-center text-[11px]">画像を読み込んでいます</p>
      )}
      {/* 外部URLをそのまま出すため next/image は使わない（プレビュー用途） */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={block.mediaUrl}
        alt=""
        onLoad={() => setStatus('ok')}
        onError={() => setStatus('error')}
        className={`rounded-control ${block.size === 'full' ? 'w-full' : 'mx-auto max-w-[70%]'}`}
      />
    </div>
  )
}

function PreviewBlock({ block, theme }: { block: FormBlock; theme: FormTheme }) {
  if (block.kind === 'heading') {
    const size = block.level === 1 ? 'text-lg' : block.level === 3 ? 'text-sm' : 'text-base'
    return (
      <div>
        <p className={`font-bold ${size}`} style={{ color: theme.text }}>{block.text || '（見出し）'}</p>
        <span className="mt-1 block h-0.5 w-10 rounded-pill" style={{ backgroundColor: theme.main }} />
      </div>
    )
  }

  if (block.kind === 'text') {
    return (
      <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: theme.text }}>
        {block.text || '（本文）'}
      </p>
    )
  }

  if (block.kind === 'image') {
    return <PreviewImage block={block} />
  }

  if (block.kind === 'button') {
    return (
      <div
        className="border py-2 text-center text-sm font-medium"
        style={{
          borderColor: theme.main,
          borderRadius: radiusOf(theme),
          backgroundColor: block.style === 'outline' ? 'transparent' : theme.main,
          color: block.style === 'outline' ? theme.main : formThemeButtonText(theme),
        }}
      >
        {block.label || '（ボタン）'}
      </div>
    )
  }

  if (block.hidden) return null

  const choices = block.choices ?? []

  return (
    <div>
      <Label text={block.label} required={block.required} theme={theme} />
      {block.description && (
        <p className="text-ink-faint mt-0.5 text-[11px]">{block.description}</p>
      )}

      {block.type === 'textarea' && <Box>{block.placeholder}</Box>}
      {block.type === 'text' && <Box>{block.placeholder}</Box>}
      {block.type === 'date' &&
        (block.dateStyle === 'ymd' ? <Box>年＿＿＿ 月＿＿ 日＿＿</Box> : <Box>日付を選択</Box>)}
      {block.type === 'file' && <Box>ファイルを選択</Box>}
      {block.type === 'prefecture' && <Box>{PREFECTURES[12]} など</Box>}
      {block.type === 'select' && (
        <Box>{choices.length ? choices.map((c) => c.label).join(' / ') : '選んでください'}</Box>
      )}

      {(block.type === 'radio' || block.type === 'checkbox') && (
        <div className={`mt-1 gap-2 ${block.inline ? 'flex flex-wrap' : 'space-y-1'}`}>
          {choices.length === 0 && (
            <p className="text-ink-faint text-xs">選択肢がまだありません</p>
          )}
          {choices.map((choice, choiceIndex) => {
            // ラジオは選べるのが1つだけ。初期選択が複数残っていても
            // プレビューでは先頭の1つだけを塗る（回答画面と同じ見え方）。
            const firstDefaultIndex =
              block.type === 'radio' ? choices.findIndex((c) => c.defaultSelected) : -1
            const selected =
              block.type === 'checkbox'
                ? (choice.defaultSelected ?? false)
                : choiceIndex === firstDefaultIndex
            return (
              <span
                key={choice.id}
                className="flex items-center gap-1.5 text-xs"
                style={{ color: theme.text }}
              >
                <span
                  className={`border-hairline inline-block h-3 w-3 border ${
                    block.type === 'radio' ? 'rounded-pill' : 'rounded-[3px]'
                  } ${selected ? '' : 'bg-canvas'}`}
                  style={selected ? { backgroundColor: theme.main, borderColor: theme.main } : undefined}
                />
                {choice.label}
                {choice.isOther && (
                  <span className="border-hairline bg-canvas text-ink-faint inline-block w-16 border-b text-[10px] leading-4">
                    自由記入
                  </span>
                )}
                {choice.capacity?.enabled && (
                  <span className="text-ink-faint">（先着{choice.capacity.limit}名）</span>
                )}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function FormPreview({
  layout,
  sectionIndex,
}: {
  layout: FormLayout
  /** 編集中のセクション。プレビューもそこを出す */
  sectionIndex: number
}) {
  const section = layout.sections[sectionIndex] ?? layout.sections[0]
  const multi = layout.sections.length > 1
  const options = layout.options ?? {}
  const theme = normalizeFormTheme(options.theme)
  const isLast = sectionIndex >= layout.sections.length - 1

  return (
    <div
      className="rounded-card border-hairline border p-4"
      style={{
        backgroundColor: theme.sub,
        backgroundImage: theme.backgroundImageUrl ? `url(${theme.backgroundImageUrl})` : undefined,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
      }}
    >
      {/* スマホの幅で出す。友だちが見るのはLINEの中なので、PCの幅で
          確認すると1行の長さの感覚がずれる。 */}
      <div
        className="bg-canvas border-hairline mx-auto max-w-[22rem] space-y-4 border p-4"
        style={{
          color: theme.text,
          borderRadius: radiusOf(theme),
          fontFamily: theme.fontFamily === 'serif' ? 'serif' : 'sans-serif',
        }}
      >
        {multi && options.sectionHeader !== 'none' && (
          <div className="flex items-center justify-center gap-2">
            {layout.sections.map((s, i) => (
              <span
                key={s.id}
                className={`text-xs tabular-nums ${
                  i === sectionIndex ? 'font-bold' : 'text-ink-faint'
                }`}
                style={i === sectionIndex ? { color: theme.main } : undefined}
              >
                {options.sectionHeader === 'name' ? s.name : i + 1}
              </span>
            ))}
          </div>
        )}

        {layout.header.map((block) => (
          <PreviewBlock key={block.id} block={block} theme={theme} />
        ))}

        {(section?.blocks ?? []).map((block) => (
          <PreviewBlock key={block.id} block={block} theme={theme} />
        ))}

        {(section?.blocks ?? []).length === 0 && layout.header.length === 0 && (
          <p className="text-ink-faint py-8 text-center text-xs">
            ブロックを足すと、ここに出ます
          </p>
        )}

        <div className="flex gap-2 pt-2">
          {multi && sectionIndex > 0 && (
            <div className="border-hairline text-ink-secondary rounded-control flex-1 border py-2 text-center text-sm">
              {options.prevLabel || '前へ'}
            </div>
          )}
          <div
            className="flex-1 py-2 text-center text-sm font-medium"
            style={{ backgroundColor: theme.main, color: formThemeButtonText(theme), borderRadius: radiusOf(theme) }}
          >
            {isLast ? options.submitLabel || '送信' : options.nextLabel || '次へ'}
          </div>
        </div>
      </div>
    </div>
  )
}

function radiusOf(theme: FormTheme): string {
  if (theme.cornerRadius === 'none') return '0'
  if (theme.cornerRadius === 'round') return '1rem'
  return '0.5rem'
}
