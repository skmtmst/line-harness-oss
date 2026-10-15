'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Circle, CircleCheck, CircleDot, Hourglass, Info, Play } from 'lucide-react'
import Link from '@/components/shared/list-navigation'
import Button from '@/components/shared/button'
import Dialog, { DialogActions } from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import StatusBadge from '@/components/shared/status-badge'
import Toggle from '@/components/shared/toggle'
import { notifySaved } from '@/components/shared/toast'
import { usePreparingDialog, PREPARING_WORD } from '@/components/shared/preparing-dialog'
import { describeApiFailure } from '@/components/shared/api-error-message'
import type { AccountStyle, SetupAnswer } from '@line-crm/shared'
import { styleApi, type StarterSetItem } from '@/lib/api-styles'
import Select from '@/components/shared/select'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { SetupIcon } from './icons'
import { SampleMenuTiles } from './sample-menu'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import {
  LOOK_CHOICES, SETTINGS_KEYS, STYLE_CHOICES, answerOf, answersForApi, changedAnswers, isBookingConfirmSample, settingsChanges, choiceLabel, needsActivation, pairStarterItems, questionsFor, recommendedValue, selectedValue, stepNames, styleLabel,
  type Question, type StarterItemState, type StyleState,
} from './model'
import styles from './wizard.module.css'

/*
 * はじめの質問（★V8 修正案の列 VHp7p：xxpM9 スタイル選び・RZW83 見た目・lS1Gh/rJ36f 1問の画面・
 * oKSsG 最後の［まとめて動かす］。決まり B-311・B-313）。動きは BEHAVIOR.md。
 *
 * 窓の幅は V8 の 4 段の 960（xxpM9 の絵は 880 → 絵を直す）。
 */

export type WizardStep = number | 'summary'

type Props = {
  accountId: string
  state: StyleState
  /** 開く手順（0＝スタイル、1＝見た目、2〜＝質問、'summary'＝最後の一覧）。 */
  initialStep?: WizardStep
  onClose: (changed: boolean) => void
}

type Pair = { item: StarterSetItem; state: StarterItemState }
type SummaryData = { inserted: Pair[]; activation: Pair[] }

const KIND_WORD: Record<string, { label: string; icon: string; href: (style: AccountStyle) => string }> = {
  rich_menu: { label: 'リッチメニュー', icon: 'grid', href: (style) => `/rich-menus/sample?style=${style}` },
  template: { label: 'テンプレート', icon: 'file', href: () => '/templates' },
  booking_menu: { label: '予約メニュー', icon: 'utensils', href: () => '/booking/menus' },
}

/*
 * B-335 (1)：スタイルを変えると、ダッシュボードが数える予約が変わる（前の予約は消えないが、出なくなる）。
 * 「データはそのまま使えます」は、前の予約も見えることを口が保証してから出す。今は前のスタイルの予約の行き先を出す。
 */
const BOOKING_PLACE: Record<AccountStyle, string> = {
  restaurant: '予約台帳', salon: '予約管理', consult: '予約管理', lesson: 'イベント予約', ec: '予約管理', standard: '予約管理',
}


export default function StyleSetupWizard({ accountId, state, initialStep = 0, onClose }: Props) {
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

  /* B-335 (2)：開き直して保存するときは、変えた答えだけを送る（前の答えで予約設定を書き戻さない）。 */
  const [saved, setSaved] = useState<Record<string, SetupAnswer>>(answersForApi(state.answers ?? {}))
  const [confirm, setConfirm] = useState<{ lines: string[]; run: () => void; cancel: () => void } | null>(null)

  const save = async (next: Record<string, SetupAnswer>, nextChoices = choices, options: { skipSettings?: boolean } = {}) => {
    let changed = changedAnswers(saved, answersForApi(next))
    if (options.skipSettings) changed = Object.fromEntries(Object.entries(changed).filter(([key]) => !SETTINGS_KEYS.includes(key)))
    const res = await styleApi.save(accountId, { expectedVersion: version, style, answers: changed, choices: Object.keys(nextChoices).length ? nextChoices : undefined })
    if (!res.success) throw new Error('save failed')
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
    /* B-335 (3)：予約確定の見本の自動送信は、いつもの確定の知らせと重なるので一覧に出さない（動かさせない）。 */
    const activation = pairs.filter((pair) => needsActivation(pair.state) && !isBookingConfirmSample(pair.item))
    setSummary({ inserted: pairs.filter((pair) => pair.item.kind in KIND_WORD), activation })
    /* B-335 (3)：自動で送る物・予約メニューは最初から全部止めた状態。オンにするのは利用者が自分で。 */
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

  const label = styleLabel(style)
  const head = step === 0
    ? { title: 'はじめに、使い方を教えてください', description: '答えに合わせて、メニュー・見本・設定をまとめて入れます。1 分ほどで終わります。' }
    : step === 1
      ? { title: 'リッチメニューなどの見た目をどうしますか', description: `${label}の見本が入っています。画像だけ変えることもできます。` }
      : step === 'summary'
        ? { title: '準備ができました', description: '入った物を確かめて、自動で送る物を動かしてください。' }
        : { title: question?.title ?? '', description: question?.description ?? '' }

  const onCount = Object.values(enabled).filter(Boolean).length
  const footer = (
    <DialogActions><div className={styles.footer}>
      {/* B-338：どの問も同じ骨組み。左に［戻る］（1問目は無し）、真ん中に［次へ］。あとで・手動はカードで選ぶ。 */}
      <div className={styles.footerSide}>
        {step === 0 ? null : <Button onClick={() => setStep(step === 'summary' ? total - 1 : Math.max(0, (step as number) - 1))} disabled={busy}>戻る</Button>}
      </div>
      <div className={styles.footerCenter}>
        {step === 'summary' ? <Button onClick={() => onClose(true)} disabled={busy}>動かさずにダッシュボードへ</Button> : null}
        {step === 'summary'
          ? <Button variant="primary" onClick={() => void activate()} busy={busy && summary !== null} busyLabel="動かしています…" disabled={!summary || onCount === 0}><Play aria-hidden="true" className={styles.buttonIcon} />{`まとめて動かす（${onCount}件）`}</Button>
          : <Button variant="primary" onClick={() => void onNext()} busy={busy} busyLabel="保存中…" widthReserve="idle"><ArrowRight aria-hidden="true" className={styles.buttonIcon} />次へ</Button>}
      </div>
      <div className={styles.footerSide} aria-hidden="true" />
    </div></DialogActions>
  )

  const progress = (
    <div className={styles.progress}>
      <span className={styles.progressCount}>{`はじめの質問 ${Math.min(index + 1, total)} / ${total}`}</span>
      <span className={styles.track} role="progressbar" aria-label="はじめの質問の進み" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(index + 1, total)}>
        <span className={styles.fill} style={{ width: `${Math.round((Math.min(index + 1, total) / total) * 100)}%` }} />
      </span>
      <span className={styles.progressName}>{step === 'summary' ? '確かめ' : steps[index]?.short}</span>
    </div>
  )

  const where = (text: string) => (
    <p className={styles.where}><Info aria-hidden="true" className={styles.whereIcon} />{text}</p>
  )

  let body: React.ReactNode = null
  if (step === 0) {
    body = (
      <>
        <RadioCardGroup legend="使い方のスタイル" columns={2}>
          {STYLE_CHOICES.map((item) => (
            <RadioCard key={item.value} name="setup-style" value={item.value} checked={choice === item.value} onChange={setChoice} title={item.label} note={item.note} icon={<SetupIcon name={item.icon} />} />
          ))}
          <RadioCard name="setup-style" value="later" checked={choice === 'later'} onChange={setChoice} title="あとで設定する" note="今は入れません。はじめにやることに残ります" icon={<SetupIcon name="hourglass" />} />
          <RadioCard name="setup-style" value="manual" checked={choice === 'manual'} onChange={setChoice} title="手動で設定する" note="スタイルを使わず、設定の画面で 1 つずつ決めます" icon={<SetupIcon name="sliders" />} />
        </RadioCardGroup>
        {where(`あとから変えられます（設定 › アカウント）。友だち・配信は残ります。前の予約は${BOOKING_PLACE[state.style]}から見られます。`)}
      </>
    )
  } else if (step === 1) {
    body = (
      <>
        <div className={styles.lookRow}>
          <RadioCardGroup legend="見た目" className={styles.stack}>
            {LOOK_CHOICES.filter((item) => item.value !== 'later').map((item) => (
              <RadioCard key={item.value} name="setup-look" value={item.value} checked={choice === item.value} onChange={setChoice} title={item.label} note={item.value === 'keep' ? `${label}${item.note}` : item.note} icon={<SetupIcon name={item.icon} />} />
            ))}
            <div className={styles.pair}>
              <RadioCard name="setup-look" value="later" checked={choice === 'later'} onChange={setChoice} title="あとで設定する" note="今は入れません。はじめにやることに残ります" icon={<SetupIcon name="hourglass" />} />
              <RadioCard name="setup-look" value="manual" checked={choice === 'manual'} onChange={setChoice} title="手動で設定する" note="リッチメニューの画面で 1 から作ります" icon={<SetupIcon name="sliders" />} />
            </div>
            {choice === 'existing' ? (
              <Select aria-label="使うリッチメニュー・画像" size="full" value={resource} onChange={setResource} disabled={resources === null}
                options={[{ value: '', label: resources === null ? '読み込んでいます…' : resources.length ? '使うリッチメニュー・画像を選ぶ' : '使える物がありません' }, ...(resources ?? []).map((item) => ({ value: item.id, label: `${item.kind === 'image' ? '画像' : 'リッチメニュー'}：${item.name}` }))]} />
            ) : null}
          </RadioCardGroup>
          <aside className={styles.samplePanel} aria-label="入る見本">
            <div className={styles.panelHead}><span className={styles.panelTitle}>入る見本</span><StatusBadge tone="neutral" dot>見本</StatusBadge></div>
            <SampleMenuTiles style={style} />
            <p className={styles.panelNote}>{`中身が決まっていないボタンは、お客さまには「${PREPARING_WORD}」と出します。`}</p>
          </aside>
        </div>
        {where('あとから変えられます（リッチメニュー・テンプレートの画面）。')}
      </>
    )
  } else if (question) {
    const mains = question.choices
    body = (
      <div className={styles.questionRow}>
        <StepList steps={steps} index={index} answers={answers} styleSelected onSelect={(i) => setStep(i)} />
        <div className={styles.question}>
          {question.pendingApi ? (
            <p className={styles.pending}><StatusBadge tone="neutral" dot>{PREPARING_WORD}</StatusBadge>この質問の答えは、まだ保存されません（使えるようになったら保存します）。</p>
          ) : null}
          <RadioCardGroup legend={question.short} className={styles.stack}>
            {mains.map((item) => (
              <RadioCard key={item.value} name={`setup-${question.key}`} value={item.value} checked={choice === item.value} onChange={setChoice} title={choiceLabel(question, item, style)} note={item.note} icon={<SetupIcon name={item.icon} />} />
            ))}
            {question.info ? <Notice tone="info">{question.info}</Notice> : null}
            <div className={styles.pair}>
              <RadioCard name={`setup-${question.key}`} value="later" checked={choice === 'later'} onChange={setChoice} title="あとで設定する" note="今は入れません。はじめにやることに残ります" icon={<SetupIcon name="hourglass" />} />
              <RadioCard name={`setup-${question.key}`} value="manual" checked={choice === 'manual'} onChange={setChoice} title="手動で設定する" note={question.manualNote} icon={<SetupIcon name="settings" />} />
            </div>
          </RadioCardGroup>
          {where(`あとから変えられます（${question.where}）。`)}
        </div>
      </div>
    )
  } else if (step === 'summary') {
    const skipped = questions.filter((q) => answers[q.key] && answers[q.key].mode !== 'configured')
    body = summary ? (
      <>
        <div className={styles.summaryRow}>
          <section className={styles.card} aria-labelledby="setup-inserted">
            <div className={styles.cardHead}><h3 id="setup-inserted" className={styles.cardTitle}>入った物</h3><span className={styles.cardMeta}>{`${groupInserted(summary.inserted).length}件`}</span></div>
            <ul className={styles.rows}>
              {groupInserted(summary.inserted).map((group) => (
                <li key={group.kind} className={styles.row}>
                  <SetupIcon name={KIND_WORD[group.kind].icon} className={styles.rowIcon} />
                  <span className={styles.rowText}><span className={styles.rowTitle}>{KIND_WORD[group.kind].label}</span><span className={styles.rowNote}>{group.note}</span></span>
                  <StatusBadge tone="neutral" dot>見本</StatusBadge>
                  <Link href={KIND_WORD[group.kind].href(style)} className={styles.link}>見る</Link>
                </li>
              ))}
            </ul>
          </section>
          <section className={styles.card} aria-labelledby="setup-activate">
            <div className={styles.cardHead}><h3 id="setup-activate" className={styles.cardTitle}>動かす前に確かめる物</h3><span className={styles.cardMetaEnd}>止めた状態で入っています</span></div>
            <ul className={styles.rows}>
              {summary.activation.length === 0 ? <li className={styles.row}><span className={styles.rowNote}>動かす前に確かめる物はありません。</span></li> : null}
              {summary.activation.map(({ item, state: itemState }) => (
                <li key={itemState.target_id} className={styles.row}>
                  <span className={styles.rowText}><span className={styles.rowTitle}>{item.name}</span><span className={styles.rowNote}>{itemState.kind === 'booking_menu' ? '予約メニュー（止めた状態）' : item.text ?? 'LINE に自動で送る物'}</span></span>
                  <Link href={itemState.kind === 'booking_menu' ? '/booking/menus' : '/automations'} className={styles.link}>中身を見る</Link>
                  <Toggle label={`${item.name}を動かす`} checked={enabled[itemState.target_id] ?? false} onChange={(next) => setEnabled((prev) => ({ ...prev, [itemState.target_id]: next }))} disabled={busy} />
                </li>
              ))}
            </ul>
            <p className={styles.cardFoot}>自動で送る物は全部止めて入れています。オンにした物だけ、［まとめて動かす］で動き始めます。</p>
          </section>
        </div>
        {skipped.length > 0 ? (
          <section className={styles.skipped} aria-labelledby="setup-skipped">
            <div className={styles.cardHead}><h3 id="setup-skipped" className={styles.cardTitle}>入れなかった物（あとで設定する）</h3><span className={styles.cardMetaEnd}>はじめにやることに残ります</span></div>
            <ul className={styles.skippedRows}>
              {skipped.map((q) => (
                <li key={q.key} className={styles.skippedRow}>
                  <Hourglass aria-hidden="true" className={styles.skippedIcon} />
                  <span className={styles.rowTitle}>{q.skippedTitle ?? q.short}</span>
                  <span className={styles.skippedNote}>{q.skipped ?? q.todo.note}</span>
                  {q.preparing
                    ? <button type="button" className={styles.linkButton} onClick={() => preparing.open(q.preparing!)}>今設定する</button>
                    : <Link href={q.manualHref} className={styles.link}>今設定する</Link>}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </>
    ) : <p className={styles.loading}>入った物を読み込んでいます…</p>
  }

  return (
    <>
      <Dialog
        open
        title={head.title}
        description={head.description}
        size="wide"
        designTop={step === 'summary' ? 48 : 60}
        fitViewport
        onCancel={() => void close()}
        busy={busy}
        error={error}
        designNode={step === 0 ? 'xxpM9' : step === 1 ? 'RZW83' : step === 'summary' ? 'oKSsG' : 'lS1Gh'}
        footer={footer}
        footerDivider={false}
        designFooterPadding="16px 24px"
        designContentPadding="16px 24px 24px"
      >
        <div className={styles.body} data-step={step}>
          {progress}
          {body}
        </div>
      </Dialog>
      {preparing.dialog}
      <ConfirmDialog
        open={confirm !== null}
        title="予約設定が変わります"
        description={`保存すると、予約設定のこれが変わります。${confirm?.lines.join('。') ?? ''}。`}
        confirmLabel="変えて保存する"
        onCancel={() => confirm?.cancel()}
        onConfirm={() => confirm?.run()}
      />
    </>
  )
}

/** 入った物を種類ごとにまとめる（テンプレートは「A・B ほか n件」）。 */
function groupInserted(pairs: Pair[]): Array<{ kind: string; note: string }> {
  const items = pairs.map((pair) => pair.item)
  const kinds = [...new Set(items.map((item) => item.kind))]
  return kinds.map((kind) => {
    const list = items.filter((item) => item.kind === kind)
    if (kind === 'rich_menu') {
      const menu = list[0]
      return { kind, note: `${menu.name}${menu.buttons ? `（${menu.buttons.length}つのボタン）` : ''}` }
    }
    if (list.length > 3) return { kind, note: `${list.slice(0, 2).map((item) => item.name).join('・')} ほか ${list.length}件` }
    return { kind, note: list.map((item) => item.name).join('・') }
  })
}

/** 左の質問の一覧（lS1Gh）。済んだ手順は ✓、今の手順は地の色、まだは ○。押すとその質問へ。 */
function StepList({ steps, index, answers, onSelect }: { steps: Array<{ key: string; short: string }>; index: number; answers: Record<string, SetupAnswer>; styleSelected: boolean; onSelect: (index: number) => void }) {
  return (
    <nav aria-label="はじめの質問の一覧">
      <ol className={styles.stepList}>
        {steps.map((item, i) => {
          const state = i === index ? 'now' : i < index || answers[item.key] ? 'done' : 'idle'
          const Icon = state === 'now' ? CircleDot : state === 'done' ? CircleCheck : Circle
          return (
            <li key={item.key} aria-current={state === 'now' ? 'step' : undefined}>
              <button type="button" className={styles.stepItem} data-state={state} onClick={() => onSelect(i)}>
                <Icon aria-hidden="true" className={styles.stepIcon} />
                <span className={styles.stepName}>{item.short}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
