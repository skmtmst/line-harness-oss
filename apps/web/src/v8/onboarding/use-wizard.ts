'use client'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import { notifySaved } from '@/components/shared/toast'
import { accountStyleUpdated } from '@/hooks/use-account-style'
import { styleApi } from '@/lib/api/helpers/styles'
import type { AccountStyle,SetupAnswer } from '@line-crm/shared'
import { useEffect,useMemo,useState } from 'react'
import { LOOK_CHOICES, SETTINGS_KEYS, answerOf, answersForApi, changedAnswers, isBookingConfirmSample, needsActivation, pairStarterItems, questionsFor, recommendedValue, selectedValue, settingsChanges, stepNames } from './model'
import { type Question } from './question-types'
import type { Props, SummaryData, WizardStep } from './wizard-types'
export function useWizard({ accountId, state, initialStep = 0, onClose }: Props) {
  const [style, setStyle] = useState<AccountStyle>(state.style)
  const [answers, setAnswers] = useState<Record<string, SetupAnswer>>(state.answers ?? {})
  const [choices, setChoices] = useState<Record<string, { mode: 'sample' | 'existing' | 'configured'; resourceId?: string }>>({})
  const [version, setVersion] = useState(state.version)
  const [step, setStep] = useState<WizardStep>(initialStep)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [resources, setResources] = useState<Array<{ id: string; name: string; kind: string }> | null>(null)
  const [resource, setResource] = useState('')
  const preparing = usePreparingDialog()

  const steps = useMemo(() => stepNames(style), [style])
  const questions = useMemo(() => questionsFor(style), [style])
  const total = steps.length
  const index = step === 'summary' ? total : step
  const question: Question | null = typeof step === 'number' && step >= 2 ? questions[step - 2] ?? null : null

  /* 今の手順で選んでいる値（まだ答えていなければおすすめ）。 */
  const current = (() => {
    if (step === 0) return style
    /* 「あとで」「手動」にした質問を開き直したときは、答えに来たのでおすすめを選んでおく。 */
    const picked = (key: string) => (answers[key]?.mode === 'configured' ? selectedValue(answers[key], questions.find((q) => q.key === key)) : null)
    if (step === 1) return picked('image') ?? 'keep'
    if (question) return picked(question.key) ?? recommendedValue(question, style)
    return ''
  })()
  const [choice, setChoice] = useState<string>(current)
  useEffect(() => { setChoice(current) }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  /* 「同じアカウントの中にある物を使う」：同じアカウントのリッチメニュー・画像の候補（styleApi.resources）。 */
  useEffect(() => {
    if (choice !== 'existing' || resources) return
    void styleApi.resources(accountId).then((res) => { if (res.success) setResources(res.data.items.filter((item) => item.kind === 'rich_menu' || item.kind === 'image')) }).catch((caught) => setError(describeApiFailure(caught, '読み込み')))
  }, [choice, resources, accountId])

  const answer = (key: string, value: SetupAnswer) => {
    setAnswers((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  /*  (2)：開き直して保存するときは、変えた答えだけを送る（前の答えで予約設定を書き戻さない）。 */
  const [saved, setSaved] = useState<Record<string, SetupAnswer>>(answersForApi(state.answers ?? {}))
  const [confirm, setConfirm] = useState<{ lines: string[]; run: () => void; cancel: () => void } | null>(null)

  const save = async (next: Record<string, SetupAnswer>, nextChoices = choices, options: { skipSettings?: boolean } = {}) => {
    let changed = changedAnswers(saved, answersForApi(next))
    if (options.skipSettings) changed = Object.fromEntries(Object.entries(changed).filter(([key]) => !SETTINGS_KEYS.includes(key)))
    const res = await styleApi.save(accountId, { expectedVersion: version, style, answers: changed, choices: Object.keys(nextChoices).length ? nextChoices : undefined })
    if (!res.success) throw new Error('save failed')
    accountStyleUpdated(accountId)
    setVersion(res.data.version)
    setSaved((prev) => ({ ...prev, ...changed }))
    setDirty(false)
  }

  /* 予約設定が変わる答え（承認の仕方）を送るときは、何が変わるかを確かめの窓で出してから保存する。 */
  const confirmThenSave = (next: Record<string, SetupAnswer>, nextChoices = choices) => new Promise<boolean>((resolve, reject) => {
    const lines = settingsChanges(saved, answersForApi(next))
    if (lines.length === 0) { save(next, nextChoices).then(() => resolve(true), reject); return }
    setConfirm({
      lines,
      run: () => { setConfirm(null); save(next, nextChoices).then(() => resolve(true), reject) },
      cancel: () => { setConfirm(null); resolve(false) },
    })
  })

  const loadSummary = async () => {
    const [set, items] = await Promise.all([styleApi.starterSet(accountId, style), styleApi.starterItems(accountId)])
    if (!set.success || !items.success) throw new Error('summary failed')
    const pairs = pairStarterItems(set.data.definition.items, items.data.items)
    /*  (3)：予約確定の見本の自動送信は、いつもの確定の知らせと重なるので一覧に出さない（動かさせない）。 */
    const activation = pairs.filter((pair) => needsActivation(pair.state) && !isBookingConfirmSample(pair.item))
    setSummary({ inserted: pairs.filter((pair) => pair.item.kind in KIND_WORD), activation })
    /*  (3)：自動で送る物・予約メニューは最初から全部止めた状態。オンにするのは利用者が自分で。 */
    setEnabled(Object.fromEntries(activation.map((pair) => [pair.state.target_id, false])))
  }

  /* 最後の一覧から開いたときは、入った物を読んでから出す。 */
  useEffect(() => {
    if (step !== 'summary' || summary) return
    let cancelled = false
    setBusy(true)
    loadSummary().catch((caught) => { if (!cancelled) setError(describeApiFailure(caught, '読み込み')) }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (next: WizardStep, nextAnswers = answers, nextChoices = choices) => {
    setError('')
    if (next === 'summary') {
      setBusy(true)
      try {
        if (!(await confirmThenSave(nextAnswers, nextChoices))) return
        setSummary(null)
        setStep('summary')
      } catch (caught) {
        setError(describeApiFailure(caught, '保存'))
      } finally {
        setBusy(false)
      }
      return
    }
    setStep(next)
  }

  const nextOf = (i: number): WizardStep => (i + 1 >= total ? 'summary' : i + 1)

  const commitAndNext = (key: string, value: SetupAnswer, nextChoices = choices) => {
    const nextAnswers = { ...answers, [key]: value }
    answer(key, value)
    setChoices(nextChoices)
    void go(nextOf(index), nextAnswers, nextChoices)
  }

  const onNext = async () => {
    if (step === 0) {
      /* スタイルの「あとで」「手動」は口の styleMode で保存する（別の人・別の端末でも同じ）。 */
      if (choice === 'later' || choice === 'manual') { await saveStyleMode(choice); return }
      if (choice !== style) { setStyle(choice as AccountStyle); setDirty(true) }
      void go(1)
      return
    }
    if (step === 1) {
      if (choice === 'configured') { preparing.open(LOOK_CHOICES.find((c) => c.value === choice)!.label); return }
      if (choice === 'later') { commitAndNext('image', { mode: 'later' }); return }
      if (choice === 'manual') { commitAndNext('image', { mode: 'manual' }); return }
      if (choice === 'existing') {
        const picked = resources?.find((item) => item.id === resource)
        if (!picked) { setError('使うリッチメニューか画像を選んでください。'); return }
        if (picked.kind === 'image') { commitAndNext('image', { mode: 'configured', resourceId: picked.id }); return }
        /* 今あるリッチメニューをそのまま使う：初期セットのリッチメニューの代わりにする（choices）。 */
        try {
          const set = await styleApi.starterSet(accountId, style)
          const menuKey = set.success ? set.data.definition.items.find((item) => item.kind === 'rich_menu')?.key : undefined
          commitAndNext('image', { mode: 'configured', value: 'keep' }, menuKey ? { ...choices, [menuKey]: { mode: 'existing', resourceId: picked.id } } : choices)
        } catch (caught) { setError(describeApiFailure(caught, '読み込み')) }
        return
      }
      commitAndNext('image', { mode: 'configured', value: choice })
      return
    }
    if (question) commitAndNext(question.key, answerOf(choice, question))
  }

  const close = async () => {
    if (busy) return
    if (dirty && step !== 'summary' && step !== 0) {
      /* 閉じるときは確かめの窓を出さず、予約設定が変わる答えだけは送らない（勝手に予約設定を変えない）。 */
      try { await save(answers, choices, { skipSettings: true }) } catch { /* 閉じるのは止めない。答えは次に開いたとき聞き直す */ }
    }
    onClose(true)
  }

  /* スタイルを「あとで」（はじめにやることに残る）・「手動」（スタイルを使わず設定の画面で決める）。 */
  const saveStyleMode = async (mode: 'later' | 'manual') => {
    setBusy(true)
    setError('')
    try {
      const res = await styleApi.save(accountId, { expectedVersion: version, styleMode: mode })
      if (!res.success) throw new Error('save failed')
      onClose(true)
      if (mode === 'manual') router.push('/settings')
    } catch (caught) {
      setError(describeApiFailure(caught, '保存'))
    } finally {
      setBusy(false)
    }
  }

  const activate = async () => {
    const targets = (summary?.activation ?? []).filter((pair) => enabled[pair.state.target_id])
    setBusy(true)
    setError('')
    try {
      /* 予約メニューは今の版を読んで渡す。オートメーションは下書きの版（draftRevision）。 */
      const items = await Promise.all(targets.map(async ({ state: target }) => {
        if (target.kind === 'automation') return { id: target.target_id, kind: 'automation' as const, expectedDraftVersionId: target.draftRevision ?? undefined }
        const menu = await styleApi.menu(accountId, target.target_id)
        if (!menu.success) throw new Error('menu failed')
        return { id: target.target_id, kind: 'booking_menu' as const, expectedVersion: menu.data.version }
      }))
      const res = await styleApi.activate(accountId, items)
      if (!res.success) throw new Error('activate failed')
      const failed = res.data.items.filter((item) => !item.success)
      if (!res.data.complete || failed.length > 0) {
        /* 途中の失敗を成功で隠さない（API-CONTRACT-4）。動いた物は動いたまま、動かなかった物の名前を出す。 */
        const names = failed.map((item) => targets.find((pair) => pair.state.target_id === item.id)?.item.name ?? item.id)
        setError(`動かせなかった物があります：${names.join('・')}。中身を確かめて、もう一度押してください。`)
        await loadSummary()
        return
      }
      notifySaved(`${items.length}件を動かしました`)
      onClose(true)
    } catch (caught) {
      setError(describeApiFailure(caught, '動かす操作'))
    } finally {
      setBusy(false)
    }
  }


 return { style, setStyle, answers, setAnswers, choices, setChoices, version, setVersion, step, setStep, dirty, setDirty, busy, setBusy, error, setError, router, summary, setSummary, enabled, setEnabled, resources, setResources, resource, setResource, preparing, steps, questions, total, index, question, current, choice, setChoice, answer, saved, setSaved, confirm, setConfirm, save, confirmThenSave, loadSummary, go, nextOf, commitAndNext, onNext, close, saveStyleMode, activate }
}

import { KIND_WORD } from './wizard-item-kinds'
