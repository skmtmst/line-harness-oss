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

import { PREFECTURES, type FormBlock, type FormLayout } from '@line-crm/shared'

function Label({ text, required }: { text: string; required?: boolean }) {
  return (
    <p className="text-ink text-sm font-medium">
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

function PreviewBlock({ block }: { block: FormBlock }) {
  if (block.kind === 'heading') {
    const size = block.level === 1 ? 'text-lg' : block.level === 3 ? 'text-sm' : 'text-base'
    return (
      <div>
        <p className={`text-ink font-bold ${size}`}>{block.text || '（見出し）'}</p>
        <span className="bg-accent mt-1 block h-0.5 w-10 rounded-pill" />
      </div>
    )
  }

  if (block.kind === 'text') {
    return (
      <p className="text-ink-secondary text-xs leading-relaxed whitespace-pre-wrap">
        {block.text || '（本文）'}
      </p>
    )
  }

  if (block.kind === 'image') {
    return block.mediaUrl ? (
      // 外部URLをそのまま出すため next/image は使わない（プレビュー用途）
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={block.mediaUrl}
        alt=""
        className={`rounded-control ${block.size === 'full' ? 'w-full' : 'mx-auto max-w-[70%]'}`}
      />
    ) : (
      <div className="border-hairline text-ink-faint rounded-control border border-dashed py-6 text-center text-xs">
        画像のURLを入れると、ここに出ます
      </div>
    )
  }

  if (block.kind === 'button') {
    return (
      <div
        className={`rounded-control py-2 text-center text-sm font-medium ${
          block.style === 'outline'
            ? 'border-accent text-accent border'
            : 'bg-accent-deep text-on-accent'
        }`}
      >
        {block.label || '（ボタン）'}
      </div>
    )
  }

  if (block.hidden) return null

  const choices = block.choices ?? []

  return (
    <div>
      <Label text={block.label} required={block.required} />
      {block.description && (
        <p className="text-ink-faint mt-0.5 text-[11px]">{block.description}</p>
      )}

      {block.type === 'textarea' && <Box>{block.placeholder}</Box>}
      {block.type === 'text' && <Box>{block.placeholder}</Box>}
      {block.type === 'date' && <Box>日付を選択</Box>}
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
          {choices.map((choice) => (
            <span
              key={choice.id}
              className="text-ink-secondary flex items-center gap-1.5 text-xs"
            >
              <span
                className={`border-hairline inline-block h-3 w-3 border ${
                  block.type === 'radio' ? 'rounded-pill' : 'rounded-[3px]'
                } ${choice.defaultSelected ? 'bg-accent border-accent' : 'bg-canvas'}`}
              />
              {choice.label}
              {choice.capacity?.enabled && (
                <span className="text-ink-faint">（先着{choice.capacity.limit}名）</span>
              )}
            </span>
          ))}
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
  const isLast = sectionIndex >= layout.sections.length - 1

  return (
    <div className="bg-canvas-sunken rounded-card border-hairline border p-4">
      {/* スマホの幅で出す。友だちが見るのはLINEの中なので、PCの幅で
          確認すると1行の長さの感覚がずれる。 */}
      <div className="bg-canvas rounded-card border-hairline mx-auto max-w-[22rem] space-y-4 border p-4">
        {multi && options.sectionHeader !== 'none' && (
          <div className="flex items-center justify-center gap-2">
            {layout.sections.map((s, i) => (
              <span
                key={s.id}
                className={`text-xs tabular-nums ${
                  i === sectionIndex ? 'text-accent font-bold' : 'text-ink-faint'
                }`}
              >
                {options.sectionHeader === 'name' ? s.name : i + 1}
              </span>
            ))}
          </div>
        )}

        {layout.header.map((block) => (
          <PreviewBlock key={block.id} block={block} />
        ))}

        {(section?.blocks ?? []).map((block) => (
          <PreviewBlock key={block.id} block={block} />
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
          <div className="bg-accent-deep text-on-accent rounded-control flex-1 py-2 text-center text-sm font-medium">
            {isLast ? options.submitLabel || '送信' : options.nextLabel || '次へ'}
          </div>
        </div>
      </div>
    </div>
  )
}
