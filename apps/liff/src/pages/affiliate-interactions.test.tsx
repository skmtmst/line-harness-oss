// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Affiliate from './affiliate.js';
import * as profile from '../lib/affiliate-profile-api.js';

vi.mock('@line/liff', () => ({ default: { getAccessToken: () => 'identity' } }));
vi.mock('../lib/affiliate-profile-api.js', () => ({ fetchMe: vi.fn(), fetchMileage: vi.fn(), fetchOffers: vi.fn(), postRegister: vi.fn(), postEnrollOffer: vi.fn(), postAddLink: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { liffConfig: vi.fn().mockResolvedValue({ data: {} }) } }));
vi.mock('../components/member-card.js', () => ({ default: () => null }));
vi.mock('../components/mileage-rewards.js', () => ({ default: () => null }));
vi.mock('../components/affiliate-payments.js', () => ({ default: () => null }));
const affiliate = { id: 'affiliate', name: '会員', code: 'code', commissionRate: 0, isActive: true, friendId: 'friend' };
const link = { refCode: 'ref', label: 'ご案内', url: 'https://example.test/ref', clickCount: 2, friendAdds: 1, conversions: 1, conversionsPending: 1, conversionsApproved: 0, offerId: 'offer', offerName: '参加済み' };
const offer = { id: 'offer', name: '参加済み', description: '案内', rewardAmount: 0, rewardMiles: 100, windowDays: null, receptionFrom: null, receptionTo: null, halted: false, totalRemaining: null, monthlyRemaining: null, enrolled: true, refCode: 'ref', url: link.url };
const wallet = { mileage: { programId: 'program', programName: 'マイル', available: 100, pending: 20, lifetimeEarned: 140, spent: 40 }, insights: { accountCount: 2, rewardedActions: 2, referralMiles: 100, qualityReferralCount: 1, lastEarnedAt: null }, history: [], opportunities: [
  { id: 'webinar', type: 'webinar' as const, title: '説明会を見る', description: '動画', rewardMiles: 10, nextRewardMiles: 10, progressPercent: 25, ctaLabel: '視聴する', url: 'https://example.test/watch' },
  { id: 'line', type: 'friend_add' as const, title: 'お店を追加', description: '追加', rewardMiles: 10, nextRewardMiles: 10, progressPercent: 0, ctaLabel: '友だち追加', url: 'https://example.test/add' },
] };
beforeEach(() => {
  vi.mocked(profile.fetchMe).mockResolvedValue({ registered: true, affiliate, links: [link, { ...link, refCode: 'old', offerId: null }] });
  vi.mocked(profile.fetchMileage).mockResolvedValue(wallet);
  vi.mocked(profile.fetchOffers).mockResolvedValue([offer, { ...offer, id: 'available', name: '新しい案件', enrolled: false, refCode: null, url: null }]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('マイル・紹介・履歴・取り組み・案件の順で、実際の残高とリンクを表示する', async () => {
  render(<Affiliate />);
  await screen.findByRole('region', { name: '参加できる案件' });
  const names = ['貯まったマイル', 'お友だちを紹介する', 'マイルの履歴', '今、マイルを増やせます', '参加中の案件', '参加できる案件', 'その他のリンク'];
  const regions = names.map(name => screen.getByRole('region', { name }));
  for (let i = 1; i < regions.length; i++) expect(regions[i - 1].compareDocumentPosition(regions[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  for (const label of ['使えるマイル', 'これまでに得た', '使った', '2個のLINE公式アカウントで貯めたマイルを合算しています']) expect(within(regions[0]).getByText(label)).toBeTruthy();
  expect(within(regions[0]).getByText('100')).toBeTruthy();
  expect(screen.getByRole('link', { name: '視聴する' }).getAttribute('href')).toBe('https://example.test/watch');
  expect(screen.getByRole('region', { name: 'LINEアカウント登録マイル' })).toBeTruthy();
  for (const label of ['開いた', '友だち追加', '成果になった']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
});

it('未登録なら紹介者登録を出し、二度押しを1回にまとめて登録画面を更新する', async () => {
  vi.mocked(profile.fetchMe).mockResolvedValue({ registered: false });
  let done!: (value: Awaited<ReturnType<typeof profile.postRegister>>) => void;
  vi.mocked(profile.postRegister).mockImplementation(() => new Promise(resolve => { done = resolve; }));
  render(<Affiliate />);
  const register = await screen.findByRole('button', { name: '紹介者になる' });
  fireEvent.click(register); fireEvent.click(register);
  expect(profile.postRegister).toHaveBeenCalledOnce();
  done({ affiliate, links: [] });
  expect(await screen.findByRole('region', { name: '参加できる案件' })).toBeTruthy();
});

it('案件への参加も連打を1回にまとめ、新しいリンクを参加中へ出す', async () => {
  let done!: (value: Awaited<ReturnType<typeof profile.postEnrollOffer>>) => void;
  vi.mocked(profile.postEnrollOffer).mockImplementation(() => new Promise(resolve => { done = resolve; }));
  render(<Affiliate />);
  const region = await screen.findByRole('region', { name: '参加できる案件' });
  const enroll = within(region).getByRole('button', { name: /参加/ });
  fireEvent.click(enroll); fireEvent.click(enroll);
  expect(profile.postEnrollOffer).toHaveBeenCalledExactlyOnceWith('available');
  done({ ...link, offerId: 'available', offerName: '新しい案件' });
  expect(await within(await screen.findByRole('region', { name: '参加中の案件' })).findByText('新しい案件')).toBeTruthy();
});

it('SNSのリンクを発行し、返ったリンクをコピーできる', async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
  vi.mocked(profile.postAddLink).mockResolvedValue({ ...link, refCode: 'sns', label: 'SNS用', url: 'https://example.test/sns' });
  render(<Affiliate />);
  const region = await screen.findByRole('region', { name: '参加中の案件' });
  fireEvent.click(within(region).getByRole('button', { name: /SNSごとのリンクを発行/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'リンクの名前' }), { target: { value: ' SNS用 ' } });
  fireEvent.click(screen.getByRole('button', { name: 'リンクを発行する' }));
  expect(await screen.findByText('SNS用')).toBeTruthy();
  expect(profile.postAddLink).toHaveBeenCalledExactlyOnceWith('SNS用', 'offer');
  const row = within(region).getByText('SNS用').parentElement!.parentElement!;
  fireEvent.click(within(row).getByRole('button', { name: 'コピーする' }));
  expect(await screen.findByText('コピーしました')).toBeTruthy();
  expect(copy).toHaveBeenCalledWith('https://example.test/sns');
});

it('リンクが20本なら発行操作を出さず、上限を知らせる', async () => {
  vi.mocked(profile.fetchMe).mockResolvedValue({ registered: true, affiliate, links: Array.from({ length: 20 }, (_, i) => ({ ...link, refCode: `link-${i}` })) });
  render(<Affiliate />);
  expect(await screen.findByText('リンクの上限（20本）に達しています')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /SNSごとのリンクを発行/ })).toBeNull();
});

it.each([
  [0, 500, '+500マイル'],
  [1000, 0, '1件 ¥1,000'],
  [1000, 500, '1件 ¥1,000 +500マイル'],
  [0, 0, '報酬はこれから決まります'],
])('金額%s・マイル%sで矛盾しない報酬を出す', async (rewardAmount, rewardMiles, expected) => {
  vi.mocked(profile.fetchOffers).mockResolvedValue([{ ...offer, rewardAmount, rewardMiles }]);
  render(<Affiliate />);
  const region = await screen.findByRole('region', { name: '参加中の案件' });
  expect(within(region).getByText(expected)).toBeTruthy();
  expect(within(region).queryByText(/報酬未設定/)).toBeNull();
});
