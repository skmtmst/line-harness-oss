'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AutoLineRule } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Drawer from '@/components/shared/drawer'
import { Field } from '@/components/shared/form-controls'
import InsertTextField, { type InsertTextFieldHandle } from '@/components/shared/insert-text-field'
import LinePreview, { LinePreviewCard, LinePreviewMessage } from '@/components/shared/line-preview'
import MessageInsertRow, { MessageInsertButton } from '@/components/shared/message-insert-row'
import PreviewLauncher from '@/components/templates/preview-launcher'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { SettingCheckbox } from '@/components/shared/checkbox'
import HelpTip from '@/components/shared/help-tip'
import { notifySaved } from '@/components/shared/toast'
import { ecAutoLineApi } from '@/lib/api/helpers/gap3'
import { KIND_LABEL, KIND_WHO, WAIT_CHOICES, failureText, ruleText, waitLabel } from './words'
import { SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import styles from './auto-line.module.css'

/*
 * ★V8 EC連携「自動の LINE」を編集する右の引き出し（G6-2 `DuGA3`）。
 * 左：待つ時間・本文・止める条件・1人の上限・送らない時間帯・送る目的。右：LINE の見本（商品カード）。
 * 止める条件・上限・時間帯・目的は Worker が決めた値（いつも守る）なので、変えられない形で見せる。
 * 保存すると待つ時間と本文だけが変わる。オン・オフは表のスイッチ。
 */

const DEFAULT_TEXT: Record<AutoLineRule['kind'], string> = {
  cart: '{{name}} さま、カートに商品が残っています。',
  browse: '{{name}} さま、ご覧になった商品はいかがでしたか。',
  restock: '{{name}} さま、お待ちいただいていた商品が入荷しました。',
}

export default function EditDrawer({ accountId, rule, onClose, onSaved }: {
  accountId: string
  rule: AutoLineRule | null
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const [wait, setWait] = useState(0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<InsertTextFieldHandle | null>(null)
  const errors = useSaveFormErrors()
  const kind = rule?.kind
  const ruleKey = rule ? `${rule.kind}:${rule.version}` : ''

  useEffect(() => {
    if (!rule) return
    setWait(rule.waitMinutes)
    setText(ruleText(rule.messages) || DEFAULT_TEXT[rule.kind])
    setError('')
  // 開き直したときと版が変わったときだけ入れ直す。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleKey])

  if (!rule || !kind) return <Drawer open={false} title="" onClose={onClose} />

  const choices = Array.from(new Set([...WAIT_CHOICES[kind], rule.waitMinutes])).sort((a, b) => a - b)
  const insertName = () => {
    const area = ref.current
    if (!area) return
    const start = area.selectionStart ?? text.length
    const end = area.selectionEnd ?? start
    setText(text.slice(0, start) + '{{name}}' + text.slice(end))
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(start + 8, start + 8) })
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await ecAutoLineApi.save(accountId, kind, { waitMinutes: wait, messages: [{ type: 'text', text }], expectedVersion: rule.version })
      if (!response.success) throw new Error('save_failed')
      notifySaved(`${KIND_LABEL[kind]}の自動の LINE を保存しました。`)
      await onSaved()
    } catch (reason) {
      if (!errors.capture(reason)) setError(failureText(reason, '保存する'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SaveErrorScope errors={errors}><Drawer
      open
      width="editor"
      heightMode="viewport"
      title={`${KIND_LABEL[kind]}の LINE を編集する`}
      description={KIND_WHO[kind]}
      closeAppearance="box"
      busy={busy}
      dirty={wait !== rule.waitMinutes || text !== (ruleText(rule.messages) || DEFAULT_TEXT[kind])}
      onClose={onClose}
      footer={<div className={styles.footerCenter}>
        <Button onClick={onClose} disabled={busy}>キャンセル</Button>
        <Button variant="primary" onClick={() => void save()} busy={busy} disabled={busy}>保存する</Button>
      </div>}
    >
      <div className={styles.editor}>
        <div className={styles.form}>
          {error ? <Notice tone="danger" message={error} /> : null}
          <Field label="待つ時間" required help="きっかけから、何分（何時間）あとに送るかです。その間に買った人には送りません。">
            <Select
              aria-label="待つ時間"
              value={String(wait)}
              onChange={(value) => setWait(Number(value))}
              options={choices.map((minutes) => ({ value: String(minutes), label: waitLabel(minutes) }))}
              disabled={choices.length < 2}
            />
          </Field>
          <Field label="本文" required count={{ value: text.length, max: 1000 }}>
            <InsertTextField ref={ref} aria-label="本文" editorSize="message" maxLength={1000} value={text} onValueChange={setText} />
            <MessageInsertRow>
              <MessageInsertButton kind="name" label="名前" onClick={insertName} />
            </MessageInsertRow>
            <p className={styles.tokenNote}>下に、見ていた商品の画像・名前・値段・リンクのカードが付きます。</p>
          </Field>
          <FixedBlock label="止める条件" help="この条件は、お客さまに迷惑をかけないよう、いつも守ります。変えられません。">
            <div className={styles.fixedList}>
              <span className={styles.fixedRow}><SettingCheckbox checked locked label="買ったら送らない" />買ったら送らない</span>
              <span className={styles.fixedRow}><SettingCheckbox checked locked label="同じ商品は 30 日に 1 回だけ" />同じ商品は 30 日に 1 回だけ</span>
              <span className={styles.fixedRow}><SettingCheckbox checked locked label="宣伝を止めている人・ブロックした人には送らない" />宣伝を止めている人・ブロックした人には送らない</span>
            </div>
          </FixedBlock>
          <FixedBlock label="1 人の上限"><p className={styles.subtle}>1 日に 1 通・1 週間に 3 通まで（変えられません）</p></FixedBlock>
          <FixedBlock label="送らない時間帯"><p className={styles.subtle}>夜の静かな時間（21 時〜翌 8 時）は、朝 8 時に送ります。</p></FixedBlock>
          <FixedBlock label="送る目的"><p className={styles.subtle}>宣伝（固定）</p></FixedBlock>
          <div>
            <PreviewLauncher title="LINE の見本" label="LINE での見え方を見る">
              <LinePreview title={null} fit note="本文と商品カードの見え方です。" caption="自動で送る">
                <LinePreviewMessage accountName="お店" avatar="店" time="10:00">{text.replace(/\{\{name\}\}/g, '山田')}</LinePreviewMessage>
                <LinePreviewCard imageUrl="" title="商品の名前" description="見ていた商品の説明が入ります" price="¥3,280" time="10:00" actions={[{ label: 'カートを見る', onClick: () => {} }]} />
              </LinePreview>
            </PreviewLauncher>
          </div>
        </div>
      </div>
    </Drawer></SaveErrorScope>
  )
}

/** 変えられない決まり。入力欄ではないので「任意」の札は付けず、名前と中身だけを見せる。 */
function FixedBlock({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.fixedBlock}>
      <span className={styles.fixedLabel}>{label}{help ? <HelpTip label={`${label}の説明`}>{help}</HelpTip> : null}</span>
      {children}
    </div>
  )
}
