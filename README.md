# Misan Pharmacy: Payment Reliability Prototype

A portfolio-ready, **interactive product prototype** of a payment-timeout recovery feature for pharmacy checkout. A timeout is treated as an **unknown outcome**, not proof of failure. The system checks the original transaction attempt before ever offering a new chargeable attempt, and never marks an order paid without authoritative confirmation.

> **Independent portfolio concept.** Not an official Misan product. No live payment provider, bank, wallet, or payment rail is connected. All transactions, names, IDs, timings, and provider events are synthetic and deterministic.

## What this demonstrates

- **Product judgment:** order state is distinct from payment-attempt state; settlement is distinct from confirmation.
- **Safety design:** retry is gated behind a confirmed failure; status checks reuse the original attempt ID and never create a charge.
- **Before/After comparison:** the baseline experience (premature retry, possible duplicate charge) and the improved experience (verify-before-retry) are both fully walkable.
- **Operational completeness:** reconciliation exceptions with explicit review states and a required resolution reason; deterministic reset.

This is an application prototype only. There are no dashboards, metrics panels, test runners, or case-study sections in the app itself. Verification results live in `TEST_REPORT.md`.

## Running the prototype

No build step, no dependencies, no server required.

```bash
# Option 1: open directly
open index.html          # macOS
xdg-open index.html      # Linux

# Option 2: serve statically (any static server works)
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed local URL.

## Using the interface

| Element | Purpose |
|---|---|
| **Before / After switch** | Before = baseline flow (timeout treated like failure → blind retry → possible duplicate charge). After = improved flow (check the original attempt first; retry only after a confirmed failure). Each mode keeps its own state, so you can switch mid-journey and come back. |
| **Customer queue** | Three counter customers, each with a deterministic payment outcome: Amina Yusuf → paid + settlement-not-matched exception; Chidi Oke → confirmed failure → safe retry → paid; Bola Adeyemi → stays pending → support handoff + unresolved-outcome exception. |
| **Check payment status** | Status check on the original attempt reference. Never creates a charge. |
| **Reconciliation** *(After only)* | Bottom sheet of exceptions (settlement missing, unresolved outcomes). `open → in_review → resolved`; resolution always requires a written reason. |
| **Start over / Next customer** | Deterministic reset of the current mode; advances the queue. |

### Suggested demo path (2 minutes)

1. Leave the switch on **After**.
2. **Start digital payment** → timeout screen (note: *checks the original attempt first*) → **Check payment status** → *pending* → check again → **Payment completed** + settlement exception appears.
3. Open **Reconciliation**, try resolving without a reason (refused), then with a reason.
4. **Next customer** → Chidi Oke: check → *failed* → **Start a new payment** → check → paid on attempt 2.
5. **Next customer** → Bola Adeyemi: two checks stay pending → **Get help** (support handoff) → on checkout, tap **Take payment** to see the blocked-attempt guard.
6. Switch to **Before** and repeat: timeout → **Try payment again** → confirm → *Two charges may exist*: the baseline failure mode.

## Product rules implemented

1. A provider timeout transitions the attempt to `unknown` (shown as *Pending*), never to `confirmed_failed`.
2. Status checks always target the original attempt ID and do not create a chargeable attempt.
3. A confirmed-paid result marks the order paid and blocks any further chargeable attempt.
4. A new chargeable attempt is permitted only after `confirmed_failed`.
5. Settlement is not inferred from confirmation; missing settlement / mismatches open a reviewable exception.
6. Exceptions are never auto-resolved; resolution requires a documented reason.
7. Reset restores the documented initial state for the active mode.

## State model (summary)

**Order:** `awaiting_payment` → `payment_pending` → `paid` | `payment_failed`

**Attempt:** (none) → `unknown` (after timeout) → `confirmed_paid` | `confirmed_failed`

**Exception:** `open` → `in_review` → `resolved` (reason required)

## Deployment (Vercel)

This is a single static `index.html`. Any static host works.

1. Push this folder to a GitHub repository.
2. On [Vercel](https://vercel.com): **Add New Project** → import the repo.
3. Framework preset: **Other**. No build command. Output directory: **`.`** (or the repo root if this folder is the repo).
4. Deploy. No environment variables are required.

## Repository layout

```
index.html        # complete self-contained prototype (HTML + CSS + JS)
README.md         # this file
TEST_REPORT.md    # verification results and run log
.gitignore
```

## Limitations & what a real integration would require

- **No real provider.** Provider responses, webhooks, latency, and settlement files are simulated with deterministic functions. A real build needs provider sandbox credentials, webhook receivers with signature verification, and idempotency keys enforced server-side.
- **Client-side state only.** Persistence is in-memory for the page session. A production system needs a server-side ledger; the browser must never be authoritative for payment state.
- **Deterministic demo outcomes.** Each customer's payment resolves on a fixed schedule so every recovery path is explorable; real traffic is stochastic.
- **Simulated check latency.** The ~550 ms status-check delay stands in for a provider round trip; no wall-clock metric is instrumented.

## Credits & disclaimer

Built as an independent product-management portfolio artifact from the supplied Project 1 brief and build-and-test guide. Synthetic data only. No affiliation with Misan, Bamboo, or any payment provider.
