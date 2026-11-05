'use client'

import EntitySelect from '@/components/shared/entity-select'

import { DataTable, TableHeadRow, Tr, Td, Th, HandleCell, ActionCell } from '@/components/shared/table'

import Notice from '@/components/shared/notice'

import { useMemo, useRef, useState } from 'react'
import { Play, Plus } from 'lucide-react'
import type { FormBlock } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import HelpTip from '@/components/shared/help-tip'
import { RowMenu } from '@/components/shared/row-actions'
import ReorderHandle, { useReorder } from '@/components/shared/reorder-handle'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import Toggle from '@/components/shared/toggle'
import type { FormRefs } from '@/components/forms/form-refs'
import { choiceModeLabel, type FormRouting, type RoutingRule, type RoutingTarget, emptyRouting, hasBookingBlock, MAX_ROUTING_ROWS, newRule, routingError, routingQuestions, ruleAnswer } from './routing-model'
import styles from './routing-section.module.css'

const MODES = [{ value: '', label: '指定しない' }, { value: 'in_person', label: 'お店で' }, { value: 'online', label: 'オンライン' }]

/*
 * 回答フォーム 編集 › 中身 の区画「答えで予約の行き先を分ける」（B6-1・BGoRL）。
 * 表の 1 行 1 決まり・上から順に当てる・最後の行は消せない。「試しに答える」は保存せず、当たった行を緑で光らせる。
 * 閲覧のみの人には編集を出さず、試しだけ使える（何も変えないため）。決まりは回答フォームの版に含める。
 */
export default function RoutingSection({ blocks, refs, routing, readOnly, onChange, onPreview, previewScope }: {
  blocks: FormBlock[]
  refs: FormRefs
  routing: FormRouting | undefined
  readOnly?: boolean
  onChange: (next: FormRouting) => void
  onPreview?: (answers: Record<string, unknown>) => Promise<{ matchedIndex: number; fellBack: boolean; target: RoutingTarget; usable: boolean }>
  previewScope?: string
}) {
  const questions = useMemo(() => routingQuestions(blocks), [blocks])
  const value = routing ?? emptyRouting()
  const [trying, setTrying] = useState(false)
  const [trial, setTrial] = useState('')
  const [trialAnswers, setTrialAnswers] = useState<Record<string, unknown>>({})
  const [trialResult, setTrialResult] = useState<{ matchedIndex: number; fellBack: boolean; target: RoutingTarget; scope: string; request: number } | null>(null)
  const [trialError, setTrialError] = useState<{ scope: string; request: number; message: string } | null>(null)
  const trialRequest = useRef(0)
  const scope = JSON.stringify([previewScope, blocks, routing])
  const currentScope = useRef(scope)
  const answersScope = useRef(scope)
  if (currentScope.current !== scope) {
    currentScope.current = scope
    answersScope.current = ''
    trialRequest.current += 1
  }
  const visibleAnswers = answersScope.current === scope ? trialAnswers : {}
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [pickedQuestion, setPickedQuestion] = useState<string | null>(null)
  const [pendingQuestion, setPendingQuestion] = useState<{ id: string; scope: string } | null>(null)
  const questionId = value.rules[0]?.conditions[0]?.questionId ?? pickedQuestion ?? questions[0]?.id ?? ''
  const question = questions.find((q) => q.id === questionId) ?? null
  const relevantIds = new Set(value.rules.flatMap((r) => r.conditions.map((c) => c.questionId)))
  const trialQuestions = blocks.filter((b): b is Extract<FormBlock, { kind: 'input' }> => b.kind === 'input' && (relevantIds.size ? relevantIds.has(b.id) : b.id === questionId))
  const menus = refs.bookingMenus ?? []
  const ruled = value.rules.map((r, i) => ({ ...r, id: `r${i}` }))
  const reorder = useReorder({ items: ruled, idOf: (r) => r.id, disabledReason: readOnly ? '閲覧のみのため並べ替えられません' : null, onReorder: ({ ids }) => { trialRequest.current++; setTrial(''); setTrialAnswers({}); setTrialResult(null); setTrialError(null); onChange({ ...value, rules: ids.map((id) => value.rules[Number(id.slice(1))]) }) } })
  const problem = routingError(value)
  if (!hasBookingBlock(blocks)) return null

  const visibleResult = trialResult?.scope === scope && trialResult.request === trialRequest.current ? trialResult : null
  const hit = trying && trial ? visibleResult?.matchedIndex ?? null : null
  const runTrial = async (name: string, answer: string | string[] | number) => {
    setTrial('selected')
    const answers = { ...visibleAnswers, [name]: answer }
    answersScope.current = scope
    setTrialAnswers(answers)
    setTrialResult(null)
    setTrialError(null)
    const request = ++trialRequest.current
    if (!onPreview) return
    try {
      const result = await onPreview(answers)
      if (request === trialRequest.current && scope === currentScope.current) setTrialResult({ ...result, scope, request })
    } catch {
      if (request === trialRequest.current && scope === currentScope.current) setTrialError({ scope, request, message: '試しに答える結果を確認できませんでした。行き先を確認して、もう一度お試しください。' })
    }
  }
  const answersLeft = (question?.choices ?? []).filter((c) => !value.rules.some((r) => ruleAnswer(r) === c.label))
  const set = (patch: Partial<FormRouting>) => { trialRequest.current++; setTrial(''); setTrialAnswers({}); setTrialResult(null); setTrialError(null); onChange({ ...value, ...patch }) }
  const setRule = (id: string, patch: Partial<RoutingRule>) => set({ rules: value.rules.map((r, i) => (`r${i}` === id ? { ...r, ...patch } : r)) })
  const setTarget = (target: RoutingTarget, patch: Partial<RoutingTarget>): RoutingTarget => ({ ...target, ...patch, ...(patch.menuId !== undefined && patch.menuId !== target.menuId ? { staffId: undefined, staffGroupId: undefined } : {}) })
  const menuOptions = [{ value: '', label: 'メニューを選ぶ' }, ...menus.map((m) => ({ value: m.id, label: `${m.name} ${m.durationMinutes} 分` }))]
  const lockReason = readOnly ? '閲覧のみのため変更できません' : undefined
  const staffValue = (target: RoutingTarget) => target.staffGroupId ? `group:${target.staffGroupId}` : target.staffId ? `staff:${target.staffId}` : ''
  const staffOptions = (target: RoutingTarget) => {
    const options = [{ value: '', label: '全員' }, ...(refs.bookingRoutingGroups ?? []).map((g) => ({ value: `group:${g.id}`, label: `組：${g.name}` })), ...(refs.bookingMenuStaff?.[target.menuId] ?? []).map((s) => ({ value: `staff:${s.id}`, label: s.name }))]
    const current = staffValue(target)
    return current && !options.some(option => option.value === current) ? [...options, { value: current, label: '現在の担当を確認できません' }] : options
  }

  const targetCells = (target: RoutingTarget, update: (next: RoutingTarget) => void, label: string, invalid: boolean) => <>
    <Td><EntitySelect size="full" aria-label={`${label}の出すメニュー`} lockedReason={lockReason ?? refs.bookingRoutingLockedReason} invalid={invalid} value={target.menuId} options={target.menuId && !menus.some(menu => menu.id === target.menuId) ? [...menuOptions, { value: target.menuId, label: '現在のメニューを確認できません' }] : menuOptions} onChange={(v) => update(setTarget(target, { menuId: v }))} /></Td>
    <Td><EntitySelect size="full" aria-label={`${label}の担当`} lockedReason={lockReason ?? refs.bookingRoutingLockedReason} value={staffValue(target)} options={staffOptions(target)} onChange={(v) => update(setTarget(target, { staffId: v.startsWith('staff:') ? v.slice(6) : undefined, staffGroupId: v.startsWith('group:') ? v.slice(6) : undefined }))} disabled={!readOnly && !refs.bookingRoutingLockedReason && (!target.menuId || refs.bookingRoutingGroups == null)} disabledReason={!target.menuId ? '先にメニューを選んでください' : refs.bookingRoutingGroups == null ? '担当の組を確認できません' : undefined} /></Td>
    <Td><Select size="full" aria-label={`${label}の会い方`} lockedReason={lockReason} value={target.meetingMode ?? ''} options={MODES} onChange={(v) => update(setTarget(target, { meetingMode: (v || undefined) as RoutingTarget['meetingMode'] }))} /></Td>
  </>

  return (
    <Card layout="vertical" contentPadding="var(--tpl-fe-card-pad)" gap="var(--tpl-fe-card-gap)" aria-labelledby="fe-routing-title">
      <div className={styles.head}>
        <span className={styles.title}>
          <h2 id="fe-routing-title" className={styles.h2}>答えで予約の行き先を分ける</h2>
          <HelpTip label="答えで予約の行き先を分けるの説明">質問への答えに合わせて、予約のメニューと担当を自動で決めます。行き先はこの表で決まるので、お客さまにはメニューと担当を選ばせず日時から始めます（下の「メニューを選んでもらう」は使いません）。上の行から順に当てはめ、どれにも当たらないときは最後の行へ進みます。</HelpTip>
        </span>
        <span className={styles.actions}>
          {value.enabled ? <Button variant="secondary" icon={<Play size={16} aria-hidden="true" />} disabled={!onPreview} disabledReason={!onPreview ? 'フォームを保存してから試せます' : undefined} onClick={() => { trialRequest.current++; setTrying((v) => !v); setTrial(''); setTrialAnswers({}); setTrialResult(null); setTrialError(null) }} aria-expanded={trying} aria-controls="routing-trial">試しに答える</Button> : null}
          <Toggle label="答えで予約の行き先を分ける" checked={value.enabled} lockedReason={readOnly ? '閲覧のみのため変更できません' : undefined} onChange={(enabled) => set({ enabled })} />
        </span>
      </div>
      {value.enabled ? <>
        <div className={styles.questionRow}>
          <span className={styles.label}>分ける質問</span>
          <EntitySelect aria-label="分ける質問" lockedReason={lockReason} disabled={!readOnly && questions.length === 0} value={questionId} options={questions.map((q) => ({ value: q.id, label: `${q.label}（${choiceModeLabel(q.type)}）` }))}
            onChange={(id) => { if (id === questionId) return; if (value.rules.length) setPendingQuestion({ id, scope }); else { setPickedQuestion(id); set({ rules: [] }) } }} />
          <span className={styles.hint}>使える質問：1 つ選ぶ・いくつでも選ぶ・プルダウン・5 段階</span>
        </div>
        {/* 決まり2: 行き先の決まりは帯にせず、題の横の「？」へ入れる。 */}
        {trying && question ? <div id="routing-trial" className={styles.trial} role="group" aria-label="試しに答える">
          <span>もしお客さまが次のように答えたら</span>
          {trialQuestions.map((q) => {
            const label = trialQuestions.length === 1 ? '試しの答え' : `試しの答え：${q.label}`
            const options = (q.choices ?? []).map((c) => ({ value: c.label, label: c.label }))
            return q.type === 'checkbox'
              ? <EntitySelect key={q.id} aria-label={label} values={Array.isArray(visibleAnswers[q.name]) ? visibleAnswers[q.name] as string[] : []} options={options} onChange={(answers) => runTrial(q.name, answers)} />
              : <Select key={q.id} aria-label={label} value={String(visibleAnswers[q.name] ?? '')} options={[{ value: '', label: '答えを選ぶ' }, ...(q.type === 'rating' ? [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) })) : options)]} onChange={(answer) => runTrial(q.name, q.type === 'rating' && answer ? Number(answer) : answer)} />
          })}
          <span>と答えたら</span>
          {visibleResult ? <strong>{visibleResult.fellBack ? '行き先が使えないため「どれにも当たらないとき」の行き先になります（保存はされません）' : hit === -1 ? '「どれにも当たらないとき」の行き先になります（保存はされません）' : `${(hit ?? 0) + 1} 行目の行き先になります（保存はされません）`}</strong> : null}
          {visibleResult ? <span>行き先：{menus.find((m) => m.id === visibleResult.target.menuId)?.name ?? 'メニューを確認してください'}</span> : null}
          {trialError?.scope === scope && trialError.request === trialRequest.current ? <Notice tone="danger">{trialError.message}</Notice> : null}
        </div> : null}
        <DataTable aria-label="行き先の表" columnWeights={[0.4, 1.8, 1.6, 1.4, 1.4, 0.4]}>
          <thead><TableHeadRow><Th aria-label="並べ替え" /><Th>答えの条件</Th><Th grow>出すメニュー</Th><Th>担当の組</Th><Th>会い方</Th><Th aria-label="操作" /></TableHeadRow></thead><tbody>
          {(readOnly ? ruled : reorder.shown).map((rule, index) => {
            const invalid = problem?.row === index
            const conditionText = rule.conditions.map((condition) => {
              const label = blocks.find((block) => block.id === condition.questionId && block.kind === 'input')
              const answer = condition.op === 'between' && Array.isArray(condition.value) ? condition.value.join('〜') : Array.isArray(condition.value) ? condition.value.join('・') : condition.value
              return rule.conditions.length > 1 || condition.questionId !== questionId ? `${label && label.kind === 'input' ? label.label : '質問'}：${answer}` : String(answer)
            }).join('、かつ ')
            const availableQuestions = questions.filter((q) => !rule.conditions.some((condition) => condition.questionId === q.id))
            const updateCondition = (conditionIndex: number, condition: RoutingRule['conditions'][number]) => setRule(rule.id, { conditions: rule.conditions.map((existing, i) => i === conditionIndex ? condition : existing) })
            return (
              <Tr key={rule.id} selected={hit === index} data-invalid={invalid || undefined} {...reorder.rowProps(rule.id)}>
                <HandleCell><ReorderHandle look="icon" label={`${index + 1} 行目`} {...reorder.handle(rule.id)} {...reorder.handleProps(rule.id)} lockedReason={lockReason} /></HandleCell>
                <Td>{question?.type === 'rating' && rule.conditions.length === 1 && rule.conditions[0].op === 'between' && Array.isArray(rule.conditions[0].value) ? <span className={styles.cond}>
                  <Select size="full" aria-label={`${index + 1} 行目の下限`} lockedReason={lockReason} value={String(rule.conditions[0].value[0])} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => { const upper = Number(rule.conditions[0].value[1]); setRule(rule.id, { conditions: [{ ...rule.conditions[0], op: 'between', value: [Number(v), Math.max(Number(v), upper)] }] }) }} />
                  〜
                  <Select size="full" aria-label={`${index + 1} 行目の上限`} lockedReason={lockReason} value={String(rule.conditions[0].value[1])} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => { const lower = Number(rule.conditions[0].value[0]); setRule(rule.id, { conditions: [{ ...rule.conditions[0], op: 'between', value: [Math.min(lower, Number(v)), Number(v)] }] }) }} />
                </span> : question && rule.conditions[0]?.questionId === question.id && rule.conditions[0].op === 'in' && Array.isArray(rule.conditions[0].value) ? <EntitySelect size="full" aria-label={`${index + 1} 行目の答え`} lockedReason={lockReason} values={rule.conditions[0].value as string[]} options={(question.choices ?? []).map((choice) => ({ value: choice.label, label: choice.label }))} onChange={(answers) => { if (answers.length) updateCondition(0, { ...rule.conditions[0], op: 'in', value: answers }) }} /> : question && question.type !== 'rating' && rule.conditions[0]?.questionId === question.id && rule.conditions[0].op === 'is' ? <Select size="full" aria-label={`${index + 1} 行目の答え`} lockedReason={lockReason} value={String(rule.conditions[0].value)} options={(question.choices ?? []).map((choice) => ({ value: choice.label, label: choice.label }))} onChange={(answer) => updateCondition(0, { ...rule.conditions[0], op: 'is', value: answer })} /> : <span className={styles.cond}><span title={conditionText}>〈{conditionText}〉</span></span>}
                {rule.conditions.slice(1).map((condition, offset) => {
                  const conditionIndex = offset + 1
                  const selectedQuestion = questions.find((q) => q.id === condition.questionId)
                  return <span className={styles.cond} key={conditionIndex}>
                    <EntitySelect size="full" aria-label={`${index + 1} 行目の条件 ${conditionIndex + 1} の質問`} lockedReason={lockReason} value={condition.questionId} options={questions.filter((q) => q.id === condition.questionId || !rule.conditions.some((c) => c.questionId === q.id)).map((q) => ({ value: q.id, label: q.label }))} onChange={(id) => { const q = questions.find((item) => item.id === id); if (q) updateCondition(conditionIndex, newRule(id, q.type === 'rating' ? [1, 5] : q.choices![0].label).conditions[0]) }} />
                    {selectedQuestion?.type === 'rating' && condition.op === 'between' && Array.isArray(condition.value) ? <>
                      <Select size="full" aria-label={`${index + 1} 行目の条件 ${conditionIndex + 1} の下限`} lockedReason={lockReason} value={String(condition.value[0])} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => updateCondition(conditionIndex, { ...condition, op: 'between', value: [Number(v), Math.max(Number(v), Number(condition.value[1]))] })} />
                      〜
                      <Select size="full" aria-label={`${index + 1} 行目の条件 ${conditionIndex + 1} の上限`} lockedReason={lockReason} value={String(condition.value[1])} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => updateCondition(conditionIndex, { ...condition, op: 'between', value: [Math.min(Number(condition.value[0]), Number(v)), Number(v)] })} />
                    </> : selectedQuestion && condition.op === 'in' && Array.isArray(condition.value) ? <EntitySelect size="full" aria-label={`${index + 1} 行目の条件 ${conditionIndex + 1} の答え`} lockedReason={lockReason} values={condition.value as string[]} options={(selectedQuestion.choices ?? []).map((choice) => ({ value: choice.label, label: choice.label }))} onChange={(answers) => { if (answers.length) updateCondition(conditionIndex, { ...condition, op: 'in', value: answers }) }} /> : selectedQuestion && condition.op === 'is' ? <Select size="full" aria-label={`${index + 1} 行目の条件 ${conditionIndex + 1} の答え`} lockedReason={lockReason} value={String(condition.value)} options={(selectedQuestion.choices ?? []).map((choice) => ({ value: choice.label, label: choice.label }))} onChange={(answer) => updateCondition(conditionIndex, { ...condition, op: 'is', value: answer })} /> : null}
                    <Button variant="text" lockedReason={lockReason} onClick={() => setRule(rule.id, { conditions: rule.conditions.filter((_, i) => i !== conditionIndex) })}>条件 {conditionIndex + 1} を外す</Button>
                  </span>
                })}</Td>
                {targetCells(rule.target, (target) => setRule(rule.id, { target }), `${index + 1} 行目`, invalid)}
                <ActionCell><RowMenu appearance="box" size="row" label={`${index + 1} 行目のそのほかの操作`} lockedReason={lockReason} open={openMenu === rule.id} onOpenChange={(o) => setOpenMenu(o ? rule.id : null)}
                  items={[...reorder.menuItems(rule.id, () => setOpenMenu(null)), ...(rule.conditions.length < 3 && availableQuestions.length ? [{ id: 'add-condition', label: '条件を追加する', onSelect: () => { const q = availableQuestions[0]; setRule(rule.id, { conditions: [...rule.conditions, newRule(q.id, q.type === 'rating' ? [1, 5] : q.choices![0].label).conditions[0]] }); setOpenMenu(null) } }] : []), { id: 'delete', label: '削除する', tone: 'danger', onSelect: () => { set({ rules: value.rules.filter((_, i) => `r${i}` !== rule.id) }); setOpenMenu(null) } }]} /></ActionCell>
              </Tr>
            )
          })}
          <Tr data-fallback selected={hit === -1} data-invalid={problem?.row === value.rules.length || undefined}>
            <HandleCell />
            <Td><span className={styles.cond}><span title="どれにも当たらないとき">どれにも当たらないとき</span><StatusBadge size="compact" dot={false}>消せない</StatusBadge></span></Td>
            {targetCells(value.fallback, (fallback) => set({ fallback }), 'どれにも当たらないとき', problem?.row === value.rules.length)}
            <ActionCell>—</ActionCell>
          </Tr>
        </tbody></DataTable>
        {problem ? <Notice tone="danger">{problem.message}</Notice> : null}
        <div className={styles.add}>
          <Button variant="text" icon={<Plus size={16} aria-hidden="true" />} lockedReason={readOnly ? '閲覧のみのため変更できません' : undefined} disabled={!question || (question.type !== 'rating' && !question.choices?.length) || value.rules.length >= MAX_ROUTING_ROWS} onClick={() => question && set({ rules: [...value.rules, newRule(question.id, question.type === 'rating' ? [1, 5] : (answersLeft[0]?.label ?? question.choices![0].label))] })}>行き先を追加</Button>
          {value.rules.length >= MAX_ROUTING_ROWS ? <span className={styles.hint}>{MAX_ROUTING_ROWS} 行までです</span> : null}
        </div>
      </> : null}
      <ConfirmDialog open={Boolean(pendingQuestion)} title="分ける質問を変えますか？" description="今ある行き先の条件がすべて消えます。変更する場合は、新しい質問の行き先を設定し直してください。" confirmLabel="質問を変える" primaryAction="cancel" confirmLockedReason={readOnly ? '閲覧のみのため変更できません' : undefined} onCancel={() => setPendingQuestion(null)} onConfirm={() => { if (!readOnly && pendingQuestion?.scope === scope) { setPickedQuestion(pendingQuestion.id); set({ rules: [] }) } setPendingQuestion(null) }} />
    </Card>
  )
}
