'use client'

import { useMemo, useState } from 'react'
import { FlaskConical, Info, Plus } from 'lucide-react'
import type { FormBlock } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import HelpTip from '@/components/shared/help-tip'
import { RowMenu } from '@/components/shared/row-actions'
import ReorderHandle, { useReorder } from '@/components/shared/reorder-handle'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import Toggle from '@/components/shared/toggle'
import type { FormRefs } from '@/components/forms/form-refs'
import type { FormRouting, RoutingRule, RoutingTarget } from '@/lib/api-gap2'
import { choiceModeLabel, emptyRouting, hasBookingBlock, matchRule, MAX_ROUTING_ROWS, newRule, routingError, routingQuestions, ruleAnswer } from './routing-model'
import styles from './routing-section.module.css'

const MODES = [{ value: '', label: '指定しない' }, { value: 'in_person', label: 'お店で' }, { value: 'online', label: 'オンライン' }]

/*
 * 回答フォーム 編集 › 中身 の区画「答えで予約の行き先を分ける」（B6-1・BGoRL）。
 * 表の 1 行 1 決まり・上から順に当てる・最後の行は消せない。「試しに答える」は保存せず、当たった行を緑で光らせる。
 * 閲覧のみの人には編集を出さず、試しだけ使える（何も変えないため）。決まりは回答フォームの版に含める。
 */
export default function RoutingSection({ blocks, refs, routing, readOnly, onChange }: {
  blocks: FormBlock[]
  refs: FormRefs
  routing: FormRouting | undefined
  readOnly?: boolean
  onChange: (next: FormRouting) => void
}) {
  const questions = useMemo(() => routingQuestions(blocks), [blocks])
  const value = routing ?? emptyRouting()
  const [trying, setTrying] = useState(false)
  const [trial, setTrial] = useState('')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const questionId = value.questionId ?? value.rules[0]?.conditions[0]?.questionId ?? questions[0]?.id ?? ''
  const question = questions.find((q) => q.id === questionId) ?? null
  const menus = refs.bookingMenus ?? []
  const reorder = useReorder({ items: value.rules, idOf: (r) => r.id, disabledReason: readOnly ? '閲覧のみのため並べ替えられません' : null, onReorder: ({ ids }) => onChange({ ...value, rules: ids.map((id) => value.rules.find((r) => r.id === id)!) }) })
  const problem = routingError(value)
  if (!hasBookingBlock(blocks) || questions.length === 0) return null

  const hit = trying && trial && question ? matchRule(value, question.id, [trial]) : null
  const answersLeft = (question?.choices ?? []).filter((c) => !value.rules.some((r) => ruleAnswer(r) === c.label))
  const set = (patch: Partial<FormRouting>) => onChange({ ...value, ...patch })
  const setRule = (id: string, patch: Partial<RoutingRule>) => set({ rules: value.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
  const setTarget = (target: RoutingTarget, patch: Partial<RoutingTarget>): RoutingTarget => ({ ...target, ...patch, ...(patch.menuId !== undefined && patch.menuId !== target.menuId ? { staffId: null, staffGroupId: null } : {}) })
  const menuOptions = [{ value: '', label: 'メニューを選ぶ' }, ...menus.map((m) => ({ value: m.id, label: `${m.name} ${m.durationMinutes} 分` }))]
  const staffOptions = (menuId: string) => [{ value: '', label: '全員' }, ...(refs.bookingMenuStaff?.[menuId] ?? []).map((s) => ({ value: s.id, label: s.name }))]

  const targetCells = (target: RoutingTarget, update: (next: RoutingTarget) => void, label: string, invalid: boolean) => <>
    <span className={styles.cell}>{readOnly ? <span>{menus.find((m) => m.id === target.menuId)?.name ?? '—'}</span> : <Select aria-label={`${label}の出すメニュー`} invalid={invalid} value={target.menuId} options={menuOptions} onChange={(v) => update(setTarget(target, { menuId: v }))} />}</span>
    <span className={styles.cell}>{readOnly ? <span>{target.staffId ? (refs.bookingMenuStaff?.[target.menuId] ?? []).find((s) => s.id === target.staffId)?.name : '全員'}</span> : <Select aria-label={`${label}の担当`} value={target.staffId ?? ''} options={staffOptions(target.menuId)} onChange={(v) => update(setTarget(target, { staffId: v || null }))} disabled={!target.menuId} />}</span>
    <span className={styles.cell}>{readOnly ? <span>{MODES.find((m) => m.value === (target.meetingMode ?? ''))?.label}</span> : <Select aria-label={`${label}の会い方`} value={target.meetingMode ?? ''} options={MODES} onChange={(v) => update(setTarget(target, { meetingMode: (v || null) as RoutingTarget['meetingMode'] }))} />}</span>
  </>

  return (
    <Card layout="vertical" contentPadding="var(--tpl-fe-card-pad)" gap="var(--tpl-fe-card-gap)" aria-labelledby="fe-routing-title">
      <div className={styles.head}>
        <span className={styles.title}>
          <h2 id="fe-routing-title" className={styles.h2}>答えで予約の行き先を分ける</h2>
          <HelpTip label="答えで予約の行き先を分けるの説明">質問への答えに合わせて、予約のメニューと担当を自動で決めます。上の行から順に当てはめ、どれにも当たらないときは最後の行へ進みます。</HelpTip>
        </span>
        <span className={styles.actions}>
          {value.enabled ? <Button variant="secondary" icon={<FlaskConical size={16} aria-hidden="true" />} onClick={() => { setTrying((v) => !v); setTrial('') }} aria-pressed={trying}>試しに答える</Button> : null}
          {readOnly ? null : <Toggle label="答えで予約の行き先を分ける" checked={value.enabled} onChange={(enabled) => set({ enabled })} />}
        </span>
      </div>
      {value.enabled ? <>
        <div className={styles.questionRow}>
          <span className={styles.label}>分ける質問</span>
          {readOnly ? <span>{question?.label}</span> : <Select aria-label="分ける質問" value={questionId} options={questions.map((q) => ({ value: q.id, label: `${q.label}（${choiceModeLabel(q.type)}）` }))}
            onChange={(id) => set({ questionId: id, rules: [] })} />}
          <span className={styles.hint}>使える質問：1 つ選ぶ・いくつでも選ぶ・プルダウン</span>
        </div>
        <p className={styles.info}><Info aria-hidden="true" size={16} />行き先はこの表で決まるので、お客さまにはメニューと担当を選ばせず日時から始めます（下の「メニューを選んでもらう」は使いません）。上の行から順に当てはめます。</p>
        {trying && question ? <div className={styles.trial} role="group" aria-label="試しに答える">
          <span>もしお客さまが「{question.label}」に</span>
          <Select aria-label="試しの答え" value={trial} options={[{ value: '', label: '答えを選ぶ' }, ...(question.choices ?? []).map((c) => ({ value: c.label, label: c.label }))]} onChange={setTrial} />
          <span>と答えたら</span>
          {trial ? <strong>{hit === -1 || hit === null ? '「どれにも当たらないとき」の行き先になります（保存はされません）' : `${(hit ?? 0) + 1} 行目の行き先になります（保存はされません）`}</strong> : null}
        </div> : null}
        <div className={styles.table} role="table" aria-label="行き先の表">
          <div className={styles.headRow} role="row"><span /><span>もし「{question?.label ?? '質問'}」が</span><span>出すメニュー</span><span>担当の組</span><span>会い方</span><span /></div>
          {(readOnly ? value.rules : reorder.shown).map((rule, index) => {
            const invalid = problem?.row === index
            return (
              <div key={rule.id} className={styles.row} role="row" data-hit={hit === index || undefined} data-invalid={invalid || undefined} {...reorder.rowProps(rule.id)}>
                <span className={styles.grip}>{readOnly ? null : <ReorderHandle look="icon" label={`${index + 1} 行目`} {...reorder.handle(rule.id)} {...reorder.handleProps(rule.id)} />}</span>
                <span className={styles.cond}>〈{ruleAnswer(rule)}〉</span>
                {targetCells(rule.target, (target) => setRule(rule.id, { target }), `${index + 1} 行目`, invalid)}
                <span className={styles.more}>{readOnly ? null : <RowMenu appearance="box" size="row" label={`${index + 1} 行目のそのほかの操作`} open={openMenu === rule.id} onOpenChange={(o) => setOpenMenu(o ? rule.id : null)}
                  items={[...reorder.menuItems(rule.id, () => setOpenMenu(null)), { id: 'delete', label: '削除する', tone: 'danger', onSelect: () => { set({ rules: value.rules.filter((r) => r.id !== rule.id) }); setOpenMenu(null) } }]} />}</span>
              </div>
            )
          })}
          <div className={styles.row} role="row" data-fallback data-hit={(hit === -1) || undefined} data-invalid={problem?.row === value.rules.length || undefined}>
            <span />
            <span className={styles.cond}>どれにも当たらない<StatusBadge size="compact" dot={false}>消せない</StatusBadge></span>
            {targetCells(value.fallback, (fallback) => set({ fallback }), 'どれにも当たらないとき', problem?.row === value.rules.length)}
            <span className={styles.more}>—</span>
          </div>
        </div>
        {problem ? <p className={styles.error} role="alert">{problem.message}</p> : null}
        {readOnly ? null : <div className={styles.add}>
          <Button variant="text" icon={<Plus size={16} aria-hidden="true" />} disabled={answersLeft.length === 0 || value.rules.length >= MAX_ROUTING_ROWS} onClick={() => question && set({ rules: [...value.rules, newRule(question.id, answersLeft[0].label)] })}>行き先を追加</Button>
          {value.rules.length >= MAX_ROUTING_ROWS ? <span className={styles.hint}>{MAX_ROUTING_ROWS} 行までです</span> : answersLeft.length === 0 ? <span className={styles.hint}>この質問の答えはすべて表にあります</span> : null}
        </div>}
      </> : null}
    </Card>
  )
}
