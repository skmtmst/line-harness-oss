// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVisiblePolling } from './use-visible-polling.js';

let visibility: 'visible' | 'hidden';
beforeEach(() => {
  vi.useFakeTimers(); visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function hide(next: 'visible' | 'hidden') { visibility = next; document.dispatchEvent(new Event('visibilitychange')); }

it('F06: 既存の3秒間隔を保ち、非表示・閉じた後の要求は0', async () => {
  const read = vi.fn().mockResolvedValue(true);
  const { unmount } = renderHook(() => useVisiblePolling(read, true, 3000));
  await advance(2999); expect(read).not.toHaveBeenCalled();
  await advance(1); expect(read).toHaveBeenCalledTimes(1);
  hide('hidden'); await advance(30000); expect(read).toHaveBeenCalledTimes(1);
  hide('visible'); await advance(3000); expect(read).toHaveBeenCalledTimes(2);
  unmount(); await advance(30000); expect(read).toHaveBeenCalledTimes(2);
});
it('F06: 遅い要求が終わるまで次を重ねず、復帰でも重複しない', async () => {
  let finish!: (value: boolean) => void;
  const read = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  renderHook(() => useVisiblePolling(read, true, 3000));
  await advance(3000); hide('hidden'); hide('visible'); await advance(30000);
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => finish(true)); await advance(2999); expect(read).toHaveBeenCalledTimes(1);
  await advance(1); expect(read).toHaveBeenCalledTimes(2);
});
it.each(['false', 'reject'])('F06: %s は自動読取を止め、要求を増やさない', async (kind) => {
  const read = kind === 'false' ? vi.fn().mockResolvedValue(false) : vi.fn().mockRejectedValue(new Error('offline'));
  renderHook(() => useVisiblePolling(read, true, 3000));
  await advance(3000); hide('hidden'); hide('visible'); await advance(30000);
  expect(read).toHaveBeenCalledTimes(1);
});
