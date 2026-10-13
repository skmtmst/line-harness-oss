import { expect, test } from 'vitest'
// Scripts run as ESM in both CI and this test.
// @ts-expect-error plain JavaScript guard
import { inspectPickers } from '../../../scripts/verify-entity-pickers.mjs'

test('Select の別名・変数経由・MultiSelect でも作った物のプルダウンを落とす', () => {
  for (const code of [
    `import Choice from '@/components/shared/select'; const view = <Choice options={tags.map(t => ({ value: t.id, label: t.name }))} />`,
    `import Multi from '@/components/shared/multi-select'; const choices = staff.map(t => ({ value: t.id, label: t.name })); const view = <Multi options={choices} />`,
    `import Select from '@/components/shared/select'; const optionsFor = () => resources.map(row => ({ value: `+"`tag:${row.id}`"+`, label: row.name })); const view = <Select options={optionsFor()} />`,
    `const view = <select>{tags.map(t => <option value={t.id}>{t.name}</option>)}</select>`,
    `import Choice from '@/components/shared/select'; const view = <Choice disabled options={tags.map(t => ({ value: t.id, label: t.name }))} />`,
    `import Combo from '@/components/shared/combobox'; const view = <Combo options={friendOptions} />`,
  ]) expect(inspectPickers(code)).toHaveLength(1)
})

test('状態などの定数とB-164のフォルダ例外、共通窓は通す', () => {
  expect(inspectPickers(`import Choice from '@/components/shared/select'; const view = <Choice options={[{ value: 'on', label: '有効' }, { value: 'off', label: '無効' }]} />`)).toHaveLength(0)
  expect(inspectPickers(`import Choice from '@/components/shared/select'; const view = <Choice aria-label="フォルダ" options={folders.map(f => ({ value: f.id, label: f.name }))} />`)).toHaveLength(0)
  expect(inspectPickers(`import EntitySelect from '@/components/shared/entity-select'; const view = <EntitySelect options={tags.map(t => ({ value: t.id, label: t.name }))} />`)).toHaveLength(0)
})
