/* Paywell QA runner service.
   One local command: serves the product, the /qa results interface, the run API,
   and executes Playwright in Node (headed Chrome). The frontend never runs tests. */

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import {
  PRODUCT_VERSION, listRuns, getRun, startRun, cancelRun, resumeRun,
  rerunExecution, computeMetrics, exportJSON, exportCSV, loadPersistedRuns, browserInfo
} from './runner.js';
import { SCENARIOS, PERSONAS, SEED } from './scenarios.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.PORT || 8920);
const BASE = 'http://127.0.0.1:' + PORT;

loadPersistedRuns();

const PRESETS = [5, 10, 18, 36, 50];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png', '.zip': 'application/zip', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8'
};

function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(b);
}
function err(res, code, message, ecode) { json(res, code, { error: message, code: ecode || null }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function serveFile(res, absPath) {
  if (!existsSync(absPath) || !statSync(absPath).isFile()) { res.writeHead(404); res.end('not found'); return; }
  const ext = absPath.slice(absPath.lastIndexOf('.'));
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(absPath));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const p = url.pathname;

  try {
    /* ── API ── */
    if (p.startsWith('/api/')) {
      if (req.method === 'GET' && p === '/api/meta') {
        return json(res, 200, {
          product: PRODUCT_VERSION, seed: SEED,
          presets: PRESETS,
          scenarios: SCENARIOS.map(s => ({ id: s.id, title: s.title, category: s.category, severity: s.severity, modes: s.modes, persona: s.persona, metric: s.metric, expected: s.expected, intentional: !!s.intentional })),
          personas: Object.values(PERSONAS),
          categories: [...new Set(SCENARIOS.map(s => s.category))],
          variants: SCENARIOS.reduce((n, s) => n + s.modes.length, 0),
          runs: listRuns(),
          note: 'Runs execute in one visible Chrome window (single worker). The hosted copy of this page cannot open a browser on your machine: use the local runner (see README).'
        });
      }
      if (req.method === 'GET' && p === '/api/browser-check') {
        return json(res, 200, await browserInfo());
      }
      if (req.method === 'GET' && p === '/api/runs') {
        return json(res, 200, { runs: listRuns() });
      }
      if (req.method === 'GET' && /^\/api\/runs\/[^/]+$/.test(p)) {
        const run = getRun(p.split('/')[3]);
        if (!run) return err(res, 404, 'Run not found');
        return json(res, 200, { run, metrics: computeMetrics(run) });
      }
      if (req.method === 'GET' && /^\/api\/runs\/[^/]+\/export\.json$/.test(p)) {
        const data = exportJSON(p.split('/')[3].replace('.json', ''));
        if (!data) return err(res, 404, 'Run not found');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="paywell-qa-results.json"' });
        return res.end(JSON.stringify(data, null, 2));
      }
      if (req.method === 'GET' && /^\/api\/runs\/[^/]+\/export\.csv$/.test(p)) {
        const id = p.split('/')[3].replace('.csv', '');
        const data = exportCSV(id);
        if (!data) return err(res, 404, 'Run not found');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="paywell-qa-results.csv"' });
        return res.end(data);
      }
      if (req.method === 'POST' && p === '/api/runs') {
        const body = await readBody(req);
        const executions = Math.max(1, Math.min(2000, Number(body.executions) || 10));
        const run = startRun({
          executions, mode: body.mode || 'all',
          scenarioIds: Array.isArray(body.scenarioIds) && body.scenarioIds.length ? body.scenarioIds : null,
          preset: body.preset || 'custom'
        }, BASE);
        return json(res, 201, { runId: run.runId, status: run.status, planned: run.plan.length });
      }
      if (req.method === 'POST' && /^\/api\/runs\/[^/]+\/cancel$/.test(p)) {
        try { return json(res, 200, await cancelRun(p.split('/')[3])); }
        catch (e) { return err(res, 409, e.message, e.code); }
      }
      if (req.method === 'POST' && /^\/api\/runs\/[^/]+\/resume$/.test(p)) {
        try { const r = resumeRun(p.split('/')[3], BASE); return json(res, 200, { runId: r.runId, status: r.status }); }
        catch (e) { return err(res, 409, e.message, e.code); }
      }
      if (req.method === 'POST' && /^\/api\/runs\/[^/]+\/rerun$/.test(p)) {
        const body = await readBody(req);
        try {
          const rec = await rerunExecution(p.split('/')[3], Number(body.execId), BASE);
          return json(res, 201, rec);
        } catch (e) { return err(res, 409, e.message, e.code); }
      }
      return err(res, 404, 'Unknown API route');
    }

    /* ── product app (same origin, keeps the prototype clean: no link from it) ── */
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return serveFile(res, join(ROOT, 'index.html'));
    }
    /* ── QA results interface ── */
    if (req.method === 'GET' && (p === '/qa' || p === '/qa.html')) {
      return serveFile(res, join(ROOT, 'qa.html'));
    }
    /* ── artifacts & run files ── */
    if (req.method === 'GET' && p.startsWith('/results/')) {
      const safe = normalize(p).replace(/^(\.\.(\/|\\|$))+/, '');
      const abs = join(ROOT, safe);
      if (!abs.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
      return serveFile(res, abs);
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    err(res, 500, String(e && e.message || e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Paywell QA runner service');
  console.log('  Product:  ' + BASE + '/');
  console.log('  QA UI:    ' + BASE + '/qa');
  console.log('  Product version: ' + PRODUCT_VERSION.file + ' sha256:' + PRODUCT_VERSION.sha256);
  console.log('  Runs execute in a VISIBLE Chrome window (single worker).');
});
