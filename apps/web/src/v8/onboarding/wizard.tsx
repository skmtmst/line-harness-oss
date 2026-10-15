'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Circle, CircleCheck, CircleDot, Eye, Hourglass, Info, Play } from 'lucide-react'
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
import { styleSetupApi, type AccountStyle, type SetupAnswer, type StarterItemState, type StarterSetItem, type StyleState } from '@/lib/api-style-setup'
import { SetupIcon } from './icons'
import { SampleMenuPhone, SampleMenuTiles } from './sample-menu'
import {
  LOOK_CHOICES, STYLE_CHOICES, answerOf, choiceLabel, questionsFor, recommendedValue, selectedValue, stepNames, styleLabel,
  type Question,
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

type SummaryData = {
  inserted: StarterSetItem[]
  automations: Array<{ item: StarterSetItem; state: StarterItemState | null }>
}

const KIND_WORD: Record<string, { label: string; icon: string; href: (style: AccountStyle) => string }> = {
  rich_menu: { label: 'リッチメニュー', icon: 'grid', href: (style) => `/rich-menus/sample?style=${style}` },
  template: { label: 'テンプレート', icon: 'file', href: () => '/templates' },
  booking_menu: { label: '予約メニュー', icon: 'utensils', href: () => '/booking/menus' },
  coupon: { label: 'クーポン', icon: 'ticket', href: () => '/friend-add-settings' },
}

export default function StyleSetupWizard({ accountId, state, initialStep = 0, onClose }: Props) {
  const [style, setStyle] = useState<AccountStyle>(state.style)
  const [answers, setAnswers] = useState<Record<string, SetupAnswer>>(state.answers ?? {})
  const [version, setVersion] = useState(state.version)
  const [step, setStep] = useState<WizardStep>(initialStep)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
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
    const picked = (key: string) => (answers[key]?.mode === 'configured' ? selectedValue(answers[key]) : null)
    if (step === 1) return picked('look') ?? 'sample'
    if (question) return picked(question.key) ?? recommendedValue(question, style)
    return ''
  })()
  const [choice, setChoice] = useState<string>(current)
  useEffect(() => { setChoice(current) }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (key: string, value: SetupAnswer) => {
    setAnswers((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const save = async (next: Record<string, SetupAnswer>) => {
    const res = await styleSetupApi.save(accountId, {
      expectedVersion: version,
      style,
      answers: next,
      choices: next.look?.mode === 'configured' ? { look: { mode: next.look.value === 'sample' || next.look.value === 'image' ? 'sample' : next.look.value === 'existing' ? 'existing' : 'configured' } } : undefined,
    })
    if (!res.success) throw new Error('save failed')
    setVersion(res.data.version)
    setDirty(false)
  }

  const loadSummary = async () => {
    const [set, items] = await Promise.all([styleSetupApi.starterSet(accountId, style), styleSetupApi.starterItems(accountId)])
    if (!set.success || !items.success) throw new Error('summary failed')
    const states = [...items.data.items]
    const take = (item: StarterSetItem) => {
      const at = states.findIndex((s) => s.kind === item.kind && (!s.key || s.key === item.key))
      return at < 0 ? null : states.splice(at, 1)[0]
    }
    const automations = set.data.definition.items.filter((item) => item.kind === 'automation').map((item) => ({ item, state: take(item) }))
    setSummary({ inserted: set.data.definition.items.filter((item) => item.kind in KIND_WORD), automations })
    /* 質問で「送る」を選んだお知らせ（前日・当日）だけ最初からオン。ほかはオフで並べる（勝手に送らない）。 */
    const reminderOn = (answers.reminder?.mode === 'configured' && answers.reminder.value === 'on')
    setEnabled(Object.fromEntries(automations.filter((a) => a.state && a.state.status !== 'active').map((a) => [a.state!.target_id, reminderOn && a.item.feature === 'reminder'])))
  }

  /* 最後の一覧から開いたときは、入った物を読んでから出す。 */
  useEffect(() => {
    if (step !== 'summary' || summary) return
    let cancelled = false
    setBusy(true)
    loadSummary().catch((caught) => { if (!cancelled) setError(describeApiFailure(caught, '読み込み')) }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (next: WizardStep, nextAnswers = answers) => {
    setError('')
    if (next === 'summary') {
      setBusy(true)
      try {
        await save(nextAnswers)
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

  const commitAndNext = (key: string, value: SetupAnswer) => {
    const nextAnswers = { ...answers, [key]: value }
    answer(key, value)
    void go(nextOf(index), nextAnswers)
  }

  const onNext = () => {
    if (step === 0) {
      if (choice !== style) { setStyle(choice as AccountStyle); setDirty(true) }
      void go(1)
      return
    }
    if (step === 1) {
      if (choice === 'existing' || choice === 'configured') { preparing.open(LOOK_CHOICES.find((c) => c.value === choice)!.label); return }
      if (choice === 'later') { commitAndNext('look', { mode: 'later' }); return }
      commitAndNext('look', { mode: 'configured', value: choice })
      return
    }
    if (question) commitAndNext(question.key, answerOf(choice))
  }

  const close = async () => {
    if (busy) return
    if (dirty && step !== 'summary') {
      try { await save(answers) } catch { /* 閉じるのは止めない。答えは次に開いたとき聞き直す */ }
    }
    onClose(true)
  }

  const later = async () => {
    const next = { ...answers, style: { mode: 'later' } as SetupAnswer }
    setBusy(true)
    try { await save(next) } catch { /* 閉じるのは止めない */ }
    setBusy(false)
    onClose(true)
  }

  const activate = async () => {
    const ids = Object.entries(enabled).filter(([, on]) => on).map(([id]) => id)
    setBusy(true)
    setError('')
    try {
      const res = await styleSetupApi.activate(accountId, ids.map((id) => ({ id, kind: 'automation' as const })))
      if (!res.success) throw new Error('activate failed')
      notifySaved(`${ids.length}件を動かしました`)
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
      <div className={styles.footerSide}>
        {step === 0
          ? <Button onClick={() => void later()} disabled={busy}>あとで設定する</Button>
          : <Button onClick={() => setStep(step === 'summary' ? total - 1 : Math.max(0, (step as number) - 1))} disabled={busy}>戻る</Button>}
      </div>
      <div className={styles.footerCenter}>
        {step === 0 ? <Button onClick={() => setPreview(true)}><Eye aria-hidden="true" className={styles.buttonIcon} />プレビュー</Button> : null}
        {step === 1 ? <Button onClick={() => commitAndNext('look', { mode: 'manual' })} disabled={busy}>手動で設定する</Button> : null}
        {question ? <Button onClick={() => commitAndNext(question.key, { mode: 'later' })} disabled={busy}>この質問を飛ばす</Button> : null}
        {step === 'summary' ? <Button onClick={() => onClose(true)} disabled={busy}>動かさずにダッシュボードへ</Button> : null}
        {step === 'summary'
          ? <Button variant="primary" onClick={() => void activate()} busy={busy && summary !== null} busyLabel="動かしています…" disabled={!summary || onCount === 0}><Play aria-hidden="true" className={styles.buttonIcon} />{`まとめて動かす（${onCount}件）`}</Button>
          : <Button variant="primary" onClick={onNext} busy={busy} busyLabel="保存中…" widthReserve="idle"><ArrowRight aria-hidden="true" className={styles.buttonIcon} />次へ</Button>}
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
        </RadioCardGroup>
        {where('あとから変えられます（設定 › 使い方のスタイル）。変えても、友だち・予約・配信のデータはそのまま使えます。')}
      </>
    )
  } else if (step === 1) {
    body = (
      <>
        <div className={styles.lookRow}>
          <RadioCardGroup legend="見た目" className={styles.stack}>
            {LOOK_CHOICES.map((item) => (
              <RadioCard key={item.value} name="setup-look" value={item.value} checked={choice === item.value} onChange={setChoice} title={item.label} note={item.value === 'sample' ? `${label}${item.note}` : item.note} icon={<SetupIcon name={item.icon} />} />
            ))}
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
              {summary.automations.map(({ item, state: itemState }) => (
                <li key={item.key} className={styles.row}>
                  <span className={styles.rowText}><span className={styles.rowTitle}>{item.name}</span><span className={styles.rowNote}>{item.text ?? ''}</span></span>
                  <Link href="/reminders" className={styles.link}>中身を見る</Link>
                  {itemState && itemState.status !== 'active'
                    ? <Toggle label={`${item.name}を動かす`} checked={enabled[itemState.target_id] ?? false} onChange={(next) => setEnabled((prev) => ({ ...prev, [itemState.target_id]: next }))} disabled={busy} />
                    : <StatusBadge tone="success" dot>動いている</StatusBadge>}
                </li>
              ))}
            </ul>
            <p className={styles.cardFoot}>オンにした物だけ、［まとめて動かす］で動き始めます。</p>
          </section>
        </div>
        {skipped.length > 0 ? (
          <section className={styles.skipped} aria-labelledby="setup-skipped">
            <div className={styles.cardHead}><h3 id="setup-skipped" className={styles.cardTitle}>入れなかった物（あとで設定する）</h3><span className={styles.cardMetaEnd}>はじめにやることに残ります</span></div>
            <ul className={styles.skippedRows}>
              {skipped.map((q) => (
                <li key={q.key} className={styles.skippedRow}>
                  <Hourglass aria-hidden="true" className={styles.skippedIcon} />
                  <span className={styles.rowTitle}>{q.short}</span>
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
      {preview ? (
        <Dialog open title={`${styleLabel(choice as AccountStyle)}の見本`} description="友だち追加のあとに、お客さまの LINE にこう出ます。" size="medium" onCancel={() => setPreview(false)} footer={null}>
          <div className={styles.preview}>
            <SampleMenuPhone style={(choice as AccountStyle) in { restaurant: 1, salon: 1, consult: 1, lesson: 1 } ? choice as AccountStyle : 'restaurant'} />
            <p className={styles.panelNote}>{`見本の画像のまま使えます。ボタンの中身が未設定のときは「${PREPARING_WORD}」と出ます。`}</p>
          </div>
        </Dialog>
      ) : null}
      {preparing.dialog}
    </>
  )
}

/** 入った物を種類ごとにまとめる（テンプレートは「A・B ほか n件」）。 */
function groupInserted(items: StarterSetItem[]): Array<{ kind: string; note: string }> {
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
