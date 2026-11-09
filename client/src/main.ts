import { Game } from './game';
import './drone/touch.css';

const game = new Game(document.getElementById('app')!);
(window as unknown as { game: Game }).game = game;
game.start().catch((e) => {
  console.error(e);
  const t = document.getElementById('load-text');
  if (t) t.textContent = 'Failed to start: ' + (e?.message ?? e);
});
