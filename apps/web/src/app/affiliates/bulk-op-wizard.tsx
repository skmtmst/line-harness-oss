'use client'

import { useState } from 'react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Stepper from '@/components/shared/stepper'
import { formatNumber } from '@/lib/format'

export type BulkOpChoice = 'approved' | 'rejected'

export interface BulkOpTarget {
  id: string
  displayName: string
  amountYen: number
}

/**
 * 成果をまとめて操作（★V8-B `hadfk`：手順1/3「操作を選ぶ」）。
 *
 * 手順2「確かめる」・手順3「結果」は、既存の確かめ窓・結果の知らせを使う。
 * 呼び出し側が選んだ操作で既存の確かめ窓を開く。
 *
 * 認めない札の補足に「理由を書きます」とは書かない。却下理由の記録は
 * 未接続のため（画面の注意書きどおり）、書けることだけを書く。
 */
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
      title="成果をまとめて操作"
      description="対象を確認してから操作を選んでください"
      onCancel={onClose}
      footer={(
        <div className="border-hairline flex items-center justify-between gap-2 border-t pt-4">
          <p className="text-ink-faint text-xs">手順 1 / 3</p>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={onClose}>閉じる</Button>
            <Button type="button" variant="primary" onClick={() => onChoose(choice)}>
              実行内容を確認
            </Button>
          </div>
        </div>
      )}
    >
      <Stepper
        label="まとめて操作の進み"
        currentKey="choose"
        steps={[
          { key: 'choose', label: '操作を選ぶ', state: 'current' },
          { key: 'confirm', label: '確かめる', state: 'todo' },
          { key: 'result', label: '結果', state: 'todo' },
        ]}
      />
      <div className="rounded-control border border-hairline bg-canvas-sunken px-4 py-3 text-sm">
        <p className="text-ink">
          選択した成果{formatNumber(targets.length)}件：{shownNames}
          {restCount > 0 ? `ほか${formatNumber(restCount)}件` : null}（報酬¥{formatNumber(totalYen)}）
        </p>
        <div className="mt-1 text-right">
          <button type="button" className="text-action text-sm underline" onClick={onReselect}>
            選び直す
          </button>
        </div>
      </div>
      <RadioCardGroup legend="操作の選択" className="mt-3 grid gap-3 sm:grid-cols-2">
        <RadioCard
          name="bulk-op-choice"
          value="approved"
          checked={choice === 'approved'}
          onChange={() => setChoice('approved')}
          title="認める"
          note="次の締めで報酬に入ります"
        />
        <RadioCard
          name="bulk-op-choice"
          value="rejected"
          checked={choice === 'rejected'}
          onChange={() => setChoice('rejected')}
          title="認めない"
          note="報酬に入りません"
        />
      </RadioCardGroup>
    </Dialog>
  )
}
