'use client'
import type { Props, Pair } from './wizard-types'
export type { WizardStep, Props, Pair, SummaryData } from './wizard-types'

import { Steps } from '@/components/templates/steps'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog, { DialogActions } from '@/components/shared/dialog'
import Link from '@/components/shared/list-navigation'
import Notice from '@/components/shared/notice'
import { PREPARING_WORD } from '@/components/shared/preparing-dialog'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import EntitySelect from '@/components/shared/entity-select'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import Toggle from '@/components/shared/toggle'

import type { AccountStyle, SetupAnswer } from '@line-crm/shared'
import { ArrowRight, Hourglass, Info, Play } from 'lucide-react'
import { SetupIcon } from './icons'
import { LOOK_CHOICES, STYLE_CHOICES, choiceLabel, styleLabel } from './model'
import { SampleMenuTiles } from './sample-menu'
import { useWizard } from './use-wizard'
import { KIND_WORD } from './wizard-item-kinds'
import styles from './wizard.module.css'
import { useStarterMenu } from './use-starter-menu'
import SetupLinks from './setup-links'

/*
 *  (1)：スタイルを変えると、ダッシュボードが数える予約が変わる（前の予約は消えないが、出なくなる）。
 * 「データはそのまま使えます」は、前の予約も見えることを口が保証してから出す。今は前のスタイルの予約の行き先を出す。
 */
const BOOKING_PLACE: Record<AccountStyle, string> = {
  restaurant: '予約台帳', salon: '予約管理', consult: '予約管理', lesson: 'イベント予約', ec: '予約管理', standard: '予約管理',
}

export default function StyleSetupWizard({ accountId, state, initialStep = 0, onClose }: Props) {
  const { style, answers, step, setStep, dirty, busy, error, summary, enabled, setEnabled, resources, resource, setResource, preparing, steps, questions, total, index, question, choice, setChoice, confirm, onNext, discard, saveAndClose, activate } = useWizard({ accountId, state, initialStep, onClose })

  const label = styleLabel(style)
  const menu = useStarterMenu(accountId, style)
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
      <div className={styles.footerSide}>
        {step !== 0 && step !== 'summary' ? <Button onClick={() => void saveAndClose()} busy={busy} busyLabel="保存中…">途中保存して閉じる</Button> : null}
      </div>
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
              <EntitySelect aria-label="使うリッチメニュー・画像" noun="リッチメニュー・画像" size="full" value={resource} onChange={setResource} disabled={resources === null}
                options={[{ value: '', label: resources === null ? '読み込んでいます…' : resources.length ? '使うリッチメニュー・画像を選ぶ' : '使える物がありません' }, ...(resources ?? []).map((item) => ({ value: item.id, label: `${item.kind === 'image' ? '画像' : 'リッチメニュー'}：${item.name}` }))]} />
            ) : null}
          </RadioCardGroup>
          <Card surface="muted" layout="vertical" contentPadding="var(--polish-space-card)" gap="var(--ob-panel-gap)" role="complementary" aria-label="入る見本">
            <div className={styles.panelHead}><span className={styles.panelTitle}>入る見本</span><StatusBadge tone="neutral" dot>見本</StatusBadge></div>
            {menu.error ? <ListState kind="error" title="見本を読み込めませんでした" error={menu.error} onRetry={menu.reload} /> : menu.loading ? <ListState kind="loading" title="見本を確認しています" /> : <SampleMenuTiles style={style} buttons={menu.buttons} />}
            <p className={styles.panelNote}>{`中身が決まっていないボタンは、お客さまには「${PREPARING_WORD}」と出します。`}</p>
          </Card>
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
          {!question.preparing ? <Link href={question.manualHref} className={styles.link}>設定の画面を開く</Link> : null}
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
        <SetupLinks style={style} />
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
    ) : <ListState kind="loading" title="入った物を読み込んでいます…" />
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
        onCancel={discard}
        dirty={dirty || undefined}
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
  return <Steps label="はじめの質問の一覧" layout="sidebar" currentKey={steps[index]?.key}
    steps={steps.map((item, i) => ({ key: item.key, label: item.short,
      state: i < index || answers[item.key] ? 'done' : 'todo', onSelect: () => onSelect(i),
    }))} />
}
