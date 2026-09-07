import type { FormLayout } from '@line-crm/shared'

/** 空でなければ http(s) のURLか。 */
function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 保存の直前検査。壊れた定義の保存を止める。
 *
 * 返すのは画面に出す文。問題がなければ null。
 * 名前・空タイトル・回答キー重複は呼び出し側で先に見る。
 */
export function validateLayoutForSave(layout: FormLayout): string | null {
  const blocks = layout.header.concat(layout.sections.flatMap((s) => s.blocks))
  for (const block of blocks) {
    if (
      block.kind === 'input'
      && (block.type === 'radio' || block.type === 'checkbox' || block.type === 'select')
    ) {
      const title = block.label.trim() || block.name
      const choices = block.choices ?? []
      if (choices.length === 0) return `「${title}」に選択肢がありません`
      if (choices.some((choice) => !choice.label.trim())) return `「${title}」に空の選択肢があります`
    }
    if (block.kind === 'button' && block.url.trim() !== '' && !isHttpUrl(block.url)) {
      return `ボタン「${block.label}」のリンク先がURLの形ではありません`
    }
  }
  const thanksUrl = layout.options.thanksUrl?.trim() ?? ''
  if (thanksUrl !== '' && !isHttpUrl(thanksUrl)) {
    return '答えたあとに開くページがURLの形ではありません'
  }
  if (layout.options.deadline?.enabled) {
    const endsAt = layout.options.deadline.endsAt?.trim() ?? ''
    if (endsAt === '' || Number.isNaN(Date.parse(endsAt))) {
      return '受付の期限が日時の形ではありません'
    }
  }
  return null
}
