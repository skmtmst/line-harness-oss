'use client'

/*
 * ★V8 はじめの設定（Pencil ）。
 *
 * 白い板の頭（題と説明）→ 左に「設定の中のメニュー」→ 右に
 * 進み具合の帯・6段の表・下の2枚（いま止まっている理由・気をつけること）。
 * データの口は今の画面（app/getting-started/page.tsx）と同じ：
 * はじめの設定の口（`'v8'` の6段）と、段2を確かめる機能設定の実物。
 */
import { Check } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { useFirstRun } from '@/v8/onboarding/public/use-first-run/index'
import { useStaffRole } from '@/lib/staff-role'
import { usePageTitle } from '@/components/shell/page-chrome'
import { SettingsPage } from '@/components/templates'
import SettingsInnerNav from '@/components/layout/settings-inner-nav'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import { ProgressBar } from '@/components/shared/progress'
import { GridTable, GridRow, GridCell } from '@/components/shared/grid-table'
import TruncatedText from '@/components/shared/truncated-text'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import {
  type StepResult,
  doneCount,
  progressHeadline,
  stoppedReasons,
} from './steps'
import frame from '../sa-frame.module.css'
import styles from './getting-started.module.css'

/** 板の下の「気をつけること」（絵の2行）。 */
const CARE_LINES = ['・手順は飛ばしても使えます', '・あとからこの画面に戻れます（設定 › はじめの設定）'] as const

export default function GettingStartedV8() {
  usePageTitle('はじめの設定')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const role = useStaffRole()
  const { steps, status, error: loadError, reload } = useFirstRun(selectedAccountId, !accountLoading)

  const reasons = stoppedReasons(steps)
  const done = doneCount(steps)

  return (
    <div className={frame.screen}>
      <SettingsPage layout="accounts" heightMode="content"
        boardId="xuJ7D"
        title="はじめの設定"
        help="musubo を使いはじめるまでの6つの手順です。上から順に進めると、最初の1通が届くまでたどり着けます。"
        navigation={<SettingsInnerNav inline />}
        notice={role === 'viewer' ? <ReadOnlyNotice /> : undefined}
      >
        {status !== 'ready' ? (
          <ListState
            kind={status === 'error' ? 'error' : 'loading'}
            error={status === 'error' ? loadError : undefined}
            onRetry={reload}
          />
        ) : (
          <>
            <div className={styles.progress} role="note">
              <strong className={styles.progressText}>{progressHeadline(steps)}</strong>
              <ProgressBar className={styles.bar} value={100 * done / Math.max(steps.length, 1)} label="はじめの設定の進み具合" />
            </div>

            <Card padding="rows" overflow="hidden">
              <GridTable label="はじめの設定の順路" framed={false} design={{ columns: "max-content minmax(0, 1fr) max-content", gap: "var(--polish-space-card)", rowPadding: "var(--polish-space-card)", fontSize: "var(--text-body)" }}>
                {steps.map((step) => <StepRow key={step.key} step={step} readOnly={!role || role === 'viewer'} />)}
              </GridTable>
            </Card>

            <Card id="first-message" variant="form" aria-label="最初の1通の確認方法">
              <CardHeader size="stacked" title="最初の1通の確認方法" />
              <p className={styles.cardLine}>自分のLINEで受け取る方法を選びます。QRから友だち追加時の配信を受け取るか、シナリオを選んで「まとめてテストを送る」を開き、自分をテスト受信者に選んでください。</p>
              <p className={styles.cardLine}>送信の記録は友だち追加時の配信かシナリオの1通目で判定します。送らずに判定するテストと受信箱の手動返信は完了に数えません。記録が済みでも、LINEの端末で本文を確認してください。</p>
              {role && role !== 'viewer' && steps.find((step) => step.key === 'firstMessage')?.action ? <div className={styles.bottom}>
                <Button href="/?qr=base">友だち追加のQRを開く</Button>
                <Button href="/scenarios">シナリオを選んでテスト送信する</Button>
              </div> : null}
              <Button onClick={reload}>受信後に状態を読み直す</Button>
            </Card>

            <div className={styles.bottom}>
              {reasons.length > 0 ? (
                <Card variant="form" className={styles.card} aria-label="いま止まっている理由">
                  <CardHeader size="stacked" title="いま止まっている理由" />
                  {reasons.map((line) => <p key={line} className={styles.cardLine}>{line}</p>)}
                </Card>
              ) : null}
              <Card variant="form" className={styles.card} aria-label="気をつけること">
                <CardHeader size="stacked" title="気をつけること" />
                <p className={styles.cardLine}>
                  {CARE_LINES[0]}
                  <br />
                  {CARE_LINES[1]}
                </p>
              </Card>
            </div>
          </>
        )}
      </SettingsPage>
    </div>
  )
}

/** 1段。済みは緑の丸と札、まだは番号の丸と行き先のボタン。押せない段は理由の文字。 */
function StepRow({ step, readOnly }: { step: StepResult; readOnly: boolean }) {
  const done = step.state === 'done'
  return (
    <GridRow data-step-state={step.state}>
      <GridCell><span className={`${styles.mark} ${done ? styles.markDone : ''}`} aria-label={done ? '済み' : `手順${step.ordinal}`}>{done ? <Check size={16} aria-hidden="true" /> : step.ordinal}</span></GridCell>
      <GridCell><div className={styles.stepBody}>
        <strong className={done ? styles.stepDoneTitle : undefined}><TruncatedText value={step.title} /></strong>
        <span className={styles.stepSub}><TruncatedText value={step.sub} /></span>
      </div></GridCell>
      <GridCell align="right">
        {done ? <StatusBadge tone="success" size="compact">済み</StatusBadge> : step.action && !readOnly ? (
          <Button href={step.action.href} variant="secondary">{step.action.label}</Button>
        ) : <span className={styles.stepBlocked}>{step.blockedReason}</span>}
      </GridCell>
    </GridRow>
  )
}
