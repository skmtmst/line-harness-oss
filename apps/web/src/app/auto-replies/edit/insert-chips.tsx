'use client'

/*
 * 自動応答の「差し込む」の札（絵 A0pDt の4つ）。見た目は wizard-v8.module.css の札のまま。
 *
 * 札が入れる文字は、送るときに本当に置き換わる形（{{name}}・{{field.x}}・{{var.x}}）だけ。
 * 以前は {name}・{field}・{var}・{booking_at} を入れていて、どれも置き換わらずに
 * そのままお客さまへ届いていた（2026-10-07 の点検）。
 * 友だち情報・共通情報は項目を選ばないと形が決まらないので、押すと一覧が開く。
 * 予約日時は自動応答で差し込める値がまだ無いので、押せない札にして理由を出す。
 */
import { useEffect, useRef, useState } from 'react'
import { Braces, CalendarDays, IdCard, User } from 'lucide-react'
import ActionMenu from '@/components/shared/action-menu'
import { EMPTY_REFERENCES, loadTemplateReferences, type TemplateReferences } from '@/v8/template-edit/core'
import styles from './wizard-v8.module.css'

export const NAME_TOKEN = '{{name}}'

/** 本文に入っている差し込みを、札の名前で返す（右の「設定内容」の箱で使う）。 */
export function insertedLabels(content: string): string[] {
  const labels: string[] = []
  if (content.includes(NAME_TOKEN)) labels.push('名前')
  if (/\{\{field\.[a-z][a-z0-9_]*\}\}/.test(content)) labels.push('友だち情報')
  if (/\{\{\s*var\.[a-z][a-z0-9_]*\s*\}\}/.test(content)) labels.push('共通情報')
  return labels
}

type MenuKey = 'field' | 'var'

export default function AutoReplyInsertChips({
  accountId,
  onInsert,
  load = loadTemplateReferences,
}: {
  accountId: string | null
  onInsert: (token: string) => void
  load?: (accountId: string) => Promise<TemplateReferences>
}) {
  const [references, setReferences] = useState<TemplateReferences>(EMPTY_REFERENCES)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [menu, setMenu] = useState<MenuKey | null>(null)
  const fieldRef = useRef<HTMLButtonElement>(null)
  const varRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!accountId) { setReferences(EMPTY_REFERENCES); setState('idle'); return }
    let alive = true
    setState('loading')
    load(accountId)
      .then((next) => { if (alive) { setReferences(next); setState('ready') } })
      .catch(() => { if (alive) { setReferences(EMPTY_REFERENCES); setState('failed') } })
    return () => { alive = false }
  }, [accountId, load])

  const pick = (token: string) => { setMenu(null); onInsert(token) }
  const why = (ready: boolean, label: string) =>
    state === 'loading' ? '読み込み中です'
      : state === 'failed' ? '差し込み項目を読み込めませんでした。画面を再読み込みしてください'
        : ready ? `${label}を差し込む` : `差し込める${label}がありません`
  const fieldsReady = state === 'ready' && references.friendFields.length > 0
  const varsReady = state === 'ready' && references.commonVars.length > 0

  return (
    <>
      <button type="button" className={styles.insertChip} title="名前を差し込む" onClick={() => onInsert(NAME_TOKEN)}>
        <User size={16} aria-hidden="true" />名前
      </button>
      <button
        ref={fieldRef}
        type="button"
        className={styles.insertChip}
        title={why(fieldsReady, '友だち情報')}
        aria-haspopup="menu"
        aria-expanded={menu === 'field'}
        disabled={!fieldsReady}
        onClick={() => setMenu((m) => (m === 'field' ? null : 'field'))}
      >
        <IdCard size={16} aria-hidden="true" />友だち情報
      </button>
      <button
        ref={varRef}
        type="button"
        className={styles.insertChip}
        title={why(varsReady, '共通情報')}
        aria-haspopup="menu"
        aria-expanded={menu === 'var'}
        disabled={!varsReady}
        onClick={() => setMenu((m) => (m === 'var' ? null : 'var'))}
      >
        <Braces size={16} aria-hidden="true" />共通情報
      </button>
      <button
        type="button"
        className={styles.insertChip}
        title="自動応答では予約日時を差し込めません（予約の通知で使えます）"
        disabled
      >
        <CalendarDays size={16} aria-hidden="true" />予約日時
      </button>
      <ActionMenu
        open={menu === 'field'}
        anchorRef={fieldRef}
        ariaLabel="差し込む友だち情報"
        onClose={() => setMenu(null)}
        items={references.friendFields.map((field) => ({ id: field.fieldKey, label: field.name, onSelect: () => pick(`{{field.${field.fieldKey}}}`) }))}
      />
      <ActionMenu
        open={menu === 'var'}
        anchorRef={varRef}
        ariaLabel="差し込む共通情報"
        onClose={() => setMenu(null)}
        items={references.commonVars.map((item) => ({ id: item.varKey, label: item.name, onSelect: () => pick(`{{var.${item.varKey}}}`) }))}
      />
    </>
  )
}
