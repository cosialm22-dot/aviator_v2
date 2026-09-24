// Helpers for the bets board (BetsPanel) and the round-history strip.

/** Spribe palette for multipliers: blue < 2x, purple 2–10x, pink ≥ 10x. */
export function multColor(m: number): string {
  if (m < 2) return 'text-[#34b4ff]';
  if (m < 10) return 'text-[#913ef8]';
  return 'text-[#c017b4]';
}

export const fmtX = (m: number) => `${m.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;

export const money = (n: number) => Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Other players' names are masked on the public board: "david8" -> "d***8". */
export const maskName = (u: string) => (u.length <= 2 ? `${u[0] ?? '?'}***` : `${u[0]}***${u[u.length - 1]}`);

/** Only real players' bets are shown or counted: server-seeded bots and demo bots are dropped. */
export const realOnly = <T extends { is_bot: boolean }>(rows: T[]) => rows.filter((r) => !r.is_bot);
