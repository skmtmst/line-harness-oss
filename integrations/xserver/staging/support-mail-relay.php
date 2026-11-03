<?php
declare(strict_types=1);

const SECRET_FILE = '/home/andu2021/.nen-support-relay-secret-stg';
const FROM_EMAIL = 'test-shed@stg.nen-petfood.com';

/**
 * 差出人の表示名。本番 `integrations/xserver/support-mail-relay.php` と同じ考え方で、
 * 検証環境だと分かる名前にする。許可した名前と丸ごと一致しない限り既定値に落とす。
 */
const FROM_NAME_DEFAULT = '然-NEN- 検証用お客様窓口';
const FROM_NAME_ALLOWED = [
    '然-NEN- お客様窓口' => '然-NEN- 検証用お客様窓口',
    'musubo' => 'musubo 検証用',
];

header('Content-Type: application/json; charset=UTF-8');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}
$body = file_get_contents('php://input');
$timestamp = $_SERVER['HTTP_X_NEN_TIMESTAMP'] ?? '';
$signature = strtolower($_SERVER['HTTP_X_NEN_SIGNATURE'] ?? '');
$secret = trim((string) @file_get_contents(SECRET_FILE));
if (!preg_match('/^\d{10}$/', $timestamp) || abs(time() - (int) $timestamp) > 300
    || !preg_match('/^[0-9a-f]{64}$/', $signature) || strlen($secret) < 32
    || !hash_equals(hash_hmac('sha256', $timestamp.'.'.$body, $secret), $signature)) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Invalid signature']);
    exit;
}
$input = json_decode($body, true);
$to = is_array($input) ? ($input['to'] ?? '') : '';
$subject = is_array($input) ? ($input['subject'] ?? '') : '';
$text = is_array($input) ? ($input['body'] ?? '') : '';
if (!filter_var($to, FILTER_VALIDATE_EMAIL) || !is_string($subject) || !is_string($text)
    || $text === '' || strlen($text) > 50000) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid message']);
    exit;
}
/*
 * html は飾り付きの本文。本番と同じ扱いで、無ければ文字だけの1通にする。
 * 飾り付きは文字より長いので、上限は本文と別に持つ。
 */
$html = is_array($input) && is_string($input['html'] ?? null) ? $input['html'] : '';
if (strlen($html) > 200000) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid message']);
    exit;
}
$requestedFromName = is_array($input) && is_string($input['fromName'] ?? null) ? $input['fromName'] : '';
$fromName = FROM_NAME_ALLOWED[$requestedFromName] ?? FROM_NAME_DEFAULT;
$messageId = '<'.bin2hex(random_bytes(16)).'@stg.nen-petfood.com>';
$cleanHeader = static fn (mixed $value): string => preg_replace('/[\r\n]+/', ' ', is_string($value) ? $value : '');
// 区切り線。毎回引き直すので、本文の中に同じ並びが出ることはない。
$boundary = 'nen-'.bin2hex(random_bytes(16));
$headers = [
    'From: =?UTF-8?B?'.base64_encode($fromName).'?= <'.FROM_EMAIL.'>',
    'Reply-To: <'.FROM_EMAIL.'>',
    'Message-ID: '.$messageId,
    'MIME-Version: 1.0',
];
if ($html !== '') {
    $headers[] = 'Content-Type: multipart/alternative; boundary="'.$boundary.'"';
} else {
    $headers[] = 'Content-Type: text/plain; charset=UTF-8';
    // 本番と同じ。本文を丸ごと base64 にすると迷惑メール判定の材料になる。
    $headers[] = 'Content-Transfer-Encoding: quoted-printable';
}
if (!empty($input['inReplyTo'])) {
    $headers[] = 'In-Reply-To: '.$cleanHeader($input['inReplyTo']);
}
if (!empty($input['references'])) {
    $headers[] = 'References: '.$cleanHeader($input['references']);
}
$encodedSubject = '=?UTF-8?B?'.base64_encode($cleanHeader($subject)).'?=';
// 改行を CRLF に揃えてから符号化する。混ざると受信側で行が崩れる。
$encodeQp = static fn (string $value): string => quoted_printable_encode(preg_replace("/\r\n|\r|\n/", "\r\n", $value));
// 並び順は決まりで、後ろにあるものが優先される。飾り付きを後ろに置く。
$encodedBody = $html === '' ? $encodeQp($text) : implode("\r\n", [
    'This is a multi-part message in MIME format.',
    '',
    '--'.$boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    $encodeQp($text),
    '--'.$boundary,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    $encodeQp($html),
    '--'.$boundary.'--',
    '',
]);
$sent = mail($to, $encodedSubject, $encodedBody, implode("\r\n", $headers), '-f'.FROM_EMAIL);
if (!$sent) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Mail delivery failed']);
    exit;
}
echo json_encode(['success' => true, 'messageId' => $messageId]);
