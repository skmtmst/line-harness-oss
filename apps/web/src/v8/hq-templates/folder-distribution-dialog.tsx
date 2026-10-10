'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'
import type { HqTemplateFolder } from '@line-crm/shared'
import type { HqAccount, HqTemplate } from '@/lib/hq-templates-api'
import Dialog from '@/components/shared/dialog'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import StatusBadge from '@/components/shared/status-badge'
import TagPill from '@/components/shared/tag-pill'
import { folderDisplayColor } from '@/components/shared/folder-dot'
import { HqAccountPickerField } from '@/components/shared/hq-account-picker'
import styles from './folder-distribution-dialog.module.css'
import { SaveErrorField } from '@/components/shared/save-form-errors'

export function distributionKind(row: HqTemplate) {
  if (row.template_type === 'template' && (row.kind ?? 'message') === 'message' && row.content_summary) return row.content_summary.replace(/\s+\d+$/u, '')
  return row.template_type === 'template' ? ({ message: 'メッセージ', carousel: 'カルーセル', rich_message: 'リッチメッセージ', question: '質問', coupon: 'クーポン', research: 'リサーチ' }[row.kind ?? 'message'])
    : ({ tag: 'タグ', rich_menu: 'リッチメニュー', form: '回答フォーム', scenario: 'シナリオ' }[row.template_type])
}
export default function FolderDistributionDialog({ name, templates, templateFolders = [], accounts, busy, error, onCancel, onConfirm }: {
  name: string; templates: HqTemplate[]; templateFolders?: HqTemplateFolder[]; accounts: HqAccount[]; busy: boolean; error?: string
  onCancel: () => void; onConfirm: (templates: HqTemplate[], ids: string[]) => void
}) {
  const [picked, setPicked] = useState(templates.map((row) => row.id))
  const [selected, setSelected] = useState<string[]>([])
  return <Dialog open designNode="JSirC" designWidth={620} title={`フォルダ「${name}」の ${templates.length} 件を配る`}
    description="フォルダの中のひな形をまとめて、選んだアカウントへ配ります。"
    busy={busy} error={error} onCancel={onCancel}
    designHeaderPadding="24px 24px 8px" designContentPadding="8px 24px 20px"
    footer={<div className={styles.footer}>
      <Button disabled={busy} onClick={onCancel}>キャンセル</Button>
      <Button variant="primary" disabled={busy || !picked.length || !selected.length} onClick={() => onConfirm(templates.filter((row) => picked.includes(row.id)), selected)}>
        <Send size={15} aria-hidden="true" />{`${picked.length} 件を ${selected.length} アカウントへ配る`}
      </Button>
    </div>}
  >
    <div className={styles.sections}>
      <section className={styles.section} aria-label="配るひな形">
        <div className={styles.heading}><strong>配るひな形</strong><span>{`${picked.length} / ${templates.length} 件を選択`}</span></div>
        <div className={styles.list}>
          {templates.map((row, saveFieldIndex) => {
            const folder = templateFolders.find((folder) => folder.id === row.folder_id)
            return <div className={styles.row} key={row.id}>
            <SaveErrorField names={[`templates.${saveFieldIndex}.id`,"id","row.id","picked"]}><Checkbox checked={picked.includes(row.id)} disabled={busy} onCheckedChange={(checked) => setPicked((ids) => checked ? [...ids, row.id] : ids.filter((id) => id !== row.id))}>{row.template_type === 'tag' ? <TagPill name={row.name} color={folder ? folderDisplayColor(folder) : null} size="sm" /> : row.name}</Checkbox></SaveErrorField>
            <StatusBadge size="compact" tone="neutral">{distributionKind(row)}</StatusBadge>
          </div>
          })}
        </div>
      </section>
      <section className={styles.section} aria-label="配る先">
        <div className={styles.heading}><strong>配る先</strong><span>{`${selected.length} アカウントを選択`}</span></div>
        <HqAccountPickerField label="配る先" title="配るアカウントを選ぶ" accounts={accounts} value={selected} onChange={setSelected} disabled={busy} />
      </section>
      <p className={styles.note}>同じ名前のひな形があるアカウントは、配布方法（上書き・新しく作る）を次の確認で選べます。</p>
    </div>
  </Dialog>
}
