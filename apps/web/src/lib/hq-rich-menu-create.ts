import type { Area } from '@/components/rich-menus/canvas-editor'
import type { RichMenuCreateValue } from '@/components/rich-menus/rich-menu-create-form'
import type { RichMenuDefinition } from './hq-templates-api'
import { TEMPLATES } from './rich-menu-templates'

export class HqRichMenuCompatibilityError extends Error {
  /** 画面にそのまま出せる日本語の理由。 */
  readonly reason: string
  constructor(message: string) {
    super(message)
    this.name = 'HqRichMenuCompatibilityError'
    this.reason = message
  }
}

const fail = (message: string): never => { throw new HqRichMenuCompatibilityError(message) }

function stringData(value: Record<string, string>): Record<string, unknown> {
  return { ...value }
}

function templateFor(definition: RichMenuDefinition) {
  const menu = definition.richMenu
  const firstPage = menu.pages[0]
  if (!firstPage) fail('リッチメニューにページがありません。')
  const matched = TEMPLATES.find((template) => {
    if (template.size !== menu.size || template.areas.length !== firstPage.areas.length) return false
    return template.areas.every((bounds, index) => {
      const area = firstPage.areas[index]
      return area.bounds.x === Math.round(bounds.x)
        && area.bounds.y === Math.round(bounds.y)
        && area.bounds.width === Math.round(bounds.w)
        && area.bounds.height === Math.round(bounds.h)
    })
  })
  return matched ?? fail('このリッチメニューは自由配置の領域を含むため、共通の新規作成画面では編集できません。店舗側の編集画面で確認してください。')
}

function definitionAreaToDraft(area: RichMenuDefinition['richMenu']['pages'][number]['areas'][number]): Area {
  if (area.scenarioId) fail('シナリオ参照を含むボタンは、共通の新規作成画面では変更できません。')
  if (area.intent === 'switch' || area.actionType === 'richmenuswitch') fail('メニュー切替を含むボタンは、作成後の編集画面で変更してください。')
  if (!area.intent || !['url', 'text', 'form', 'template'].includes(area.intent)) fail('対応していないボタン動作が含まれているため、内容を変更せず停止しました。')
  return {
    id: area.id,
    boundsX: area.bounds.x,
    boundsY: area.bounds.y,
    boundsWidth: area.bounds.width,
    boundsHeight: area.bounds.height,
    actionType: area.actionType,
    actionData: stringData(area.actionData),
    intent: area.intent,
    label: area.label ?? null,
    tagIds: [...(area.tagIds ?? [])],
    scoreChange: null,
    templateId: area.templateId ?? null,
    formId: area.formId ?? null,
    trackedLinkId: null,
  }
}

export function hqDefinitionToRichMenuCreateValue(definition: RichMenuDefinition): RichMenuCreateValue {
  if (definition.richMenu.pages.length > 4) fail('新規作成画面で扱えるのは4ページまでです。内容は変更していません。')
  const template = templateFor(definition)
  const firstPage = definition.richMenu.pages[0]
  return {
    name: definition.richMenu.name,
    chatBarText: definition.richMenu.chatBarText,
    size: definition.richMenu.size,
    tabCount: definition.richMenu.pages.length - 1,
    templateKey: template.key,
    folderId: '',
    areaDraftsByTemplate: { [template.key]: firstPage.areas.map(definitionAreaToDraft) },
    // N-161: 統括ひな形には既定ページ・出し分け・全員既定の概念がない。
    // 店舗側で作り直すときの既定値を置く。
    defaultPageIndex: 0,
    isDefaultForAll: false,
    targetingEnabled: false,
    targetingCondition: null,
    targetingPriority: 0,
  }
}

function draftAreaToDefinition(area: Area): RichMenuDefinition['richMenu']['pages'][number]['areas'][number] {
  if (area.trackedLinkId) fail('計測リンクは店舗ごとの参照です。配布先へ安全に置き換えられないため保存しません。')
  if (area.scoreChange != null && area.scoreChange !== 0) fail('スコア加算は統括の配布形式が未対応のため保存しません。')
  if (!area.intent || !['url', 'text', 'form', 'template'].includes(area.intent)) fail('このボタン動作は統括の配布形式が未対応のため保存しません。')
  // O: 日時・コピーは統括の配布形式が持てない（上の門番で弾く）。
  // 種類は intent から決め直し、4つのままに絞る。
  const hqIntent = area.intent as 'url' | 'text' | 'form' | 'template'
  const actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch' =
    hqIntent === 'url' || hqIntent === 'form' ? 'uri' : hqIntent === 'text' ? 'message' : 'postback'
  const entries = Object.entries(area.actionData ?? {})
  if (entries.some(([, value]) => typeof value !== 'string')) fail('ボタン動作に保存できない値が含まれています。')
  return {
    id: area.id,
    bounds: { x: area.boundsX, y: area.boundsY, width: area.boundsWidth, height: area.boundsHeight },
    actionType,
    actionData: Object.fromEntries(entries) as Record<string, string>,
    intent: area.intent as 'url' | 'text' | 'form' | 'template',
    ...(area.label ? { label: area.label } : {}),
    ...(area.tagIds?.length ? { tagIds: [...area.tagIds] } : {}),
    ...(area.formId ? { formId: area.formId } : {}),
    ...(area.templateId ? { templateId: area.templateId } : {}),
  }
}

function uniqueId(prefix: string, used: Set<string>): string {
  let index = 1
  while (used.has(`${prefix}-${index}`)) index += 1
  const id = `${prefix}-${index}`
  used.add(id)
  return id
}

export function richMenuCreateValueToHqDefinition(value: RichMenuCreateValue, previous: RichMenuDefinition): RichMenuDefinition {
  if (value.folderId) fail('統括のフォルダは配布先の店舗フォルダと対応しないため保存しません。')
  const template = TEMPLATES.find((item) => item.key === value.templateKey && item.size === value.size)
    ?? fail('面の分けかたを選び直してください。')
  const drafts = value.areaDraftsByTemplate[template.key]
  const areas = (drafts ?? []).map(draftAreaToDefinition)
  const old = previous.richMenu
  if (value.size !== old.size && old.pages.some((page) => page.imageR2Key)) fail('登録済み画像があるためサイズを変更できません。画像を作り直す場合は別のひな形を作成してください。')
  const wanted = value.tabCount + 1
  if (wanted < old.pages.length) {
    const removed = old.pages.slice(wanted)
    if (removed.some((page) => page.imageR2Key || page.areas.length)) fail('内容のあるタブを削除するとデータが失われるため停止しました。')
  }
  const used = new Set<string>([old.id, ...old.pages.flatMap((page) => [page.id, ...page.areas.map((area) => area.id)])])
  const pages = old.pages.slice(0, wanted).map((page, index) => index === 0 ? { ...page, areas } : page)
  while (pages.length < wanted) {
    const pageId = uniqueId('page', used)
    pages.push({
      id: pageId,
      name: `タブ ${String.fromCharCode(65 + pages.length - 1)}`,
      imageR2Key: old.pages[0]?.imageR2Key ?? '',
      areas: areas.map((area) => ({ ...area, id: uniqueId('area', used), bounds: { ...area.bounds }, actionData: { ...area.actionData }, tagIds: area.tagIds ? [...area.tagIds] : undefined })),
    })
  }
  return {
    ...previous,
    richMenu: {
      ...old,
      name: value.name,
      chatBarText: value.chatBarText,
      size: value.size,
      pages,
      defaultPageId: pages.some((page) => page.id === old.defaultPageId) ? old.defaultPageId : pages[0].id,
    },
  }
}

/* ───── 統括のリッチメニューを、店のリッチメニューの作る画面（app/rich-menus/new/create-v8.tsx）で作る口（B-36・gobhu〜gQabc） ───── */

/**
 * 作る画面が手順①〜④の間に画面の中で持つ統括のひな形。店は手順ごとにサーバーへ下書きを保存するが、
 * 統括のひな形は一度に保存する形なので、最後に一度だけ統括のひな形の口へ保存する。
 */
export interface HqRichMenuSeed {
  /** 保存してある定義の id（新しく作るときは無い）。 */
  id?: string
  name: string
  chatBarText: string
  folderId: string | null
  size: 'large' | 'compact'
  /** 誰に出すか：すべての友だち（配った先の既定）／配った先で店が決める。 */
  displayAudience: 'all' | 'store'
  displayOrder: number
  defaultPageId: string
  pages: Array<{ id: string; name: string; imageR2Key: string | null; areas: Area[] }>
}

/** 統括のひな形で選べるボタンの動き（配った先の同じ名前の参照に直せるもの）。 */
export const HQ_RICH_MENU_INTENTS = ['url', 'text', 'form', 'template', 'switch'] as const

const HQ_ID = /^[A-Za-z0-9_-]{1,128}$/

export function hqRichMenuSeedFromDefinition(definition: RichMenuDefinition, folderId: string | null): HqRichMenuSeed {
  const menu = definition.richMenu
  return {
    id: menu.id,
    name: menu.name,
    chatBarText: menu.chatBarText,
    folderId,
    size: menu.size,
    displayAudience: menu.displayAudience === 'all' ? 'all' : 'store',
    displayOrder: menu.displayOrder ?? 0,
    defaultPageId: menu.defaultPageId,
    pages: menu.pages.map((page) => ({
      id: page.id,
      name: page.name,
      imageR2Key: page.imageR2Key || null,
      areas: page.areas.map((area) => ({
        id: area.id,
        boundsX: area.bounds.x,
        boundsY: area.bounds.y,
        boundsWidth: area.bounds.width,
        boundsHeight: area.bounds.height,
        actionType: area.actionType,
        actionData: { ...area.actionData },
        intent: area.intent ?? null,
        label: area.label ?? null,
        tagIds: [...(area.tagIds ?? [])],
        scoreChange: null,
        templateId: area.templateId ?? null,
        formId: area.formId ?? null,
        trackedLinkId: null,
      })),
    })),
  }
}

const ACTION_BY_INTENT = { url: 'uri', form: 'uri', text: 'message', template: 'postback', switch: 'richmenuswitch' } as const

/** 画面の中の下書きを、統括のひな形の定義にする。統括で持てない動き・参照は保存の前に断る。 */
export function hqRichMenuDefinitionFromSeed(seed: HqRichMenuSeed): RichMenuDefinition {
  const used = new Set<string>()
  const pageIds = new Map<string, string>()
  seed.pages.forEach((page, index) => {
    const id = HQ_ID.test(page.id) && !used.has(page.id) ? page.id : uniqueId('page', used)
    used.add(id)
    pageIds.set(page.id, id)
    void index
  })
  const pages = seed.pages.map((page) => {
    if (!page.imageR2Key) fail(`ページ「${page.name}」の画像を選んでください。`)
    return {
      id: pageIds.get(page.id)!,
      name: page.name.trim() || 'ページ',
      imageR2Key: page.imageR2Key ?? '',
      areas: page.areas.map((area, index) => {
        const name = area.label?.trim() || `面 ${String.fromCharCode(65 + index)}`
        if (area.trackedLinkId) fail(`「${name}」の計測リンクは店ごとの参照です。配った先で決めてください。`)
        if (area.scoreChange != null && area.scoreChange !== 0) fail(`「${name}」のスコアは統括のひな形では決められません。`)
        const intent = area.intent
        if (!intent || !(HQ_RICH_MENU_INTENTS as readonly string[]).includes(intent)) fail(`「${name}」の動きを決めてください（統括では URL・メッセージ・回答フォーム・テンプレート・メニューの切り替えだけ選べます）。`)
        const hqIntent = intent as typeof HQ_RICH_MENU_INTENTS[number]
        if (area.tagIds?.length && hqIntent !== 'text' && hqIntent !== 'template') fail(`「${name}」でタグを付けられるのは「メッセージを送る」「テンプレートを送る」だけです。`)
        const data = area.actionData ?? {}
        const actionData: Record<string, string> = hqIntent === 'url' ? { uri: String(data.uri ?? '') }
          : hqIntent === 'text' ? { text: String(data.text ?? '') }
          : hqIntent === 'switch' ? { targetPageId: pageIds.get(String(data.targetPageId ?? '')) ?? String(data.targetPageId ?? '') }
          : {}
        const id = HQ_ID.test(area.id) && !used.has(area.id) ? area.id : uniqueId('area', used)
        used.add(id)
        return {
          id,
          bounds: { x: area.boundsX, y: area.boundsY, width: area.boundsWidth, height: area.boundsHeight },
          actionType: ACTION_BY_INTENT[hqIntent],
          actionData,
          intent: hqIntent,
          ...(area.label?.trim() ? { label: area.label.trim() } : {}),
          ...(area.tagIds?.length ? { tagIds: [...area.tagIds] } : {}),
          ...(hqIntent === 'form' && area.formId ? { formId: area.formId } : {}),
          ...(hqIntent === 'template' && area.templateId ? { templateId: area.templateId } : {}),
        }
      }),
    }
  })
  const menuId = seed.id && HQ_ID.test(seed.id) ? seed.id : uniqueId('menu', used)
  return {
    schemaVersion: 1,
    richMenu: {
      id: menuId,
      name: seed.name.trim(),
      chatBarText: seed.chatBarText.trim(),
      size: seed.size,
      defaultPageId: pageIds.get(seed.defaultPageId) ?? pages[0]?.id ?? '',
      displayOrder: Math.max(0, Math.round(seed.displayOrder)),
      displayAudience: seed.displayAudience,
      pages,
    },
  }
}
