import { describe, it, expect } from 'vitest';
import { resolveStepContent } from './scenario-resolve.js';

function mockDb(tplRow: { message_type: string; message_content: string; question_json?: string | null } | null): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => tplRow,
      }),
    }),
  } as unknown as D1Database;
}

describe('resolveStepContent', () => {
  it('template_id=null → step の値を返す', async () => {
    const result = await resolveStepContent(mockDb(null), {
      template_id: null,
      message_type: 'text',
      message_content: 'hello',
    });
    expect(result).toEqual({
      messageType: 'text',
      messageContent: 'hello',
      templateIdAtSend: null,
      questionJson: null,
    });
  });

  it('template_id がある + テンプレが存在 → テンプレ値を返す', async () => {
    const result = await resolveStepContent(
      mockDb({ message_type: 'flex', message_content: '{"foo":"bar"}' }),
      {
        template_id: 'tpl-1',
        message_type: 'text',
        message_content: 'fallback',
      },
    );
    expect(result).toEqual({
      messageType: 'flex',
      messageContent: '{"foo":"bar"}',
      templateIdAtSend: 'tpl-1',
      questionJson: null,
    });
  });

  it('template_id がある + テンプレが見つからない → step 値にフォールバック', async () => {
    const result = await resolveStepContent(mockDb(null), {
      template_id: 'tpl-deleted',
      message_type: 'text',
      message_content: 'fallback',
    });
    expect(result).toEqual({
      messageType: 'text',
      messageContent: 'fallback',
      templateIdAtSend: null,
      questionJson: null,
    });
  });

  /*
   * carousel は flex に coerce しない。PR #177「カルーセルを送れるように
   * する(配信が壊れていたのも直す)」(2026-08-19) で意図的に撤回された。
   *
   * 撤回の理由: カルーセルの中身は columns の配列で、Flex が要求するのは
   * bubble か carousel の**オブジェクト**。coerce していた頃は配列のまま
   * Flex の contents に入れて送っていたため LINE が 400 を返し、400 は
   * 永続エラー扱いなので pauseFriendScenarioDelivery が走って、その人の
   * 購読ごと止まっていた(詳細: packages/db/src/scenario-resolve.ts の
   * normalizeMessageType のコメント)。carousel はそのまま返し、
   * buildMessage が template メッセージ
   * ({ type: 'template', template: { type: 'carousel', columns } }) に
   * 組み立てる。
   */
  it('テンプレ messageType=carousel はそのまま carousel で返る(flex へ coerce しない)', async () => {
    const result = await resolveStepContent(
      mockDb({ message_type: 'carousel', message_content: '{"type":"carousel","contents":[]}' }),
      {
        template_id: 'tpl-carousel',
        message_type: 'text',
        message_content: 'fallback',
      },
    );
    expect(result.messageType).toBe('carousel');
    expect(result.templateIdAtSend).toBe('tpl-carousel');
  });

  it('質問テンプレートは step の控えよりテンプレートの最新版を優先する', async () => {
    const question = JSON.stringify({ text: '続けますか？', tapMode: 'single', choices: [{ label: 'はい', behavior: 'none' }] });
    const result = await resolveStepContent(
      mockDb({ message_type: 'text', message_content: '続けますか？', question_json: question }),
      {
        template_id: 'tpl-question',
        message_type: 'text',
        message_content: '古い質問',
        question_json: JSON.stringify({ text: '古い質問', tapMode: 'single', choices: [{ label: 'はい', behavior: 'none' }] }),
      },
    );
    expect(result.questionJson).toBe(question);
    expect(result.templateIdAtSend).toBe('tpl-question');
  });
});
