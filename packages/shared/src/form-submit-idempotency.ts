/*
 * フォーム回答送信の Idempotency-Key まわり(#729)。
 *
 * サーバはキーなし・非UUIDの送信を 400 で断る
 * (`apps/worker/src/routes/forms.ts` の `idempotency_key_required` ほか)。
 * つまりこのヘッダが落ちると、その経路の回答は全部通らなくなる。
 * それでいて LIFF・内蔵フォーム・webinar の3経路はヘッダを別々に
 * 組み立てていたため、1行消しても型検査は通った(#646 の逆変異 mA/mB)。
 *
 * この部品は「渡し忘れ」を型で止めるためだけの小部品。fetch・認証の
 * 取得・URL・202再送・応答判定は各経路に残す(3者で別物のため)。
 * 「組み立て忘れ」は #646 の実行時ヘッダ試験2本が見張る。型と試験で
 * 見張る対象が違うので、両方要る。
 */

/**
 * UUID 形の冪等キー。素の `string` では呼び出し側の渡し忘れ・空文字を
 * 型で止められないため branded にする。作るときは必ず
 * `newFormIdempotencyKey` か `toFormIdempotencyKey` を通す。
 */
export type FormIdempotencyKey = string & {
  readonly __formIdempotencyKey: unique symbol;
};

/**
 * サーバが受け付ける UUID の形(`routes/forms.ts` の
 * `FORM_IDEMPOTENCY_KEY_PATTERN` と同じ)。
 */
const FORM_IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 文字列を検証してキー型にする。UUID の形でなければ投げる(サーバも
 * 400 で断るので、握りつぶして送り直しループに入れない)。
 * サーバが誘導してきたキーなど、外から来た値の境界で使う。
 */
export function toFormIdempotencyKey(value: string): FormIdempotencyKey {
  const text = value.trim();
  if (!FORM_IDEMPOTENCY_KEY_PATTERN.test(text)) {
    throw new Error('idempotency_key_must_be_uuid');
  }
  return text as FormIdempotencyKey;
}

/** 新しい回答ぶんのキーを作る。回答ごとの安定化は呼び出し側の仕事。 */
export function newFormIdempotencyKey(): FormIdempotencyKey {
  return toFormIdempotencyKey(crypto.randomUUID());
}

export interface FormSubmitHeadersOptions {
  /**
   * `Bearer ...` 全体を渡す。トークンの取り方(LIFF SDK・ctx)は経路ごとに
   * 違うので、この関数は運ばない。渡さなければ Authorization を付けない。
   */
  authorization?: string;
}

/**
 * 送信ヘッダを組み立てる純粋関数。fetch はしない。
 *
 * `Idempotency-Key` は必須引数のキーから必ず付ける。落とせば呼び出し側の
 * typecheck が落ちる。`Content-Type` は回答送信の固定値。
 */
export function buildFormSubmitHeaders(
  key: FormIdempotencyKey,
  options: FormSubmitHeadersOptions = {},
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(options.authorization ? { Authorization: options.authorization } : {}),
    'Idempotency-Key': key,
  };
}
