'use client'

import { CardHeader } from '@/components/shared/card';
import Checkbox from '@/components/shared/checkbox';
import { emptyValue } from '@/components/shared/empty-value';
import LinePreview,{ LinePreviewMessage } from '@/components/shared/line-preview';
import { SaveErrorField } from '@/components/shared/save-form-errors';
import { CreatePreviewNote,CreateSummaryCard } from '@/components/templates/create-parts';
import { formatNumber } from '@/lib/format';
import type {
AutoReplyConflict,
AutoReplyDryRunResult
} from '@line-crm/shared';
import type { Dispatch,SetStateAction } from 'react';
import { insertedLabels } from './insert-chips';
import { RuleRow,WizardForm,WizardStep } from './wizard-model';
import styles from '../../../app/auto-replies/edit/wizard-v8.module.css';

type RenderWizardPreviewContext = {
  acknowledged: Set<string>
  autoReplyId: string | null
  conflicts: AutoReplyConflict[]
  dryRun: AutoReplyDryRunResult | null
  form: WizardForm
  imageContent: { originalContentUrl: string; previewImageUrl: string; } | null
  isActive: boolean
  matchedLast28Days: number | null
  myIndex: number
  myPositionLabel: string
  orderedRules: RuleRow[]
  previewAccountName: string
  replyPreviewText: string
  selectedTemplate: { id: string; name: string; messageType: string; messageContent: string; folderId?: string | null; updatedAt?: string; } | null
  setAcknowledged: Dispatch<SetStateAction<Set<string>>>
  step: WizardStep
  testMessage: string
  triggerSamples: { text: string; hit: boolean; }[]
}

export function renderWizardPreview({ acknowledged, autoReplyId, conflicts, dryRun, form, imageContent, isActive, matchedLast28Days, myIndex, myPositionLabel, orderedRules, previewAccountName, replyPreviewText, selectedTemplate, setAcknowledged, step, testMessage, triggerSamples }: RenderWizardPreviewContext, withPhone: boolean) { return (<>
          {step === 'basic' && (
            <CreateSummaryCard rows={[
              { label: '状態', value: '停止中' },
              { label: '動く順番', value: myIndex >= 0 ? myPositionLabel : `いちばん下（${orderedRules.length + 1}番目）` },
              { label: '同時に当たるルール', value: '手順4で確かめる' },
            ]} />
          )}
          {step === 'basic' && (
            <CreatePreviewNote>LINEでの見え方は、届けるメッセージを決める手順から右に出ます。</CreatePreviewNote>
          )}

          {step === 'trigger' && (
            <>
              <CreateSummaryCard
                title="過去28日で当たった数"
                leading={<>
                  <p className={styles.countRow} aria-label="当たった受信（過去28日）">
                    <span className={styles.countNum}>{matchedLast28Days == null ? emptyValue('unknown') : formatNumber(matchedLast28Days)}</span>
                    <span className={styles.countUnit}>件</span>
                  </p>
                  <p className={styles.sideHint}>いまの作りでは、保存する前の条件は数えられません。保存すると、このルールが動いた回数がここに出ます。</p>
                </>}
                rows={triggerSamples.map(sample => ({
                  key: sample.text, label: `「${sample.text}」`,
                  value: <span className={sample.hit ? styles.sampleHit : styles.sampleMiss}>{sample.hit ? '当たる' : '当たらない'}</span>,
                }))}
              />
              {withPhone ? <LinePreview accountName={previewAccountName}>
                <div className={styles.talkStack}>
                  <LinePreviewMessage direction="outgoing" accountName={previewAccountName} avatar={null} time="">
                    {triggerSamples[0].text}
                  </LinePreviewMessage>
                </div>
              </LinePreview> : null}
            </>
          )}

          {step === 'response' && (
            <>
              <CreateSummaryCard
                title="送るものの確認"
                rows={[
                  { label: '返すもの', value: form.mode === 'silent' ? '返信しない'
                    : form.mode === 'template' ? selectedTemplate?.name ?? 'テンプレート'
                    : form.mode === 'inline-flex' ? 'カード'
                    : form.mode === 'inline-image' ? '画像'
                    : `テキスト${form.responseContent ? ` ${formatNumber(form.responseContent.length)}字` : ''}` },
                  { label: '後の処理', value: form.actions.length > 0 ? `${form.actions.length}つ` : emptyValue('none') },
                  ...(form.mode === 'inline-text' && insertedLabels(form.responseContent).length > 0
                    ? [{ label: '差し込み', value: insertedLabels(form.responseContent).map(label => label === '名前' ? '名前（取れないときは空欄）' : label).join('・') }] : []),
                ]}
              />
              {withPhone ? <LinePreview accountName={previewAccountName}>
                <div className={styles.talkStack}>
                  <LinePreviewMessage direction="outgoing" accountName={previewAccountName} avatar={null} time="">{triggerSamples[0].text}</LinePreviewMessage>
                  {form.mode === 'inline-image' && imageContent ? (
                    <img
                      src={imageContent.previewImageUrl}
                      alt="返信画像のプレビュー"
                      className={styles.bubbleIn}
                      style={{ padding: 0, overflow: 'hidden' }}
                    />
                  ) : (
                    <LinePreviewMessage density="compact" accountName={previewAccountName} avatar={previewAccountName.slice(0, 1)} time="">{replyPreviewText}</LinePreviewMessage>
                  )}
                </div>
              </LinePreview> : null}
            </>
          )}

          {step === 'priority' && (
            <>
              {/* 絵 Guoye：重なりを1件ずつ確かめる（クリーム地）→ 重なりの確認（行3つ）。 */}
              <section className={styles.conflictCard} aria-label="重なりを1件ずつ確かめる">
                <CardHeader size="stacked" title={<>重なりを1件ずつ確かめる</>} />
                <p className={styles.conflictDesc}>すべてにチェックを付けるまで、⑤で有効にできません。</p>
                {conflicts.length === 0 ? (
                  <p className={styles.conflictDesc}>同時に当たるルールはありません。</p>
                ) : (
                  conflicts.map((conflict, saveFieldIndex) => {
                    const pos = orderedRules.findIndex((r) => r.id === conflict.autoReplyId)
                    return (
                      <div key={conflict.autoReplyId} className={styles.conflictItem}>
                        <span className={conflict.certainty === 'certain' ? styles.conflictChipCertain : styles.conflictChipPossible}>
                          ● {conflict.certainty === 'certain' ? '必ず重なります' : '重なることがあります'}
                        </span>
                        <p className={styles.conflictName} title={conflict.reason}>
                          {conflict.name}{pos >= 0 ? `（${pos + 1}番目）` : ''}
                        </p>
                        <SaveErrorField names={[`conflicts.${saveFieldIndex}.autoReplyId`,`conflicts.${saveFieldIndex}.auto_reply_id`,"autoReplyId","conflict.autoReplyId","acknowledged","id","auto_reply_id","conflict.auto_reply_id"]}><Checkbox
                          checked={acknowledged.has(conflict.autoReplyId)}
                          onCheckedChange={(on) =>
                            setAcknowledged((current) => {
                              const next = new Set(current)
                              if (on) next.add(conflict.autoReplyId)
                              else next.delete(conflict.autoReplyId)
                              return next
                            })
                          }
                          aria-label={`「${conflict.name}」を確かめた`}
                        >
                          確かめた
                        </Checkbox></SaveErrorField>
                      </div>
                    )
                  })
                )}
                <p className={`${styles.conflictDesc} ${styles.conflictResult}`}>
                  試した結果：{dryRun ? (dryRun.draftWon ? 'このルールが返す' : `「${dryRun.winner?.name ?? '別のルール'}」が先に動く → このルールは見送り`) : 'まだ試していません'}
                </p>
              </section>
              <CreateSummaryCard
                title="重なりの確認"
                rows={[
                  { label: '同時に当たるルール', value: conflicts.length > 0 ? `${conflicts.length}つ` : emptyValue('none') },
                  { label: '当たる受信（過去28日）', value: matchedLast28Days == null ? emptyValue('unknown') : `${formatNumber(matchedLast28Days)}件` },
                  { label: '試した結果', value: dryRun ? (dryRun.draftWon ? 'このルールが返す' : '見送り') : 'まだ試していません' },
                ]}
              />
              {withPhone ? <LinePreview accountName={previewAccountName}>
                <div className={styles.talkStack}>
                  {testMessage.trim() ? <p className={styles.bubbleIn}>{testMessage.trim()}</p> : null}
                  <LinePreviewMessage density="compact" accountName={previewAccountName} avatar={previewAccountName.slice(0, 1)} time="">
                    {dryRun?.winner?.responseContent || replyPreviewText}
                  </LinePreviewMessage>
                  {dryRun?.winner && dryRun.winner.autoReplyId !== autoReplyId ? (
                    <p className={styles.bubbleMeta}>「{dryRun.winner.name}」が返します</p>
                  ) : (
                    <p className={styles.bubbleMeta}>このルールが返します</p>
                  )}
                </div>
              </LinePreview> : null}
            </>
          )}

          {step === 'confirm' && (
            <>
              <CreateSummaryCard rows={[
                { label: '状態', value: isActive ? '有効のまま更新' : '停止中 → 有効にする' },
                { label: '動く順番', value: myPositionLabel },
                { label: '同時に当たるルール', value: conflicts.length > 0 ? `${conflicts.length}つ` : emptyValue('none') },
              ]} />
              {withPhone ? <LinePreview accountName={previewAccountName}>
                <div className={styles.talkStack}>
                  <LinePreviewMessage direction="outgoing" accountName={previewAccountName} avatar={null} time="">{triggerSamples[0].text}</LinePreviewMessage>
                  <LinePreviewMessage density="compact" accountName={previewAccountName} avatar={previewAccountName.slice(0, 1)} time="">{replyPreviewText}</LinePreviewMessage>
                </div>
              </LinePreview> : null}
            </>
          )}
        </>
  ) }
