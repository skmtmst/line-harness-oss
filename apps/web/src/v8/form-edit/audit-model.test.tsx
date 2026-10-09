// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { emptyLayout, type FormInputBlock, type FormImageBlock } from '@line-crm/shared'
import { describeConflictDiff } from './model'
import { FormPhone } from './phone'
afterEach(cleanup)
it.each(['required', 'choices', 'destinations', 'type', 'position'])('WEB-142: %sの変更を差分へ出す', (field) => {
 const layout = emptyLayout(); layout.sections[0].blocks = [{ id: 'q', kind: 'input', name: 'q', label: '題', type: 'radio', required: false, choices: [{ id: 'a', label: 'A' }] }]
 const changed = structuredClone(layout); const block = changed.sections[0].blocks[0] as FormInputBlock
 if (field === 'required') block.required = true
 if (field === 'choices') block.choices![0].label = 'B'
 if (field === 'destinations') block.destinations = [{ kind: 'friend_field', fieldKey: 'new' }]
 if (field === 'type') block.type = 'text'
 if (field === 'position') { changed.sections.push({ id: 's2', name: '次', blocks: [] }); changed.sections[1].blocks.push(changed.sections[0].blocks.pop()!) }
 expect(describeConflictDiff({ name: 'F', description: '', layout }, { name: 'F', description: '', layout: changed }).lines.length).toBeGreaterThan(0)
})
it('WEB-146: 失敗した画像のURLを変えたら新しい画像を試す', () => {
 const layout = emptyLayout(); layout.sections[0].blocks = [{ id: 'image', kind: 'image', mediaUrl: 'https://test/old.png' }]
 const props = { layout, pageIndex: 0, accountName: '店', bookingMenus: [] }
 const view = render(<FormPhone {...props} />)
 fireEvent.error(view.container.querySelector('img')!)
 const next = structuredClone(layout); (next.sections[0].blocks[0] as FormImageBlock).mediaUrl = 'https://test/new.png'
 view.rerender(<FormPhone {...props} layout={next} />)
 expect(view.container.querySelector('img')?.getAttribute('src')).toBe('https://test/new.png')
})
