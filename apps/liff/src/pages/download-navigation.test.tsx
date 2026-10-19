// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import FileOpen from './file-open.js';
import StatementOpen from './statement-open.js';
import { fetchFileBlob, issueFile } from '../lib/file-download-api.js';
import { fetchStatementBlob, issueStatement } from '../lib/statement-download-api.js';

vi.mock('../lib/file-download-api.js', async (original) => ({ ...await original<typeof import('../lib/file-download-api.js')>(), issueFile: vi.fn(), fetchFileBlob: vi.fn() }));
vi.mock('../lib/statement-download-api.js', () => ({ issueStatement: vi.fn(), fetchStatementBlob: vi.fn() }));
vi.mock('../components/liff-look-scope.js', () => ({ default: ({ children }: { children: import('react').ReactNode }) => children }));
vi.mock('../components/ui/liff-header.js', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Navigate() { const go = useNavigate(); return <button onClick={() => go('../second', { relative: 'path' })}>別の通知を開く</button>; }

it.each(['files', 'statements'])('%s: 古い通知の遅い取得は、新しい通知の本人確認画面を上書きしない', async (kind) => {
  const issued = { id: 'first', url: 'https://example.test/signed', expiresAt: '2099-01-01T00:00:00Z', filename: '前の写真.png', mimeType: 'image/png', size: 10, kind: 'image' as const };
  const issue = kind === 'files' ? vi.mocked(issueFile) : vi.mocked(issueStatement);
  issue.mockResolvedValueOnce(issued).mockReturnValueOnce(new Promise(() => {}));
  let finish!: (blob: Blob) => void;
  const pending = new Promise<Blob>((resolve) => { finish = resolve; });
  if (kind === 'files') vi.mocked(fetchFileBlob).mockReturnValueOnce(pending);
  else vi.mocked(fetchStatementBlob).mockReturnValueOnce(pending);
  const create = vi.fn(() => 'blob:old');
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn(); });
  render(<MemoryRouter initialEntries={[`/${kind}/first`]}><Routes><Route path={`/${kind}/:id`} element={<><Navigate />{kind === 'files' ? <FileOpen /> : <StatementOpen />}</>} /></Routes></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: kind === 'files' ? 'ファイルを開く' : '明細を開く' }));
  fireEvent.click(screen.getByRole('button', { name: '別の通知を開く' }));
  await vi.waitFor(() => expect(issue).toHaveBeenLastCalledWith('second'));
  await act(async () => finish(new Blob(['old'])));
  expect(create).not.toHaveBeenCalled();
  expect(screen.queryByText(/開きました/)).toBeNull();
});
