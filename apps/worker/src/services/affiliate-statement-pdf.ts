export function simplePdf(snapshot: {
  affiliateCode: string; periodFrom: string; periodTo: string; totalAmount: number; currency: string;
  grossAmount?: number; deductionAmount?: number; exportedBy?: string; exportedAt?: string;
}): Uint8Array {
  const ascii = (value: string) => value.replace(/[^\x20-\x7E]/g, '?').replace(/[()\\]/g, '\\$&');
  const deduction = snapshot.deductionAmount ?? 0;
  const lines = [
    'Affiliate payment statement',
    ...(snapshot.exportedBy && snapshot.exportedAt ? [`Exported by: ${ascii(snapshot.exportedBy)}`, `Exported at: ${ascii(snapshot.exportedAt)}`] : []),
    `Affiliate: ${ascii(snapshot.affiliateCode)}`,
    `Period: ${ascii(snapshot.periodFrom)} - ${ascii(snapshot.periodTo)}`,
    // R288: 取消の差し引きがあるときだけ内訳を分けて出す。
    ...(deduction > 0 ? [
      `Gross: ${snapshot.currency} ${snapshot.grossAmount ?? snapshot.totalAmount + deduction}`,
      `Adjustment: -${snapshot.currency} ${deduction}`,
    ] : []),
    `Amount: ${snapshot.currency} ${snapshot.totalAmount}`,
  ];
  const stream = `BT /F1 14 Tf 72 760 Td ${lines.map((line, index) => `${index ? '0 -24 Td ' : ''}(${line}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(new TextEncoder().encode(document).byteLength);
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = new TextEncoder().encode(document).byteLength;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(document);
}
