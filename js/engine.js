'use strict';
/* ============================================================
   BlackjackEngine — pure, deterministic, zero-dependency.
   Shared by the authoritative server (require) and tests/browser.
   The UI never computes results; it only replays events.

   Money model: bets are DEDUCTED at placeBet (chips move from
   rail -> circle). resolve() returns every staked chip to the
   rail first, then applies signed winnings — balances can never
   leak. Split/double move additional chips rail -> hand bet.
   ============================================================ */

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function cardValue(rank) {
  return rank === 'A' ? 11 : (rank === 'J' || rank === 'Q' || rank === 'K' || rank === '10' ? 10 : parseInt(rank, 10));
}

function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { total += cardValue(c.rank); if (c.rank === 'A') aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  const soft = aces > 0 && total <= 21;
  return { total, soft };
}
const isBlackjack = hand => !!(hand && hand.cards && hand.cards.length === 2 && handValue(hand.cards).total === 21);
const code = c => (c.hidden ? null : c.rank + c.suit); // wire format for cards; hidden hole card travels as null

/* Dealer-card view: the unrevealed hole card is masked to null and its value
   excluded from the open total — clients must never see/sum the hidden card. */
function dealerView(dealer) {
  const open = !!dealer.revealed;
  const cards = dealer.cards.map((c, i) => (!open && i === 1 ? null : c.rank + c.suit));
  const visible = open ? dealer.cards : dealer.cards.filter((_, i) => i !== 1);
  return { cards, open, total: handValue(visible).total };
}

/* Seeded PRNG (mulberry32) so shuffles are reproducible in tests. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PHASES = ['BETTING', 'DEALING', 'PLAYER_TURN', 'DEALER_TURN', 'RESULT'];

class BlackjackEngine {
  /** @param {object} opts { seats:[{id,name,balance}], decks, seed, minBet, unit, hitSoft17 } */
  constructor(opts = {}) {
    this.seats = (opts.seats || []).map((s, i) => ({
      id: s.id, name: s.name, seat: i,
      balance: s.balance != null ? s.balance : 500,
      bet: 0, hands: [], activeHand: 0, done: true,
      connected: true, outcome: null, payout: 0,
    }));
    this.decksCount = opts.decks || 6;
    this.minBet = opts.minBet || 10;
    this.unit = opts.unit || 10;
    this.hitSoft17 = !!opts.hitSoft17;
    this.rng = makeRng(opts.seed != null ? opts.seed : (Date.now() ^ Math.floor(Math.random() * 1e9)));
    this.phase = 'BETTING';
    this.round = 0;
    this.deck = [];
    this._roundCardCount = 0;
    this.dealer = { cards: [], revealed: false };
    this.turnSeat = -1;
    this.eventsOut = [];
    this.dealQueue = [];   // [{target:'dealer'|'seat', seat?, hidden?}] — cards drawn on RELEASE
  }

  /* ---------- events ---------- */
  _emit(e) { this.eventsOut.push(e); }
  drainEvents() { const ev = this.eventsOut; this.eventsOut = []; return ev; }

  /* ---------- shoe (rebuilt every round via SHUFFLE; can never exhaust mid-round) ---------- */
  buildShoe() {
    const shoe = [];
    for (let d = 0; d < this.decksCount; d++)
      for (const suit of SUITS)
        for (const rank of RANKS)
          shoe.push({ rank, suit });
    for (let i = shoe.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }
    this.deck = shoe;
  }
  drawCard() {
    if (!this.deck.length) this.buildShoe(); // safety net
    const c = this.deck.pop();
    return { ...c, uid: `r${this.round}-${this._roundCardCount++}` };
  }

  /* ---------- rules ---------- */
  dealerShouldHit(cards) {
    const { total, soft } = handValue(cards);
    if (total < 17) return true;
    return total === 17 && soft && this.hitSoft17;
  }

  /* ---------- round lifecycle ---------- */
  startBetting() {
    this.round++;
    this.buildShoe();
    this._emit({ t: 'SHUFFLE', round: this.round });
    this._roundCardCount = 0;
    this.phase = 'BETTING';
    this.dealQueue = [];
    this.dealer = { cards: [], revealed: false };
    for (const s of this.seats) {
      if (s.balance < this.minBet) s.balance += 200; // broke seats get a fresh rail each new game — no persistence, nothing to store
      s.bet = 0; s.hands = []; s.activeHand = 0; s.done = true;
      s.outcome = null; s.payout = 0;
    }
    this.turnSeat = -1;
    this._emit({ t: 'PHASE', phase: 'BETTING', round: this.round });
  }

  placeBet(seatId, amount) {
    const s = this.seat(seatId);
    if (!s) return { ok: false, why: 'NO_SEAT' };
    if (this.phase !== 'BETTING') return { ok: false, why: 'WRONG_PHASE' };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, why: 'BAD_AMOUNT' };
    amount = Math.round(amount);
    if (amount < this.minBet) return { ok: false, why: 'BELOW_MIN' };
    const committed = s.bet; // already deducted; available = balance + committed
    if (amount > s.balance + committed) return { ok: false, why: 'INSUFFICIENT' };
    s.balance += committed;            // pull old chips back to rail
    s.bet = amount;                    // set new bet
    s.balance -= amount;               // push chips into the circle
    this._emit({ t: 'BET_PLACED', seat: s.seat, amount });
    return { ok: true, amount };
  }

  /** Pull an un-dealt bet fully back to the rail (UI CLEAR). */
  resetBet(seatId) {
    const s = this.seat(seatId);
    if (!s || this.phase !== 'BETTING') return { ok: false };
    s.balance += s.bet; s.bet = 0;
    this._emit({ t: 'BET_CLEARED', seat: s.seat });
    return { ok: true };
  }

  /** Any committed bet starts the round; no-bet seats sit it out. */
  beginDealing() {
    if (this.phase !== 'BETTING') return { ok: false, why: 'WRONG_PHASE' };
    const active = this.seats.filter(s => s.bet >= this.minBet);
    if (!active.length) return { ok: false, why: 'NO_BETS' };
    for (const s of active) { s.done = false; s.activeHand = 0; s.hands = [{ cards: [], status: 'PLAY', bet: s.bet, doubled: false }]; }
    for (const s of this.seats) if (s.bet < this.minBet) { s.done = true; s.hands = []; }
    this.phase = 'DEALING';
    this._emit({ t: 'PHASE', phase: 'DEALING', round: this.round });
    // Classic casino deal, one card at a time: dealer upcard first, then each
    // active seat, then the dealer hole card, then second cards around the table.
    // 2 seats -> D, P0, D?, P1 ; 1 seat -> D, P0, D?, P0.
    // Cards are drawn only when released in tick(), never at queue-build time.
    const order = [{ target: 'dealer' }];
    for (const s of active) order.push({ target: 'seat', seat: s.seat });
    order.push({ target: 'dealer', hidden: true });
    for (const s of active) order.push({ target: 'seat', seat: s.seat });
    this.dealQueue = order;
    return { ok: true };
  }

  /** Release exactly ONE queued card per call (~every 380ms while DEALING). */
  tick() {
    if (this.phase !== 'DEALING') return false;
    while (this.dealQueue.length) {
      const o = this.dealQueue[0];
      if (o.target === 'dealer') {
        this.dealQueue.shift();
        const card = this.drawCard();
        this.dealer.cards.push(card);
        this._emit({ t: 'DEAL_CARD', to: 'dealer', card, hidden: !!o.hidden });
        break; // one card per pacing interval
      }
      const s = this.seat(o.seat); // numeric seat index
      if (s && !s.done && s.hands[0]) { // recipient still live & invested
        this.dealQueue.shift();
        const card = this.drawCard();
        s.hands[0].cards.push(card);
        this._emit({ t: 'DEAL_CARD', to: 'seat', seat: o.seat, hand: 0, card });
        break;
      }
      // departed/no-bet slot: drop it without burning a card
      this.dealQueue.shift();
    }
    if (!this.dealQueue.length) this._afterDeal();
    return true;
  }

  _afterDeal() {
    const bjSeats = this.seats.filter(s => !s.done && s.hands[0] && isBlackjack(s.hands[0]));
    const dv = handValue(this.dealer.cards);
    const dealerBJ = isBlackjack(this.dealer.cards);
    for (const s of bjSeats) s.done = true;
    if (bjSeats.length || dealerBJ) {
      this._revealDealer();
      if (dealerBJ) return this.resolve();           // dealer BJ beats non-BJs, pushes BJs
      if (!this.seats.some(s => !s.done)) return this.resolve();
    }
    const live = this.seats.filter(s => !s.done && s.hands.length);
    if (!live.length) return this.resolve();
    this.phase = 'PLAYER_TURN';
    this.turnSeat = live[0].seat;
    this._emit({ t: 'PHASE', phase: 'PLAYER_TURN', turn: this.turnSeat });
    this._emit({ t: 'TURN_CHANGED', turn: this.turnSeat });
  }

  /** Lookup by player id OR by seat index (numeric). */
  seat(idOrIndex) {
    if (typeof idOrIndex === 'number') return this.seats.find(s => s.seat === idOrIndex);
    return this.seats.find(s => String(s.id) === String(idOrIndex));
  }
  _myActive(seatId) {
    if (typeof seatId === 'number' || seatId == null || String(seatId).trim() === '') return null; // reject bad/empty ids
    const s = this.seat(seatId);
    if (!s || this.phase !== 'PLAYER_TURN' || s.done || s.seat !== this.turnSeat) return null;
    while (s.activeHand > 0 && s.activeHand >= s.hands.length) s.activeHand = s.hands.length - 1;
    if (s.hands[s.activeHand] && s.hands[s.activeHand].status !== 'PLAY') {
      const idx = s.hands.findIndex(h => h.status === 'PLAY');
      if (idx === -1) return null;
      s.activeHand = idx;
    }
    return s;
  }

  canDouble(s) {
    const hand = s.hands[s.activeHand];
    return !!(hand && hand.cards.length === 2 && !hand.doubled && s.balance >= hand.bet && hand.status === 'PLAY');
  }
  canSplit(s) {
    const hand = s.hands[s.activeHand];
    return !!(hand && hand.cards.length === 2
      && cardValue(hand.cards[0].rank) === cardValue(hand.cards[1].rank)
      && s.hands.length < 4 && s.balance >= hand.bet && hand.status === 'PLAY');
  }

  /** Legal actions for UI enablement (server still validates everything). */
  legalActions(seatId) {
    const s = this._myActive(seatId);
    if (!s) return { hit: false, stand: false, dbl: false, split: false };
    return { hit: true, stand: true, dbl: this.canDouble(s), split: this.canSplit(s) };
  }

  /** Server-validated action entry point. */
  act(seatId, action) {
    const s = this._myActive(seatId);
    if (!s) return { ok: false, why: 'NOT_YOUR_TURN' };
    const h = s.activeHand;
    const hand = s.hands[h];
    switch (action) {
      case 'HIT': {
        const card = this.drawCard();
        hand.cards.push(card);
        this._emit({ t: 'DEAL_CARD', to: 'seat', seat: s.seat, hand: h, card });
        const v = handValue(hand.cards);
        if (v.total > 21) {
          hand.status = 'BUST';
          this._emit({ t: 'HAND_BUST', seat: s.seat, hand: h, total: v.total });
          this._advanceTurn();
        } else if (v.total === 21) {
          hand.status = 'STAND';
          this._emit({ t: 'HAND_STOOD', seat: s.seat, hand: h });
          this._advanceTurn();
        }
        return { ok: true };
      }
      case 'STAND': {
        hand.status = 'STAND';
        this._emit({ t: 'HAND_STOOD', seat: s.seat, hand: h });
        this._advanceTurn();
        return { ok: true };
      }
      case 'DOUBLE': {
        if (!this.canDouble(s)) return { ok: false, why: 'CANNOT_DOUBLE' };
        hand.doubled = true;
        s.balance -= hand.bet;   // extra chips into the circle
        hand.bet *= 2;
        s.bet = s.hands.reduce((a, x) => a + x.bet, 0);
        this._emit({ t: 'DOUBLED', seat: s.seat, hand: h, bet: hand.bet });
        const card = this.drawCard();
        hand.cards.push(card);
        this._emit({ t: 'DEAL_CARD', to: 'seat', seat: s.seat, hand: h, card });
        const v = handValue(hand.cards);
        if (v.total > 21) { hand.status = 'BUST'; this._emit({ t: 'HAND_BUST', seat: s.seat, hand: h, total: v.total }); }
        else hand.status = 'STAND';
        this._advanceTurn();
        return { ok: true };
      }
      case 'SPLIT': {
        if (!this.canSplit(s)) return { ok: false, why: 'CANNOT_SPLIT' };
        const [c1, c2] = hand.cards;
        hand.cards = [c1];
        const nh = { cards: [c2], status: 'PLAY', bet: hand.bet, doubled: false };
        s.hands.splice(h + 1, 0, nh);
        s.balance -= hand.bet; // second circle
        s.bet = s.hands.reduce((a, x) => a + x.bet, 0);
        this._emit({ t: 'SPLIT', seat: s.seat, hand: h });
        const a = this.drawCard(); hand.cards.push(a);
        this._emit({ t: 'DEAL_CARD', to: 'seat', seat: s.seat, hand: h, card: a });
        const b = this.drawCard(); nh.cards.push(b);
        this._emit({ t: 'DEAL_CARD', to: 'seat', seat: s.seat, hand: h + 1, card: b });
        if (hand.cards[0].rank === 'A' && nh.cards[0].rank === 'A') {
          hand.status = 'STAND'; nh.status = 'STAND';
          hand.splitFromAce = nh.splitFromAce = true;
          this._advanceTurn();
        }
        return { ok: true };
      }
      default: return { ok: false, why: 'UNKNOWN_ACTION' };
    }
  }

  _advanceTurn() {
    const s = this.seat(this.turnSeat);
    if (s && s.hands.some(x => x.status === 'PLAY')) {
      s.activeHand = s.hands.findIndex(x => x.status === 'PLAY');
      this._emit({ t: 'HAND_CHANGED', seat: s.seat, hand: s.activeHand });
      return; // more split hands to play
    }
    if (s) s.done = true;
    const next = this.seats.find(x => !x.done && x.seat > this.turnSeat);
    if (next) {
      this.turnSeat = next.seat;
      next.activeHand = 0;
      this._emit({ t: 'TURN_CHANGED', turn: this.turnSeat });
    } else {
      this._startDealer();
    }
  }

  _startDealer() {
    this.phase = 'DEALER_TURN';
    this.turnSeat = -1;
    this._emit({ t: 'PHASE', phase: 'DEALER_TURN' });
    this._revealDealer();
    // Do NOT draw here: the first dealer hit (if any) is paced via dealerTick().
  }

  _revealDealer() {
    if (this.dealer.cards.length > 1 && !this.dealer.revealed) {
      this.dealer.revealed = true;
      this._emit({ t: 'DEALER_REVEAL', card: this.dealer.cards[1] });
    }
  }

  /** Paced continuation for the server loop / tests: releases ONE dealer card
   *  per call while DEALER_TURN; resolves automatically once the dealer stands. */
  dealerTick() {
    if (this.phase !== 'DEALER_TURN') return false;
    if (!this.dealerShouldHit(this.dealer.cards)) { this.resolve(); return true; }
    const card = this.drawCard();
    this.dealer.cards.push(card);
    this._emit({ t: 'DEAL_CARD', to: 'dealer', card });
    if (!this.dealerShouldHit(this.dealer.cards)) this.resolve();
    return true;
  }

  /* ---------- resolution ---------- */
  resolve() {
    if (this.phase === 'RESULT') return this;
    this.phase = 'RESULT';
    this._revealDealer();

    const dv = handValue(this.dealer.cards);
    const dealerBJ = isBlackjack(this.dealer.cards);
    const dealerBust = dv.total > 21;
    const results = [];
    for (const s of this.seats) {
      if (!s.hands.length) continue;
      const staked = s.hands.reduce((a, x) => a + x.bet, 0); // chips currently in the circle
      if (s.bet < this.minBet) { s.balance += staked; s.done = true; continue; } // sat out: return unposted chips
      // Money model: every staked chip has ALREADY left the rail when the bet
      // was placed (placeBet / DOUBLE / SPLIT). Here the house pays out each
      // hand independently — BLACKJACK 2.5x stake, WIN/PUSH 1x, LOSE/BUST 0 —
      // so payouts can never go negative and chips are conserved exactly:
      //   invariant during a round: balance + Σ hand bets === start-of-round balance
      //   invariant at resolution : payout === Σ per-hand returns, balance === pre-bet + payout
      let net = 0;
      const outs = [];
      for (const hd of s.hands) {
        const hv = handValue(hd.cards);
        const bj = isBlackjack(hd) && !hd.splitFromAce;
        let outcome, ret; // ret = total chips returned to the rail for this hand
        if (hd.status === 'BUST') { outcome = 'LOSE'; ret = 0; }
        else if (bj && !dealerBJ) { outcome = 'BLACKJACK'; ret = Math.round(hd.bet * 2.5); }
        else if (bj && dealerBJ) { outcome = 'PUSH'; ret = hd.bet; }
        else if (dealerBJ) { outcome = 'LOSE'; ret = 0; }
        else if (dealerBust || hv.total > dv.total) { outcome = 'WIN'; ret = hd.bet * 2; }
        else if (hv.total < dv.total) { outcome = 'LOSE'; ret = 0; }
        else { outcome = 'PUSH'; ret = hd.bet; }
        outs.push(outcome);
        net += ret;
      }
      s.balance += net;
      s.outcome = outs.length === 1 ? outs[0] : [...new Set(outs)].join('+');
      s.payout = net;
      s.done = true;
      results.push({ seat: s.seat, name: s.name, outcome: s.outcome, payout: net, balance: s.balance });
    }
    this._emit({
      t: 'ROUND_RESULT', round: this.round,
      dealer: { cards: this.dealer.cards, total: dv.total, bust: dealerBust, bj: dealerBJ },
      results,
    });
    return this;
  }

  /** Fast next-round: straight back to betting, no menus. Rail top-up happens in startBetting. */
  nextRound() {
    if (this.phase !== 'RESULT') return { ok: false, why: 'WRONG_PHASE' };
    this.startBetting();
    return { ok: true };
  }

  /* ---------- view model: THE single state shape used by local UI, tests, and network snapshots.
     Engine objects are never mutated by consumers; totals/statuses are derived server-side. */
  view() {
    const seatView = s => ({
      id: s.id, name: s.name, seat: s.seat, balance: s.balance, bet: s.bet,
      connected: s.connected, outcome: s.outcome, payout: s.payout, done: s.done,
      activeHand: s.activeHand,
      hands: s.hands.map((h, i) => {
        const v = handValue(h.cards);
        return {
          id: i, cards: h.cards.map(code), total: v.total, soft: v.soft,
          status: h.status, busted: h.status === 'BUST', doubled: !!h.doubled,
          blackjack: isBlackjack(h) && !h.splitFromAce, bet: h.bet,
          splitAcesDone: !!h.splitFromAce, done: h.status !== 'PLAY',
        };
      }),
    });

    return {
      phase: this.phase, round: this.round, turnSeat: this.turnSeat,
      minBet: this.minBet, unit: this.unit, deckLeft: this.deck.length,
      dealer: dealerView(this.dealer),
      seats: this.seats.map(seatView),
    };
  }

  /* ---------- snapshot for network ---------- */
  snapshot(seatId) {
    const me = this.seat(seatId);
    const v = this.view();
    v.you = me ? me.seat : -1;
    return v;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BlackjackEngine, handValue, isBlackjack, cardValue, makeRng, SUITS, RANKS, PHASES, code };
}
