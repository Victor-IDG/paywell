/* Paywell QA scenario suite.
   Every scenario is grounded in the actual UI of ../index.html.
   Assertions check BOTH visible UI and application state (window script-scope S).
   Synthetic data only: this validates the mock prototype, not a production backend. */

export const SEED = 20261024;

export const PERSONAS = {
  ada:  { id: 'ada',  name: 'Ada',  profile: 'Careful counter staff: checks the original attempt before any retry (improved flow discipline).' },
  ben:  { id: 'ben',  name: 'Ben',  profile: 'Hasty counter staff: retries as soon as the request appears to fail (baseline behaviour).' },
  cleo: { id: 'cleo', name: 'Cleo', profile: 'Support agent: works reconciliation exceptions and resolution reasons.' },
  dez:  { id: 'dez',  name: 'Dez',  profile: 'Adversarial operator: tries prohibited or repeated actions to expose rule violations.' },
  eve:  { id: 'eve',  name: 'Eve',  profile: 'Keyboard-only user: no pointer input, relies on focus and accessibility affordances.' },
  probe:{ id: 'probe',name: 'QA probe', profile: 'Tooling persona for acceptance probes. Not a product user. Intentionally failing assertions are excluded from product metrics.' }
};

/* ── helpers ─────────────────────────────────────────────── */
const H = {
  async h2(page) {
    const t = await page.locator('#screen h2').first().textContent().catch(() => null);
    return (t || '').trim();
  },
  async text(page, sel) {
    const t = await page.locator(sel).first().textContent().catch(() => null);
    return (t || '').trim();
  },
  act(page, action) {
    return page.locator('#screen button[data-action="' + action + '"]').first().click({ timeout: 4000 });
  },
  async state(page) {
    return page.evaluate(() => JSON.parse(JSON.stringify({
      flow: S.flow, screen: S.screen, orderIdx: S.orderIdx, orderState: S.orderState,
      attempt: S.attempt, chargeable: S.chargeable, dupBlocks: S.dupBlocks,
      checkIdx: S.checkIdx, exceptions: S.exceptions
    })));
  },
  async waitH2(page, text, timeout) {
    await page.locator('#screen h2', { hasText: text }).first().waitFor({ state: 'visible', timeout: timeout || 6000 });
  },
  async toast(page) {
    await page.waitForTimeout(120);
    return H.text(page, '#toast');
  },
  eq(actual, expected) {
    if (actual !== expected) throw new Error('expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  },
  async true_(fn, msg) {
    const ok = await fn();
    if (!ok) throw new Error(msg || 'condition false');
  }
};

function tape() {
  const items = [];
  return {
    items,
    async check(name, fn) {
      try { const d = await fn(); items.push({ name, ok: true, detail: typeof d === 'string' ? d : undefined }); }
      catch (e) { items.push({ name, ok: false, detail: e.message }); }
    }
  };
}

async function toMode(page, mode) {
  if (mode === 'before') {
    await page.click('#beforeTab');
    await H.true_(async () => (await H.state(page)).flow === 'before', 'flow did not switch to before');
  } else {
    await H.true_(async () => (await H.state(page)).flow === 'after', 'flow is not after');
  }
}

/* Travel: order-1 paid with settlement exception (After). */
async function paidJourney(page, tape_) {
  await H.act(page, 'start');
  await H.waitH2(page, 'Still confirming');
  await tape_.check('timeout screen keeps attempt unknown', async () => {
    const s = await H.state(page);
    H.eq(s.attempt.state, 'unknown'); H.eq(s.orderState, 'payment_pending'); H.eq(s.chargeable, 1);
  });
  await H.act(page, 'check');
  await H.waitH2(page, 'Still waiting');
  await H.act(page, 'check');
  await H.waitH2(page, 'Payment completed');
}

/* Each execution runs on a fresh page (customer 1, clean counters), so scenarios that
   need customer 2/3 drive the queue themselves instead of assuming leftover UI state. */
async function toCustomer2(page, t) {
  await paidJourney(page, t);
  await H.act(page, 'next');
  await page.locator('#orderMeta', { hasText: 'Customer 2 of 3 · ORD-2026-1043' }).first().waitFor({ timeout: 3000 });
}

async function toCustomer3(page, t) {
  await paidJourney(page, t);
  await H.act(page, 'next');
  await page.locator('#orderMeta', { hasText: 'Customer 2 of 3 · ORD-2026-1043' }).first().waitFor({ timeout: 3000 });
  await H.act(page, 'start');
  await H.waitH2(page, 'Still confirming');
  await H.act(page, 'check');
  await H.waitH2(page, 'Still waiting');
  await H.act(page, 'check');
  await H.waitH2(page, 'Payment failed');
  // The failed result has no "next" control; the support handoff screen does.
  // Advancing there keeps queue progress without creating another chargeable attempt.
  await H.act(page, 'support');
  await H.waitH2(page, 'We can trace this payment');
  await H.act(page, 'next');
  await page.locator('#orderMeta', { hasText: 'Customer 3 of 3 · ORD-2026-1044' }).first().waitFor({ timeout: 3000 });
}

/* ── suite ───────────────────────────────────────────────── */
export const SCENARIOS = [
  {
    id: 'H01', title: 'Improved flow: timeout then confirmed paid via original reference',
    category: 'happy-path', severity: 'critical', modes: ['after'], persona: 'ada',
    metric: 'task_completion',
    expected: 'Timeout shows "Still confirming" (never Failed); two status checks on the SAME attempt end paid; order becomes paid with only 1 chargeable attempt; settlement exception opens.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await H.act(page, 'start');
      await t.check('UI: timeout screen is "Still confirming this payment"', async () => {
        const h = await H.h2(page); H.eq(h, 'Still confirming this payment');
      });
      await t.check('State A (rule A): attempt unknown, order payment_pending after timeout', async () => {
        const s = await H.state(page);
        H.eq(s.attempt.state, 'unknown'); H.eq(s.orderState, 'payment_pending');
      });
      const id1 = (await H.state(page)).attempt.id;
      await H.act(page, 'check');
      await H.waitH2(page, 'Still waiting');
      await t.check('Rule C: pending result creates no new chargeable attempt', async () => {
        const s = await H.state(page);
        H.eq(s.chargeable, 1); H.eq(s.attempt.state, 'unknown');
      });
      await H.act(page, 'check');
      await H.waitH2(page, 'Payment completed');
      await t.check('Rule B: same attempt ID used for both checks (' + id1 + ')', async () => {
        const s = await H.state(page); H.eq(s.attempt.id, id1);
      });
      await t.check('Rule D: paid with exactly 1 chargeable attempt', async () => {
        const s = await H.state(page);
        H.eq(s.orderState, 'paid'); H.eq(s.attempt.state, 'confirmed_paid'); H.eq(s.chargeable, 1);
      });
      await t.check('Rule 5: settlement exception opened, not silently resolved', async () => {
        const s = await H.state(page);
        H.eq(s.exceptions.length, 1); H.eq(s.exceptions[0].type, 'Settlement record missing'); H.eq(s.exceptions[0].status, 'open');
      });
      await t.check('UI: paid result offers Next customer', async () => {
        await page.locator('#screen button[data-action="next"]').first().waitFor({ timeout: 2000 });
      });
      t.measurements = { dupAttemptPrevented: null, taskCompleted: true, recoverySuccess: null, terminalCorrect: true };
      t.observations = [];
    }
  },
  {
    id: 'H02', title: 'Improved flow: confirmed failure unlocks exactly one safe retry',
    category: 'happy-path', severity: 'critical', modes: ['after'], persona: 'ada',
    metric: 'recovery_success',
    expected: 'Customer 2 (reached from a fresh page via the customer-1 paid setup): pending → confirmed failed on the original attempt → exactly one new chargeable attempt allowed → paid on attempt 2 (PAY-1043-02); status checks never change the chargeable count.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await toCustomer2(page, t);
      const c0 = (await H.state(page)).chargeable;
      await t.check('Queue advanced to customer 2 of 3', async () => {
        H.eq(await H.text(page, '#orderMeta'), 'Customer 2 of 3 · ORD-2026-1043');
      });
      await H.act(page, 'start');
      await H.waitH2(page, 'Still confirming');
      const id1 = (await H.state(page)).attempt.id;
      await t.check('Attempt 1 on customer 2 creates exactly one chargeable attempt (' + id1 + ')', async () => {
        H.eq(id1, 'PAY-1043-01');
        H.eq((await H.state(page)).chargeable, c0 + 1);
      });
      await H.act(page, 'check');
      await H.waitH2(page, 'Still waiting');
      await H.act(page, 'check');
      await H.waitH2(page, 'Payment failed');
      await t.check('Rule A/E: failure shown only after confirmation; retry offered; checks added no chargeable attempt', async () => {
        const s = await H.state(page);
        H.eq(s.attempt.state, 'confirmed_failed'); H.eq(s.orderState, 'payment_failed');
        H.eq(s.chargeable, c0 + 1);
        await page.locator('#screen button[data-action="start"]').first().waitFor({ timeout: 2000 });
      });
      await H.act(page, 'start');
      await H.waitH2(page, 'Still confirming');
      await t.check('Rule 4: exactly one new chargeable attempt after confirmed failure; new attempt ID (PAY-1043-02)', async () => {
        const s = await H.state(page);
        if (s.attempt.id === id1) throw new Error('attempt ID reused: ' + id1);
        H.eq(s.attempt.id, 'PAY-1043-02'); H.eq(s.chargeable, c0 + 2);
      });
      await H.act(page, 'check');
      await H.waitH2(page, 'Payment completed');
      await t.check('Recovery completes paid on attempt 2 with no further chargeable attempts', async () => {
        const s = await H.state(page);
        H.eq(s.attempt.state, 'confirmed_paid'); H.eq(s.orderState, 'paid'); H.eq(s.chargeable, c0 + 2);
      });
      t.measurements = { dupAttemptPrevented: null, taskCompleted: true, recoverySuccess: true, terminalCorrect: true };
      t.observations = ['chargeable is a session-wide counter: the customer-1 paid setup contributes ' + c0 + ' before customer 2 begins.'];
    }
  },
  {
    id: 'H03', title: 'Baseline flow: timeout pushed as failure, blind retry creates 2nd charge',
    category: 'baseline', severity: 'major', modes: ['before'], persona: 'ben',
    metric: 'dup_prevention',
    expected: 'Documented baseline defect: timeout UI says "Payment didn\u2019t go through" and offers retry without checking the original attempt; confirming creates a second chargeable attempt (PAY-1042-02). PASS means the baseline behaved as documented; the duplicate-prevention metric counts this as NOT prevented.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await H.act(page, 'start');
      await t.check('UI: baseline timeout copy "Payment didn\u2019t go through"', async () => {
        H.eq(await H.h2(page), 'Payment didn\u2019t go through');
      });
      await t.check('Observation-backed: model attempt is still unknown while UI pushes retry', async () => {
        const s = await H.state(page);
        H.eq(s.attempt.state, 'unknown');
        await page.locator('#screen button[data-action="retry"]').first().waitFor({ timeout: 2000 });
      });
      await H.act(page, 'retry');
      await H.waitH2(page, 'Submit payment again');
      await H.act(page, 'duplicate');
      await H.waitH2(page, 'Two charges may exist');
      await t.check('Baseline defect reproduced: second chargeable attempt created', async () => {
        const s = await H.state(page);
        H.eq(s.chargeable, 2);
        H.eq(s.attempt.id, 'PAY-1042-02');
      });
      t.measurements = { dupAttemptPrevented: false, taskCompleted: true, recoverySuccess: null, terminalCorrect: null };
      t.observations = ['Baseline treats an unknown outcome as failure in copy while state stays unknown; the retry path creates a second chargeable attempt with no status check.'];
    }
  },
  {
    id: 'R01', title: 'Adversarial: retry attempt while original is pending is blocked',
    category: 'rule-safety', severity: 'critical', modes: ['after'], persona: 'dez',
    metric: 'rule_safety',
    expected: 'Tapping "Take payment" while an attempt is unresolved shows the blocked screen; no second chargeable attempt is created; attempt ID unchanged.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await H.act(page, 'start');
      await H.waitH2(page, 'Still confirming');
      const id1 = (await H.state(page)).attempt.id;
      await H.act(page, 'home');
      await t.check('Checkout shows pending notice, not a fresh start', async () => {
        const h = await H.h2(page); H.eq(h, 'Collect payment');
        await page.locator('#screen .notice.warn', { hasText: 'Payment pending' }).first().waitFor({ timeout: 2000 });
      });
      await H.act(page, 'start'); // "Take payment" while pending
      await H.waitH2(page, 'New charge prevented');
      await t.check('Rule D/4: blocked screen shown, dupBlocks incremented', async () => {
        const s = await H.state(page);
        H.eq(s.screen, 'blocked'); H.eq(s.dupBlocks, 1);
      });
      await t.check('No second chargeable attempt; original ID ' + id1 + ' preserved', async () => {
        const s = await H.state(page);
        H.eq(s.chargeable, 1); H.eq(s.attempt.id, id1); H.eq(s.attempt.state, 'unknown');
      });
      t.measurements = { dupAttemptPrevented: true, taskCompleted: null, recoverySuccess: null, terminalCorrect: null };
      t.observations = [];
    }
  },
  {
    id: 'R02', title: 'Adversarial: start a charge on an already-paid order (UI + direct call)',
    category: 'adversarial', severity: 'critical', modes: ['after'], persona: 'dez',
    metric: 'rule_safety',
    expected: 'Paid checkout exposes no start-payment control; a direct startPayment() call is refused by the model guard; chargeable stays 1.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await paidJourney(page, t);
      await H.act(page, 'next'); // -> back to checkout? next advances queue; use back path instead
      // Return to checkout for the paid order via back buttons
      await page.locator('#screen h2').first().waitFor({ timeout: 2000 });
      // We are now on customer 2 checkout; go back is not available. Reset to paid order state:
      // Instead: navigate from result (paid) -> back to details -> checkout before pressing next.
      // (This branch is unreachable; kept linear below.)
      await t.check('placeholder', async () => { throw new Error('unreachable'); });
    }
  },
  {
    id: 'R03', title: 'Repeated status checks on an unresolved outcome stay pending and stable',
    category: 'repeat', severity: 'major', modes: ['after'], persona: 'ada',
    metric: 'rule_safety',
    expected: 'Customer 3 (reached from a fresh page via paid customer 1 + confirmed-failed customer 2): two checks stay pending and open exactly one unresolved exception; a third check changes nothing (same ID, no new chargeable attempt, no duplicate exception).',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await toCustomer3(page, t);
      await t.check('Queue at customer 3 of 3', async () => {
        H.eq(await H.text(page, '#orderMeta'), 'Customer 3 of 3 · ORD-2026-1044');
      });
      await H.act(page, 'start');
      await H.waitH2(page, 'Still confirming');
      const s0 = await H.state(page);
      const id1 = s0.attempt.id, c1 = s0.chargeable;
      await H.act(page, 'check');
      await H.waitH2(page, 'Still waiting');
      await H.act(page, 'check');
      await H.waitH2(page, 'Still waiting');
      await t.check('Rule 6: exactly one unresolved exception; checks created no chargeable attempt', async () => {
        const s = await H.state(page);
        const u = s.exceptions.filter(e => e.type === 'Unresolved payment outcome');
        H.eq(u.length, 1); H.eq(u[0].status, 'open');
        H.eq(s.chargeable, c1);
      });
      await H.act(page, 'check');
      await H.waitH2(page, 'Still waiting');
      await t.check('Third check: same ID, chargeable unchanged, no duplicate unresolved exception', async () => {
        const s = await H.state(page);
        H.eq(s.attempt.id, id1); H.eq(s.chargeable, c1);
        H.eq(s.exceptions.filter(e => e.type === 'Unresolved payment outcome').length, 1);
        H.eq(s.attempt.state, 'unknown'); H.eq(s.orderState, 'payment_pending');
      });
      t.measurements = { dupAttemptPrevented: true, taskCompleted: null, recoverySuccess: null, terminalCorrect: null };
      t.observations = ['Session chargeable counter is cumulative across customers (' + c1 + ' after the customer-3 start); the safety invariant tested is that status checks never increase it.'];
    }
  },
  {
    id: 'V01', title: 'Reconciliation: silent resolution (whitespace reason) is refused',
    category: 'validation', severity: 'critical', modes: ['after'], persona: 'cleo',
    metric: 'rule_safety',
    expected: 'Resolving a settlement exception with only whitespace is refused with a toast; exception stays Open in UI and state.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await paidJourney(page, t);
      await page.click('#opsBtn');
      await t.check('Sheet opens with the settlement exception', async () => {
        await page.locator('#opsSheet.open .exc', { hasText: 'Settlement record missing' }).first().waitFor({ timeout: 2000 });
      });
      await page.locator('.exc [data-exc-resolve]').first().click();
      await page.locator('.resolve-row input').first().fill('   ');
      await page.locator('.exc [data-exc-confirm]').first().click();
      await t.check('UI: refusal toast shown', async () => {
        const msg = await H.toast(page);
        if (!msg.includes('A resolution reason is required')) throw new Error('toast was: ' + JSON.stringify(msg));
      });
      await t.check('Rule G: exception remains open in state', async () => {
        const s = await H.state(page);
        H.eq(s.exceptions[0].status, 'open'); H.eq(s.exceptions[0].reason, null);
      });
      await t.check('UI: status pill still "Open"', async () => {
        const pill = await H.text(page, '.exc .status-pill');
        H.eq(pill, 'Open');
      });
      t.measurements = { dupAttemptPrevented: null, taskCompleted: null, recoverySuccess: null, terminalCorrect: null };
      t.observations = [];
    }
  },
  {
    id: 'V02', title: 'Reconciliation: review then resolve with a documented reason',
    category: 'validation', severity: 'critical', modes: ['after'], persona: 'cleo',
    metric: 'task_completion',
    expected: 'Exception moves open → in_review → resolved only with a written reason; reason is persisted and displayed.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await paidJourney(page, t);
      await page.click('#opsBtn');
      await page.locator('.exc [data-exc-review]').first().click();
      await t.check('Review transition recorded', async () => {
        const s = await H.state(page); H.eq(s.exceptions[0].status, 'in_review');
        const pill = await H.text(page, '.exc .status-pill'); H.eq(pill, 'In review');
      });
      await page.locator('.exc [data-exc-resolve]').first().click();
      await page.locator('.resolve-row input').first().fill('Bank settlement file BNF-7741 matched the attempt reference.');
      await page.locator('.exc [data-exc-confirm]').first().click();
      await t.check('Resolved with reason persisted and shown', async () => {
        const s = await H.state(page);
        H.eq(s.exceptions[0].status, 'resolved');
        if (!s.exceptions[0].reason.includes('BNF-7741')) throw new Error('reason not persisted');
        const shown = await H.text(page, '.exc-reason');
        if (!shown.includes('BNF-7741')) throw new Error('reason not displayed');
        const pill = await H.text(page, '.exc .status-pill'); H.eq(pill, 'Resolved');
      });
      t.measurements = { dupAttemptPrevented: null, taskCompleted: true, recoverySuccess: null, terminalCorrect: null };
      t.observations = [];
    }
  },
  {
    id: 'N01', title: 'Mode switch preserves each flow\u2019s own state',
    category: 'navigation', severity: 'major', modes: ['after'], persona: 'ada',
    metric: 'regression',
    expected: 'After blocked state (dupBlocks=1) survives a round-trip through the Before tab and back.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await H.act(page, 'start');
      await H.waitH2(page, 'Still confirming');
      await H.act(page, 'home');
      await H.act(page, 'start'); // take payment while pending
      await H.waitH2(page, 'New charge prevented');
      await page.click('#beforeTab');
      await t.check('Before tab active with its own fresh checkout state', async () => {
        const s = await H.state(page);
        H.eq(s.flow, 'before'); H.eq(s.screen, 'checkout');
        const sel = await page.getAttribute('#beforeTab', 'aria-selected'); H.eq(sel, 'true');
      });
      await page.click('#afterTab');
      await t.check('After state intact: blocked screen, dupBlocks=1, ops control visible', async () => {
        const s = await H.state(page);
        H.eq(s.flow, 'after'); H.eq(s.screen, 'blocked'); H.eq(s.dupBlocks, 1);
        H.eq(await page.locator('#opsBtn').isHidden(), false);
      });
      t.measurements = { dupAttemptPrevented: true, taskCompleted: null, recoverySuccess: null, terminalCorrect: null };
      t.observations = [];
    }
  },
  {
    id: 'N02', title: 'Reset restores the documented initial state',
    category: 'regression', severity: 'critical', modes: ['after', 'before'], persona: 'ada',
    metric: 'rule_safety',
    expected: 'After starting a payment, "Start over" returns checkout, order 1 of 3, no attempt, chargeable 0, state awaiting_payment.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await H.act(page, 'start');
      await H.waitH2(page, mode === 'before' ? 'Payment didn\u2019t go through' : 'Still confirming');
      await page.click('#resetBtn');
      await t.check('Screen back to checkout', async () => {
        const s = await H.state(page); H.eq(s.screen, 'checkout');
      });
      await t.check('Counters/state restored', async () => {
        const s = await H.state(page);
        H.eq(s.orderIdx, 0); H.eq(s.attempt, null); H.eq(s.chargeable, 0);
        H.eq(s.orderState, 'awaiting_payment'); H.eq(s.flow, mode);
      });
      await t.check('Order meta shows customer 1 of 3', async () => {
        H.eq(await H.text(page, '#orderMeta'), 'Customer 1 of 3 · ORD-2026-1042');
      });
      t.measurements = { dupAttemptPrevented: null, taskCompleted: null, recoverySuccess: null, terminalCorrect: null };
      t.observations = [];
    }
  },
  {
    id: 'N03', title: 'Adversarial: navigate back while a status check is in flight',
    category: 'adversarial', severity: 'minor', modes: ['after'], persona: 'dez',
    metric: 'rule_safety',
    expected: 'Safety: whatever the user does mid-check, no charge is created and the attempt is never pushed to a terminal state by navigation. (Screen-level behaviour is recorded as an observation, not asserted: the guide defines no rule for mid-check navigation.)',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await H.act(page, 'start');
      await H.waitH2(page, 'Still confirming');
      const id1 = (await H.state(page)).attempt.id;
      await H.act(page, 'check');
      await t.check('Checking screen visible with original reference', async () => {
        H.eq(await H.h2(page), 'Checking the original attempt');
        const sub = await H.text(page, '#screen .subcopy');
        if (!sub.includes(id1)) throw new Error('checking screen ref: ' + sub);
      });
      await H.act(page, 'timeout'); // "Back to payment details" during in-flight check
      await page.waitForTimeout(900); // let the pending 550ms timer fire
      await t.check('Safety holds after mid-check navigation', async () => {
        const s = await H.state(page);
        H.eq(s.chargeable, 1); H.eq(s.attempt.id, id1);
        H.eq(s.attempt.state, 'unknown'); H.eq(s.orderState, 'payment_pending');
      });
      const after = await H.state(page);
      t.observations = ['Observed: in-flight status check still applied after Back (screen ended at "' + after.screen + '"). State stayed safe (1 charge, attempt unknown). Recommendation: cancel or disable Back while checking.'];
      t.measurements = { dupAttemptPrevented: true, taskCompleted: null, recoverySuccess: null, terminalCorrect: null };
    }
  },
  {
    id: 'K01', title: 'Keyboard-only: reach and activate the primary action with visible focus',
    category: 'accessibility', severity: 'major', modes: ['after'], persona: 'eve',
    metric: 'accessibility',
    expected: 'Tab reaches "Start digital payment"; focus outline is visible; Enter starts the payment (timeout screen).',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      let found = null;
      for (let i = 0; i < 12 && !found; i++) {
        await page.keyboard.press('Tab');
        found = await page.evaluate(() => {
          const el = document.activeElement;
          return el && el.dataset && el.dataset.action === 'start' ? el.textContent.trim() : null;
        });
      }
      await t.check('Tab reaches the start control (' + JSON.stringify(found) + ')', async () => {
        if (!found) throw new Error('start button not reachable via Tab within 12 presses');
        if (!found.includes('Start digital payment')) throw new Error('focused: ' + found);
      });
      await t.check('Focus outline visible on keyboard focus', async () => {
        const w = await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth);
        if (!w || w === '0px') throw new Error('outline-width=' + w);
      });
      await page.keyboard.press('Enter');
      await t.check('Enter activates: timeout screen appears', async () => {
        await H.waitH2(page, 'Still confirming', 3000);
        const s = await H.state(page); H.eq(s.screen, 'timeout');
      });
      t.measurements = { dupAttemptPrevented: null, taskCompleted: true, recoverySuccess: null, terminalCorrect: null };
      t.observations = [];
    }
  },
  {
    id: 'K02', title: 'Keyboard: Escape closes the reconciliation dialog and returns focus',
    category: 'accessibility', severity: 'major', modes: ['after'], persona: 'eve',
    metric: 'accessibility',
    expected: 'Sheet opens as a modal dialog with focus inside; Escape closes it and focus returns to the Reconciliation button.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await paidJourney(page, t);
      await page.click('#opsBtn');
      await t.check('Dialog open with focus moved into it', async () => {
        await page.locator('#opsSheet.open').waitFor({ timeout: 2000 });
        const id = await page.evaluate(() => document.activeElement && document.activeElement.id);
        H.eq(id, 'opsClose');
      });
      await page.keyboard.press('Escape');
      await t.check('Escape closes dialog and restores focus to trigger', async () => {
        await page.waitForFunction(() => !document.getElementById('opsSheet').classList.contains('open'), null, { timeout: 2000 });
        const id = await page.evaluate(() => document.activeElement && document.activeElement.id);
        H.eq(id, 'opsBtn');
      });
      t.measurements = { dupAttemptPrevented: null, taskCompleted: null, recoverySuccess: null, terminalCorrect: null };
      t.observations = [];
    }
  },
  {
    id: 'T01', title: 'Rule A: timeout never renders or records a failed outcome',
    category: 'timeout', severity: 'critical', modes: ['after'], persona: 'ada',
    metric: 'terminal_state',
    expected: 'After a timeout the heading is uncertainty copy (not "Payment failed" / "didn\u2019t go through"), attempt stays unknown, order stays payment_pending, and no retry/duplicate control is offered.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await H.act(page, 'start');
      await t.check('Heading is "Still confirming this payment"', async () => {
        H.eq(await H.h2(page), 'Still confirming this payment');
      });
      await t.check('No failure copy and no retry/duplicate controls', async () => {
        const h = (await H.h2(page)).toLowerCase();
        if (h.includes('fail') || h.includes('didn')) throw new Error('failure copy: ' + h);
        H.eq(await page.locator('#screen button[data-action="retry"]').count(), 0);
        H.eq(await page.locator('#screen button[data-action="duplicate"]').count(), 0);
      });
      await t.check('State: unknown outcome, not confirmed_failed', async () => {
        const s = await H.state(page);
        H.eq(s.attempt.state, 'unknown'); H.eq(s.orderState, 'payment_pending');
      });
      t.measurements = { dupAttemptPrevented: null, taskCompleted: null, recoverySuccess: null, terminalCorrect: true };
      t.observations = [];
    }
  },
  {
    id: 'T02', title: 'Baseline: timeout presented as failure while state remains unknown',
    category: 'baseline', severity: 'major', modes: ['before'], persona: 'ben',
    metric: 'terminal_state',
    expected: 'Documented baseline defect: UI copy says the payment "didn\u2019t go through" and offers retry, while the model still holds attempt=unknown. PASS means the defect is reproduced as documented; counted as an incorrect-terminal-presentation observation in the comparison.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await H.act(page, 'start');
      await t.check('UI: failure-style heading shown', async () => {
        H.eq(await H.h2(page), 'Payment didn\u2019t go through');
      });
      await t.check('State: attempt still unknown (model did not confirm failure)', async () => {
        const s = await H.state(page);
        H.eq(s.attempt.state, 'unknown'); H.eq(s.orderState, 'payment_pending');
      });
      await t.check('Retry offered without any status-check control', async () => {
        H.eq(await page.locator('#screen button[data-action="retry"]').count(), 1);
        H.eq(await page.locator('#screen button[data-action="check"]').count(), 0);
      });
      t.measurements = { dupAttemptPrevented: null, taskCompleted: null, recoverySuccess: null, terminalCorrect: false };
      t.observations = ['Baseline presents an unknown outcome as a failure in copy; model state remains unknown. This is the divergence the improved flow removes.'];
    }
  },
  {
    id: 'U01', title: 'Unresolved outcome: support handoff exposes the original reference',
    category: 'failure-recovery', severity: 'major', modes: ['after'], persona: 'ada',
    metric: 'recovery_success',
    expected: 'After two pending checks: one unresolved exception exists; "Get help" shows a support screen carrying the original attempt reference and no new attempt is created.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await toCustomer3(page, t);
      await H.act(page, 'start');
      await H.waitH2(page, 'Still confirming');
      const s0 = await H.state(page);
      const id1 = s0.attempt.id, c1 = s0.chargeable;
      await H.act(page, 'check');
      await H.waitH2(page, 'Still waiting');
      await H.act(page, 'check');
      await H.waitH2(page, 'Still waiting');
      await t.check('Unresolved exception opened (rule 6); checks created no chargeable attempt', async () => {
        const s = await H.state(page);
        const u = s.exceptions.filter(e => e.type === 'Unresolved payment outcome');
        H.eq(u.length, 1); H.eq(u[0].status, 'open');
        H.eq(s.chargeable, c1);
      });
      await H.act(page, 'support');
      await t.check('Support screen shows the original reference ' + id1, async () => {
        H.eq(await H.h2(page), 'We can trace this payment');
        const amt = await H.text(page, '#screen .amount-card .amount');
        H.eq(amt, id1);
        const s = await H.state(page); H.eq(s.chargeable, c1); H.eq(s.attempt.id, id1);
      });
      t.measurements = { dupAttemptPrevented: true, taskCompleted: true, recoverySuccess: true, terminalCorrect: null };
      t.observations = [];
    }
  },
  {
    id: 'M01', title: 'Acceptance probe: intentionally false assertion (must report FAIL)',
    category: 'meta', severity: 'info', modes: ['after'], persona: 'probe',
    metric: 'meta', intentional: true,
    expected: 'Known-false assertion: expects the timeout heading to be "Payment failed". The product is CORRECT to disagree; this probe proves failures are reported honestly. Excluded from all product metrics.',
    async run({ page, mode, t }) {
      await toMode(page, mode);
      await H.act(page, 'start');
      await t.check('Probe: timeout heading is exactly "Payment failed" (known false)', async () => {
        H.eq(await H.h2(page), 'Payment failed');
      });
      t.measurements = { dupAttemptPrevented: null, taskCompleted: null, recoverySuccess: null, terminalCorrect: null };
      t.observations = ['Intentional failure injected to verify the harness does not mask failing assertions.'];
    }
  }
];

/* R02 defined separately because its navigation needs the paid-order checkout. */
const r02 = SCENARIOS.find(s => s.id === 'R02');
r02.run = async ({ page, mode, t }) => {
  await toMode(page, mode);
  await H.act(page, 'start');
  await H.waitH2(page, 'Still confirming');
  await H.act(page, 'check');
  await H.waitH2(page, 'Still waiting');
  await H.act(page, 'check');
  await H.waitH2(page, 'Payment completed');
  // paid result -> back to payment details -> back to checkout
  await H.act(page, 'timeout');
  await H.waitH2(page, 'Payment confirmed');
  await H.act(page, 'checkout');
  await t.check('Paid checkout shows "Order paid" and exposes no start control', async () => {
    H.eq(await H.h2(page), 'Order paid');
    H.eq(await page.locator('#screen button[data-action="start"]').count(), 0);
  });
  await t.check('Direct model call startPayment() is refused (guard)', async () => {
    const res = await page.evaluate(() => {
      const before = { chargeable: S.chargeable, id: S.attempt && S.attempt.id };
      const ok = startPayment();
      return { ok, before, after: { chargeable: S.chargeable, id: S.attempt && S.attempt.id, dupBlocks: S.dupBlocks, screen: S.screen } };
    });
    if (res.ok !== false) throw new Error('startPayment() returned true on paid order');
    if (res.after.chargeable !== res.before.chargeable) throw new Error('chargeable changed: ' + res.before.chargeable + ' -> ' + res.after.chargeable);
    if (res.after.id !== res.before.id) throw new Error('attempt id changed');
    if (res.after.dupBlocks !== 1) throw new Error('dupBlocks=' + res.after.dupBlocks);
  });
  t.measurements = { dupAttemptPrevented: true, taskCompleted: null, recoverySuccess: null, terminalCorrect: null };
  t.observations = [];
};

export function buildPlan(scenarioIds, count, modeFilter) {
  const defs = [];
  for (const s of SCENARIOS) {
    if (scenarioIds && !scenarioIds.includes(s.id)) continue;
    for (const m of s.modes) {
      if (modeFilter && modeFilter !== 'all' && m !== modeFilter) continue;
      defs.push({ scenarioId: s.id, mode: m });
    }
  }
  if (!defs.length) return [];
  const plan = [];
  let i = 0;
  while (plan.length < count) {
    const d = defs[i % defs.length];
    plan.push({ idx: plan.length, scenarioId: d.scenarioId, mode: d.mode, round: Math.floor(i / defs.length) });
    i++;
  }
  return plan;
}

export function getScenario(id) {
  return SCENARIOS.find(s => s.id === id);
}

export { tape };
