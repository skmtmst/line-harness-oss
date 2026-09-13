import {
  newBlockId,
  type FormBlock,
  type FormInputType,
  type FormLayout,
} from '@line-crm/shared'

/** Store and HQ builders must generate answer keys in exactly the same way. */
export function makeFormBlock(kind: string, type?: FormInputType, count = 0): FormBlock {
  const id = newBlockId()
  switch (kind) {
    case 'heading': return { id, kind: 'heading', text: '見出し', level: 2 }
    case 'text': return { id, kind: 'text', text: '' }
    case 'image': return { id, kind: 'image', mediaUrl: '', size: 'normal' }
    case 'button': return { id, kind: 'button', label: 'ボタン', url: '', style: 'default' }
    default:
      return {
        id,
        kind: 'input',
        type: type ?? 'text',
        name: `q${count + 1}_${id.slice(2)}`,
        label: '',
        required: false,
        ...(type === 'radio' || type === 'checkbox' || type === 'select'
          ? {
              choiceMode: 'tag' as const,
              choices: [
                { id: newBlockId('c'), label: '選択肢1' },
                { id: newBlockId('c'), label: '選択肢2' },
              ],
            }
          : {}),
      }
  }
}

export function formJumpsInto(layout: FormLayout, sectionId: string): number {
  return layout.sections.reduce((count, section) => count + section.blocks.reduce((sum, block) => {
    if (block.kind !== 'input' || !block.choices) return sum
    return sum + block.choices.filter(choice => choice.jumpToSectionId === sectionId).length
  }, 0), 0)
}

export function takenFormAnswerNames(layout: FormLayout): Set<string> {
  return new Set(
    layout.header.concat(layout.sections.flatMap(section => section.blocks))
      .flatMap(block => block.kind === 'input' ? [block.name] : []),
  )
}

export function uniqueFormCopyName(base: string, taken: Set<string>): string {
  const first = `${base}_copy`
  if (!taken.has(first)) return first
  let number = 2
  while (taken.has(`${base}_copy${number}`)) number += 1
  return `${base}_copy${number}`
}
