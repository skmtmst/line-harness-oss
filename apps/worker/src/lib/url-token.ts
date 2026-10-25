/** LINE プロフィール画像 URL の既知 CDN 接頭辞後の80文字は、同じ本人でチャネルをまたいでも一致するため、異なる provider の user_id を結ぶ手掛かりとして使う。画像なし・未知の CDN は NULL にする。SELECT では (${URL_TOKEN_SQL}) AS url_token として使う。 */
export const URL_TOKEN_SQL = `
  CASE
    WHEN picture_url LIKE 'https://sprofile.line-scdn.net/%' THEN SUBSTR(picture_url, 42, 80)
    WHEN picture_url LIKE 'https://profile.line-scdn.net/%' THEN SUBSTR(picture_url, 41, 80)
    ELSE NULL
  END
`;
