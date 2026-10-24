# Test Report: Payment Reliability Prototype

**Prototype version:** single-file `index.html`, Revision 2 (2026-10-24), focused application build
**Test date:** 2026-10-24
**Test method:** automated browser verification (Chromium via Playwright, `python3 -m http.server` on localhost:8901)
**Data:** synthetic only. Results below are measurements of the simulation, not production metrics.

> **Revision note.** Per review, the application was stripped to a product prototype only: the in-app scenario runner (T01–T10), metrics/paired-comparison panels, acceptance-criteria checklist, state inspector, event log, simulation controls, phone bezel, and case-study content were removed from the UI. Section 1 below is the historical record of that earlier build's runner session. Section 2 is the **current** verification of the Revision 2 build. The safety rules themselves were unchanged.

**Console (Revision 2):** 0 errors, 0 warnings (inline data-URI favicon).

---

## 0. Revision 2: current build verification (2026-10-24)

Automated Playwright pass: **48 / 48 checks PASS** (script: `/tmp/opencode/verify-rewrite.mjs`), including page-load resource checks (favicon present, inline data-URI, zero HTTP request errors).

### After (improved) flow journeys

| Journey | Expected | Observed | Result |
|---|---|---|---|
| Order 1 (Amina Yusuf): start → timeout → check → pending → check → paid | Timeout stays unknown; same attempt ID; paid only after authoritative check | `PAY-1042-01` across both checks; result "Payment completed"; settlement exception `EXC-001` opens with badge | PASS |
| Reconciliation: resolve with whitespace reason | Silent resolution refused | Refused; status stays Open; toast "A resolution reason is required" | PASS |
| Reconciliation: resolve with reason | Resolves with documented reason | Status → Resolved, reason shown inline | PASS |
| Order 2 (Chidi Oke): pending → confirmed failed → new attempt → paid | Retry allowed only after confirmed failure; new attempt ID | `PAY-1043-02` paid on first check of attempt 2 | PASS |
| Order 3 (Bola Adeyemi): two checks stay pending | Unresolved outcome flagged; support path offered | Unresolved exception opens; support screen shows reference | PASS |
| Blocked guard: pending attempt → checkout → Take payment | Second charge prevented | "New charge prevented / Safety rule enforced" | PASS |
| Paid checkout: paid order → back to checkout | No new charge possible | "Order paid / Already paid" with no start button | PASS |
| Toggle state preservation | Each mode keeps its own state | After blocked+badge state survived a Before round-trip | PASS |
| Reset | Deterministic restore | Checkout order 1, badge cleared, attempt nulled | PASS |

### Before (baseline) flow journey

| Journey | Expected | Observed | Result |
|---|---|---|---|
| start → timeout → Try payment again → confirm | Baseline treats timeout like failure and pushes a retry | "Payment didn't go through" → retry screen → *Two charges may exist* (`PAY-1042-01` + `PAY-1042-02`) with duplicate-charge warning | PASS |
| Ops sheet hidden in Before mode | Tester-only surfaces removed from baseline | Reconciliation button hidden | PASS |

### Cross-cutting checks

| Check | Result |
|---|---|
| No runner/metrics/criteria/inspector/event-log content in app | PASS |
| No horizontal overflow @375px | PASS (overflow = 0) |
| No horizontal overflow @1280px | PASS (overflow = 0) |
| Tab reaches "Start digital payment"; Enter activates | PASS |
| Favicon present as inline data-URI; no `/favicon.ico` request | PASS |
| Page load: 0 HTTP request errors | PASS |
| Console: 0 errors / 0 warnings | PASS |

Screenshots: `/tmp/opencode/rewrite-mobile-375.png`, `rewrite-desktop-1280.png`, `shot-after-timeout.png`, `shot-after-paid.png`, `shot-before-duplicate.png`, `shot-ops-sheet.png`.

### Acceptance criteria (evidence from Revision 2 journeys)

| # | Criterion | Status |
|---|-----------|--------|
| A | Timeout never → confirmed failed directly | PASS: pending result after timeout in every After journey |
| B | Status check uses original attempt ID | PASS: `PAY-1042-01` across both checks |
| C | Pending creates no new chargeable attempt | PASS: check paths never create attempts |
| D | Confirmed-paid blocks another attempt | PASS: blocked guard + "Order paid" checkout |
| E | Retry only after confirmed failure | PASS: only Order 2's confirmed failure unlocked attempt 2 |
| F | Duplicate events → one effective change | Structural: no duplicate-event UI exists anymore (runner removed); idempotency was verified in Revision 1 (T05) |
| G | Mismatch flagged, not silently resolved | PASS: whitespace reason refused |
| H | Reset restores documented initial state | PASS |
| I | Mouse + keyboard operability | PASS: tab + Enter walkthrough, visible focus |
| J | Phone/desktop widths; no external deps | PASS: 375/1280 zero overflow; single file, zero external requests |

---

## 1. Historical: Revision 1 in-page scenario suite (pre-strip build)

Run with **Run all scenarios** on each flow. The runner reset state before every scenario.
Final confirmation run: After suite 10/10, then Before suite 6/10, then After results restored from per-flow store, with no regressions. **These panels no longer exist in the app**; the record is kept for traceability.

### After (improved) flow: 10 / 10 PASS

| ID | Scenario | Expected | Observed | Result | Attempts |
|----|----------|----------|----------|--------|----------|
| T01 | Timeout → later status paid | Original attempt becomes paid after check; no 2nd chargeable attempt | Order=paid, attempt=confirmed_paid, attempts=1, checkResult=paid, sameAttemptId=true | PASS | 1 |
| T02 | Timeout → status remains pending | Stays pending; same attempt ID; no new chargeable attempt | attempt=PAY-1042-01 (was PAY-1042-01), state=unknown, order=payment_pending, attempts=1, check=pending | PASS | 1 |
| T03 | Timeout → confirmed failed | Failure shown only after confirmation; safe retry available | prematureFailed=false, afterCheck attempt=confirmed_failed, order=payment_failed, retryGate=open, checkResult=failed | PASS | 1 |
| T04 | Retry while original pending | No 2nd chargeable attempt; guided to check status | retryBlocked=true, attempts=1, duplicateBlocks=1, screen=blocked | PASS | 1 |
| T05 | Status event delivered twice | One effective state change; duplicate ignored | firstApplied=true, secondIgnored=true, effectiveTransitions=3, ignored=1 | PASS | 1 |
| T06 | Delayed paid confirmation | Final state follows authoritative status | final attempt=confirmed_paid, order=paid, contradictoryFailedEvent=false | PASS | 1 |
| T07 | Settlement record missing | Exception flagged; settlement not assumed | exception=EXC-001/open, order=payment_pending (settlement not inferred) | PASS | 1 |
| T08 | Amount/reference mismatch | Mismatch visible with review state | exception=EXC-001/open, visible in reconciliation panel with review state | PASS | 1 |
| T09 | Reset during/after scenario | State, counters, log restored | after reset: attempts=0, events=0, exceptions=0, order=awaiting_payment, seq=0 | PASS | 0 |
| T10 | Keyboard-only operability | Controls focusable; focus visible | 9 focusable buttons, all native `<button>`, focus ring CSS present, first control focusable=true | PASS | 0 |

**Metrics (After)**: calculated in-page from this run, denominators disclosed:

- Scenario pass rate: **10 / 10 (100%)**
- Duplicate-charge prevention rate: **1 / 1 eligible (100%)** (T04)
- Incorrect terminal-state rate: **0 / 3 terminal cases (0%)** (T01, T03, T06)
- Reconciliation detection rate: **2 / 2 injected (100%)** (T07, T08)
- Duplicate-event idempotency: **100%** (T05: exactly one effective state change)

### Before (baseline) flow: 6 / 10 PASS

| ID | Scenario | Expected (safety spec) | Observed | Result | Attempts |
|----|----------|------------------------|----------|--------|----------|
| T01 | Timeout → later status paid | Original attempt becomes paid after check; no 2nd chargeable attempt | Baseline offered retry after timeout with no status check. Attempts created=2. Expected paid-via-check with 1 attempt: not achievable through baseline UI. | FAIL | 2 |
| T02 | Timeout → status remains pending | Stays pending; same attempt ID; no new chargeable attempt | Baseline: no status-check path exposed. User retried; attempts=2 (same attempt ID preserved: false). | FAIL | 2 |
| T03 | Timeout → confirmed failed | Failure shown only after confirmation; safe retry available | prematureFailed=false, baseline prompted retry with no confirmation path (attempts=2). Failure was never shown *after* confirmation because confirmation is never requested. | FAIL | 2 |
| T04 | Retry while original pending | No 2nd chargeable attempt; guided to check status | Baseline allowed a second chargeable attempt (attempts=2). Safety expectation not met by design of Before flow. | FAIL | 2 |
| T05 | Status event delivered twice | One effective state change; duplicate ignored | firstApplied=true, secondIgnored=true, effectiveTransitions=3, ignored=1 | PASS | 1 |
| T06 | Delayed paid confirmation | Final state follows authoritative status | final attempt=confirmed_paid, order=paid, contradictoryFailedEvent=false | PASS | 1 |
| T07 | Settlement record missing | Exception flagged; settlement not assumed | exception=EXC-001/open, order=payment_pending (settlement not inferred) | PASS | 1 |
| T08 | Amount/reference mismatch | Mismatch visible with review state | exception=EXC-001/open, visible in reconciliation panel with review state | PASS | 1 |
| T09 | Reset during/after scenario | State, counters, log restored | after reset: attempts=0, events=0, exceptions=0, order=awaiting_payment, seq=0 | PASS | 0 |
| T10 | Keyboard-only operability | Controls focusable; focus visible | 10 focusable buttons, all native `<button>`, focus ring CSS present, first control focusable=true | PASS | 0 |

**Metrics (Before):** pass rate **6 / 10 (60%)**; duplicate-charge prevention **0 / 1 (0%)**; incorrect terminal-state **0 / 3 (0%)**; reconciliation detection **2 / 2 (100%)**.

**Note:** the T01–T04 Before failures are the baseline problem this concept targets (premature retry with no status check), not defects in the prototype. T05–T08 use the shared tester instrumentation (event injection, reconciliation panel) available on both flows so the paired comparison uses identical inputs.

### Paired comparison (both runs in one session)

| Measure | Before | After | Difference |
|---------|--------|-------|------------|
| Scenario pass rate | 60% | 100% | +40 pts |
| Duplicate-charge prevention | 0% | 100% | +100 pts |
| Incorrect terminal-state rate | 0% | 0% | 0 pts |
| Reconciliation detection | 100% | 100% | 0 pts |

Results are stored per flow; switching tabs restores each flow's last run so both sides stay visible.

---

## 2. Historical: Revision 1 manual browser verification

*Record of the pre-strip build; superseded by Section 0 for the current build.*

| Check | Method | Result |
|-------|--------|--------|
| Page loads with no console errors | Open in Chromium, inspect console | PASS: 0 errors, 0 warnings |
| Before/After switch changes phone UI behavior | Click both tabs, compare timeout screen | PASS: Before: "Payment didn't go through" + retry push; After: "Still confirming this payment" + check-first |
| Status check reuses attempt ID | Start → check (pending) → check again (paid) | PASS: PAY-1042-01 across both checks; result "Paid / No further action needed" |
| Retry blocked while pending (After) | Start → home → tap "Take payment" again | PASS: "Attempt blocked / New charge prevented" screen with original attempt ID; counter stays 1 |
| Retry allowed after confirmed failed | Suite T03 + checkout branch renders "Start a new payment" only for confirmed_failed | PASS |
| Paid order offers no new charge | Confirm paid → home | PASS: "Already paid" notice, no start button, "View receipt" only |
| Duplicate event ignored on second inject | Suite T05 | PASS: ignored=1 |
| Late paid applies cleanly | Suite T06 | PASS |
| Exception open → review → resolve requires reason | Inject exception; resolve with whitespace reason; then with real reason | PASS: whitespace rejected: "A resolution reason is required. Silent resolution is not allowed."; status stays Open; real reason → Resolved with reason displayed |
| Reset restores initial state | Act, reset, verify counters/log/attempt | PASS: attempts=0, events=0, exceptions=0, order=awaiting_payment, seq=0 (stored test results intentionally survive resets; "Clear results" removes them) |
| Responsive at ~375px and ~1280px | Resize viewport; check overflow | PASS: no page-level horizontal overflow; wide tables scroll inside their wrappers |
| Keyboard: focus ring + Enter activates | Focus "Start digital payment", press Enter | PASS: 3px focus outline visible; Enter navigates to timeout screen |
| Production static serve works | `python3 -m http.server`, load page | PASS |

---

## 3. Historical: Revision 1 acceptance criteria status

*Evidence for the current build is in Section 0.*

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| A | Timeout never → confirmed failed directly | PASS | T03 `prematureFailed=false` (both flows); After shows "Still confirming" |
| B | Status check uses original attempt ID | PASS | T01/T02 same-ID assertion; manual checks on PAY-1042-01 |
| C | Pending creates no new chargeable attempt | PASS | T02 attempts === 1; status check paths never call startPayment |
| D | Confirmed-paid blocks another attempt | PASS | T01 attempts === 1; paid checkout offers no start button |
| E | Retry only after confirmed failure | PASS | T03 retryGate=open only after confirmed_failed; T04 block |
| F | Duplicate events → one effective change | PASS | T05 secondIgnored=true |
| G | Mismatch flagged, not silently resolved | PASS | T07/T08 open exceptions; empty-reason resolve rejected in manual test |
| H | Reset restores documented initial state | PASS | T09 counters/log/attempt restored |
| I | Mouse + keyboard operability | PASS | T10 structural + manual Enter activation, focus ring |
| J | Phone/desktop widths; no external deps | PASS | 375px/1280px checks; single-file, zero external requests |

---

## 4. Known limitations of this test pass

- Results are from a hand-authored deterministic simulation; they do not generalize to real payment failure distributions.
- No wall-clock timing metric is recorded (median exception identification time intentionally omitted, not instrumented).
- The keyboard check is a tab-order + Enter-activation walkthrough, not a screen-reader audit.
- Before-flow violations of the safety criteria are expected demonstrations of the baseline problem, not prototype defects.
- Criterion F (duplicate-event idempotency) has no remaining in-app surface after the runner removal; it was verified in the Revision 1 suite (T05) and would be re-verified against a real webhook layer in production.

---

## 5. Run log template (for additional manual runs)

| Run | Mode | Journey | Expected | Observed | Pass/Fail | Attempt IDs | Notes |
|-----|------|---------|----------|----------|-----------|-------------|-------|
| | | | | | | | |
