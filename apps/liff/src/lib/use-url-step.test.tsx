// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useUrlStep } from './use-url-step.js';
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });
test('手順を進めても入口のqueryと履歴のstateを保つ', () => {
  window.history.replaceState({ key: 'entry' }, '', '/booking?liffId=app&menu_id=menu');
  const { result } = renderHook(() => useUrlStep<'menu' | 'staff'>('menu'));
  act(() => result.current[1]('staff'));
  expect(new URLSearchParams(window.location.search).get('step')).toBe('staff');
  expect(new URLSearchParams(window.location.search).get('liffId')).toBe('app');
  expect(window.history.state).toEqual({ key: 'entry' });
});
test('端末の戻るで前の手順へ戻る', () => {
  const { result } = renderHook(() => useUrlStep<'menu' | 'staff' | 'confirm'>('menu'));
  act(() => { result.current[1]('staff'); result.current[1]('confirm'); });
  act(() => { window.history.replaceState(null, '', '/booking?step=staff'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(result.current[0]).toBe('staff');
});
test('再読込や不正なqueryでは入力を復元せず確定へ進ませない', () => {
  window.history.replaceState(null, '', '/booking?liffId=app&step=confirm');
  const { result } = renderHook(() => useUrlStep('menu'));
  expect(result.current[0]).toBe('menu');
  expect(new URLSearchParams(window.location.search).get('step')).toBe('menu');
  expect(new URLSearchParams(window.location.search).get('liffId')).toBe('app');
});
