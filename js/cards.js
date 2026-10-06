'use strict';
/* Card factory — DOM cards with skins, faces, backs, flip state.
   Skins are cosmetic only; adding one = append to SKINS + CSS rules. */
const CARDS = (() => {
  const SUIT_CHAR = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };
  const isRed  = code => { const s = code.slice(-1); return s === 'H' || s === 'D'; };
  const rankOf = code => code.slice(0, -1);

  const SKINS = ['standard', 'holo', 'gold', 'neon', 'mystic'];
  let skinIndex = 0;
  const currentSkin = () => SKINS[skinIndex];
  function cycleSkin() {
    skinIndex = (skinIndex + 1) % SKINS.length;
    document.querySelectorAll('.card').forEach(el => { el.dataset.skin = currentSkin(); pop(el); });
    return currentSkin();
  }

  const PIP_LAYOUT = {
    2: [[50,14],[50,86]],
    3: [[50,14],[50,50],[50,86]],
    4: [[28,16],[72,16],[28,84],[72,84]],
    5: [[28,16],[72,16],[50,50],[28,84],[72,84]],
    6: [[28,16],[72,16],[28,50],[72,50],[28,84],[72,84]],
    7: [[28,16],[72,16],[50,33],[28,50],[72,50],[28,84],[72,84]],
    8: [[28,16],[72,16],[50,33],[28,50],[72,50],[50,67],[28,84],[72,84]],
    9: [[28,14],[72,14],[28,38],[72,38],[50,50],[28,62],[72,62],[28,86],[72,86]],
    10:[[28,14],[72,14],[50,26],[28,38],[72,38],[28,62],[72,62],[50,74],[28,86],[72,86]],
  };

  function faceHTML(code) {
    const r = rankOf(code), s = code.slice(-1), ch = SUIT_CHAR[s], red = isRed(code);
    const corners = ['tl','br'].map(cls =>
      `<div class="corner ${cls} ${red ? 'r' : 'b'}"><span>${r}</span><span>${ch}</span></div>`).join('');
    let center;
    if (['J','Q','K'].includes(r)) {
      center = `<div class="court"><div class="court-letter ${red?'r':'b'}">${r}</div><div class="court-suit">${ch}</div></div>`;
    } else if (r === 'A') {
      center = `<div class="ace-center ${red ? 'r' : 'b'}">${ch}</div>`;
    } else {
      const pos = PIP_LAYOUT[parseInt(r,10)] || [];
      center = '<div class="pips">' + pos.map(p =>
        `<span class="${red?'r':'b'}" style="left:${p[0]}%;top:${p[1]}%">${ch}</span>`).join('') + '</div>';
    }
    const shine = currentSkin() === 'holo'   ? '<div class="holo-layer"></div>'
                : currentSkin() === 'gold'   ? '<div class="gold-shine"></div>'
                : currentSkin() === 'mystic' ? '<div class="mystic-runes"><i>\u2726</i><i>\u2727</i><i>\u2726</i></div>'
                : '';
    return corners + center + shine;
  }

  function backHTML() {
    return `<svg viewBox="0 0 100 140" class="back-art" preserveAspectRatio="none">
      <defs>
        <pattern id="bp" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="12" height="12" fill="#123a52"/>
          <path d="M0 6 H12 M6 0 V12" stroke="#1d5a7d" stroke-width="1.6"/>
          <circle cx="6" cy="6" r="1.4" fill="#d9b25a" opacity=".5"/>
        </pattern>
      </defs>
      <rect x="4" y="4" width="92" height="132" rx="10" fill="url(#bp)"/>
      <rect x="4" y="4" width="92" height="132" rx="10" fill="none" stroke="#d9b25a" stroke-width="2" opacity=".85"/>
      <rect x="10" y="10" width="80" height="120" rx="7" fill="none" stroke="#e8cf94" stroke-width="1" opacity=".5"/>
      <g transform="translate(50 70)">
        <path d="M0 -22 L14 0 L0 22 L-14 0 Z" fill="#0d2c40" stroke="#d9b25a" stroke-width="2"/>
        <path d="M0 -11 L7 0 L0 11 L-7 0 Z" fill="#d9b25a" opacity=".9"/>
      </g>
    </svg>`;
  }

  /* make(code|null): null → starts face-down */
  function make(code) {
    const el = document.createElement('div');
    el.className = 'card' + (code == null ? ' down' : '');
    el.dataset.skin = currentSkin();
    if (code) el.dataset.code = code;
    el.innerHTML = `<div class="card-inner">
        <div class="face front">${code ? faceHTML(code) : ''}</div>
        <div class="face back">${backHTML()}</div>
      </div>`;
    attachHover(el);
    return el;
  }

  function reface(el, code) {
    el.dataset.code = code;
    el.querySelector('.front').innerHTML = faceHTML(code);
    el.classList.remove('down');
    el.dataset.skin = currentSkin();
  }
  function flipTo(el, code) { // reveal a back card around its Y axis
    reface(el, code);
    el.classList.remove('down');
    SOUND.flip();
  }
  function toBack(el) { el.classList.add('down'); }
  function pop(el) { el.classList.remove('settled'); void el.offsetWidth; el.classList.add('settled'); }

  /* tactile hover/click on settled cards */
  function attachHover(el) {
    el.addEventListener('click', () => {
      el.classList.remove('selected', 'tapped'); void el.offsetWidth;
      el.classList.add('selected', 'tapped');
      setTimeout(() => el.classList.remove('tapped'), 260);
      SOUND.click();
    });
  }

  return { make, reface, flipTo, toBack, pop, currentSkin, cycleSkin, isRed, rankOf, SKINS };
})();
