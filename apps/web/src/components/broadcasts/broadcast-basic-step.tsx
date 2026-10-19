'use client'
import Notice from '@/components/shared/notice'

import type { FolderSelectCreate } from '@/components/shared/folder-select'


import { type BroadcastStepKey } from '@/components/broadcasts/broadcast-steps'
import Button from '@/components/shared/button'
import FolderSelect,{ folderById } from '@/components/shared/folder-select'
import { RequiredBadge } from '@/components/shared/form-controls'
import HelpTip from '@/components/shared/help-tip'
import RadioCard,{ RadioCardGroup } from '@/components/shared/radio-card'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import { type ApiBroadcast } from '@/lib/api'
import { formatDateTime,formatNumber } from '@/lib/format'
import { Send } from 'lucide-react'
import Link from 'next/link'
import type { Dispatch,SetStateAction } from 'react'
import { TITLE_MAX } from './broadcast-form-model'
import styles from './broadcast-form-v8.module.css'

type BroadcastBasicStepContext = {
  canCreateFolder: boolean
  createFolder: FolderSelectCreate
  deliveryMethod: "new" | "template" | "duplicate"
  duplicateRecent: (broadcast: ApiBroadcast) => void
  folderId: string
  folders: { id: string; name: string; color?: string | null; }[]
  goToStep: (step: BroadcastStepKey) => void | undefined
  internalMemo: string
  recentBroadcasts: ApiBroadcast[]
  recentState: 'unselected' | 'loading' | 'error' | 'ready'
  retryRecent: () => void
  setComposerTemplateIndex: Dispatch<SetStateAction<number | null>>
  setComposerTemplateKind: Dispatch<SetStateAction<string | undefined>>
  setDeliveryMethod: Dispatch<SetStateAction<"new" | "template" | "duplicate">>
  setFolderId: Dispatch<SetStateAction<string>>
  setInternalMemo: Dispatch<SetStateAction<string>>
  setShowTemplatePicker: Dispatch<SetStateAction<boolean>>
  setTitle: Dispatch<SetStateAction<string>>
  shows: (step: BroadcastStepKey) => boolean
  title: string
}

export function BroadcastBasicStep({ canCreateFolder, createFolder, deliveryMethod, duplicateRecent, folderId, folders, goToStep, internalMemo, recentBroadcasts, recentState, retryRecent, setComposerTemplateIndex, setComposerTemplateKind, setDeliveryMethod, setFolderId, setInternalMemo, setShowTemplatePicker, setTitle, shows, title }: BroadcastBasicStepContext) {
  return (<section id="broadcast-step-basic" className={shows('basic') ? styles.section : 'hidden'}>
          <h3>配信方法</h3>
              <SaveErrorField names={["broadcast-delivery-method","value","deliveryMethod"]}><RadioCardGroup legend="配信方法" className={styles.methodCards}>
                {([
                  ['new', '新しいメッセージを作成', 'テキスト・画像・ボタンを組み合わせて一から作ります。'],
                  ['template', 'テンプレートを選択', '保存済みテンプレートを呼び出して手直しします。'],
                  ['duplicate', '過去の配信を複製', '送信済みの配信をそのまま写して作り直します。'],
                ] as const).map(([value, label, description]) => (
                  <RadioCard
                    key={value}
                    name="broadcast-delivery-method"
                    value={value}
                    checked={deliveryMethod === value}
                    title={label}
                    note={description}
                    onChange={(next) => {
                      setDeliveryMethod(next as typeof deliveryMethod)
                      if (next === 'template') {
                        setComposerTemplateIndex(null); setComposerTemplateKind(undefined)
                        setShowTemplatePicker(true)
                        goToStep('message')
                      }
                    }}
                    /* 選択済みの「テンプレートを選択」をもう一度押すと、
                       一覧を開き直せる（radio の change は発火しないため）。 */
                    onClick={value === 'template' && deliveryMethod === 'template'
                      ? () => { setComposerTemplateIndex(null); setComposerTemplateKind(undefined); setShowTemplatePicker(true); goToStep('message') }
                      : undefined}
                  />
                ))}
              </RadioCardGroup></SaveErrorField>
          <label className={styles.nameField}>
            <span className={styles.labelRow}><span className="text-ink text-sm font-bold">配信名<RequiredBadge /></span><span className="text-xs text-ink-faint">{title.trim().length} / {TITLE_MAX}文字</span></span>
            <SaveErrorField names={["title"]}><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：8月キャンペーンのお知らせ" className={styles.textInput} /></SaveErrorField>
            <small>友だちには表示されません。一覧で見分けるための名前です</small>
          </label>
          <div className={styles.basicFields}>
            <label><span className={styles.labelRow}>フォルダ</span><SaveErrorField names={["folderId","folder_id"]}><FolderSelect aria-label="フォルダ" value={folderId} onChange={setFolderId} folders={folders.map(folderById)} onCreate={canCreateFolder ? createFolder : undefined} size="full" /></SaveErrorField></label>
            <label><span className={styles.labelRow}>社内メモ <span className="text-ink-faint text-xs font-normal">任意</span><HelpTip label="社内メモの説明">友だちには表示されません</HelpTip></span><SaveErrorField names={["internalMemo","internal_memo"]}><textarea aria-label="社内メモ" value={internalMemo} onChange={(event) => setInternalMemo(event.target.value)} rows={1} className={styles.textInput} placeholder="配信の目的や運用メモ" /></SaveErrorField></label>
          </div>
          <div className={styles.recentHeader}><h3>最近の配信</h3><Link href="/broadcasts">一斉配信の一覧を見る →</Link></div>
          <div className={styles.recentList}>
            {recentState === 'unselected' ? <p className="text-xs text-ink-faint">LINEアカウントを選ぶと最近の配信を表示します。</p>
              : recentState === 'loading' ? <p role="status" className="text-xs text-ink-faint">最近の配信を読み込んでいます…</p>
              : recentState === 'error' ? <Notice tone="danger" action={<Button onClick={retryRecent}>もう一度読み込む</Button>}>最近の配信を読み込めませんでした。</Notice>
              : recentBroadcasts.length ? recentBroadcasts.map((broadcast) => (
              <div key={broadcast.id} className={styles.recentRow}>
                <Send size={14} aria-hidden /><span className={styles.recentName} title={broadcast.title}>{broadcast.title}</span>
                <span className="text-ink-faint">{broadcast.sentAt || broadcast.scheduledAt ? formatDateTime(broadcast.sentAt ?? broadcast.scheduledAt ?? '') : '下書き'} ・ {broadcast.totalCount == null ? '—' : `${formatNumber(broadcast.totalCount)}人`}</span>
                <Button size="compact" onClick={() => duplicateRecent(broadcast)}>複製する</Button>
              </div>
            )) : <p className="text-xs text-ink-faint">最近の配信はまだありません。</p>}
          </div>
        </section>)
}
