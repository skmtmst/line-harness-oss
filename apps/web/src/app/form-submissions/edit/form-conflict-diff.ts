import type { FormBlock, FormLayout } from '@line-crm/shared'

/**
 * 競合（409）の「違いを比べる」で出す差分。
 *
 * 自分の下書きと、相手が保存した最新を比べ、運用者の言葉の行にする。
 * 版の履歴APIは無いので、読み直す前に最新を1回取ってその場で比べる。
 */

export type ConflictSide = {
  name: string
  description: string
  layout: FormLayout
}

export type ConflictDiffLine = {
  /** 自分が足したもの / 最新にあって自分が消したもの / 両方あって中身が違うもの */
  kind: 'add' | 'remove' | 'change'
  text: string
}

function blockTitle(block: FormBlock): string {
  if (block.kind === 'input' || block.kind === 'button') return block.label || '（タイトルなし）'
  if (block.kind === 'heading' || block.kind === 'text') return block.text || '（本文なし）'
  return '画像'
}

function summarizeBlockChange(kind: FormBlock['kind']): string {
  switch (kind) {
    case 'input':
      return '入力欄'
    case 'button':
      return 'ボタン'
    case 'heading':
      return '見出し'
    case 'text':
      return '文章'
    case 'image':
      return '画像'
    default:
      return 'ブロック'
  }
}

/**
 * 2つの版の違いを行にする。多いときは先頭だけ返し、残り件数を添える。
 * 中身の比べ方は粗い（選択肢の1件ずつは追わない）が、嘘の行は出さない。
 */
export function describeConflictDiff(
  mine: ConflictSide,
  incoming: ConflictSide,
  maxLines = 20,
): { lines: ConflictDiffLine[]; omitted: number } {
  const lines: ConflictDiffLine[] = []
  const push = (kind: ConflictDiffLine['kind'], text: string) => {
    lines.push({ kind, text })
  }

  if (mine.name !== incoming.name) {
    push('change', `フォーム名が違います（最新「${incoming.name}」／あなた「${mine.name}」）`)
  }
  if ((mine.description ?? '') !== (incoming.description ?? '')) {
    push('change', 'フォームの説明が違います')
  }

  const mineSections = new Map(mine.layout.sections.map((s) => [s.id, s]))
  const incomingSections = new Map(incoming.layout.sections.map((s) => [s.id, s]))
  for (const section of mine.layout.sections) {
    const other = incomingSections.get(section.id)
    if (!other) {
      push('add', `「${section.name}」のページを足そうとしています`)
    } else if (other.name !== section.name) {
      push('change', `ページの名前が違います（最新「${other.name}」／あなた「${section.name}」）`)
    }
  }
  for (const section of incoming.layout.sections) {
    if (!mineSections.has(section.id)) {
      push('remove', `「${section.name}」のページを消そうとしています（最新にあります）`)
    }
  }

  const sectionNameOf = (id: string): string => {
    if (id === '') return '共通ヘッダ'
    const found = [...mineSections.values(), ...incomingSections.values()].find((s) => s.id === id)
    return found?.name ?? 'ページ'
  }
  const mineBlocks = new Map<string, { block: FormBlock; sectionId: string }>()
  const incomingBlocks = new Map<string, { block: FormBlock; sectionId: string }>()
  for (const block of mine.layout.header) {
    mineBlocks.set(block.id, { block, sectionId: '' })
  }
  for (const block of incoming.layout.header) {
    incomingBlocks.set(block.id, { block, sectionId: '' })
  }
  for (const section of mine.layout.sections) {
    for (const block of section.blocks) {
      mineBlocks.set(block.id, { block, sectionId: section.id })
    }
  }
  for (const section of incoming.layout.sections) {
    for (const block of section.blocks) {
      incomingBlocks.set(block.id, { block, sectionId: section.id })
    }
  }
  for (const [blockId, entry] of mineBlocks) {
    const other = incomingBlocks.get(blockId)
    if (!other) {
      push('add', `「${sectionNameOf(entry.sectionId)}」に${summarizeBlockChange(entry.block.kind)}「${blockTitle(entry.block)}」を足そうとしています`)
    } else if (
      other.block.kind !== entry.block.kind ||
      blockTitle(other.block) !== blockTitle(entry.block)
    ) {
      push(
        'change',
        `「${sectionNameOf(entry.sectionId)}」の${summarizeBlockChange(entry.block.kind)}「${blockTitle(other.block)}」の中身を変えようとしています`,
      )
    }
  }
  for (const [blockId, entry] of incomingBlocks) {
    if (!mineBlocks.has(blockId)) {
      push('remove', `「${sectionNameOf(entry.sectionId)}」の${summarizeBlockChange(entry.block.kind)}「${blockTitle(entry.block)}」を消そうとしています（最新にあります）`)
    }
  }

  if (JSON.stringify(mine.layout.options) !== JSON.stringify(incoming.layout.options)) {
    push('change', '答え終わったあと・受付のきまり・見た目の言葉のどれかが違います')
  }

  if (lines.length <= maxLines) return { lines, omitted: 0 }
  return { lines: lines.slice(0, maxLines), omitted: lines.length - maxLines }
}
