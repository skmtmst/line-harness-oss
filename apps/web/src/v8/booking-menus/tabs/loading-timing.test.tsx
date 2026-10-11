// @vitest-environment happy-dom
import React from 'react'
import {render,act,cleanup} from '@testing-library/react'
import {it,expect,vi,afterEach} from 'vitest'
import {SkeletonRows} from './shared'
import ListState from '@/components/shared/list-state'
afterEach(()=>{cleanup();vi.useRealTimers();delete document.documentElement.dataset.theme})
it('DC-UI-05 all tab loading shapes follow the common 300ms delay',()=>{
 document.documentElement.dataset.theme='v8'
 vi.useFakeTimers()
 const view=render(<><SkeletonRows/><ListState kind="loading"/></>)
 const shapes=()=>[...view.container.querySelectorAll('[role="status"],[data-skeleton]')]
 expect(shapes().length).toBeGreaterThan(1)
 expect(shapes().every(shape=>shape.closest('.invisible'))).toBe(true)
 act(()=>vi.advanceTimersByTime(299))
 expect(shapes().every(shape=>shape.closest('.invisible'))).toBe(true)
 act(()=>vi.advanceTimersByTime(1))
 expect(shapes().every(shape=>!shape.closest('.invisible'))).toBe(true)
})
