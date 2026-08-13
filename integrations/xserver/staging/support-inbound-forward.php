#!/usr/bin/php8.3
<?php
declare(strict_types=1);

const SECRET_FILE = '/home/andu2021/.nen-support-relay-secret-stg';
const WORKER_URL = 'https://nen-line-stg.skmtmst.workers.dev/webhooks/xserver/support-email';
const MAX_EMAIL_BYTES = 10 * 1024 * 1024;

$raw = file_get_contents('php://stdin', false, null, 0, MAX_EMAIL_BYTES + 1);
if ($raw === false || $raw === '' || strlen($raw) > MAX_EMAIL_BYTES) {
    fwrite(STDERR, "invalid email payload\n");
    exit(1);
}
$secret = trim((string) @file_get_contents(SECRET_FILE));
if (strlen($secret) < 32) {
    fwrite(STDERR, "relay secret is not configured\n");
    exit(1);
}
$body = json_encode(['raw' => base64_encode($raw)], JSON_UNESCAPED_SLASHES);
if ($body === false) {
    exit(1);
}
$timestamp = (string) time();
$signature = hash_hmac('sha256', $timestamp.'.'.$body, $secret);
$curl = curl_init(WORKER_URL);
curl_setopt_array($curl, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'X-NEN-Timestamp: '.$timestamp,
        'X-NEN-Signature: '.$signature,
    ],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 30,
]);
$response = curl_exec($curl);
$status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
$error = curl_error($curl);
curl_close($curl);
if ($response === false || $status < 200 || $status >= 300) {
    fwrite(STDERR, "worker delivery failed: {$status} {$error}\n");
    exit(1);
}
