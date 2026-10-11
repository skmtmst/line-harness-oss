'use client'
import TemplateRichV8 from '@/v8/template-edit/rich'
import TemplateAssetV8 from '@/v8/template-edit/asset'
import { type BroadcastAssetKind } from '@/lib/api'
import { type InlineAction } from '@/components/auto-replies/draft-fields'



export type AssetKind = Extract<BroadcastAssetKind, 'rich_message' | 'coupon' | 'research'>


export const META: Record<AssetKind, { title: string; folder: string }> = {
  rich_message: { title: 'リッチメッセージ', folder: '03_販促・クーポン' },
  coupon: { title: 'クーポン', folder: '03_販促・クーポン' },
  research: { title: 'リサーチ', folder: '02_健康フォロー' },
}


/*
 * NEXT-18: 面の分け方はこの1つの定義から展開する。
 * 形状を選ぶと、プレビューの枠・面ごとの設定欄・保存データ（座標つき
 * tapAreas）がすべて同じ面数になる。面の定義を3か所に写すと、
 * 「6面を選んだのに2面しか保存されない」ような食い違いがまた起きる。
 */
export interface RichArea {
  label: string
  /** 画像の左上を 0,0 とした百分率。 */
  x: number
  y: number
  width: number
  height: number
}


export interface RichShape {
  value: string
  label: string
  /** 形状ボタンの中に出す見取り図。 */
  glyph: string
  areas: RichArea[]
}


export function buildAreas(rows: string[][]): RichArea[] {
  const height = 100 / rows.length
  return rows.flatMap((labels, rowIndex) => {
    const width = 100 / labels.length
    return labels.map((label, colIndex) => ({
      label,
      x: Math.round(colIndex * width * 100) / 100,
      y: Math.round(rowIndex * height * 100) / 100,
      width: Math.round(width * 100) / 100,
      height: Math.round(height * 100) / 100,
    }))
  })
}


export const RICH_SHAPES: RichShape[] = [
  { value: '1', label: '1面', glyph: 'A', areas: buildAreas([['A']]) },
  { value: '2v', label: '上下2面', glyph: 'A\nB', areas: buildAreas([['A'], ['B']]) },
  { value: '2h', label: '左右2面', glyph: 'A B', areas: buildAreas([['A', 'B']]) },
  { value: '3', label: '上1・下2', glyph: 'A\nB C', areas: buildAreas([['A'], ['B', 'C']]) },
  { value: '4', label: '4面', glyph: 'A B\nC D', areas: buildAreas([['A', 'B'], ['C', 'D']]) },
  { value: '6', label: '6面', glyph: 'A B C\nD E F', areas: buildAreas([['A', 'B', 'C'], ['D', 'E', 'F']]) },
]


export type AreaActionKind = 'none' | 'uri' | 'actions'


/** 面1つぶんの設定。`kind` が動きの種類。 */
export interface AreaDraft {
  kind: AreaActionKind
  uri: string
  actions: InlineAction[]
}


export function emptyAreaDraft(): AreaDraft {
  return { kind: 'none', uri: '', actions: [] }
}


/** その面に設定が入っているか。面を減らす確認に使う。 */
export function areaDraftConfigured(draft: AreaDraft | undefined): boolean {
  return Boolean(draft && draft.kind !== 'none')
}


export function areaSummary(draft: AreaDraft | undefined): string {
  if (!draft || draft.kind === 'none') return '未設定'
  if (draft.kind === 'uri') return 'URLを開く'
  return draft.actions.length > 0 ? `動きを ${draft.actions.length} 件` : '動きなし'
}


/* NEXT-19: リサーチの質問は配列で持ち、順序・形式・必須・選択肢まで保存する。 */
export const MAX_QUESTIONS = 10

/** LINEのクイックリプライは13件まで。 */
export const MAX_CHOICES = 13


export type ResearchFormat = 'single' | 'multiple' | 'free'


export const FORMAT_LABEL: Record<ResearchFormat, string> = {
  single: '1つだけ選ぶ',
  multiple: 'いくつでも選ぶ',
  free: '自由に書く',
}


export interface ResearchQuestion {
  /** 並び替え・選択のための画面内の印。保存しない。 */
  key: string
  text: string
  format: ResearchFormat
  required: boolean
  choices: string[]
}


export function newQuestion(): ResearchQuestion {
  return { key: crypto.randomUUID(), text: '', format: 'single', required: true, choices: ['', ''] }
}


export function visualQuestions(): ResearchQuestion[] {
  return [
    { key: 'vq-1', text: '来月も定期便を続けたいと思いますか？', format: 'single', required: true, choices: ['続けたい', 'どちらともいえない', '止めたい'] },
    { key: 'vq-2', text: 'よく使っている商品を教えてください', format: 'multiple', required: false, choices: ['フード', 'おやつ', 'ケア用品'] },
    { key: 'vq-3', text: '改善してほしいところがあれば教えてください', format: 'free', required: false, choices: [] },
  ]
}


/** datetime-local の値を画面表示用に整える（`2026-09-30T23:59` → `2026/09/30 23:59`）。 */
export function displayDateTime(value: string): string {
  return value ? value.replace('T', ' ').replaceAll('-', '/') : '未設定'
}


/*
 * NEXT-24: テンプレート素材のテスト送信口はまだ無い。
 * 押せる見た目のボタンを置くと「送れた」と誤解するので、押せない形にして
 * 理由と代替の手順を添える。
 */
export const TEST_SEND_UNAVAILABLE_NOTE =
  'この形式は、いまの画面から自分へのテスト送信ができません。保存して一斉配信に組み込むと、配信の画面からテスト送信できます。'


export default function TemplateAssetEditor({ kind, visual = false }: { kind: AssetKind; visual?: boolean }) {
  return kind === 'rich_message' ? <TemplateRichV8 visual={visual} /> : <TemplateAssetV8 kind={kind} visual={visual} />
}
