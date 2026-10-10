// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { emptyLayout, type FormInputBlock } from '@line-crm/shared'
import { EMPTY_REFS } from '@/components/forms/form-refs'
import { ContentTab } from './content-tab'

vi.mock('next/link', () => ({ default: ({ children, ...rest }: React.ComponentProps<'a'>) => <a {...rest}>{children}</a> }))
vi.mock('@/components/shared/select', () => ({ default: ({ value, onChange, options, ...rest }: { value: string; onChange: (s: string) => void; options: { value: string; label: string }[] }) => <select {...rest} value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }))
afterEach(cleanup)
export function mount(blocks: FormInputBlock[] = []) {
  const layout = emptyLayout()
  layout.sections = [{ id: 'p1', name: '前半', blocks }, { id: 'p2', name: '後半', blocks: [] }]
  const onRemovePage = vi.fn(), onPatchBlock = vi.fn()
  render(<ContentTab layout={layout} page={0} blocks={blocks} refs={{ ...EMPTY_REFS, friendFields: [{ id: 'A', name: 'A', ecIsMaster: false }, { id: 'B', name: 'B', ecIsMaster: false }] }} selectedBlockId={blocks[0]?.id ?? null} inputCount={blocks.length} accountId="acc"
    onSelectPage={vi.fn()} onAddPage={vi.fn()} onRenamePage={() => true} onDuplicatePage={vi.fn()} onRemovePage={onRemovePage} onSelectBlock={vi.fn()} onAddBlock={vi.fn()} onPatchBlock={onPatchBlock} onMoveBlock={vi.fn()} onDuplicateBlock={vi.fn()} onRemoveBlock={vi.fn()} />)
  return { onRemovePage, onPatchBlock }
}
