/**
 * 版の中身を、保存されている生の文字列のまま持ったもの。
 *
 * 指紋も突き合わせも**この生の文字列**で行う。読み直して組み立て直すと
 * 鍵の並びや空白で見た目が変わることがあり、同じ中身なのに違うと言い出す。
 */
export interface AutomationVersionContent {
  trigger_type: string;
  trigger_config: string;
  condition_config: string;
  action_config: string;
}
