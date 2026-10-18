// @vitest-environment happy-dom
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import IconButton from './icon-button'

afterEach(cleanup)
it('controlled selection follows the saved state and retains its click action',()=>{
  const click=vi.fn()
  const {rerender}=render(<IconButton aria-label="お気に入りにする" pressed={false} onClick={click}>☆</IconButton>)
  const button=screen.getByRole('button')
  expect(button.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(button)
  expect(click).toHaveBeenCalledTimes(1)
  expect(button.getAttribute('aria-pressed')).toBe('false')
  rerender(<IconButton aria-label="お気に入りから外す" pressed onClick={click}>★</IconButton>)
  expect(button.getAttribute('aria-pressed')).toBe('true')
})
it('a busy disabled action preserves state and cannot invoke the mutation',()=>{
  const click=vi.fn()
  render(<IconButton aria-label="お気に入り" pressed disabled onClick={click}>★</IconButton>)
  fireEvent.click(screen.getByRole('button'))
  expect(click).not.toHaveBeenCalled()
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
})
