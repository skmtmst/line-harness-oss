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
test('array choices with opposing boolean predicates are exclusive, independent membership remains valid', () => {
  const conditions = "if(filters.includes('open') && !offer.isActive)return false;if(filters.includes('draft') && offer.isActive)return false;"
  const chips = "<div><FilterChip selected={filters.includes('open')}/><FilterChip selected={filters.includes('draft')}/></div>"
  assert.equal(singleChoiceFilters(imported + conditions + chips).length, 2)
  assert.equal(singleChoiceFilters(imported + conditions.replace('!offer.isActive','offer.hasImage') + chips).length, 0)
})
for (const file of [
  'v8/broadcasts/list.tsx', 'v8/templates/list.tsx', 'v8/templates/asset-list.tsx',
  'v8/hq-templates/store-list.tsx', 'v8/conversions/list.tsx', 'v8/common-vars/list.tsx',
  'v8/inflow-links/list.tsx', 'v8/ops/tenants.tsx', 'v8/automations/common-actions.tsx', 'v8/automations/templates.tsx',
  'app/booking/bookings/ledger-screen.tsx', 'v8/friends/migrations/uid.tsx', 'v8/nen-health/health.tsx',
  'v8/affiliates/offers.tsx', 'v8/affiliates/payment.tsx', 'components/shared/entity-picker.tsx',
]) {
  test(`single-choice filters use the shared switch in ${file}`, () => {
    const source = readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8')
    assert.deepEqual(singleChoiceFilters(source, file), [])
  })
}
