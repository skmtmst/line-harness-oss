import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8');

// フォーム回答の3経路。LIFF は別アプリのため相対でたどる。
const EMBEDDED = read('form.ts');
const WEBINAR = read('webinar', 'main.tsx');
const LIFF = read('..', '..', '..', 'liff', 'src', 'lib', 'api.ts');

/**
 * フォーム回答の3経路が送信ヘッダを直に組み立てた旧形へ戻らないことを見張る。
 *
 * 3経路とも Idempotency-Key を実際に載せることは、送信して fetch へ渡ったヘッダで見る：
 * 内蔵フォーム＝form-submit-key.test.ts、webinar＝webinar/form-sheet-submit-key.test.ts、
 * LIFF＝apps/liff/src/lib/form-api-contract.test.ts（UUID でないキーを送る前に止めることも）。
 * キーを branded 型の必須引数で受けることは型検査が守る。
 */
describe('フォーム回答3経路は送信ヘッダを直に組み立てない', () => {
  it('内蔵フォームは Idempotency-Key を直に書かない', () => {
    expect(EMBEDDED).not.toMatch(/headers:\s*\{\s*'Idempotency-Key'/);
  });

  it('webinar は回答送信の旧行へ戻らない', () => {
    // 予約系の別関数にも同形があるため、回答送信の旧行だけを指す。
    expect(WEBINAR).not.toContain(
      "headers: buildAuthHeaders(ctx, { 'Content-Type': 'application/json', 'Idempotency-Key': key })",
    );
  });

  it('LIFF は回答送信の旧行へ戻らない', () => {
    // 予約系の別経路にも同名ヘッダがあるため、回答送信の旧行だけを指す。
    expect(LIFF).not.toContain(
      "headers: authHeaders({ 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey })",
    );
  });
});
