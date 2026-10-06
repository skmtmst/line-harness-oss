'use client'

/*
 * 「中身」のタブ（m1cWEy・ITBAB・ijxur・J1pdB・Z9wXm の左の列）。
 * ページの札、ページのブロック（畳んだ行と開いた設定）、ブロックを足す欄。
 */
import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import {
  AlignLeft,
  CalendarCheck,
  ExternalLink,
  Heading,
  HelpCircle,
  Image as ImageIcon,
  MousePointerClick,
  Plus,
  X,
} from 'lucide-react'
import { newBlockId, type FormBlock, type FormInputBlock, type FormLayout } from '@line-crm/shared'
import BlockEditor from '@/components/forms/block-editor'
import type { FormRefs } from '@/components/forms/form-refs'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import { TextArea, TextInput } from '@/components/shared/form-controls'
import { DragHandle, RowActions } from '@/components/shared/row-actions'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { ADD_GROUPS, blockKindLine, blockTitleLine, inputTypeLabel, isChoiceType } from './model'
import MediaPickerDialog from './media-picker'
import styles from './edit.module.css'

type Props = {
  layout: FormLayout
  page: number
  blocks: FormBlock[]
  refs: FormRefs
  selectedBlockId: string | null
  inputCount: number
  accountId: string | null
  onSelectPage: (index: number) => void
  onAddPage: () => void
  onRenamePage: (index: number, name: string) => boolean
  onDuplicatePage: (index: number) => void
  onRemovePage: (index: number) => void
  onSelectBlock: (id: string | null) => void
  onAddBlock: (block: FormBlock) => void
  onPatchBlock: (id: string, patch: Partial<FormBlock>) => void
  onMoveBlock: (id: string, to: number) => void
  onDuplicateBlock: (id: string) => void
  onRemoveBlock: (id: string) => void
}

export function ContentTab(props: Props) {
  const { layout, page, blocks } = props
  const [renaming, setRenaming] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const section = layout.sections[page]

  return (
    <>
      <section className={styles.card} aria-labelledby="fe-pages-title">
        <div className={styles.cardHead}>
          <span className={styles.cardHeadText}>
            <h2 id="fe-pages-title" className={styles.cardTitle}>ページ</h2>
            <p className={styles.cardNote}>ページごとに「次へ」で進みます</p>
          </span>
          <RowActions
            subjectName={`ページ「${section?.name ?? ''}」`}
            menuItems={[
              { id: 'rename', label: '名前を変える', onSelect: () => setRenaming(section?.name ?? '') },
              { id: 'duplicate', label: '複製する', onSelect: () => props.onDuplicatePage(page) },
            ]}
            destructiveItem={layout.sections.length > 1 ? {
              id: 'remove',
              label: 'このページを消す',
              onSelect: () => ((section?.blocks.length ?? 0) === 0 ? props.onRemovePage(page) : setRemoving(true)),
            } : undefined}
          />
        </div>
        <div className={styles.pageChips}>
          {layout.sections.map((s, index) => (
            <button
              key={s.id}
              type="button"
              className={styles.pageChip}
              data-current={index === page || undefined}
              aria-pressed={index === page}
              onClick={() => props.onSelectPage(index)}
            >
              {index + 1} {s.name}
            </button>
          ))}
          <Button variant="text" onClick={props.onAddPage}>
            <Plus size={15} aria-hidden="true" />
            ページを足す
          </Button>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="fe-blocks-title">
        <div className={styles.cardHeadText}>
          <h2 id="fe-blocks-title" className={styles.cardTitle}>{`ページ${page + 1} のブロック`}</h2>
          <p className={styles.cardNote}>つまみで並べ替え。押すと設定が開きます</p>
        </div>
        {blocks.length === 0 ? (
          <p className={styles.emptyBlocks}>下の「ブロックを足す」から作ってください</p>
        ) : (
          blocks.map((block, index) =>
            block.id === props.selectedBlockId ? (
              <OpenBlock key={block.id} block={block} index={index} {...props} />
            ) : (
              <BlockRow key={block.id} block={block} index={index} {...props} />
            ),
          )
        )}
        <AddGrid onAdd={(make) => props.onAddBlock(make(props.inputCount))} />
      </section>

      <RenameDialog
        value={renaming}
        onCancel={() => setRenaming(null)}
        onSave={(next) => {
          if (props.onRenamePage(page, next)) setRenaming(null)
        }}
      />
      <Dialog
        open={removing}
        title="このページを消す"
        description={`「${section?.name ?? ''}」と、その中のブロック${section?.blocks.length ?? 0}個を消します。保存するまでは元に戻せます。`}
        confirmLabel="消す"
        onConfirm={() => {
          setRemoving(false)
          props.onRemovePage(page)
        }}
        onCancel={() => setRemoving(false)}
      />
    </>
  )
}

function RenameDialog({ value, onCancel, onSave }: { value: string | null; onCancel: () => void; onSave: (next: string) => void }) {
  const [draft, setDraft] = useState('')
  const [openedWith, setOpenedWith] = useState<string | null>(null)
  if (value !== openedWith) {
    setOpenedWith(value)
    setDraft(value ?? '')
  }
  return (
    <Dialog open={value !== null} title="ページの名前" confirmLabel="この名前にする" onConfirm={() => onSave(draft)} onCancel={onCancel}>
      <TextInput aria-label="ページの名前" value={draft} onChange={(e) => setDraft(e.target.value)} />
    </Dialog>
  )
}

/* ---------------- ブロックの行 ---------------- */

type RowProps = Props & { block: FormBlock; index: number }

function blockIcon(block: FormBlock): ReactNode {
  switch (block.kind) {
    case 'image': return <ImageIcon size={15} aria-hidden="true" />
    case 'heading': return <Heading size={15} aria-hidden="true" />
    case 'text': return <AlignLeft size={15} aria-hidden="true" />
    case 'button': return <MousePointerClick size={15} aria-hidden="true" />
    default: return block.type === 'booking' ? <CalendarCheck size={15} aria-hidden="true" /> : <HelpCircle size={15} aria-hidden="true" />
  }
}

/** つまみ：矢印キーで上下へ、つかんで落とす先の行へ。 */
function useRowDrag(props: RowProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      props.onMoveBlock(props.block.id, props.index + (event.key === 'ArrowUp' ? -1 : 1))
    }
  }
  const dragProps = {
    onDragOver: (event: DragEvent) => {
      if (event.dataTransfer.types.includes('text/x-form-block')) event.preventDefault()
    },
    onDrop: (event: DragEvent) => {
      const id = event.dataTransfer.getData('text/x-form-block')
      if (id) {
        event.preventDefault()
        props.onMoveBlock(id, props.index)
      }
    },
  }
  const handleProps = {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData('text/x-form-block', props.block.id)
      event.dataTransfer.effectAllowed = 'move'
    },
    onKeyDown,
  }
  return { dragProps, handleProps }
}

function rowMenu(props: RowProps, opened: boolean) {
  const { block, index, blocks } = props
  return {
    menuItems: [
      ...(opened ? [] : [{ id: 'open', label: '設定を開く', onSelect: () => props.onSelectBlock(block.id) }]),
      { id: 'duplicate', label: '複製する', onSelect: () => props.onDuplicateBlock(block.id) },
      { id: 'up', label: '上へ', disabled: index === 0, onSelect: () => props.onMoveBlock(block.id, index - 1) },
      { id: 'down', label: '下へ', disabled: index === blocks.length - 1, onSelect: () => props.onMoveBlock(block.id, index + 1) },
    ],
    destructiveItem: { id: 'remove', label: '消す', onSelect: () => props.onRemoveBlock(block.id) },
  }
}

function BlockRow(props: RowProps) {
  const { block } = props
  const { dragProps, handleProps } = useRowDrag(props)
  const title = blockTitleLine(block)
  return (
    <div className={styles.blockRow} {...dragProps}>
      <DragHandle label={`「${title}」を並べ替える`} className={styles.grip} {...handleProps} />
      <button type="button" className={styles.blockOpen} onClick={() => props.onSelectBlock(block.id)} aria-label={`「${title}」の設定を開く`}>
        <span className={styles.blockIcon}>{blockIcon(block)}</span>
        <span className={styles.blockText}>
          <span className={styles.blockTitle} title={title}>{title}</span>
          <span className={styles.blockKind}>{blockKindLine(block)}</span>
        </span>
      </button>
      <RowActions className={styles.more} subjectName={`「${title}」`} {...rowMenu(props, false)} />
    </div>
  )
}

/* ---------------- 開いたブロック ---------------- */

function OpenBlock(props: RowProps) {
  const { block, refs } = props
  const { dragProps, handleProps } = useRowDrag(props)
  const patch = (next: Partial<FormBlock>) => props.onPatchBlock(block.id, next)
  const input = block.kind === 'input' ? block : null
  const typeLabel = input ? inputTypeLabel(input) : blockTitleKind(block)
  const [detailOpen, setDetailOpen] = useState(false)
  const menu = rowMenu(props, true)
  const menuItems = [
    { id: 'close', label: '設定を閉じる', onSelect: () => props.onSelectBlock(null) },
    ...(input ? [{ id: 'detail', label: '詳しい設定（分岐・入力の形・説明）', onSelect: () => setDetailOpen(true) }] : []),
    ...menu.menuItems,
  ]
  return (
    <div className={styles.blockOpenCard} {...dragProps} data-block-kind={block.kind}>
      <div className={styles.openHead}>
        <DragHandle label={`「${blockTitleLine(block)}」を並べ替える`} className={styles.grip} {...handleProps} />
        <span className={styles.openType}>{typeLabel}</span>
        {input?.type === 'booking' ? <span className={styles.newBadge}>新</span> : null}
        <span className={styles.spacer} />
        {input ? (
          <label className={styles.required}>
            <span className={styles.requiredLabel}>必須</span>
            <Toggle checked={input.required ?? false} onChange={(required) => patch({ required } as Partial<FormBlock>)} label="必須" />
          </label>
        ) : null}
        <RowActions className={styles.more} subjectName={`「${blockTitleLine(block)}」`} menuItems={menuItems} destructiveItem={menu.destructiveItem} />
      </div>
      {input ? <InputFields block={input} refs={refs} patch={patch} /> : <DecoFields block={block} patch={patch} accountId={props.accountId} />}
      {input ? (
        <Dialog open={detailOpen} title={`「${blockTitleLine(block)}」の詳しい設定`} description="分岐・選んだときの動き・入力の形・説明など。変えるとすぐ画面に入ります。" confirmLabel="閉じる" onConfirm={() => setDetailOpen(false)} onCancel={() => setDetailOpen(false)}>
          <BlockEditor block={block} index={props.index} sections={props.layout.sections} refs={refs} selected onSelect={() => {}} onChange={patch} />
        </Dialog>
      ) : null}
    </div>
  )
}

function blockTitleKind(block: FormBlock): string {
  return { image: '画像', heading: '見出し', text: 'テキスト', button: 'ボタン', input: '入力' }[block.kind]
}

function Labeled({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  )
}

function InputFields({ block, refs, patch }: { block: FormInputBlock; refs: FormRefs; patch: (next: Partial<FormBlock>) => void }) {
  const set = (next: Partial<FormInputBlock>) => patch(next as Partial<FormBlock>)
  const labelId = `fe-q-${block.id}`
  return (
    <>
      <Labeled label="質問文" htmlFor={labelId}>
        <TextInput id={labelId} value={block.label} placeholder="質問の文" onChange={(e) => set({ label: e.target.value })} />
      </Labeled>
      {isChoiceType(block.type) ? <ChoiceFields block={block} set={set} /> : null}
      {block.type === 'booking' ? <BookingFields block={block} refs={refs} set={set} /> : <SaveTo block={block} refs={refs} set={set} />}
    </>
  )
}

function ChoiceFields({ block, set }: { block: FormInputBlock; set: (next: Partial<FormInputBlock>) => void }) {
  const choices = block.choices ?? []
  const dragFrom = useRef<number | null>(null)
  const move = (from: number, to: number) => {
    if (to < 0 || to >= choices.length || from === to) return
    const next = [...choices]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    set({ choices: next })
  }
  return (
    <>
      <p className={styles.subLabel}>選択肢</p>
      {choices.map((choice, index) => (
        <div
          key={choice.id}
          className={styles.choiceRow}
          onDragOver={(e) => { if (dragFrom.current !== null) e.preventDefault() }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragFrom.current !== null) move(dragFrom.current, index)
            dragFrom.current = null
          }}
        >
          <DragHandle
            label={`選択肢「${choice.label}」を並べ替える`}
            className={styles.grip}
            draggable
            onDragStart={() => { dragFrom.current = index }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                move(index, index + (e.key === 'ArrowUp' ? -1 : 1))
              }
            }}
          />
          <TextInput
            aria-label={`選択肢${index + 1}`}
            className={styles.choiceInput}
            value={choice.label}
            onChange={(e) => set({ choices: choices.map((c, i) => (i === index ? { ...c, label: e.target.value } : c)) })}
          />
          <button
            type="button"
            className={styles.choiceRemove}
            aria-label={`選択肢「${choice.label}」を消す`}
            disabled={choices.length <= 1}
            onClick={() => set({ choices: choices.filter((_, i) => i !== index) })}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      ))}
      <span>
        <Button variant="text" onClick={() => set({ choices: [...choices, { id: newBlockId('c'), label: `選択肢${choices.length + 1}` }] })}>
          <Plus size={15} aria-hidden="true" />
          選択肢を足す
        </Button>
      </span>
    </>
  )
}

/** 答えを保存する先（友だち情報の項目）。本名・表示名・メモへの保存は「詳しい設定」。 */
function SaveTo({ block, refs, set }: { block: FormInputBlock; refs: FormRefs; set: (next: Partial<FormInputBlock>) => void }) {
  const current = block.destinations?.friendFieldIds?.[0] ?? ''
  const options = [
    { value: '', label: '保存しない' },
    ...refs.friendFields.map((f) => ({ value: f.id, label: `友だち情報「${f.name}」`, disabled: f.ecIsMaster })),
  ]
  if (current && !refs.friendFields.some((f) => f.id === current)) options.push({ value: current, label: '友だち情報「（消えた項目）」', disabled: false })
  return (
    <div className={styles.saveTo}>
      <span className={styles.fieldLabel}>答えを保存する先</span>
      <span className={styles.saveSelect}>
        <Select
          aria-label="答えを保存する先"
          value={current}
          onChange={(value) => {
            const rest = (block.destinations?.friendFieldIds ?? []).slice(1)
            set({ destinations: { ...block.destinations, friendFieldIds: value ? [value, ...rest.filter((id) => id !== value)] : rest } })
          }}
          options={options}
        />
      </span>
    </div>
  )
}

const DAYS_AHEAD = [7, 14, 30, 60]

function BookingFields({ block, refs, set }: { block: FormInputBlock; refs: FormRefs; set: (next: Partial<FormInputBlock>) => void }) {
  const booking = block.booking ?? null
  const menus = refs.bookingMenus ?? []
  const staff = booking?.menuId ? (refs.bookingMenuStaff?.[booking.menuId] ?? []) : []
  const days = booking?.daysAhead ?? 14
  const setBooking = (next: Partial<NonNullable<FormInputBlock['booking']>>) =>
    set({ booking: { menuId: booking?.menuId ?? '', staffId: booking?.staffId ?? null, daysAhead: days, ...next } })
  return (
    <>
      <div className={styles.bookingRow}>
        <Labeled label="メニュー">
          <Select
            aria-label="メニュー"
            size="full"
            value={booking?.menuId ?? ''}
            onChange={(menuId) => setBooking({ menuId, staffId: null })}
            options={[
              { value: '', label: menus.length ? 'メニューを選ぶ' : 'メニューがありません' },
              ...menus.map((m) => ({ value: m.id, label: `${m.name}・${m.durationMinutes}分` })),
            ]}
          />
        </Labeled>
        <Labeled label="担当">
          <Select
            aria-label="担当"
            size="full"
            value={booking?.staffId ?? ''}
            onChange={(staffId) => setBooking({ staffId: staffId || null })}
            options={[{ value: '', label: 'だれでも' }, ...staff.map((s) => ({ value: s.id, label: s.name }))]}
          />
        </Labeled>
        <Labeled label="選べる期間">
          <Select
            aria-label="選べる期間"
            size="full"
            value={String(days)}
            onChange={(value) => setBooking({ daysAhead: Number(value) })}
            options={(DAYS_AHEAD.includes(days) ? DAYS_AHEAD : [...DAYS_AHEAD, days].sort((a, b) => a - b)).map((d) => ({ value: String(d), label: `今日から ${d}日` }))}
          />
        </Labeled>
      </div>
      {/* 絵の2つのつまみ（メニューを選んでもらう・未承認で入れる）は保存する口がまだ無い。今の決まりを文で出す。 */}
      <p className={styles.bookingRule}>
        <span>メニューを選んでもらう</span>
        <span className={styles.bookingRuleValue}>上のメニューで決まり</span>
      </p>
      <p className={styles.bookingRule}>
        <span>予約は「未承認」で入れて、店が承認する</span>
        <span className={styles.bookingRuleValue}>予約の設定どおり</span>
      </p>
      <div className={styles.bookingInfo}>
        <CalendarCheck size={16} aria-hidden="true" className={styles.bookingInfoIcon} />
        <p className={styles.bookingInfoText}>空いている枠は「予約」の営業時間と担当の予定から出します。入った予約は予約の一覧に入り、リマインダも動きます。</p>
        <Link href="/booking/menus" className={styles.bookingLink}>
          <ExternalLink size={15} aria-hidden="true" />
          予約の設定を開く
        </Link>
      </div>
    </>
  )
}

function DecoFields({ block, patch, accountId }: { block: FormBlock; patch: (next: Partial<FormBlock>) => void; accountId: string | null }) {
  const [picking, setPicking] = useState(false)
  const id = `fe-deco-${block.id}`
  switch (block.kind) {
    case 'heading':
      return (
        <div className={styles.decoRow}>
          <Labeled label="見出し" htmlFor={id}>
            <TextInput id={id} value={block.text} onChange={(e) => patch({ text: e.target.value } as Partial<FormBlock>)} />
          </Labeled>
          <Labeled label="大きさ">
            <Select aria-label="大きさ" value={String(block.level ?? 2)} onChange={(v) => patch({ level: Number(v) as 1 | 2 | 3 } as Partial<FormBlock>)} options={[{ value: '1', label: '見出し1' }, { value: '2', label: '見出し2' }, { value: '3', label: '見出し3' }]} />
          </Labeled>
        </div>
      )
    case 'text':
      return (
        <Labeled label="本文" htmlFor={id}>
          <TextArea id={id} rows={3} value={block.text} onChange={(e) => patch({ text: e.target.value } as Partial<FormBlock>)} />
        </Labeled>
      )
    case 'button':
      return (
        <div className={styles.decoRow}>
          <Labeled label="ボタンの文字" htmlFor={id}>
            <TextInput id={id} value={block.label} onChange={(e) => patch({ label: e.target.value } as Partial<FormBlock>)} />
          </Labeled>
          <Labeled label="開くURL" htmlFor={`${id}-url`}>
            <TextInput id={`${id}-url`} type="url" placeholder="https://..." value={block.url} onChange={(e) => patch({ url: e.target.value } as Partial<FormBlock>)} />
          </Labeled>
        </div>
      )
    case 'image':
      return (
        <>
          <div className={styles.decoRow}>
            <Labeled label="画像のURL" htmlFor={id}>
              <TextInput id={id} type="url" placeholder="https://..." value={block.mediaUrl} onChange={(e) => patch({ mediaUrl: e.target.value } as Partial<FormBlock>)} />
            </Labeled>
            <Labeled label="押したときに開くURL（任意）" htmlFor={`${id}-link`}>
              <TextInput id={`${id}-link`} type="url" value={block.linkUrl ?? ''} onChange={(e) => patch({ linkUrl: e.target.value } as Partial<FormBlock>)} />
            </Labeled>
          </div>
          <span>
            <Button onClick={() => setPicking(true)}>
              <ImageIcon size={15} aria-hidden="true" />
              登録メディアから選ぶ
            </Button>
          </span>
          <MediaPickerDialog
            open={picking}
            accountId={accountId}
            kind="image"
            onClose={() => setPicking(false)}
            onSelect={(item) => {
              patch({ mediaUrl: item.url } as Partial<FormBlock>)
              setPicking(false)
            }}
          />
        </>
      )
    default:
      return null
  }
}

/* ---------------- ブロックを足す ---------------- */

function AddGrid({ onAdd }: { onAdd: (make: (count: number) => FormBlock) => void }) {
  return (
    <div className={styles.addBox}>
      <p className={styles.addTitle}>ブロックを足す</p>
      {ADD_GROUPS.map((group) => (
        <div key={group.title} className={styles.addGroup}>
          <p className={styles.addGroupTitle}>{group.title}</p>
          <div className={styles.addCards}>
            {group.cards.map((card) => (
              <button key={card.key} type="button" className={styles.addCard} data-fresh={card.fresh || undefined} onClick={() => onAdd(card.make)}>
                <span className={styles.addCardTop}>
                  <Plus size={15} aria-hidden="true" />
                  <span className={styles.addCardLabel}>{card.label}</span>
                  {card.fresh ? <span className={styles.newBadge}>新</span> : null}
                </span>
                <span className={styles.addCardHint}>{card.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
