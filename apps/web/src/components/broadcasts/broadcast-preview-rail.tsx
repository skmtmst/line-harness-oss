'use client'

import type { AccountWithStats } from '@/contexts/account-context'
import type { Tag } from '@line-crm/shared'
import { BubblePreview } from './broadcast-preview-model'


import { type BroadcastStepKey } from '@/components/broadcasts/broadcast-steps'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import KpiCard from '@/components/shared/kpi-card'
import Checkbox from '@/components/shared/checkbox'
import LinePreview from '@/components/shared/line-preview'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import SegmentedControl from '@/components/shared/segmented'
import TextLink from '@/components/shared/text-link'
import { type BroadcastBubble,type BroadcastMessageButton,type BroadcastPreflight } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { useBroadcastAb } from '@/v8/broadcast-ab/public/use-ab/index'
import { Eye,Send } from 'lucide-react'
import type { Dispatch,RefObject,SetStateAction } from 'react'
import { bubblesError } from './broadcast-form-model'
import styles from './broadcast-form-v8.module.css'

type BroadcastPreviewRailContext = {
  ab: ReturnType<typeof useBroadcastAb>
  afterActionVersionId: string
  audienceDisplayCount: number | null
  bubbles: BroadcastBubble[]
  confirmAudienceLabel: string
  currentStep: BroadcastStepKey | null
  excludeTagId: string
  messageButtons: BroadcastMessageButton[]
  openTestDialog: () => Promise<void>
  preflight: BroadcastPreflight | null
  preflightStatus: 'error' | 'idle' | 'loading' | 'ready'
  previewCloseRef: RefObject<HTMLButtonElement | null>
  previewConfirmed: boolean
  previewDevice: "phone" | "pc"
  previewOpen: boolean
  previewToggleRef: RefObject<HTMLButtonElement | null>
  publishedActions: { versionId: string; name: string; version: number; }[]
  saving: boolean
  scheduledLabel: string | null
  selectedAccount: AccountWithStats | null
  sendWhenLabel: string | null
  setPreviewConfirmed: Dispatch<SetStateAction<boolean>>
  setPreviewDevice: Dispatch<SetStateAction<"phone" | "pc">>
  setPreviewOpen: Dispatch<SetStateAction<boolean>>
  tags: Tag[]
  testBlockReason: string
}

export function BroadcastPreviewRail({ ab, afterActionVersionId, audienceDisplayCount, bubbles, confirmAudienceLabel, currentStep, excludeTagId, messageButtons, openTestDialog, preflight, preflightStatus, previewCloseRef, previewConfirmed, previewDevice, previewOpen, previewToggleRef, publishedActions, saving, scheduledLabel, selectedAccount, sendWhenLabel, setPreviewConfirmed, setPreviewDevice, setPreviewOpen, tags, testBlockReason }: BroadcastPreviewRailContext) {
  const closeButton = <Button ref={previewCloseRef} className={styles.previewClose} size="compact" onClick={() => { setPreviewOpen(false); previewToggleRef.current?.focus() }}>閉じる</Button>
  /*
   * 手順 1〜2 はまだ本文が無い。空のスマホではなく、いま役に立つ「届く人数」と内訳を出す。
   * 数は事前確認が返した値だけ。まだ数えていない値は 0 にせず「—」にする。
   * 除くタグで外れた人数は事前確認が返さないので、タグの名前だけを出す。
   */
  if (currentStep === 'basic' || currentStep === 'audience') {
    const blocked = preflight?.exclusions?.blocked
    const matched = preflight?.audience?.matched
    const people = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${formatNumber(value)} 人`)
    return (<aside id="broadcast-line-preview" className={styles.preview} data-open={previewOpen || undefined} aria-label="届く人">
        <div className={styles.previewHead}><h3>届く人</h3>{closeButton}</div>
        <Card layout="vertical" padding="compact" gap="tight" className={styles.reachCard}>
          <div aria-live="polite"><KpiCard presentation="inline" title="届く人" value={audienceDisplayCount} unit="人" detail={null} icon={null} loading={audienceDisplayCount === null && preflightStatus === 'loading'} /></div>
          <dl className={styles.reachRows}>{[
            [confirmAudienceLabel, people(matched)],
            ['ブロック中で除く', blocked === undefined ? '—' : blocked === 0 ? '0 人' : `− ${formatNumber(blocked)} 人`],
            ['除くタグ', tags.find((tag) => tag.id === excludeTagId)?.name ?? 'なし'],
          ].map(([label, value]) => <div key={label}><dt title={label}>{label}</dt><dd title={value}>{value}</dd></div>)}</dl>
          <TextLink href="/friends">届く人の一覧へ</TextLink>
        </Card>
      </aside>)
  }
  return (<aside id="broadcast-line-preview" className={styles.preview} data-open={previewOpen || undefined} aria-label="LINEの見え方">
        <div className={styles.previewHead}><h3>LINE の見え方</h3><SegmentedControl aria-label="プレビューの端末" size="small" fit="content" value={previewDevice} options={[{ value: 'phone', label: 'スマホ' }, { value: 'pc', label: 'PC' }]} onChange={setPreviewDevice} />{closeButton}</div>
        {ab.hasB ? <SegmentedControl aria-label="見本の案" size="compact" value={ab.tab} options={[{ value: 'A', label: 'A 案の見本' }, { value: 'B', label: 'B 案の見本' }]} onChange={ab.setTab} /> : null}
        <div className={previewDevice === 'pc' ? styles.pcPreview : styles.phonePreview}>
          <LinePreview accountName={selectedAccount?.name} note="実際のLINE表示に近い確認用プレビューです。" caption={scheduledLabel ? `${scheduledLabel} に届きます` : '配信日時は STEP 4 で設定します'} empty={ Boolean(bubblesError(bubbles)) && bubbles.every((bubble) => bubble.type === 'text' && !String(bubble.content.text ?? '').trim()) ? 'メッセージは手順3で作成します' : false}>
            <div className="flex flex-col gap-3 text-ink">{ (ab.tab === 'B' && ab.b ? ab.b : bubbles).map((bubble, index) => <BubblePreview key={bubble.id} bubble={bubble} accountName={selectedAccount?.name} composer={currentStep === 'message'} buttons={index === 0 ? messageButtons : []} />)}</div>
          </LinePreview>
        </div>
        <p className={styles.previewCaption}>「名前」は相手の名前で置き換えます</p>
        <div className={styles.previewSummary}><h3>設定内容</h3><dl>{[
          ['送る相手', `${confirmAudienceLabel}${audienceDisplayCount === null ? '' : `（${formatNumber(audienceDisplayCount)}人）`}`],
          ...(currentStep === 'message' ? [] : [['除くタグ', tags.find((tag) => tag.id === excludeTagId)?.name ?? 'なし']]),
          ['送る日時', sendWhenLabel ?? '未設定'],
          ['配信後のアクション', publishedActions.find((action) => action.versionId === afterActionVersionId)?.name ?? 'なし'],
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl></div>
        <div className={styles.previewActions}><Button type="button" disabled={Boolean(testBlockReason) || saving} title={testBlockReason || (saving ? '保存が終わるまでお待ちください' : undefined)} onClick={() => void openTestDialog()}><Send size={16} aria-hidden /> テストを送る</Button><Button type="button" onClick={() => setPreviewConfirmed(true)}><Eye size={16} aria-hidden /> 配信イメージを見る</Button></div>
        {bubblesError(bubbles) ? <p className="text-xs text-ink-faint">本文を入れるとテストを送れます</p> : null}
        <SaveErrorField names={["previewConfirmed","preview_confirmed"]}><Checkbox checked={previewConfirmed} onCheckedChange={setPreviewConfirmed}>{previewConfirmed ? 'LINEプレビュー確認済み' : 'LINEプレビューが未確認です'}</Checkbox></SaveErrorField>
      </aside>)
}
