'use client'

import {
matchTypeWord
} from '@/v8/auto-replies/auto-reply-words';
import {
type KeywordRuleDraft
} from '@/components/auto-replies/draft-fields';
import { useActionOptions } from '@/components/auto-replies/inline-action-list';
import { actionRowTitle } from '@/components/auto-replies/inline-action-rows-v8';
import Button from '@/components/shared/button';
import Card,{ CardHeader } from '@/components/shared/card';
import { emptyValue } from '@/components/shared/empty-value';
import { formatNumber } from '@/lib/format';
import {
Check,
CircleAlert
} from 'lucide-react';
import { SummaryRow,WizardForm,WizardStep,weekdaySummary } from './wizard-model';
import styles from '../../../app/auto-replies/edit/wizard-v8.module.css';

type WizardConfirmStepContext = {
  actionOptions: ReturnType<typeof useActionOptions>
  autoReplyId: string | null
  confirmState: "error" | "idle" | "loading" | "ready"
  effectiveKeywords: KeywordRuleDraft[]
  folders: { id: string; name: string; color?: string | null; }[]
  form: WizardForm
  goToStep: (next: WizardStep, ruleId?: string) => void
  loadValidation: (ruleId: string) => Promise<void>
  myPositionLabel: string
  selectedTemplate: { id: string; name: string; messageType: string; messageContent: string; folderId?: string | null; updatedAt?: string; } | null
  thisRuleName: string
  v8Checks: { label: string; state: string; detail: string; back: WizardStep; }[]
}

export function WizardConfirmStep({ actionOptions, autoReplyId, confirmState, effectiveKeywords, folders, form, goToStep, loadValidation, myPositionLabel, selectedTemplate, thisRuleName, v8Checks }: WizardConfirmStepContext) {
  return (<>
              <Card variant="form" gap="normal" className={styles.cardContent}>
                <CardHeader size="stacked" title={<>設定の確認</>} />
                <div className={styles.summaryList}>
                  <SummaryRow label="名前・フォルダ" onEdit={() => goToStep('basic')}>
                    {thisRuleName}
                    {form.folderId
                      ? `・${folders.find((f) => f.id === form.folderId)?.name ?? '分けない'}`
                      : '・分けない'}
                  </SummaryRow>
                  <SummaryRow label="反応する言葉" onEdit={() => goToStep('trigger')}>
                    {form.respondToAll
                      ? 'すべてのメッセージ'
                      : effectiveKeywords.length > 0
                        ? `${effectiveKeywords.map((r) => `「${r.keyword.trim()}」`).join('')}（${matchTypeWord(form.matchType)}）`
                        : emptyValue('unconfigured')}
                  </SummaryRow>
                  <SummaryRow label="いつ" onEdit={() => goToStep('trigger')}>
                    {[
                      // 絵 「月〜金・いつでも」：手順②の「まとめて」と同じ言い方
                      weekdaySummary(form.weekdays).replace(/に反応$/, ''),
                      form.timeMode === 'custom' && (form.activeFrom || form.activeUntil)
                        ? `${form.activeFrom || '00:00'}〜${form.activeUntil || '24:00'}`
                        : 'いつでも',
                    ].join('・')}
                  </SummaryRow>
                  <SummaryRow label="誰に" onEdit={() => goToStep('trigger')}>
                    {form.friendTarget === 'filtered' ? '条件に合う友だち' : 'すべての友だち'}
                  </SummaryRow>
                  <SummaryRow label="返すもの" onEdit={() => goToStep('response')}>
                    {form.mode === 'silent'
                      ? '返信しない（後の処理だけ）'
                      : form.mode === 'template'
                        ? selectedTemplate
                          ? `テンプレート「${selectedTemplate.name}」`
                          : 'テンプレート（未選択）'
                        : form.mode === 'inline-flex'
                          ? 'カード'
                          : form.mode === 'inline-image'
                            ? '画像'
                            : `テキスト ${formatNumber(form.responseContent.length)}字`}
                  </SummaryRow>
                  <SummaryRow label="返したあと" onEdit={() => goToStep('response')}>
                    {form.actions.length > 0
                      ? form.actions.map((a, i) => `${i + 1} ${actionRowTitle(a, actionOptions)}`).join(' → ')
                      : emptyValue('none')}
                  </SummaryRow>
                  <SummaryRow label="細かい決まり" onEdit={() => goToStep('response')}>
                    {[
                      Number(form.replyDelaySeconds) > 0 ? `${form.replyDelaySeconds}秒待つ` : 'すぐ返す',
                      form.cooldownOn ? `同じ人へは${form.cooldownMinutes}分あける` : null,
                      form.skipWhenOperatorActive ? '対応中のトークには返さない' : null,
                      form.oncePerFriend ? '1人1回' : null,
                      form.unmatchedMode === 'notify_operator' ? '外れたら担当者へ' : null,
                    ]
                      .filter(Boolean)
                      .join('・')}
                  </SummaryRow>
                  <SummaryRow label="動く順番" onEdit={() => goToStep('priority')}>
                    {myPositionLabel}
                  </SummaryRow>
                </div>
              </Card>

              <Card variant="form" gap="normal" className={styles.cardContent}>
                <CardHeader size="stacked" title={<>有効にする前の確認</>} />
                {confirmState === 'loading' && <p className={styles.hint}>確かめています…</p>}
                {confirmState === 'error' && (
                  <p className={styles.hint}>
                    確認を読み込めませんでした。
                    <button
                      type="button"
                      className={styles.weekdayPreset}
                      onClick={() => autoReplyId && void loadValidation(autoReplyId)}
                    >
                      読み直す
                    </button>
                  </p>
                )}
                {confirmState === 'ready' &&
                  v8Checks.map((gate) => {
                    const backTo = gate.back
                    return (
                      <div key={gate.label} className={styles.checkRow}>
                        <span
                          className={`${styles.checkIcon} ${gate.state === 'ok' ? styles.checkIconOk : gate.state === 'blocked' ? styles.checkIconWarn : ''}`}
                          aria-hidden="true"
                        >
                          {gate.state === 'ok' ? <Check size={14} /> : gate.state === 'blocked' ? <CircleAlert size={14} /> : emptyValue('unknown')}
                        </span>
                        <div className={styles.checkBody}>
                          <p className={styles.checkTitle}>{gate.label}</p>
                          <p className={styles.checkNote}>{gate.detail}</p>
                        </div>
                        <Button type="button" variant="text" onClick={() => goToStep(backTo)}>
                          見直す
                        </Button>
                      </div>
                    )
                  })}
              </Card>
            </>)
}
