'use strict';
/* UI layer: DOM refs, animated totals, banners, chips, card flight animations. */
const UI = (() => {
  const $ = id => document.getElementById(id) || { addEventListener(){}, classList:{add(){},remove(){},toggle(){},contains(){return true}} };
  const el = {
    table: $('table'),
    roundNum: $('roundNum'),
    soundBtn: $('soundBtn'), skinBtn: $('skinBtn'),
    dealerCards: $('dealerCards'), dealerTotal: $('dealerTotal'), dealerZone: $('dealerZone'),
    oppZone: $('oppZone'),
    myHand0: $('myHand0'), myName: $('myName'), myBankroll: $('myBankroll'),
    myTurnFlag: $('myTurnFlag'), myBetRing: $('myBetRing'), myBetAmt: $('myBetAmt'), meZone: $('meZone'),
    shoe: $('shoe'), deckCount: $('deckCount'), banner: $('banner'), statusLine: $('statusLine'),
    betControls: $('betControls'), chipRack: $('chipRack'), betAmount: $('betAmount'),
    confirmBet: $('confirmBet'), clearBet: $('clearBet'),
    actionControls: $('actionControls'), hitBtn: $('hitBtn'), standBtn: $('standBtn'),
    doubleBtn: $('doubleBtn'), splitBtn: $('splitBtn'),
    toast: $('toast'), ambient: $('ambient'),
  };

  /* ---------- screen switching ---------- */
  function showTable() { if (el.table && el.table.classList) el.table.classList.add('active'); startAmbient(); }

  /* ---------- animated number ---------- */
  const animators = new WeakMap();
  function animateNumber(node, to, dur = 450) {
    const from = parseInt(node.dataset.v || '0', 10);
    if (from === to) return;
    node.dataset.v = String(to);
    cancelAnimationFrame(animators.get(node));
    const t0 = performance.now();
    (function step(t) {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      node.textContent = Math.round(from + (to - from) * e).toLocaleString();
      if (k < 1) animators.set(node, requestAnimationFrame(step));
    })(t0);
  }

  /* ---------- total chips (bump on change / 21 / bust) ---------- */
  function setTotal(chipEl, value, opts = {}) {
    const span = chipEl.querySelector('span');
    animateNumber(span, value);
    chipEl.classList.remove('bump', 'gold-bump', 'red-bump');
    void chipEl.offsetWidth;
    if (opts.bust) chipEl.classList.add('red-bump');
    else if (value === 21) chipEl.classList.add('gold-bump');
    else chipEl.classList.add('bump');
  }

  /* ---------- card flight physics ---------- */
  const SHOE_SEL = '.shoe-body';
  function flyCard(cardEl, targetEl, { faceUp, delay = 0, tilt = 0 } = {}) {
    const shoe = document.querySelector(SHOE_SEL);
    const sRect = shoe.getBoundingClientRect();
    cardEl.style.position = 'fixed';
    cardEl.style.left = sRect.left + sRect.width / 2 - cardEl.offsetWidth / 2 + 'px';
    cardEl.style.top = sRect.top - 6 + 'px';
    cardEl.style.zIndex = 60;
    document.body.appendChild(cardEl);
    // lift: tiny scale-up as it leaves the shoe
    cardEl.style.transition = 'none';
    cardEl.style.transform = 'scale(.86) rotate(-3deg)';
    setTimeout(() => {
      const tRect = targetEl.getBoundingClientRect();
      const x = tRect.left + tRect.width / 2 - cardEl.offsetWidth / 2 - parseFloat(cardEl.style.left);
      const y = tRect.top + tRect.height / 2 - cardEl.offsetHeight / 2 - parseFloat(cardEl.style.top);
      cardEl.style.transition = 'transform .5s cubic-bezier(.22,.9,.32,1.06), left .5s cubic-bezier(.22,.9,.32,1.06), top .5s cubic-bezier(.22,.9,.32,1.06)';
      cardEl.style.transform = `translate(${x}px, ${y}px) rotate(${tilt}deg) scale(1)`;
      SOUND.deal();
      shoe.classList.remove('react'); void shoe.offsetWidth; shoe.classList.add('react');
    }, 40 + delay);
    return new Promise(res => setTimeout(() => {
      cardEl.style.transition = 'none';
      cardEl.style.position = ''; cardEl.style.left = ''; cardEl.style.top = '';
      cardEl.style.transform = ''; cardEl.style.zIndex = '';
      targetEl.appendChild(cardEl);
      CARDS.pop(cardEl);
      SOUND.land();
      res(cardEl);
    }, 560 + delay));
  }

  /* ---------- flip a card in place (Y-axis) ---------- */
  function flipCard(cardEl, code) {
    CARDS.flipTo(cardEl, code);   // reface + rotateY transition via .down removal
  }

  /* ---------- banners ---------- */
  let bannerTimer = null;
  function banner(text, kind = 'neutral', ms = 1600) {
    el.banner.className = 'banner show ' + kind;
    el.banner.textContent = text;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.banner.classList.remove('show'), ms);
  }
  function status(text) { el.statusLine.textContent = text; }
  let toastTimer = null;
  function toast(text) {
    el.toast.textContent = text; el.toast.classList.remove('hidden', 'out');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.classList.add('out'); setTimeout(() => el.toast.classList.add('hidden'), 350); }, 2200);
  }

  /* ---------- chips ---------- */
  const DENOMS = [
    { v: 25, c: '#e04f4f', label: '25' },
    { v: 100, c: '#2fae7d', label: '100' },
    { v: 250, c: '#3d7dd8', label: '250' },
    { v: 500, c: '#9a5fd0', label: '500' },
  ];
  function buildRack(onPick) {
    el.chipRack.innerHTML = '';
    DENOMS.forEach(d => {
      const chip = document.createElement('button');
      chip.className = 'chip'; chip.dataset.v = d.v;
      chip.style.setProperty('--chipc', d.c);
      chip.innerHTML = `<span>${d.label}</span>`;
      chip.addEventListener('click', () => { SOUND.chip(); onPick(d.v); wobble(chip); });
      el.chipRack.appendChild(chip);
    });
  }
  function wobble(node) { node.classList.remove('pressed'); void node.offsetWidth; node.classList.add('pressed'); }

  /* chip flies from rack position to bet ring */
  function flyChip(value, ringEl) {
    const d = DENOMS.find(x => x.v === value) || DENOMS[0];
    const src = el.chipRack.lastElementChild ? [...el.chipRack.children].find(c => +c.dataset.v === value) : null;
    if (!src) return;
    const sRect = src.getBoundingClientRect(), tRect = ringEl.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'chip ghost'; ghost.style.setProperty('--chipc', d.c);
    ghost.innerHTML = `<span>${d.label}</span>`;
    ghost.style.position = 'fixed';
    ghost.style.left = sRect.left + 'px'; ghost.style.top = sRect.top + 'px';
    ghost.style.width = sRect.width + 'px'; ghost.style.height = sRect.height + 'px';
    ghost.style.zIndex = 70;
    document.body.appendChild(ghost);
    requestAnimationFrame(() => {
      const dx = tRect.left + tRect.width / 2 - sRect.left - sRect.width / 2;
      const dy = tRect.top + tRect.height / 2 - sRect.top - sRect.height / 2;
      ghost.style.transition = 'transform .45s cubic-bezier(.3,.7,.3,1.1), opacity .45s';
      ghost.style.transform = `translate(${dx}px,${dy}px) rotate(${(Math.random() * 80 - 40).toFixed(0)}deg) scale(.9)`;
    });
    setTimeout(() => { ghost.style.opacity = '0'; setTimeout(() => ghost.remove(), 250); }, 420);
  }

  /* stack of mini-chips shown inside a bet ring */
  function renderBetStack(ringEl, amount) {
    ringEl.querySelectorAll('.stack-chip').forEach(n => n.remove());
    const max = Math.min(6, Math.ceil(amount / 25));
    for (let i = 0; i < max; i++) {
      const sc = document.createElement('i');
      sc.className = 'stack-chip';
      const d = DENOMS[Math.min(DENOMS.length - 1, Math.floor(amount / 250))] || DENOMS[0];
      sc.style.background = d.c;
      sc.style.bottom = (4 + i * 4) + 'px';
      ringEl.appendChild(sc);
    }
  }

  /* ---------- turn highlight transitions ---------- */
  function setTurn(meActive) {
    el.meZone.classList.toggle('your-turn', meActive === true);
    el.myTurnFlag.classList.toggle('on', meActive === true);
  }

  /* ---------- controls visibility ---------- */
  function showControls(which) {
    [['bet', el.betControls], ['action', el.actionControls]]
      .forEach(([k, node]) => node && node.classList && node.classList.toggle('hidden', k !== which));
  }

  /* ---------- ambient canvas: dust motes + slow light ---------- */
  let raf = null;
  function startAmbient() {
    const cv = el.ambient, ctx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    function size() { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; }
    size(); addEventListener('resize', size);
    const motes = Array.from({ length: 26 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8,
      vx: (Math.random() - 0.5) * 0.00006, vy: -0.00002 - Math.random() * 0.00005,
      a: 0.05 + Math.random() * 0.12, hue: Math.random() < 0.5 ? '217,178,90' : '120,220,190',
    }));
    let t = 0;
    (function loop() {
      t += 0.004;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const gx = (0.5 + Math.sin(t) * 0.18) * cv.width, gy = (0.32 + Math.cos(t * 0.8) * 0.1) * cv.height;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, cv.width * 0.55);
      g.addColorStop(0, 'rgba(255,235,180,0.05)'); g.addColorStop(1, 'rgba(255,235,180,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
      for (const m of motes) {
        m.x += m.vx; m.y += m.vy;
        if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
        ctx.beginPath();
        ctx.arc(m.x * cv.width, m.y * cv.height, m.r * dpr, 0, 7);
        ctx.fillStyle = `rgba(${m.hue},${m.a})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    })();
  }

  /* ---------- engine event replay ---------- */
  let gameRef = null;
  const cardEls = new Map();          // key -> card element on table
  const totalChips = new Map();       // hand-key -> its total chip element
  const lastTotals = new Map();       // key -> last shown total (for bust/21 emphasis)

  function handKey(e) { return e.to === 'dealer' ? 'D' : `S${e.seat}H${e.hand || 0}`; }
  function targetFor(key) {
    if (key === 'D') return el.dealerCards;
    const [m, s, h] = key.match(/^S(\d+)H(\d+)$/) || [];
    if (!m) return el.myHand0;
    return (+h === 1 && el.myHand1 && !el.myHand1.classList.contains('hidden')) ? el.myHand1 : el.myHand0;
  }
  function chipFor(key) {
    if (key === 'D') return el.dealerTotal;
    if (!totalChips.has(key)) {
      const t = targetFor(key);
      const chip = document.createElement('div');
      chip.className = 'total-chip hand-total';
      chip.innerHTML = '<span>0</span>';
      (t.parentElement || el.myHand0).appendChild(chip);
      totalChips.set(key, chip);
    }
    return totalChips.get(key);
  }
  function clearHandChips() {
    totalChips.forEach(node => node.remove());
    totalChips.clear(); cardEls.clear(); lastTotals.clear();
  }

  function onEvent(e, animate = true) {
    switch (e.t) {
      case 'SHUFFLE':
        cardEls.forEach(n => { if (n.remove) n.remove(); }); clearHandChips();
        el.dealerCards.innerHTML = ''; el.myHand0.innerHTML = '';
        if (el.myHand1) el.myHand1.innerHTML = '';
        el.deckCount.textContent = '6D'; SOUND.shuffle();
        break;
      case 'PHASE':
        if (e.phase === 'BETTING') { status('Place your bet to begin.'); showControls('bet'); setTurn(null); }
        else if (e.phase === 'DEALING') { status('Dealing…'); showControls(null); }
        else if (e.phase === 'PLAYER_TURN') { status('Your move — hit or stand?'); showControls('action'); }
        else if (e.phase === 'DEALER_TURN') { status('Dealer plays…'); showControls(null); }
        break;
      case 'DEAL_CARD': {
        const key = handKey(e);
        const faceUp = !(e.to === 'dealer' && e.hidden);
        const cd = typeof e.card === 'string' ? e.card : (e.card.rank + e.card.suit);
        const node = CARDS.make(faceUp ? cd : null);
        cardEls.set(key + '#' + (cardEls.size), node);
        const tilt = (Math.random() * 5 - 2.5).toFixed(1);
        if (animate) flyCard(node, targetFor(key), { faceUp, tilt });
        else targetFor(key).appendChild(node);
        break;
      }
      case 'HAND_CHANGED': case 'HAND_STOOD': case 'HAND_BUST': case 'DOUBLED': break; // totals synced via setState
      case 'SPLIT':
        if (el.myHand1) { el.myHand1.classList.remove('hidden'); el.myHand1.style.display = ''; status('Split! Play hand one.'); }
        break;
      case 'TURN_CHANGED': setTurn(true); break;
      case 'DEALER_REVEAL': {
        const hole = el.dealerCards.children[1];
        if (hole) flipCard(hole, e.card && (e.card.rank + e.card.suit));
        break;
      }
      case 'BET_PLACED': renderBetStack(el.myBetRing, e.amount); el.myBetAmt.textContent = e.amount; break;
      case 'BET_CLEARED': renderBetStack(el.myBetRing, 0); el.myBetAmt.textContent = ''; break;
      case 'ROUND_RESULT': {
        const r = e.results && e.results[0];
        if (!r) break;
        const kind = r.outcome === 'PUSH' ? 'neutral' : (r.payout > 0 ? 'win' : 'lose');
        if (r.outcome === 'BLACKJACK') { banner('BLACKJACK!', 'gold', 2200); SOUND.blackjack(); }
        else if (r.outcome === 'WIN') { banner('YOU WIN +' + r.payout, 'green', 1800); SOUND.win(); }
        else if (r.outcome === 'LOSE') { banner('DEALER WINS', 'red', 1700); SOUND.lose(); }
        else { banner('PUSH', 'neutral', 1500); }
        setTurn(null);
        status('Next deal on its way…');
        break;
      }
    }
  }
  function mySeatRef() { return 0; }

  /* ---------- full state sync from engine.view() ---------- */
  function setState(v, myId) {
    const me = v.seats.find(s => s.id === myId) || v.seats[0];
    if (!me) return;
    el.roundNum.textContent = v.round;
    el.deckCount.textContent = v.deckLeft;
    animateNumber(el.myBankroll, me.balance);
    setTurn(v.turnSeat === me.seat && v.phase === 'PLAYER_TURN');
    // dealer open total
    setTotal(el.dealerTotal, v.dealer.cards.filter(Boolean).length ? v.dealer.total : 0);
    // my hand totals (animated, with bust / 21 emphasis)
    me.hands.forEach((h, i) => {
      const chip = chipFor(`S${me.seat}H${i}`);
      if (!chip) return;
      const prev = lastTotals.get(`S${me.seat}H${i}`);
      lastTotals.set(`S${me.seat}H${i}`, h.total);
      if (prev !== h.total || i === 0) {
        setTotal(chip, h.total, { bust: h.busted });
        if (h.busted && prev !== h.total) { banner('BUST', 'red', 1300); if (typeof SOUND.bust === 'function') SOUND.bust(); }
      }
    });
    // action availability
    const myTurn = v.phase === 'PLAYER_TURN' && v.turnSeat === me.seat;
    const h = me.hands[me.activeHand] || me.hands[0];
    if (el.doubleBtn) el.doubleBtn.disabled = !(myTurn && h && h.cards.length === 2 && me.balance >= h.bet);
    if (el.splitBtn) el.splitBtn.disabled = !(myTurn && h && h.cards.length === 2 && me.balance >= h.bet &&
      (String(h.cards[0]).slice(0, -1) === String(h.cards[1]).slice(0, -1)));
  }

  /* ---------- bind controls to the game loop ---------- */
  function bind(game) {
    gameRef = game;
    showTable();
    buildRack(v => game.addChip(v));
    el.confirmBet.addEventListener('click', () => { SOUND.click(); game.confirmDeal(); });
    el.clearBet.addEventListener('click', () => { SOUND.click(); game.clearBet(); });
    [['hitBtn', 'hit'], ['standBtn', 'stand'], ['doubleBtn', 'double'], ['splitBtn', 'split']]
      .forEach(([id, act]) => el[id].addEventListener('click', () => { SOUND.click(); game.act(act); }));
    el.soundBtn.addEventListener('click', () => { const on = SOUND.toggle(); el.soundBtn.textContent = on ? '🔊' : '🔇'; });
    el.skinBtn.addEventListener('click', () => { const s = CARDS.cycleSkin(); toast('Card skin: ' + s.toUpperCase()); });
    document.addEventListener('keydown', ev => {
      if (!gameRef) return;
      const k = ev.key.toLowerCase();
      const betting = el.betControls && !el.betControls.classList.contains('hidden');
      // number keys place bets during the betting phase: 1-4 = chip denominations,
      // 0 = all-in, Backspace = clear bet
      if (betting && /^[0-4]$/.test(ev.key)) {
        ev.preventDefault();
        if (ev.key === '0') gameRef.allIn();
        else gameRef.addChip(UI.DENOMS[+ev.key - 1].v);
        return;
      }
      if (betting && (ev.key === 'Backspace' || (ev.key === 'c' && !ev.ctrlKey && !ev.metaKey))) { gameRef.clearBet(); return; }
      if (k === 'h') gameRef.act('hit'); else if (k === 's') gameRef.act('stand');
      else if (k === 'd') gameRef.act('double'); else if (k === 'p') gameRef.act('split');
      else if (ev.key === 'Enter' && betting) gameRef.confirmDeal();
    });
  }
  function chipFly(v) { flyChip(v, el.myBetRing); }
  function setBetReadout(n) { el.betAmount.textContent = n; }
  function clearRing() { renderBetStack(el.myBetRing, 0); el.myBetAmt.textContent = ''; }

  return { el, showTable, animateNumber, setTotal, flyCard, flipCard, banner, status, toast,
           buildRack, flyChip, renderBetStack, setTurn, showControls, DENOMS,
           bind, onEvent, setState, chipFly, setBetReadout, clearRing };
})();
