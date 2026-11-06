import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'

function elements(children: ReactNode): ReactElement<{ children?: ReactNode; colSpan?: number }>[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; colSpan?: number }>(child)) return []
    return child.type === Fragment ? elements(child.props.children) : [child]
  })
}

/** A compact record table still needs tracks when the caller supplies no widths. */
export function recordTableColumns(children: ReactNode): string | undefined {
  const sections = elements(children)
  const head = sections.find(section => section.type === 'thead')
  const body = sections.find(section => section.type === 'tbody')
  const rows = elements((head ?? body)?.props.children)
  const row = rows.find(item => item.props.children && !item.props.colSpan)
  const count = elements(row?.props.children).reduce((sum, cell) => sum + (cell.props.colSpan ?? 1), 0)
  return count ? `repeat(${count}, minmax(0, 1fr))` : undefined
}
