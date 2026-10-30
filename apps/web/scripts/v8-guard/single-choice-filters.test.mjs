import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { singleChoiceFilters } from './single-choice-filters.mjs'
const imported = "import FilterChip from '@/components/shared/filter-chip';\n"

test('scalar state, mapped choices, and helper calls cannot use filter chips', () => {
  const scalar = imported + '<div><FilterChip selected={status === "active"}/><FilterChip selected={status === "draft"}/></div>'
  assert.equal(singleChoiceFilters(scalar).length, 2)
  assert.equal(singleChoiceFilters(imported + '<div>{options.map(o => <FilterChip selected={status === o.id}/>)}</div>').length, 1)
  const helper = imported + 'const chip = value => <FilterChip selected={status === value}/>; const content = <div>{chip("active")}{chip("draft")}</div>'
  assert.equal(singleChoiceFilters(helper).length, 1)
  assert.equal(singleChoiceFilters(scalar.replaceAll('FilterChip selected=', 'SegmentedControl value=')).length, 0)
})
test('mutually reset boolean choices fail while combined conditions and popup triggers remain valid', () => {
  const mixed = imported + 'function toggle(){if(single)next.multiple=false;if(multiple)next.single=false;}const c=<div><FilterChip selected={chips.single}/><FilterChip selected={chips.multiple}/><FilterChip selected={chips.variables}/><FilterChip selected={chips.unused}/></div>'
  assert.deepEqual(singleChoiceFilters(mixed).map(f => f.selection), ['chips.single', 'chips.multiple'])
  assert.equal(singleChoiceFilters(imported + '<div><FilterChip selected={attentionOnly}/><FilterChip selected={response === "unhandled"}/><FilterChip selected={open} aria-haspopup="dialog"/></div>').length, 0)
  assert.equal(singleChoiceFilters(imported + '<div>{days.map(d => <FilterChip selected={chosen.includes(d)}/>)}</div>').length, 0)
})
// Each delivery expands the production gate only after converting that complete group.
for (const file of ['broadcasts/list.tsx', 'templates/list.tsx', 'templates/asset-list.tsx']) {
  test(`single-choice filters use the shared switch in ${file}`, () => {
    const source = readFileSync(new URL(`../../src/v8/${file}`, import.meta.url), 'utf8')
    assert.deepEqual(singleChoiceFilters(source, file), [])
  })
}
