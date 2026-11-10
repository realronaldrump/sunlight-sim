import { SANTA_ACHIEVEMENT } from '../world/santaDiscovery';

const css = `
#santa-gift-tag { position:fixed; top:max(86px, calc(env(safe-area-inset-top) + 68px)); left:50%;
  z-index:17; pointer-events:none; width:min(310px, calc(100vw - 40px)); color:#342922;
  filter:drop-shadow(0 8px 18px #100b0e65); transform:translateX(-50%); }
#santa-gift-tag[hidden] { display:none; }
#santa-gift-tag .santa-paper { position:relative; box-sizing:border-box; display:grid; grid-template-columns:48px 1fr; align-items:center;
  gap:14px; padding:15px 17px 16px 37px; min-height:83px; border:1px solid #dfb77a;
  background:linear-gradient(144deg,#fff6df,#f2dbac); border-radius:14px 6px 6px 14px;
  animation:santa-tag-swing 5.75s both; transform-origin:8% 29%; }
#santa-gift-tag .santa-paper:before { content:""; position:absolute; inset:5px; border:1px solid #a57a4857; border-radius:10px 4px 4px 10px; }
#santa-gift-tag .santa-loop { position:absolute; left:-6px; top:17px; width:31px; height:17px; border:3px solid #a2343f;
  border-radius:50%; transform:rotate(-30deg); box-shadow:inset 0 1px #e68275; }
#santa-gift-tag .santa-loop:after { content:""; position:absolute; right:0; top:1px; width:9px; height:9px;
  border:2px solid #bc914e; background:#4a2932; border-radius:50%; }
#santa-gift-tag .santa-seal { width:46px; height:46px; transform:rotate(-9deg); animation:santa-seal-stamp .48s .12s both; }
#santa-gift-tag .santa-caption { display:block; color:#68523c; font:700 10px system-ui,sans-serif; letter-spacing:.12em; text-transform:uppercase; }
#santa-gift-tag strong { display:block; color:#632936; font:700 24px Georgia,serif; margin-top:3px; }
@keyframes santa-tag-swing { 0% { opacity:0; transform:translateY(-36px) rotate(-14deg) scale(.91); }
  7% { opacity:1; transform:translateY(2px) rotate(4deg) scale(1); }
  13% { transform:translateY(0) rotate(-1.5deg); } 24%, 88% { opacity:1; transform:translateY(0) rotate(0); }
  100% { opacity:0; transform:translateY(-7px) rotate(0); } }
@keyframes santa-seal-stamp { 0%, 18% { opacity:0; transform:rotate(-18deg) scale(1.52); }
  56% { opacity:1; transform:rotate(-9deg) scale(.93); } 100% { opacity:1; transform:rotate(-9deg) scale(1); } }
@media (prefers-reduced-motion: reduce) { #santa-gift-tag .santa-paper, #santa-gift-tag .santa-seal { animation:none; } }
`;

/** One-time unlock notification. The permanent badge remains in the menu. */
export class SantaGiftTag {
  private tag: HTMLElement | null = null;

  reveal() {
    if (this.tag) return;
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
    const tag = this.tag = document.createElement('aside');
    tag.id = 'santa-gift-tag'; tag.setAttribute('role', 'status'); tag.setAttribute('aria-live', 'polite');
    tag.innerHTML = `<div class="santa-paper"><i class="santa-loop" aria-hidden="true"></i>
      <svg class="santa-seal" aria-hidden="true" viewBox="0 0 50 50">
        <circle cx="25" cy="25" r="22" fill="#7c2b3b" stroke="#ae754b" stroke-width="2"/>
        <circle cx="25" cy="25" r="17.5" fill="none" stroke="#ffd99f" stroke-dasharray="1.5 2.6" stroke-width="1.1"/>
        <path d="M25 11v28M13 18l24 14M13 32l24-14M22 14l3 3 3-3M22 36l3-3 3 3M15 21l4 .5-.8-4M35 29l-4-.5.8 4M15 29l4-.5-.8 4M35 21l-4 .5.8-4" fill="none" stroke="#ffe9bf" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div><span class="santa-caption">Achievement unlocked</span><strong>${SANTA_ACHIEVEMENT}</strong></div></div>`;
    document.body.append(tag);
    window.setTimeout(() => { tag.hidden = true; }, 5750);
  }
}
