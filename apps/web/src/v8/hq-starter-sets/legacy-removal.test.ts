import { expect, it } from 'vitest'
import { initialFormKey, initialMenuFormTargets } from '@line-crm/shared'
import type { StarterSetItem } from '@/lib/api/helpers/styles'
import { removeLegacyItem } from './legacy-removal'

const forms: StarterSetItem[] = initialMenuFormTargets('restaurant').map(target => ({ key: initialFormKey('restaurant', target), kind: 'form', formTarget: target, name: target }))
const menu: StarterSetItem = { key: 'menu', kind: 'rich_menu', initialMenu: 'restaurant', name: 'menu' }
const unrelated: StarterSetItem = { key: 'independent', kind: 'form', name: 'independent' }
const template: StarterSetItem = { key: 'template', kind: 'template', name: 'template' }
const items = [menu, ...forms, unrelated, template]
it('removing the initial menu removes its linked forms and preserves unrelated items', () => {
 expect(removeLegacyItem(items, menu.key)).toEqual([unrelated, template])
})
it.each(forms)('removing linked form $key removes the same bundle', form => {
 expect(removeLegacyItem(items, form.key)).toEqual([unrelated, template])
})
it('removing an unrelated form keeps the initial menu and its linked forms', () => {
 expect(removeLegacyItem(items, unrelated.key)).toEqual([menu, ...forms, template])
})
