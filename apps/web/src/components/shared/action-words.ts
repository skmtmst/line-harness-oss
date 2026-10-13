import { cloneElement, isValidElement, type ReactNode } from 'react'

export const EDIT_ACTION_LABEL = '編集する'

/** Editing is one action; reload and reconstruction keep their distinct verbs. */
export function normalizeActionLabel(label: string): string {
  const text = label.trim()
  // Reconciliation repairs state rather than editing an authored setting.
  if (text.endsWith('ずれを直す')) return label
  const result = text === '直す' || text === '編集' ? EDIT_ACTION_LABEL : text.replace(/^(.+)を直す$/u, '$1を編集する')
  return result === text ? label : label.replace(text, result)
}

export function normalizeActionNode(node: ReactNode): ReactNode {
  if (typeof node === 'string') return normalizeActionLabel(node)
  if (Array.isArray(node)) {
    const result = node.map(normalizeActionNode)
    return result.every((child, index) => child === node[index]) ? node : result
  }
  if (isValidElement<{ children?: ReactNode }>(node) && node.props.children) {
    const children = normalizeActionNode(node.props.children)
    return children === node.props.children ? node : cloneElement(node, {}, children)
  }
  return node
}
