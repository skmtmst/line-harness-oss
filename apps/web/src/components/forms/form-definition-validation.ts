import type { FormLayout } from '@line-crm/shared'

function isHttpUrl(raw: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(raw.trim()).protocol) }
  catch { return false }
}

export function validateFormLayoutForSave(layout: FormLayout): string | null {
  const blocks = layout.header.concat(layout.sections.flatMap(section => section.blocks))
  const seenNames = new Set<string>()
  for (const block of blocks) {
    if (block.kind === 'input') {
      if (!block.label.trim()) return 'タイトルが空のブロックがあります'
      if (seenNames.has(block.name)) return `回答データの見出し「${block.name}」が重複しています`
      seenNames.add(block.name)
      if (block.type === 'radio' || block.type === 'checkbox' || block.type === 'select') {
        const title = block.label.trim() || block.name
        const choices = block.choices ?? []
        if (choices.length === 0) return `「${title}」に選択肢がありません`
        if (choices.some(choice => !choice.label.trim())) return `「${title}」に空の選択肢があります`
      }
    }
    if (block.kind === 'button' && block.url.trim() !== '' && !isHttpUrl(block.url)) {
      return `ボタン「${block.label}」のリンク先がURLの形ではありません`
    }
  }
  const thanksUrl = layout.options.thanksUrl?.trim() ?? ''
  if (thanksUrl !== '' && !isHttpUrl(thanksUrl)) return '答えたあとに開くページがURLの形ではありません'
  if (layout.options.deadline?.enabled) {
    const endsAt = layout.options.deadline.endsAt?.trim() ?? ''
    if (endsAt === '' || Number.isNaN(Date.parse(endsAt))) return '受付の期限が日時の形ではありません'
  }
  return null
}

