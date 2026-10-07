'use client'

/*
 * 成果をまとめて操作（★V8-B `hadfk`：手順1/3「操作を選ぶ」・640幅）。
 * 写し元：app/affiliates/bulk-op-wizard.tsx。手順2「確かめる」・手順3「結果」は、
 * 呼び出し側の確かめ窓・結果の知らせを使う（今と同じ）。
 *
 * 認めない札の補足に「理由を書きます」とは書かない。却下理由の記録は未接続のため。
 */
import { useState } from 'react'
import { ArrowRight, Check, ListChecks, X } from 'lucide-react'
import Dialog from '@/components/shared/dialog'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Stepper from '@/components/shared/stepper'
import { formatNumber } from '@/lib/format'
import styles from './affiliates.module.css'

export type BulkOpChoice = 'approved' | 'rejected'

export interface BulkOpTarget {
  id: string
  displayName: string
  amountYen: number
}

export default function BulkOpWizard({
  open,
  targets,
  onReselect,
  onClose,
  onChoose,
}: {
  open: boolean
  targets: BulkOpTarget[]
  onReselect: () => void
  onClose: () => void
  onChoose: (choice: BulkOpChoice) => void
}) {
  const [choice, setChoice] = useState<BulkOpChoice>('approved')
  const totalYen = targets.reduce((sum, target) => sum + target.amountYen, 0)
  const shownNames = targets.slice(0, 2).map((target) => target.displayName).join('・')
  const restCount = targets.length - Math.min(targets.length, 2)

  return (
    <Dialog
      open={open}
      designNode="hadfk"
      designWidth={640}
      title="成果をまとめて操作"
      description="対象を確認してから操作を選んでください"
      onCancel={onClose}
      steps={(
        <Stepper
          label="まとめて操作の進み"
          currentKey="choose"
          steps={[
            { key: 'choose', label: '操作を選ぶ', state: 'current' },
            { key: 'confirm', label: '確かめる', state: 'todo' },
            { key: 'result', label: '結果', state: 'todo' },
          ]}
        />
      )}
      footerLead={<span className={styles.dialogStep}>手順 1 / 3</span>}
      cancelLabel="閉じる"
      confirmLabel="実行内容を確認"
      confirmIcon={<ArrowRight size={15} />}
      onConfirm={() => onChoose(choice)}
    >
      <div className={styles.bulkBody}>
      <div className={styles.bulkTargets}>
        <ListChecks size={15} aria-hidden="true" />
        <span className={styles.bulkTargetsText}>
          {`選択した成果 ${formatNumber(targets.length)}件：${shownNames}${restCount > 0 ? `ほか${formatNumber(restCount)}件` : ''}（報酬 ¥${formatNumber(totalYen)}）`}
        </span>
        <button type="button" className={styles.linkButton} onClick={onReselect}>選び直す</button>
      </div>
      <RadioCardGroup legend="操作の選択" className={styles.bulkChoices}>
        <RadioCard
          name="bulk-op-choice"
          value="approved"
          checked={choice === 'approved'}
          onChange={() => setChoice('approved')}
          icon={<Check size={15} aria-hidden="true" />}
          title="認める"
          note="次の締めで報酬に入ります"
        />
        <RadioCard
          name="bulk-op-choice"
          value="rejected"
          checked={choice === 'rejected'}
          onChange={() => setChoice('rejected')}
          icon={<X size={15} aria-hidden="true" />}
          title="認めない"
          note="報酬に入りません"
        />
      </RadioCardGroup>
      </div>
    </Dialog>
  )
}
