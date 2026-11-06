// @vitest-environment happy-dom
import React from 'react'
import {render,screen,cleanup,act} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {DetailPage,DetailLoading} from './detail-page'
afterEach(()=>{cleanup();vi.useRealTimers()})
it('詳細は共通の骨組みを待って出し、読み込みを一度だけ伝える',()=>{
 vi.useFakeTimers();const {container}=render(<DetailLoading label="友だちを読み込んでいます"/>);expect(screen.getByRole('status').textContent).toBe('友だちを読み込んでいます');expect(container.querySelector('[data-skeleton-reserve]')?.className).toContain('invisible');act(()=>{vi.advanceTimersByTime(300)});expect(container.querySelector('[data-skeleton-reserve]')).toBeNull();expect(container.querySelectorAll('[data-skeleton]')).toHaveLength(5)
})
it('型に読み込みを任せると古い中身を見せず、読み終えたら実データを出す',()=>{
 vi.useFakeTimers();const view=render(<DetailPage title="友だち" loading><p>前の友だち</p></DetailPage>);expect(screen.queryByText('前の友だち')).toBeNull();view.rerender(<DetailPage title="友だち"><p>新しい友だち</p></DetailPage>);expect(screen.getByText('新しい友だち')).toBeTruthy()
})
