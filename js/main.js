'use strict';
/* ============================================================
   Blackjack — single player. The engine is the sole authority;
   this loop only paces events and hands them to the UI to animate.
   No persistence: every page load starts a fresh 500-chip rail.
   ============================================================ */
const DEAL_MS = 380, DEALER_MS = 620, RESULT_HOLD_MS = 1400;

class Game {
  constructor() {
    this.engine = new BlackjackEngine({
      seats: [{ id: 'you', name: 'You', balance: 500 }],
      decks: 6, minBet: 10, unit: 10, hitSoft17: false,
    });
    this.myId = 'you';
    this.timer = null;
    this.pendingBet = 0;
    this.engine.startBetting();
    UI.bind(this);          // wires buttons + chip rack (rack calls game.addChip)
    this.pump(false);       // SHUFFLE event clears table & creates total chips
    this.pump(false);       // PHASE:BETTING -> status + controls
  }

  /* drain engine events -> UI animations, then schedule next paced step */
  pump(animate = true) {
    const evs = this.engine.drainEvents();
    for (const e of evs) UI.onEvent(e, animate);
    UI.setState(this.engine.view(), this.myId);
    clearTimeout(this.timer);
    const ph = this.engine.phase;
    if (ph === 'DEALING') this.timer = setTimeout(() => { this.engine.tick(); this.pump(); }, DEAL_MS);
    else if (ph === 'DEALER_TURN') this.timer = setTimeout(() => { this.engine.dealerTick(); this.pump(); }, DEALER_MS);
    else if (ph === 'RESULT') this.timer = setTimeout(() => this.nextRound(), RESULT_HOLD_MS);
  }

  addChip(v) {
    const s = this.engine.seat(this.myId);
    let target = this.pendingBet + v;
    const cap = s.balance + s.bet;          // rail + already-committed chips
    if (target > cap) target = cap;         // clamp to what the player actually has
    if (target < this.engine.minBet) target = this.engine.minBet; // first chip meets table minimum
    const r = this.engine.placeBet(this.myId, target);
    if (r.ok) { this.pendingBet = r.amount; UI.chipFly(v); }
    else UI.toast(r.why === 'INSUFFICIENT' ? 'Not enough chips for that.' : "Can't add that chip.");
    UI.setBetReadout(this.pendingBet);
  }
  clearBet() {
    this.engine.resetBet(this.myId);
    this.pendingBet = 0; UI.setBetReadout(0); UI.clearRing();
  }
  allIn() {
    const s = this.engine.seat(this.myId);
    const total = s.balance + s.bet;
    if (total < this.engine.minBet) return UI.toast('Not enough chips to go all-in.');
    const r = this.engine.placeBet(this.myId, total);
    if (r.ok) { this.pendingBet = total; UI.chipFly(total >= 500 ? 500 : total >= 250 ? 250 : total >= 100 ? 100 : 25); }
    UI.setBetReadout(this.pendingBet);
  }
  confirmDeal() {
    if (!this.pendingBet) return UI.toast('Place at least one chip first.');
    const r = this.engine.beginDealing();
    if (!r.ok) UI.toast('Place a bet first.');
    this.pendingBet = 0;
    this.pump();
  }
  act(a) {
    a = String(a).toUpperCase();           // UI sends lowercase shortcuts
    const r = this.engine.act(this.myId, a);
    if (!r.ok) UI.toast("You can't do that right now.");
    this.pump();
  }
  nextRound() { this.engine.nextRound(); this.pump(false); }
}

window.addEventListener('DOMContentLoaded', () => { window.game = new Game(); });
