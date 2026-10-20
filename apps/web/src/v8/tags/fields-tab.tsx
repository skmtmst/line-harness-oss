'use client'
import { useFieldsTab } from './use-fields-tab'
export { useFieldsTab } from './use-fields-tab'

import FieldsView from './fields-view'
export { fieldTypeWord } from './fields-list-model'

export default function FieldsTab(props: Parameters<typeof useFieldsTab>[0]) {
  return <FieldsView {...useFieldsTab(props)} />
}
