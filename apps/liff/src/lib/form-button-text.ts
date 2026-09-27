import { formThemeButtonText, type FormTheme } from '@line-crm/shared';

/**
 * 回答フォームの送信ボタンの文字色。
 *
 * 大学生向けの言い換え: ボタンの地の色に対して、読める文字色を選ぶ係。
 * 管理画面でフォームの色を決めていないとき (既定の緑) は設計どおり白
 * (on-accent)。決めているときだけ、地の色に対するコントラストで
 * 白か暗い色かを自動で選ぶ (formThemeButtonText が 4.5 以上を優先)。
 */
export function submitButtonText(theme: FormTheme, hasCustomTheme: boolean): string {
  if (!hasCustomTheme) return '#ffffff';
  return formThemeButtonText(theme);
}
