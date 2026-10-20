'use client'

import { useMemo } from 'react'
import { CircleCheck, Circle, TriangleAlert } from 'lucide-react'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import { PREPARING_WORD, usePreparingDialog } from '@/components/shared/preparing-dialog'
import { FEATURES, featureHref, sampleMenuFor, featureName, summarizeSetup, type SetupSummary, type TodoRow } from './model'
import type { StyleSetupData } from './use-style-setup'
import styles from './setup-card.module.css'

/*
 * ダッシュボードの警告の帯と「はじめにやること」（★V8 修正案 Bdfxm。決まり  追記）。
 * - 中身が決まっていないのにリッチメニューにボタンがある物は、上の帯で知らせる（押すとその設定の画面へ）。
 * - はじめにやること：済んだ数／全部・進みの線・［質問の続きを開く］。あとで設定した質問・止めている
 *   自動の送信・見本の画像のまま、を 1 行ずつ。最後に済んだ物の 1 行。
 */

export function setupSummary(data: StyleSetupData | null): SetupSummary | null {
  if (!data) return null
  const summary = summarizeSetup(data.state, data.warnings, data.items)
  return summary.rows.length > 0 ? summary : null
}

/** 上の警告の帯（Bdfxm の「帯/注意（行き先つき）」）。機能ごとに 1 本。 */
export function SetupWarningBands({ data }: { data: StyleSetupData }) {
  const preparing = usePreparingDialog()
  const seen = new Set<string>()
  const warnings = data.warnings.filter((warning) => (seen.has(warning.feature) ? false : (seen.add(warning.feature), true)))
  if (warnings.length === 0) return null
  const tiles = sampleMenuFor(data.state.style).tiles
  return (
    <>
      {warnings.map((warning) => {
        const button = tiles.find((tile) => tile.feature === warning.feature)?.label ?? featureName(warning.feature)
        return (
          <Notice key={warning.feature} tone="warn" appearance="soft" action={FEATURES[warning.feature]?.preparing ? <Button onClick={() => preparing.open(FEATURES[warning.feature]!.preparing!)}>決まりを入れる</Button> : <Button href={featureHref(warning.feature, warning.href, data.state.style)}>決まりを入れる</Button>}>
            {`リッチメニューに「${button}」のボタンがありますが、${featureName(warning.feature)}の決まりがまだです。お客さまには「${PREPARING_WORD}」と出ています。`}
          </Notice>
        )
      })}
      {preparing.dialog}
    </>
  )
}

export function SetupCard({ summary, onOpenStep }: { summary: SetupSummary; onOpenStep: (step: string | number) => void }) {
  const preparing = usePreparingDialog()
  const rate = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0
  const doneText = useMemo(() => {
    const names = summary.doneNames.slice(0, 3).join('・')
    return `済み ${summary.done}件（${names}${summary.doneNames.length > 3 ? ' ほか' : ''}）`
  }, [summary])
  return (
    <Card layout="vertical" contentPadding="var(--sc-pad)" gap="var(--sc-gap)" className={styles.card} aria-labelledby="setup-card-title" data-design-node="Bdfxm">
      <div className={styles.head}>
        <h2 id="setup-card-title" className={styles.title}>使い方の設定</h2>
        <HelpTip label="使い方の設定の説明">選んだ機能だけの設定です。「はじめの設定」の完了条件とは別に、あとで設定する物や動かす前の確認を表示します。</HelpTip>
        <span className={styles.spacer} />
        <span className={styles.count}>{`${summary.done} / ${summary.total} 済み`}</span>
        <Button onClick={() => onOpenStep(summary.nextStep)}>質問の続きを開く</Button>
      </div>
      <span className={styles.track} role="progressbar" aria-label="使い方の設定の進み" aria-valuemin={0} aria-valuemax={summary.total} aria-valuenow={summary.done}>
        <span className={styles.fill} style={{ width: `${rate}%` }} />
      </span>
      <ul className={styles.rows}>
        {summary.rows.map((row) => <SetupRow key={row.key} row={row} onOpenStep={onOpenStep} onPreparing={preparing.open} />)}
      </ul>
      {summary.done > 0 ? (
        <p className={styles.done}>
          <CircleCheck aria-hidden="true" className={styles.doneIcon} />
          <span className={styles.doneText}>{doneText}</span>
          <span className={styles.spacer} />
          <button type="button" className={styles.link} onClick={() => onOpenStep(0)}>済んだ物を見る</button>
        </p>
      ) : null}
      {preparing.dialog}
    </Card>
  )
}

function SetupRow({ row, onOpenStep, onPreparing }: { row: TodoRow; onOpenStep: (step: string | number) => void; onPreparing: (feature: string) => void }) {
  const Icon = row.alert ? TriangleAlert : Circle
  return (
    <li className={styles.row} data-alert={row.alert || undefined}>
      <Icon aria-hidden="true" className={styles.rowIcon} />
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{row.title}</span>
        <span className={styles.rowNote}>{row.note}</span>
      </span>
      <StatusBadge tone={row.badge.tone} dot>{row.badge.label}</StatusBadge>
      {row.action.preparing
        ? <Button onClick={() => onPreparing(row.action.preparing!)}>{row.action.label}</Button>
        : row.action.href
          ? <Button href={row.action.href}>{row.action.label}</Button>
          : <Button onClick={() => onOpenStep(row.action.step ?? 0)}>{row.action.label}</Button>}
    </li>
  )
}
