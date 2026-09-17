/*
 * リマインダ名の文字数上限。画面の入力欄（maxLength）と同じ値を、
 * 作成・更新・下書き保存のすべてのサーバー口で同じ単位で数える (N-078)。
 *
 * 画面だけで止めると、APIを直接叩いたときに上限を越えた名前が入る。
 * 一覧・詳細・送信履歴のどの画面も60字を想定して組んであるため、
 * サーバー側でも同じ60字で止める。数え方はJS文字列の `.length`
 * （UTF-16 code unit）で、画面の maxLength と同じ。
 */
export const REMINDER_NAME_MAX_LENGTH = 60;

export const REMINDER_NAME_TOO_LONG_MESSAGE = `リマインダ名は${REMINDER_NAME_MAX_LENGTH}文字以内で指定してください`;
