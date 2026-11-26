// Client-safe: used by the reducer tests and by the client's table signs (`✅ WENT 2ND`).

/** English ordinal in capitals: 1ST, 2ND, 3RD, 4TH … 11TH, 12TH, 13TH … 21ST. */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'TH' : (['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH');
  return `${n}${suffix}`;
}
