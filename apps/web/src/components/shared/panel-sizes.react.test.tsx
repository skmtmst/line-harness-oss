// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import Dialog from './dialog'
import Drawer from './drawer'
import DetailPanel from './detail-panel'
afterEach(cleanup)
it('B-158 決まり8：実際の窓・引き出し・行の詳細が幅の表を使う', () => {
 render(<><Dialog open modal={false} title="窓" onCancel={() => {}} designWidth={1060} /><Drawer open modal={false} title="編集" onClose={() => {}} designWidth={620} /><DetailPanel open title="行" onClose={() => {}} /></>)
 expect((screen.getByRole('dialog', {name:'窓'}) as HTMLElement).style.getPropertyValue('--dialog-design-width')).toBe('960px')
 expect((screen.getByRole('dialog', {name:'編集'}) as HTMLElement).style.getPropertyValue('--drawer-design-width')).toBe('540px')
 expect((screen.getByRole('dialog', {name:'行'}) as HTMLElement).style.getPropertyValue('--detail-panel-width')).toBe('360px')
})
