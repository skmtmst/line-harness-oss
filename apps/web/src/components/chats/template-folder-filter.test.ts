import { describe, expect, it } from 'vitest'

import {
  templateMatchesFolder,
  UNFILED_TEMPLATE_FOLDER_ID,
} from './template-folder-filter'

describe('受信箱のテンプレート置き場', () => {
  it('すべてでは置き場に関係なく表示する', () => {
    expect(templateMatchesFolder('folder-1', '')).toBe(true)
    expect(templateMatchesFolder(null, '')).toBe(true)
  })

  it('未分類では置き場のないテンプレートだけを表示する', () => {
    expect(templateMatchesFolder(null, UNFILED_TEMPLATE_FOLDER_ID)).toBe(true)
    expect(templateMatchesFolder(undefined, UNFILED_TEMPLATE_FOLDER_ID)).toBe(true)
    expect(templateMatchesFolder('', UNFILED_TEMPLATE_FOLDER_ID)).toBe(true)
    expect(templateMatchesFolder('folder-1', UNFILED_TEMPLATE_FOLDER_ID)).toBe(false)
  })

  it('指定した置き場では同じIDだけを表示する', () => {
    expect(templateMatchesFolder('folder-1', 'folder-1')).toBe(true)
    expect(templateMatchesFolder('folder-2', 'folder-1')).toBe(false)
    expect(templateMatchesFolder(null, 'folder-1')).toBe(false)
  })
})
