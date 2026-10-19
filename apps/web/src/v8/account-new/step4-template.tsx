import Card from '@/components/shared/card'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import type { AccountStyle } from '@line-crm/shared'
import { CreateStepColumns } from '@/components/templates/create-step-columns'
import { templateOptions } from './check-rows'
import styles from './register.module.css'

/*
 * ★LINE新規追加_v07.pen（2026-10-18承認）④使い方を選ぶ X0pGdw の描画だけ。
 * register.tsx が行数の関所（apps/web/scripts/v8-guard/code-size.mjs）を越えたので
 * 切り出した。状態は持たず、register.tsx から受け取って出すだけ（見た目は変えていない）。
 */
export default function Step4Template({ templateKey, onPick }: {
  templateKey: string
  onPick: (key: AccountStyle) => void
}) {
  return (
    <CreateStepColumns data-design-node="X0pGdw" previewTitle="あとから変えられます" preview={(
        <Card className={styles.aside} layout="vertical" surface="muted" contentPadding="var(--tpl-htn-aside-pad)" gap="var(--tpl-htn-aside-gap)" aria-label="あとから変えられます">
        <h2 className={styles.asideH2}>あとから変えられます</h2>
        <p className={styles.asideP}>選んだ使い方でダッシュボードの並びが決まります。</p>
        <p className={styles.asideP}>カードは、あとから自分で足し引きできます。</p>
      </Card>
      )}>
      <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label="使い方を選ぶ">
        <h2 className={styles.panelTitle}>いちばん近い使い方を選んでください</h2>
        <RadioCardGroup legend="いちばん近い使い方" columns={2}>
          {templateOptions().map((option) => (
            <RadioCard
              key={option.key} name="template" value={option.key} title={option.label} note={option.note}
              checked={templateKey === option.key}
              ariaLabel={option.label}
              onChange={() => onPick(option.key)}
            />
          ))}
        </RadioCardGroup>
      </Card>
    </CreateStepColumns>
  )
}
