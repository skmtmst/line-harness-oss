'use client'
import type { Area } from './area-types'
import { SIZE_DIMENSIONS, TEMPLATES, type RichMenuTemplate } from '@/lib/rich-menu-templates'
import type { SegmentCondition } from '@/lib/segment-condition'
import type { RichMenuAreaIntent } from '@line-crm/shared'

export type RichMenuOption = { id: string; name: string }

export type RichMenuFolderOption = RichMenuOption

export type RichMenuCreateValue = {
  name: string
  chatBarText: string
  size: 'large' | 'compact'
  tabCount: number
  templateKey: string
  folderId: string
  areaDraftsByTemplate: Record<string, Area[]>
  /**
   * N-161: 作成の時点で決める「どのページを最初に見せるか」。
   * ページの orderIndex（0 がトップ）。タブを増やしたあとで減らしたときは
   * 範囲内へ丸める。
   */
  defaultPageIndex: number
  /**
   * N-161: 「公開したら全員の既定メニューにする」か。
   * 出し分け（targetingEnabled）と両立しないため、出し分けを選んだらOFF固定。
   */
  isDefaultForAll: boolean
  /** N-161: 出す相手の条件。有効にするなら targetingCondition が必須。 */
  targetingEnabled: boolean
  targetingCondition: SegmentCondition | null
  /** N-161: 複数の条件に当てはまったときの優先順（0 がいちばん先）。 */
  targetingPriority: number
}

export const STORE_NEW_MENU_INTENTS: RichMenuAreaIntent[] = [
  'url', 'text', 'template', 'form', 'tel', 'postback', 'datetime', 'clipboard',
]

/**
 * N-161: 新規作成ではページ切替もここで決める。
 * 統括ひな形（STORE_NEW_MENU_INTENTS）には switch を足さない。
 * 配布形式が切替を保持できないため（hq-rich-menu-create.ts で保存時に断る）。
 */
export const NEW_MENU_INTENTS_WITH_SWITCH: RichMenuAreaIntent[] = [
  ...STORE_NEW_MENU_INTENTS,
  'switch',
]

export function freshRichMenuCreateValue(): RichMenuCreateValue {
  return {
    name: '',
    chatBarText: 'メニュー',
    size: 'large',
    tabCount: 0,
    templateKey: TEMPLATES[0].key,
    folderId: '',
    areaDraftsByTemplate: {},
    defaultPageIndex: 0,
    isDefaultForAll: false,
    targetingEnabled: false,
    targetingCondition: null,
    targetingPriority: 0,
  }
}

export function RichMenuTemplatePreview({ template }: { template: RichMenuTemplate }) {
  const dims = SIZE_DIMENSIONS[template.size]
  const inset = dims.width * 0.006
  /*
   * 面の記号（A・B…）は面の位置を示すため、座標は変えない。
   * 大きさだけ実表示に合わせた px 指定にする。SVG 内の単位のまま
   * （200px超）書くと、計算上の大きな文字として読まれる。
   */
  /*
   * 板  の見本どおり、面は塗らず薄い線だけにする。箱の地と枠は
   * 呼び出し側の見本の箱が持つ。面の記号は契約試験が位置を守るため残す。
   */
  return (
    <svg viewBox={`0 0 ${dims.width} ${dims.height}`} className="block h-auto w-full" role="img" aria-label={`${template.label} の面の分けかた`}>
      {template.areas.length === 0 ? (
        <text x={dims.width / 2} y={dims.height / 2} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 'clamp(10px, 0.85vw, 16px)', fill: 'var(--color-ink-faint)' }}>自由に配置</text>
      ) : template.areas.map((area, index) => (
        <g key={index}>
          <rect x={area.x + inset} y={area.y + inset} width={Math.max(0, area.w - inset * 2)} height={Math.max(0, area.h - inset * 2)} rx={dims.width * 0.008} strokeWidth={dims.width * 0.004} style={{ fill: 'none', stroke: 'var(--color-ink-faint)' }} />
          <text x={area.x + area.w / 2} y={area.y + area.h / 2} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 'clamp(9px, 0.75vw, 14px)', fill: 'var(--color-ink-secondary)', fontWeight: 500 }}>{String.fromCharCode(65 + index)}</text>
        </g>
      ))}
    </svg>
  )
}
