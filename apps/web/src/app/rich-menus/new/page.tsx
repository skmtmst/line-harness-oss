'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Folder, MediaItem } from '@line-crm/shared'
import RichMenuCreateForm, {
  freshRichMenuCreateValue,
  NEW_MENU_INTENTS_WITH_SWITCH,
  type RichMenuCreateValue,
  type RichMenuOption,
} from '@/components/rich-menus/rich-menu-create-form'
import { areaDraftsForCreate, createAreaDrafts, unsetAreaLabels } from '@/components/rich-menus/action-drafts'
import type { Area } from '@/components/rich-menus/canvas-editor'
import MediaPickerDialog from '@/app/contents/media-picker-dialog'
import StickyBar from '@/components/shared/sticky-bar'
import Button from '@/components/shared/button'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { TEMPLATES } from '@/lib/rich-menu-templates'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { pruneCondition } from '@/lib/segment-condition'

/**
 * N-161: 作成画面の「切替ボタン」は行き先を orderIndex の文字列で持つ
 * （この時点ではページに実IDがないため）。送信の形へ直す。
 * 行き先が未設定のものは null を返して呼び出し側で断る。
 */
function areaDraftsWithSwitchTargets(areas: Area[]) {
  return areaDraftsForCreate(areas).map((area) => {
    if (area.actionType !== 'richmenuswitch') return area
    const raw = area.actionData?.targetPageId
    const index = typeof raw === 'string' ? Number(raw) : NaN
    const { targetPageId: _dropped, ...rest } = (area.actionData ?? {}) as Record<string, unknown>
    return {
      ...area,
      actionData: Number.isInteger(index) ? { ...rest, targetPageIndex: index } : rest,
    }
  })
}

export default function NewRichMenuPage() {
  usePageTitle('リッチメニューを作る')
  const router = useRouter()
  const { selectedAccount } = useAccount()
  const [value, setValue] = useState<RichMenuCreateValue>(freshRichMenuCreateValue)
  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<RichMenuOption[]>([])
  const [templates, setTemplates] = useState<RichMenuOption[]>([])
  const [forms, setForms] = useState<RichMenuOption[]>([])
  const [trackedLinks, setTrackedLinks] = useState<RichMenuOption[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** N-164: 登録メディアから選んだ画像。作成時に既定ページへ登録する。 */
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null)

  /*
   * N-162: 初期値から1か所でも変わっていたら未保存とみなす。
   * freshRichMenuCreateValue は決定的なので、丸ごと比較で足りる。
   * 作成成功後は編集画面へ router.push で進み、警告は出さない。
   * N-164: 選んだメディアも未保存の入力として数える。
   */
  const [initialValue] = useState(freshRichMenuCreateValue)
  const dirty = JSON.stringify(value) !== JSON.stringify(initialValue) || selectedMedia !== null
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: submitting })

  // N-164: アカウントを切り替えたら、前のアカウントで選んだメディアは捨てる。
  // 別アカウントの画像を持ち込めないよう、選択は常に今のアカウントのものだけ。
  useEffect(() => {
    setSelectedMedia(null)
  }, [selectedAccount?.id])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [folderRes, tagRes, templateRes, formRes, linkRes] = await Promise.allSettled([
        api.folders.list('rich_menu'),
        api.tags.list(),
        api.templates.list(),
        selectedAccount ? api.forms.list(selectedAccount.id) : Promise.resolve({ success: true as const, data: [] }),
        api.trackedLinks.list(),
      ])
      if (cancelled) return
      if (folderRes.status === 'fulfilled' && folderRes.value.success) setFolders(folderRes.value.data)
      if (tagRes.status === 'fulfilled' && tagRes.value.success) setTags(tagRes.value.data.map(({ id, name }) => ({ id, name })))
      if (templateRes.status === 'fulfilled' && templateRes.value.success) setTemplates(templateRes.value.data.map(({ id, name }) => ({ id, name })))
      if (formRes.status === 'fulfilled' && formRes.value.success) setForms(formRes.value.data.map(({ id, name }) => ({ id, name })))
      if (linkRes.status === 'fulfilled' && linkRes.value.success) setTrackedLinks(linkRes.value.data.map(({ id, name }) => ({ id, name })))
    })()
    return () => { cancelled = true }
  }, [selectedAccount])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!selectedAccount) return setError('アカウントを選択してください')
    if (!value.name.trim()) return setError('名前を入力してください')
    const selectedTemplate = TEMPLATES.find((item) => item.key === value.templateKey)
    if (!selectedTemplate) return setError('面の分けかたを選び直してください')
    const areas = value.areaDraftsByTemplate[selectedTemplate.key] ?? createAreaDrafts(selectedTemplate)
    // N-161: 切替ボタンの行き先が未設定のまま送ると server が 400 にする。
    // 先にここで止めて、どの面が未設定か分かる文言にする。
    if (areas.some((area) => area.actionType === 'richmenuswitch' && !String(area.actionData?.targetPageId ?? '').trim())) {
      return setError('「メニューを切り替える」面の行き先ページが決まっていません。面の設定で切り替え先を選んでください。')
    }
    // 出し分けを選んだのに条件が空（書きかけ行だけ）だと「誰にも出ない
    // 下書き」が作れる。保存に使う形と同じく、書けた行だけで数える。
    const targetingCondition = value.targetingEnabled ? pruneCondition(value.targetingCondition) : null
    if (value.targetingEnabled && !targetingCondition) {
      return setError('出す相手の条件を設定してください。')
    }
    const pageAreas = areaDraftsWithSwitchTargets(areas)
    setSubmitting(true)
    setError(null)
    try {
      const response = await api.richMenuGroups.create({
        accountId: selectedAccount.id,
        name: value.name.trim(),
        chatBarText: value.chatBarText.trim(),
        size: selectedTemplate.size,
        folderId: value.folderId || null,
        // N-161: 既定ページ・出し分け・全員既定も作成で決める。
        defaultPageIndex: value.defaultPageIndex,
        isDefaultForAll: value.isDefaultForAll && !value.targetingEnabled,
        targetingEnabled: value.targetingEnabled,
        targetingCondition: targetingCondition ? JSON.stringify(targetingCondition) : null,
        targetingPriority: value.targetingPriority,
        // N-164: 選んだ登録メディアを既定ページの画像として登録する。
        imageMediaId: selectedMedia?.id,
        pages: Array.from({ length: value.tabCount + 1 }, (_, index) => ({
          name: index === 0 ? 'トップ' : `タブ ${String.fromCharCode(65 + index - 1)}`,
          orderIndex: index,
          areas: pageAreas,
        })),
      })
      if (!response.success) throw new Error(response.error ?? '作成失敗')
      /*
       * N-161: 未完の作業があるなら「形とボタン」へ、全部そろっていれば
       * 「公開のしかた」へ進む。未完項目を次画面へ隠さない。
       */
      const incomplete = !selectedMedia || unsetAreaLabels(areas).length > 0
      router.push(`/rich-menus/edit?id=${response.data.id}${incomplete ? '' : '&step=publish'}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSubmitting(false)
    }
  }

  return (
    <div data-design-node="XtfO3" className="mx-auto max-w-screen-2xl py-6">
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs"><Link href="/rich-menus" className="hover:underline">リッチメニュー</Link><span className="mx-1.5">/</span><span>新規作成</span></nav>
      <form onSubmit={handleSubmit}>
        <RichMenuCreateForm
          value={value}
          onChange={setValue}
          folders={folders}
          tags={tags}
          templates={templates}
          forms={forms}
          trackedLinks={trackedLinks}
          allowedIntents={NEW_MENU_INTENTS_WITH_SWITCH}
          audienceSetup
          imageAction={(
            <div className="mt-2 space-y-2">
              {selectedMedia && selectedAccount ? (
                <div className="border-hairline flex items-center gap-3 rounded-control border p-2">
                  {/* 選択値のプレビューは認証つきURLで出す（保管URLは露出しない） */}
                  <img
                    src={api.media.contentUrl(selectedMedia.id, selectedAccount.id)}
                    alt={`選択中の画像: ${selectedMedia.filename}`}
                    className="h-16 w-24 rounded-control border-hairline border object-cover"
                  />
                  <div className="min-w-0">
                    <p className="text-ink truncate text-xs font-medium">{selectedMedia.filename}</p>
                    <div className="mt-1 flex gap-2">
                      <Button type="button" onClick={() => setMediaPickerOpen(true)}>選び直す</Button>
                      <Button type="button" onClick={() => setSelectedMedia(null)}>選ばない</Button>
                    </div>
                  </div>
                </div>
              ) : (
                <Button type="button" onClick={() => setMediaPickerOpen(true)} disabled={!selectedAccount}>登録メディアから選ぶ</Button>
              )}
            </div>
          )}
          footer={<StickyBar actions={<><Button href="/rich-menus">キャンセル</Button><Button type="submit" variant="primary" disabled={submitting || !selectedAccount}>{submitting ? '作成中...' : '作成して編集へ'}</Button></>} />}
        />
        {error ? <div role="alert" className="border-danger bg-danger-bg text-danger mt-3 rounded-control border p-3 text-sm">{error}</div> : null}
      </form>
      {/* N-164: キャンセル（onClose）は何も変えない。入力した内容はそのまま残る。 */}
      <MediaPickerDialog
        open={mediaPickerOpen}
        accountId={selectedAccount?.id ?? null}
        kind="image"
        title="リッチメニューの画像を選ぶ"
        description="作成したメニューの最初に見せるページへ登録します。"
        onClose={() => setMediaPickerOpen(false)}
        onSelect={(item) => {
          setSelectedMedia(item)
          setMediaPickerOpen(false)
        }}
      />
      <ConfirmDialog
        open={leaveTarget !== null}
        title="入力中の内容があります"
        description="このまま移動すると、入力した内容は保存されません。移動しますか？"
        confirmLabel="保存せずに移動"
        cancelLabel="入力を続ける"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />
    </div>
  )
}
