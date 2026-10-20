'use client'

import EntitySelect,{ entityOptionMetadata } from '@/components/shared/entity-select'
import MessageComposer from '@/components/shared/message-composer'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import { type BroadcastBubble,type BroadcastMessageAsset } from '@/lib/api'
import { type TargetMode } from '@/lib/broadcast-audience'
import { isContentTemplateType } from '@/lib/broadcast-template'
import { useFormErrors } from '@/lib/use-form-errors'
import { BroadcastAbTabs } from '@/v8/broadcast-ab/public/tabs/index'
import { useBroadcastAb } from '@/v8/broadcast-ab/public/use-ab/index'
import type { Dispatch,RefObject,SetStateAction } from 'react'
import { emptyBubble } from './broadcast-form-model'
import styles from './broadcast-form-v8.module.css'

type BroadcastMessageStepContext = {
  ab: ReturnType<typeof useBroadcastAb>
  assets: BroadcastMessageAsset[]
  bubbles: BroadcastBubble[]
  composerBusy: boolean
  fields: ReturnType<typeof useFormErrors>
  moveBubble: (index: number, direction: -1 | 1) => void
  selectedAccountId: string | null
  selectedAccountIdRef: RefObject<string | null>
  setBubbles: Dispatch<SetStateAction<BroadcastBubble[]>>
  setComposerBusy: Dispatch<SetStateAction<boolean>>
  setComposerTemplateIndex: Dispatch<SetStateAction<number | null>>
  setComposerTemplateKind: Dispatch<SetStateAction<string | undefined>>
  setInlineComposer: Dispatch<SetStateAction<{ index: number; kind: "carousel" | "rich_message" | "rich_video"; } | null>>
  setShowTemplatePicker: Dispatch<SetStateAction<boolean>>
  setTemplateSaveCreatedId: Dispatch<SetStateAction<string | null>>
  setTemplateSaveError: Dispatch<SetStateAction<string>>
  setTemplateSaveIndex: Dispatch<SetStateAction<number | null>>
  setTemplateSaveName: Dispatch<SetStateAction<string>>
  targetMode: TargetMode
  title: string
  updateBubble: (target: number | string, bubble: BroadcastBubble, restoreKind?: boolean) => void
}

export function BroadcastMessageStep({ ab, assets, bubbles, composerBusy, fields, moveBubble, selectedAccountId, selectedAccountIdRef, setBubbles, setComposerBusy, setComposerTemplateIndex, setComposerTemplateKind, setInlineComposer, setShowTemplatePicker, setTemplateSaveCreatedId, setTemplateSaveError, setTemplateSaveIndex, setTemplateSaveName, targetMode, title, updateBubble }: BroadcastMessageStepContext) {
  return (<section id="broadcast-step-message" className={ styles.section}>
          {targetMode !== 'all' ? <BroadcastAbTabs ab={ab} aBubbles={bubbles} canEdit /> : null}
          {ab.tab === 'B' && ab.b ? (
            <MessageComposer bubbles={ab.b} accountId={selectedAccountId} busy={composerBusy}
              unavailable={{ intro: '紹介メッセージは現在利用できません。' }}
              onChange={(index, bubble) => ab.setB((items) => (items ?? []).map((item, i) => (i === index ? bubble : item)))}
              onMove={(index, direction) => ab.setB((items) => { const next = [...(items ?? [])]; const to = index + direction; if (to < 0 || to >= next.length) return next; [next[index], next[to]] = [next[to], next[index]]; return next })}
              onDelete={(index) => ab.setB((items) => (items ?? []).filter((_, i) => i !== index))}
              onAdd={() => ab.setB((items) => [...(items ?? []), emptyBubble()])}
              onPickTemplate={() => undefined} onSaveTemplate={() => undefined} onCompose={() => undefined}
            />
          ) : null}
          <div className={ab.tab === 'B' && ab.b !== null ? 'hidden' : 'contents'}>
          <MessageComposer bubbleErrors={bubbles.map((_, index) => fields.error(`bubble-${index}`))} bubbleFieldProps={(index) => fields.bind(`bubble-${index}`)} bubbles={bubbles} accountId={selectedAccountId} busy={composerBusy} onBusyChange={(value) => { if (selectedAccountIdRef.current === selectedAccountId) setComposerBusy(value) }}
            unavailable={{ intro: '紹介メッセージは現在利用できません。' }}
            onChange={updateBubble} onMove={moveBubble} onDelete={(index) => setBubbles((items) => items.filter((_, i) => i !== index))}
            onAdd={() => setBubbles((items) => [...items, emptyBubble()])}
            onPickTemplate={(index, kind) => { setComposerTemplateKind(kind); setComposerTemplateIndex(index); setShowTemplatePicker(true) }}
            onSaveTemplate={(index) => { setTemplateSaveCreatedId(null); setTemplateSaveIndex(index); setTemplateSaveName(String(bubbles[index].content.templateName ?? bubbles[index].content.assetName ?? title)); setTemplateSaveError('') }}
            onCompose={(index, kind) => { setTemplateSaveError(''); setInlineComposer({ index, kind }) }}
            extraFields={(index, bubble) => bubble.type === 'text' ? null : isContentTemplateType(bubble.type) ? <SaveErrorField names={["assetId","bubble.content.assetId","content.assetId","asset_id","bubble.content.asset_id","content.asset_id"]}><EntitySelect clearable size="full" aria-label="コンテンツで作成したテンプレートから選択" placeholder="テンプレートを選択してください" value={String(bubble.content.assetId ?? '')} onChange={(id) => { const asset = assets.find((item) => item.id === id); updateBubble(index, { ...bubble, content: asset ? { assetId: asset.id, assetName: asset.name, ...asset.payload } : {} }) }} options={assets.filter((item) => item.kind === bubble.type).map((item) => ({ ...entityOptionMetadata(item), value: item.id, label: item.name }))} /></SaveErrorField> : null}
          />
          </div>
        </section>)
}
