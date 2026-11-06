import { describe, expect, it } from 'vitest'
// @ts-expect-error 監査の実装はJS。
import { loadCatalog, scanCodeFile } from './v8-pattern-audit.mjs'

describe('見本の宣言そのものの証拠', () => {
  it('画面の中の真偽値は見本と数えず、JSXを描く同名の関数は残す', () => {
    const pattern = loadCatalog().patterns.find((p: { id: string }) => p.id === 'phone-preview')
    const scan = (body: string) => scanCodeFile(pattern, 'apps/web/src/v8/demo/settings.tsx', `export function Screen() { ${body}; return <div>設定</div> }`).filter((hit: { signal: string }) => hit.signal === 'own-phone')
    expect(scan("const withoutPreview = tab === 'staff'")).toHaveLength(0)
    expect(scan('const OwnPreview = () => <div>見本を手書き</div>')).toHaveLength(1)
    expect(scan('function OwnPreview() { return <div>見本を手書き</div> }')).toHaveLength(1)
    expect(scanCodeFile(pattern, 'apps/web/src/v8/demo/settings.tsx', 'export const OwnPreview = () => <div>見本を手書き</div>')).toHaveLength(1)
  })
})
