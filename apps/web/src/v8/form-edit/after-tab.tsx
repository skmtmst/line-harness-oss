'use client'

/*
 * 「答え終わったあと」のタブ（XXFT4）。お礼の画面と、答え終わったら行うこと。
 * 行うことは上から順に動く。行の「…」で直す・並べ替える・消す。
 */
import { useState } from 'react'
import { FileText, IdCard, MessageSquare, Bell, Tag, Workflow } from 'lucide-react'
import type { FormAction, FormOptions } from '@line-crm/shared'
import ActionEditor from '@/components/forms/action-editor'
import type { FormRefs } from '@/components/forms/form-refs'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import { TextInput } from '@/components/shared/form-controls'
import { RowActions } from '@/components/shared/row-actions'
import ReorderHandle, { useReorder } from '@/components/shared/reorder-handle'
import Segmented from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import { ACTION_ADDERS, describeAfterAction, emptyAction } from './model'
import styles from './edit.module.css'

const ADDER_ICON: Record<FormAction['kind'], typeof Tag> = {
  send_text: MessageSquare,
  send_template: FileText,
  tag: Tag,
  friend_field: IdCard,
  scenario: Workflow,
  reminder: Bell,
}

type Props = {
  options: FormOptions
  refs: FormRefs
  onSubmitTagId: string
  onChangeOptions: (next: Partial<FormOptions>) => void
  onChangeSubmitTag: (id: string) => void
}

export function AfterTab({ options, refs, onSubmitTagId, onChangeOptions, onChangeSubmitTag }: Props) {
  const actions = options.afterActions ?? []
  /** 直している間の一覧（窓の中だけ。「この内容にする」で戻す）。 */
  const [editing, setEditing] = useState<FormAction[] | null>(null)
  /** URLを開く：thanksUrl がある間。消すとお礼を出すに戻る（URL は欄の中だけに残す）。 */
  const [urlDraft, setUrlDraft] = useState(options.thanksUrl ?? '')
  const ending = options.thanksUrl ? 'url' : 'thanks'

  const setActions = (next: FormAction[]) => onChangeOptions({ afterActions: next })
  /*
   * 並べ替え（共通の並び替え）。つまみのドラッグ・上下キー・「…」の上へ／下へは
   * どれも同じ入口で並びを変える。行うことには id が無いので、今の位置を目印にする。
   */
  const slots = actions.map((_, index) => String(index))
  const reorder = useReorder({
    items: slots,
    idOf: (slot) => slot,
    onReorder: ({ ids }) => setActions(ids.map((slot) => actions[Number(slot)])),
  })

  return (
    <>
      <section className={styles.card} aria-labelledby="fe-thanks-title">
        <h2 id="fe-thanks-title" className={styles.cardTitle}>答え終わったときの画面</h2>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="fe-thanks-text">お礼の文</label>
          <TextInput id="fe-thanks-text" value={options.thanksText ?? ''} placeholder="ご回答ありがとうございました。" onChange={(e) => onChangeOptions({ thanksText: e.target.value })} />
        </div>
        <div className={styles.endingRow}>
          <span className={styles.endingLabel}>終わったあと</span>
          <Segmented
            aria-label="答え終わったあと"
            value={ending}
            onChange={(value) => onChangeOptions({ thanksUrl: value === 'url' ? (urlDraft.trim() || 'https://') : null })}
            options={[
              { value: 'thanks', label: 'お礼を出す' },
              { value: 'url', label: 'URLを開く' },
            ]}
          />
        </div>
        {ending === 'url' ? (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="fe-thanks-url">開くURL</label>
            <TextInput
              id="fe-thanks-url"
              type="url"
              value={options.thanksUrl ?? ''}
              placeholder="https://..."
              onChange={(e) => {
                setUrlDraft(e.target.value)
                onChangeOptions({ thanksUrl: e.target.value || 'https://' })
              }}
            />
          </div>
        ) : null}
      </section>

      <section className={styles.card} aria-labelledby="fe-actions-title">
        <div className={styles.cardHeadText}>
          <h2 id="fe-actions-title" className={styles.cardTitle}>答え終わったら行うこと</h2>
          <p className={styles.cardNote}>上から順に行います。カルーセル・質問・自動応答からも同じ画面が開きます</p>
        </div>
        {actions.length === 0 ? <p className={styles.emptyBlocks}>行うことはまだありません。下から足せます</p> : null}
        {reorder.shown.map((slot, position) => {
          const index = Number(slot)
          const action = actions[index]
          const text = describeAfterAction(action, refs)
          return (
            <div key={slot} className={styles.actionRow} {...reorder.rowProps(slot)}>
              <ReorderHandle
                look="icon"
                label={text}
                ariaLabel={`「${text}」を並べ替える`}
                className={styles.grip}
                {...reorder.handle(slot)}
                {...reorder.handleProps(slot)}
              />
              <span className={styles.actionNum}>{position + 1}</span>
              <button type="button" className={styles.actionText} title={text} onClick={() => setEditing(actions)}>{text}</button>
              <RowActions
                className={styles.more}
                subjectName={`「${text}」`}
                menuItems={[
                  { id: 'edit', label: '直す', onSelect: () => setEditing(actions) },
                  ...reorder.menuItems(slot).map((item) => ({ ...item, id: item.id === 'move-up' ? 'up' : 'down', disabledReason: undefined })),
                ]}
                destructiveItem={{ id: 'remove', label: '消す', onSelect: () => setActions(actions.filter((_, i) => i !== index)) }}
              />
            </div>
          )
        })}
        <div className={styles.adders}>
          {ACTION_ADDERS.map((adder) => {
            const Icon = ADDER_ICON[adder.kind]
            return (
              <Button key={adder.kind} variant="text" onClick={() => setEditing([...actions, emptyAction(adder.kind)])}>
                <Icon size={15} aria-hidden="true" />
                {adder.label}
              </Button>
            )
          })}
        </div>
      </section>

      <section className={styles.card} aria-labelledby="fe-tag-title">
        <h2 id="fe-tag-title" className={styles.cardTitle}>回答したときに付けるタグ</h2>
        <p className={styles.cardNote}>このフォームに答えた人を、あとから絞り込めます。</p>
        <span className={styles.saveSelect}>
          <Select
            aria-label="回答したときに付けるタグ"
            value={onSubmitTagId}
            onChange={onChangeSubmitTag}
            options={[{ value: '', label: '付けない' }, ...refs.tags.map((t) => ({ value: t.id, label: t.name }))]}
          />
        </span>
      </section>

      <Dialog
        open={editing !== null}
        title="答え終わったら行うこと"
        description="上から順に行います。種類を選んで中身を決めてください。"
        confirmLabel="この内容にする"
        onConfirm={() => {
          if (editing) setActions(editing)
          setEditing(null)
        }}
        onCancel={() => setEditing(null)}
      >
        {editing ? <ActionEditor value={editing} refs={refs} onChange={setEditing} /> : null}
      </Dialog>
    </>
  )
}
