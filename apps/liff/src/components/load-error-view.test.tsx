// @vitest-environment happy-dom
import { writeFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import LoadErrorView from './load-error-view.js';
afterEach(cleanup);
it('従来の全体案内とcompactのDOMを保つ', () => {
  const retry = vi.fn();
  const markup = [false, true].map(compact => renderToStaticMarkup(<LoadErrorView compact={compact} onRetry={retry} />));
  if (process.env.SWE1_MARKUP_OUTPUT) writeFileSync(process.env.SWE1_MARKUP_OUTPUT, JSON.stringify(markup));
  render(<LoadErrorView onRetry={retry} />);
  expect(screen.getByText('読み込めませんでした')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }));
  expect(retry).toHaveBeenCalledOnce();
});
it('続きの小さい案内は理由と再試行だけで、取得中は押せない', () => {
  const retry = vi.fn();
  const view = render(<LoadErrorView inline busy message="続きだけ読み直してください。" onRetry={retry} />);
  expect(screen.getByRole('alert').textContent).toContain('続きだけ読み直してください。');
  expect(screen.queryByText('読み込めませんでした')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }));
  expect(retry).not.toHaveBeenCalled();
  view.rerender(<LoadErrorView inline message="続きだけ読み直してください。" onRetry={retry} />);
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }));
  expect(retry).toHaveBeenCalledOnce();
});
