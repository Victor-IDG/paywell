/* Paywell QA execution engine.
   Runs the scenario suite against the real product UI in a VISIBLE Chrome window.
   Playwright library mode: official Playwright API, headed browser, per-execution
   browser contexts, tracing + screenshots for failures. This module runs in Node,
   never in the browser frontend. */

import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCENARIOS, PERSONAS, SEED, buildPlan, getScenario, tape } from './scenarios.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RESULTS = join(HERE, 'results');
const RUNS = join(RESULTS, 'runs');
mkdirSync(RUNS, { recursive: true });

export const PRODUCT_VERSION = {
  file: 'index.html',
  sha256: createHash('sha256').update(readFileSync(join(ROOT, 'index.html'))).digest('hex').slice(0, 12),
  testedOn: new Date().toISOString().slice(0, 10)
};

const EXEC_TIMEOUT_MS = 45000;

/* ── run registry ────────────────────────────────────────── */
const runs = new Map(); // runId -> run object (live, persisted to disk)

export function listRuns() {
  return [...runs.values()]
    .map(r => ({ runId: r.runId, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt,
      config: r.config, counts: countStatuses(r) }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getRun(id) { return runs.get(id) || null; }

function persist(run) {
  const p = join(RUNS, run.runId + '.json');
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(run, null, 2));
  renameSync(tmp, p);
}

export function loadPersistedRuns() {
  if (!existsSync(RUNS)) return;
  for (const f of readdirSync(RUNS)) {
    if (!f.endsWith('.json')) continue;
    try {
      const r = JSON.parse(readFileSync(join(RUNS, f), 'utf8'));
      runs.set(r.runId, r);
    } catch { /* skip corrupt file */ }
  }
}

/* ── browser ─────────────────────────────────────────────── */
let browserPromise = null;

async function launchBrowser() {
  // Prefer the evaluator's installed Google Chrome; fall back to Playwright Chromium.
  try {
    const b = await chromium.launch({ channel: 'chrome', headless: false });
    return { browser: b, engine: 'Google Chrome (system, headed)' };
  } catch (e1) {
    try {
      const b = await chromium.launch({ headless: false });
      return { browser: b, engine: 'Playwright Chromium (headed)' };
    } catch (e2) {
      const err = new Error(
        'Could not launch a headed browser.\n' +
        'Chrome: ' + e1.message.split('\n')[0] + '\n' +
        'Chromium: ' + e2.message.split('\n')[0] + '\n' +
        'Fix: install Google Chrome, or run "npx playwright install chromium" in qa/.');
      err.code = 'BROWSER_UNAVAILABLE';
      throw err;
    }
  }
}

export async function browserInfo() {
  try {
    const b = await chromium.launch({ channel: 'chrome', headless: false });
    const v = b.version();
    await b.close();
    return { ok: true, engine: 'Google Chrome (system, headed)', version: v };
  } catch (e) {
    try {
      const b = await chromium.launch({ headless: false });
      const v = b.version();
      await b.close();
      return { ok: true, engine: 'Playwright Chromium (headed)', version: v };
    } catch (e2) {
      return { ok: false, error: e2.message.split('\n')[0], hint: 'Install Google Chrome or run: cd qa && npx playwright install chromium' };
    }
  }
}

/* ── single execution ────────────────────────────────────── */
async function runOne(browser, baseUrl, planEntry, run) {
  const def = getScenario(planEntry.scenarioId);
  const persona = PERSONAS[def.persona];
  const t = tape();
  const started = new Date().toISOString();
  const t0 = Date.now();
  const rec = {
    execId: run.execSeq++, idx: planEntry.idx, round: planEntry.round,
    scenarioId: def.id, title: def.title, category: def.category, severity: def.severity,
    mode: planEntry.mode, persona: persona.id, personaName: persona.name,
    metric: def.metric, intentional: !!def.intentional,
    expected: def.expected, seed: run.seed,
    status: 'RUNNING', startedAt: started, durationMs: null,
    assertions: [], observations: [], measurements: {}, error: null,
    artifacts: { screenshot: null, trace: null }, rerunOf: planEntry.rerunOf || null
  };

  let context = null;
  try {
    context = await browser.newContext({ viewport: { width: 900, height: 940 }, locale: 'en-US' });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    await page.goto(baseUrl + '/', { waitUntil: 'load', timeout: 15000 });
    await def.run({ page, mode: planEntry.mode, t });

    rec.assertions = t.items;
    rec.observations = t.observations || [];
    rec.measurements = t.measurements || {};
    const required = t.items;
    if (!required.length) {
      rec.status = 'INCONCLUSIVE';
      rec.error = 'Scenario recorded no assertions.';
    } else if (required.some(a => !a.ok)) {
      rec.status = 'FAIL';
    } else {
      rec.status = 'PASS';
    }
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/net::|ERR_|Timeout .* exceeded.*goto|page\.goto/i.test(msg) && !/locator|waitFor/i.test(msg)) {
      rec.status = 'BLOCKED';
      rec.error = 'Environment/navigation error: ' + msg.split('\n')[0];
    } else {
      // The product did not reach the required state in time, or the interaction failed:
      // that is a real failure of the required behaviour, not an environment problem.
      rec.status = 'FAIL';
      rec.error = msg.split('\n').slice(0, 6).join('\n');
      rec.assertions = t.items.concat([{ name: 'Execution completed without error', ok: false, detail: msg.split('\n')[0] }]);
    }
  } finally {
    rec.durationMs = Date.now() - t0;
    if (context) {
      try {
        const failed = rec.status === 'FAIL' || rec.status === 'BLOCKED';
        if (failed) {
          const dir = join(RESULTS, run.runId);
          mkdirSync(dir, { recursive: true });
          const base = 'exec-' + String(rec.idx).padStart(3, '0') + '-' + rec.scenarioId + '-' + rec.mode;
          const shot = join(dir, base + '.png');
          const page = context.pages()[0];
          if (page) await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
          rec.artifacts.screenshot = 'results/runs/' + run.runId + '/' + base + '.png';
          const trace = join(dir, base + '.zip');
          await context.tracing.stop({ path: trace });
          rec.artifacts.trace = 'results/runs/' + run.runId + '/' + base + '.zip';
        } else {
          await context.tracing.stop(); // discard trace for passing runs
        }
      } catch { /* tracing best-effort */ }
      await context.close().catch(() => {});
    }
  }
  return rec;
}

/* ── run lifecycle ───────────────────────────────────────── */
let activeBrowser = null;

export function startRun(config, baseUrl) {
  if ([...runs.values()].some(r => r.status === 'running')) {
    throw Object.assign(new Error('A run is already in progress. Cancel it first.'), { code: 'RUN_ACTIVE' });
  }
  const runId = 'run-' + new Date().toISOString().replace(/[:.]/g, '-');
  const plan = buildPlan(config.scenarioIds || null, config.executions, config.mode || 'all');
  if (!plan.length) throw Object.assign(new Error('Filters exclude every scenario.'), { code: 'EMPTY_PLAN' });

  const run = {
    runId, status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
    seed: SEED, baseUrl,
    config: {
      executions: config.executions, mode: config.mode || 'all',
      scenarioIds: config.scenarioIds || 'all (17 definitions)',
      preset: config.preset || 'custom', concurrency: 1,
      visibleWorker: 'single visible Chrome window, one execution at a time'
    },
    productVersion: PRODUCT_VERSION,
    environment: null,
    plan, execSeq: 0, executions: [], error: null,
    counts: null
  };
  runs.set(runId, run);
  persist(run);
  executeLoop(run, baseUrl).catch(e => {
    run.status = 'error';
    run.error = String(e && e.message || e);
    run.finishedAt = new Date().toISOString();
    persist(run);
  });
  return run;
}

async function executeLoop(run, baseUrl) {
  let browser, engine;
  try {
    ({ browser, engine } = await launchBrowser());
  } catch (e) {
    run.status = 'blocked';
    run.error = e.message;
    run.finishedAt = new Date().toISOString();
    for (const p of run.plan) if (p.status !== 'done') p.status = 'BLOCKED';
    persist(run);
    return;
  }
  activeBrowser = browser;
  run.environment = { engine, browserVersion: browser.version(), node: process.version, os: process.platform };

  try {
    for (const p of run.plan) {
      if (run.status === 'cancelling') { run.status = 'cancelled'; break; }
      if (p.status === 'done') continue;
      const rec = await runOne(browser, baseUrl, p, run);
      run.executions.push(rec);
      p.status = 'done';
      run.counts = countStatuses(run);
      persist(run);
    }
    if (run.status === 'running') run.status = 'completed';
    if (run.status === 'cancelling') run.status = 'cancelled';
  } catch (e) {
    run.status = 'error';
    run.error = String(e && e.message || e);
  } finally {
    run.finishedAt = new Date().toISOString();
    run.counts = countStatuses(run);
    persist(run);
    try { await browser.close(); } catch { /* already closed */ }
    activeBrowser = null;
  }
}

export async function cancelRun(runId) {
  const run = runs.get(runId);
  if (!run || run.status !== 'running') throw Object.assign(new Error('No running run.'), { code: 'NOT_RUNNING' });
  run.status = 'cancelling';
  persist(run);
  return { ok: true };
}

/* Resume a cancelled run: execute plan entries not yet done. */
export function resumeRun(runId, baseUrl) {
  const run = runs.get(runId);
  if (!run) throw Object.assign(new Error('Run not found.'), { code: 'NOT_FOUND' });
  if (run.status !== 'cancelled') throw Object.assign(new Error('Only cancelled runs can be resumed.'), { code: 'NOT_RESUMABLE' });
  run.status = 'running';
  run.finishedAt = null;
  persist(run);
  executeLoop(run, baseUrl).catch(e => {
    run.status = 'error'; run.error = String(e && e.message || e); persist(run);
  });
  return run;
}

/* Rerun one recorded execution under the same scenario/mode/seed. */
export async function rerunExecution(runId, execId, baseUrl) {
  const run = runs.get(runId);
  if (!run) throw Object.assign(new Error('Run not found.'), { code: 'NOT_FOUND' });
  if (run.status === 'running') throw Object.assign(new Error('Wait for the current run to finish.'), { code: 'RUN_ACTIVE' });
  const orig = run.executions.find(e => e.execId === execId);
  if (!orig) throw Object.assign(new Error('Execution not found.'), { code: 'NOT_FOUND' });

  let browser, engine;
  try { ({ browser, engine } = await launchBrowser()); }
  catch (e) { throw Object.assign(e, { code: 'BROWSER_UNAVAILABLE' }); }

  try {
    const rec = await runOne(browser, baseUrl, {
      idx: run.plan.length, scenarioId: orig.scenarioId, mode: orig.mode,
      round: 0, rerunOf: orig.execId
    }, run);
    rec.rerunOf = orig.execId;
    rec.seed = run.seed; // same deterministic inputs
    run.executions.push(rec);
    rec.recoveredAfterRetry = orig.status === 'FAIL' && rec.status === 'PASS';
    orig.flaky = orig.flaky || (orig.status === 'FAIL' && rec.status === 'PASS');
    run.counts = countStatuses(run);
    persist(run);
    return rec;
  } finally {
    try { await browser.close(); } catch { /* already closed */ }
  }
}

/* ── counting & metrics ──────────────────────────────────── */
export function countStatuses(run) {
  const c = { PASS: 0, FAIL: 0, BLOCKED: 0, INCONCLUSIVE: 0, SKIPPED: 0, pending: 0 };
  for (const e of run.executions) c[e.status] = (c[e.status] || 0) + 1;
  for (const p of run.plan) if (p.status !== 'done') c.pending++;
  return c;
}

const METRIC_DEFS = {
  passRate: { label: 'Pass rate', def: 'Executions with status PASS ÷ executed product executions (meta probes excluded).', interp: 'Test-set result only: not a customer success rate.' },
  failureRate: { label: 'Failure rate', def: 'Executions with status FAIL ÷ executed product executions.', interp: 'Any FAIL needs triage before trusting the affected rule.' },
  taskCompletion: { label: 'Task completion rate', def: 'Passed executions of completion-bearing scenarios (happy-path, recovery, validation-completion) ÷ their executed count.', interp: 'Scripted journey completion in the mock UI, not real user success.' },
  recovery: { label: 'Recovery success rate', def: 'Passed failure-recovery executions ÷ executed failure-recovery executions.', interp: 'Recovery paths in the simulation only.' },
  dupPrevention: { label: 'Duplicate-charge prevention', def: 'Eligible duplicate-action executions where NO extra chargeable attempt was created ÷ all eligible executions, by mode.', interp: 'Primary safety metric. Before flow is expected to fail this by design.' },
  terminal: { label: 'Incorrect terminal presentation', def: 'Terminal-state executions where the UI/state presented a terminal outcome not supported by confirmation ÷ terminal-state executions, by mode.', interp: 'Should be 0% in the improved flow.' },
  ruleViolations: { label: 'Critical rule violations', def: 'FAIL results on critical-severity rule-safety/adversarial scenarios.', interp: 'Any non-zero value blocks a safety claim.' },
  reproducibility: { label: 'Reproducibility', def: 'Scenario+mode groups executed ≥2× where every execution had the same status ÷ all groups executed ≥2×.', interp: 'Deterministic simulation should repeat exactly.' },
  coverage: { label: 'Coverage', def: 'Executed scenario definitions × personas × categories present in the run ÷ defined totals.', interp: 'Shows what the run actually exercised.' },
  duration: { label: 'Execution duration', def: 'Wall-clock time from first to last execution record.', interp: 'Local lab timing only.' }
};

export function computeMetrics(run) {
  const product = run.executions.filter(e => !e.intentional);
  const meta = run.executions.filter(e => e.intentional);
  const executed = product.length;
  const c = { PASS: 0, FAIL: 0, BLOCKED: 0, INCONCLUSIVE: 0, SKIPPED: 0 };
  for (const e of product) c[e.status] = (c[e.status] || 0) + 1;
  const pending = run.plan.filter(p => p.status !== 'done').length;

  const rate = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
  const byCat = cat => product.filter(e => {
    const d = getScenario(e.scenarioId); return d && d.category === cat;
  });
  const completion = product.filter(e => ['happy-path', 'failure-recovery', 'validation'].includes(e.category));
  const recovery = product.filter(e => e.category === 'failure-recovery');

  const dupEligible = m => product.filter(e => e.mode === m && e.measurements && typeof e.measurements.dupAttemptPrevented === 'boolean');
  const dupPrevented = m => dupEligible(m).filter(e => e.measurements.dupAttemptPrevented === true);

  const termEligible = m => product.filter(e => e.mode === m && e.measurements && typeof e.measurements.terminalCorrect === 'boolean');
  const termBad = m => termEligible(m).filter(e => e.measurements.terminalCorrect === false);

  const criticalFails = product.filter(e => e.status === 'FAIL' && e.severity === 'critical');
  const ruleFails = product.filter(e => e.status === 'FAIL' && (e.metric === 'rule_safety' || e.category === 'rule-safety' || e.category === 'adversarial'));

  // reproducibility over repeated scenario+mode groups
  const groups = new Map();
  for (const e of product) {
    const k = e.scenarioId + ':' + e.mode;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e.status);
  }
  const multi = [...groups.values()].filter(v => v.length >= 2);
  const consistent = multi.filter(v => v.every(s => s === v[0]));

  const durations = run.executions.map(e => e.durationMs).filter(d => typeof d === 'number');
  const usedCats = new Set(product.map(e => e.category));
  const usedPersonas = new Set(product.map(e => e.persona));
  const usedDefs = new Set(product.map(e => e.scenarioId));

  const flaky = product.filter(e => e.flaky || e.recoveredAfterRetry);

  return {
    denominatorNote: 'All rates use executed product executions as denominator unless stated. Meta probes (intentional failures) are excluded from every product metric and reported separately.',
    counts: {
      plannedExecutions: run.plan.length,
      executed: product.length,
      notRun: pending,
      pass: c.PASS, fail: c.FAIL, blocked: c.BLOCKED, inconclusive: c.INCONCLUSIVE, skipped: c.SKIPPED,
      metaProbes: meta.length,
      metaFailures: meta.filter(e => e.status === 'FAIL').length
    },
    unique: {
      scenarioDefinitions: new Set(SCENARIOS.map(s => s.id)).size,
      executedDefinitions: usedDefs.size,
      personas: PERSONAS ? Object.keys(PERSONAS).length : 0,
      executedPersonas: usedPersonas.size,
      categoriesExecuted: usedCats.size
    },
    metrics: {
      passRate: { ...METRIC_DEFS.passRate, n: c.PASS, d: executed, value: rate(c.PASS, executed), unit: '%' },
      failureRate: { ...METRIC_DEFS.failureRate, n: c.FAIL, d: executed, value: rate(c.FAIL, executed), unit: '%' },
      taskCompletion: { ...METRIC_DEFS.taskCompletion, n: completion.filter(e => e.status === 'PASS').length, d: completion.length, value: rate(completion.filter(e => e.status === 'PASS').length, completion.length), unit: '%' },
      recovery: { ...METRIC_DEFS.recovery, n: recovery.filter(e => e.status === 'PASS').length, d: recovery.length, value: rate(recovery.filter(e => e.status === 'PASS').length, recovery.length), unit: '%' },
      dupPrevention: {
        ...METRIC_DEFS.dupPrevention, unit: '%',
        byMode: {
          after: { n: dupPrevented('after').length, d: dupEligible('after').length, value: rate(dupPrevented('after').length, dupEligible('after').length) },
          before: { n: dupPrevented('before').length, d: dupEligible('before').length, value: rate(dupPrevented('before').length, dupEligible('before').length) }
        }
      },
      terminal: {
        ...METRIC_DEFS.terminal, unit: '%',
        byMode: {
          after: { n: termBad('after').length, d: termEligible('after').length, value: rate(termBad('after').length, termEligible('after').length) },
          before: { n: termBad('before').length, d: termEligible('before').length, value: rate(termBad('before').length, termEligible('before').length) }
        }
      },
      ruleViolations: { ...METRIC_DEFS.ruleViolations, n: ruleFails.length, d: product.filter(e => e.metric === 'rule_safety' || e.category === 'rule-safety' || e.category === 'adversarial').length, value: ruleFails.length, unit: '' },
      criticalFailures: { label: 'Critical failures', def: 'FAIL results on critical-severity scenarios.', interp: 'Blocks a safety claim until triaged.', n: criticalFails.length, d: executed, value: criticalFails.length, unit: '' },
      reproducibility: { ...METRIC_DEFS.reproducibility, n: consistent.length, d: multi.length, value: rate(consistent.length, multi.length), unit: '%' },
      flaky: { label: 'Flaky / recovered after retry', def: 'Executions whose original attempt failed but a recorded rerun passed (original failure preserved).', interp: 'Non-zero means instability; investigate before trusting the rule.', n: flaky.length, d: executed, value: flaky.length, unit: '' },
      duration: { ...METRIC_DEFS.duration, n: durations.reduce((a, b) => a + b, 0), d: durations.length, value: Math.round(durations.reduce((a, b) => a + b, 0) / 1000), unit: 's' },
      coverage: { ...METRIC_DEFS.coverage, value: usedDefs.size + '/' + new Set(SCENARIOS.map(s => s.id)).size + ' defs · ' + usedPersonas.size + '/' + Object.keys(PERSONAS).length + ' personas · ' + usedCats.size + '/' + new Set(SCENARIOS.map(s => s.category)).size + ' categories', n: usedDefs.size, d: new Set(SCENARIOS.map(s => s.id)).size, unit: '' }
    },
    comparison: buildComparison(product),
    criticalFails: criticalFails.map(execSummary),
    ruleFails: ruleFails.map(execSummary),
    metaFailures: meta.filter(e => e.status === 'FAIL').map(execSummary)
  };
}

function execSummary(e) {
  return { execId: e.execId, scenarioId: e.scenarioId, title: e.title, mode: e.mode, persona: e.personaName, severity: e.severity, error: e.error, failedAssertions: e.assertions.filter(a => !a.ok).map(a => a.name + ' — ' + (a.detail || '')) };
}

function buildComparison(product) {
  const modes = ['before', 'after'];
  const side = m => {
    const es = product.filter(e => e.mode === m);
    const pass = es.filter(e => e.status === 'PASS').length;
    const dupE = es.filter(e => e.measurements && typeof e.measurements.dupAttemptPrevented === 'boolean');
    const dupP = dupE.filter(e => e.measurements.dupAttemptPrevented === true).length;
    const termE = es.filter(e => e.measurements && typeof e.measurements.terminalCorrect === 'boolean');
    const termBad = termE.filter(e => e.measurements.terminalCorrect === false).length;
    const crit = es.filter(e => e.status === 'FAIL' && e.severity === 'critical').length;
    return {
      executions: es.length, pass, passRate: es.length ? Math.round((pass / es.length) * 1000) / 10 : null,
      dupPrevented: dupP, dupEligible: dupE.length,
      dupRate: dupE.length ? Math.round((dupP / dupE.length) * 1000) / 10 : null,
      termBad, termEligible: termE.length,
      termBadRate: termE.length ? Math.round((termBad / termE.length) * 1000) / 10 : null,
      criticalFails: crit
    };
  };
  const b = side('before'), a = side('after');
  const diff = (x, y) => (x === null || y === null || x === undefined || y === undefined) ? null : Math.round((y - x) * 10) / 10;
  return {
    note: 'Same scenario definitions, inputs, starting conditions and measurement definitions in both modes; mode-specific expectations are declared per scenario (baseline defects are asserted as documented behaviour and counted against the safety metrics).',
    before: b, after: a,
    absoluteDiff: { passRatePts: diff(b.passRate, a.passRate), dupPreventionPts: diff(b.dupRate, a.dupRate) },
    relativeChange: {
      passRate: (b.passRate && a.passRate) ? Math.round(((a.passRate - b.passRate) / b.passRate) * 1000) / 10 + '%' : 'n/a',
      dupPrevention: (b.dupRate !== null && a.dupRate !== null && b.dupRate > 0) ? Math.round(((a.dupRate - b.dupRate) / b.dupRate) * 1000) / 10 + '%' : (b.dupRate === 0 && a.dupRate === 100 ? 'from 0% to 100% (undefined relative change)' : 'n/a')
    },
    tradeoff: 'The improved flow adds an explicit status-check step before any retry. A higher completion rate never offsets a critical safety violation: critical failures are reported separately per mode.'
  };
}

/* ── exports ─────────────────────────────────────────────── */
export function exportJSON(runId) {
  const run = runs.get(runId);
  if (!run) return null;
  return { runId: run.runId, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt,
    seed: run.seed, config: run.config, productVersion: run.productVersion, environment: run.environment,
    scenarioDefinitions: SCENARIOS.map(s => ({ id: s.id, title: s.title, category: s.category, severity: s.severity, modes: s.modes, persona: s.persona, metric: s.metric, expected: s.expected, intentional: !!s.intentional })),
    executions: run.executions, metrics: computeMetrics(run) };
}

export function exportCSV(runId) {
  const run = runs.get(runId);
  if (!run) return null;
  const esc = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""').replace(/\n/g, ' ') + '"';
  const head = ['execId', 'scenarioId', 'title', 'mode', 'persona', 'category', 'severity', 'status', 'intentional', 'durationMs', 'startedAt', 'seed', 'failedAssertions', 'error', 'screenshot', 'trace'];
  const rows = run.executions.map(e => [
    e.execId, e.scenarioId, e.title, e.mode, e.personaName, e.category, e.severity, e.status,
    e.intentional ? 'yes' : 'no', e.durationMs, e.startedAt, e.seed,
    e.assertions.filter(a => !a.ok).map(a => a.name).join(' | '),
    (e.error || '').split('\n')[0],
    e.artifacts.screenshot || '', e.artifacts.trace || ''
  ].map(esc).join(','));
  return [head.join(','), ...rows].join('\n');
}
