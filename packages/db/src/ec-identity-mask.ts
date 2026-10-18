


export function maskSensitiveString(value: string): string {
  if (/[*\u2022\u25cf\u2026]/.test(value)) return value;
  const email = value.match(/^([^@\s]+)@([^@\s]+)$/);
  if (email) return `${email[1]!.slice(0, 2)}***@${email[2]}`;
  if (/^\+?[0-9 ()-]{10,20}$/.test(value) && value.replace(/\D/g, '').length >= 10) {
    return `***${value.replace(/\D/g, '').slice(-4)}`;
  }
  return value;
}
