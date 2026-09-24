// The game menu (header) and the game screen talk through window events, since the menu lives in
// the global Header and the panels need state that only the game screen has (free bets, bets).

/** Panels the game screen opens when a menu item is picked (see AviatorGame). */
export type GamePanel = 'freebets' | 'history' | 'limits' | 'howto' | 'chat';

export function openGamePanel(panel: GamePanel): void {
  if (panel === 'chat') window.dispatchEvent(new Event('aviator:open-chat'));
  else window.dispatchEvent(new CustomEvent<GamePanel>('aviator:open-panel', { detail: panel }));
}

/** The game screen publishes the player's free-bet count so the menu can badge it. */
export function publishFreeBetCount(n: number): void {
  window.dispatchEvent(new CustomEvent<number>('aviator:freebets', { detail: n }));
}
