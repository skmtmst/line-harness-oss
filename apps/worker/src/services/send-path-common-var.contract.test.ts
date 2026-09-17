/*
 * N-189 機械照合: LINE送信へ繋がる全経路が、共通情報を厳格resolver
 * （resolveSendInterpolationExtra / resolveSendCommonVars）経由で解決する
 * ことをソース走査で固定する。
 *
 * 空文字へ落ちる従来口（getCommonVarMap / 素の resolveInterpolationExtra）を
 * 送信経路へ新しく足すと、この試験が落ちる。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8');
}

// LINE送信に繋がる経路と、そこで必須の厳格resolver呼び出し。
const SEND_PATHS: Array<{ file: string; mustCall: string; label: string }> = [
  { file: 'services/step-delivery.ts', mustCall: 'resolveSendInterpolationExtra', label: 'シナリオ配信' },
  { file: 'services/immediate-first-step.ts', mustCall: 'resolveSendInterpolationExtra', label: '初回配信' },
  { file: 'services/reminder-delivery.ts', mustCall: 'resolveSendInterpolationExtra', label: 'リマインド' },
  { file: 'services/scenario-test-send.ts', mustCall: 'resolveSendInterpolationExtra', label: 'シナリオテスト送信' },
  { file: 'services/manual-send-interpolation.ts', mustCall: 'resolveSendCommonVars', label: '個別送信・送信予約' },
  { file: 'services/broadcast.ts', mustCall: 'resolveSendCommonVars', label: '一斉配信（snapshot未到達の予備経路）' },
  { file: 'services/dedup-broadcast.ts', mustCall: 'resolveSendCommonVars', label: '複数アカウント重複排除配信' },
  { file: 'services/auto-reply.ts', mustCall: 'resolveSendInterpolationExtra', label: '自動応答の実送信' },
  { file: 'routes/forms.ts', mustCall: 'resolveSendInterpolationExtra', label: 'フォーム回答の自動返信' },
  { file: 'routes/broadcasts.ts', mustCall: 'resolveSendCommonVars', label: '一斉配信のテスト送信' },
];

describe('全送信経路が共通情報の厳格resolverを通る(N-189)', () => {
  for (const { file, mustCall, label } of SEND_PATHS) {
    it(`${label}（${file}）は ${mustCall} を使う`, () => {
      const source = read(file);
      expect(source).toContain(mustCall);
    });
  }

  it('空文字へ落ちる getCommonVarMap は送信経路から排除する', () => {
    for (const { file, label } of SEND_PATHS) {
      const source = read(file);
      expect(source, `${file} (${label}) が getCommonVarMap を直接呼んでいる`).not.toContain('getCommonVarMap');
    }
  });

  it('個別送信の呼出元はsource（台帳の出所）を必ず渡す', () => {
    for (const file of ['routes/chats.ts', 'services/scheduled-chat-sends.ts']) {
      const source = read(file);
      const calls = source.match(/renderChatMessageContent\([\s\S]*?\);/g) ?? [];
      const lenientPreviews = source.match(/lenient[\s\S]*?renderChatMessageContent\([\s\S]*?\);/g) ?? [];
      const sendCalls = calls.filter(
        (call) => !lenientPreviews.some((preview) => preview.endsWith(call)),
      );
      expect(sendCalls.length, `${file} に送信経路の呼出しがありません`).toBeGreaterThan(0);
      for (const call of sendCalls) {
        expect(
          /kind:\s*'chat'/.test(call),
          `${file} の renderChatMessageContent 呼出しに source がありません: ${call.slice(0, 120)}`,
        ).toBe(true);
      }
    }
  });

  it('自動応答の実送信では source を渡し、dry-run では渡さない', () => {
    const source = read('services/auto-reply.ts');
    // 実送信（matchAndReply内の呼出し）は source 付きで呼ぶ
    expect(source).toContain("kind: 'auto_reply'");
    // dry-run（auto-replies.ts のプレビュー呼出し）は source なしのまま
    const dryRun = read('routes/auto-replies.ts');
    const previewCalls = dryRun.match(/previewAutoReplyContent\([^)]*\)/g) ?? [];
    for (const call of previewCalls) {
      expect(call).not.toContain('kind:');
    }
  });
});
