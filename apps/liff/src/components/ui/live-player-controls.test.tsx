// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LivePlayerControls from './live-player-controls';
afterEach(cleanup);
it('配信中・試写・録画でも同じ音声操作を使い、現在の状態を伝える', () => {
  const toggle = vi.fn();
  const { rerender } = render(<LivePlayerControls mode="live" muted onToggleMute={toggle} />);
  expect(screen.getByText('● ライブ')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '音声をオンにする' }));
  expect(toggle).toHaveBeenCalledTimes(1);
  rerender(<LivePlayerControls mode="preview" muted={false} onToggleMute={toggle} />);
  expect(screen.getByText('PREVIEW')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '音声をオフにする' }));
  expect(toggle).toHaveBeenCalledTimes(2);
  rerender(<LivePlayerControls mode="replay" muted={false} onToggleMute={toggle} />);
  expect(screen.getByText('REPLAY')).toBeTruthy();
});
