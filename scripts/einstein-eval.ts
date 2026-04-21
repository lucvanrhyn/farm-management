/**
 * scripts/einstein-eval.ts — Phase L Wave 3F hallucination eval harness.
 *
 * Runs 20 golden Q&A fixtures against a live Farm Einstein endpoint and reports
 * pass/fail per the G4 gate: ≥95% of questions must be correctly handled.
 *
 * Usage:
 *   npx tsx scripts/einstein-eval.ts [farmSlug] [--golden path/to/fixture.json]
 *
 * Defaults:
 *   farmSlug   = delta-livestock
 *   --golden   = scripts/fixtures/einstein-eval-golden.json
 *   EVAL_BASE_URL = http://localhost:3001
 *
 * Output:
 *   - Stdout: summary table (via buildSummaryTable)
 *   - File: tmp/einstein-eval-report-<ISO>.json
 *   - Exit 0 on G4 PASS, exit 1 on FAIL or env-var error
 *
 * The script is idempotent — it reads from the live API only; it does NOT
 * write to any database tables. The RagQueryLog rows written by the ask route
 * are side-effects of the route itself, not this script.
 *
 * No paid API calls are made directly from this script. It delegates to the
 * running server which owns the OPENAI_API_KEY + ANTHROPIC_API_KEY.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  scoreGroundedQuestion,
  scoreAdversarial,
  computeOverallG4,
  buildSummaryTable,
  parseSSEFinalFrame,
  type GoldenEntry,
  type EvalFinalPayload,
  type EvalQuestionResult,
} from './einstein-eval-helpers';

// ── CLI parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  farmSlug: string;
  goldenPath: string;
} {
  const args = argv.slice(2); // drop 'node' + script path
  let farmSlug = 'delta-livestock';
  let goldenPath = join(__dirname, 'fixtures', 'einstein-eval-golden.json');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--golden' && args[i + 1]) {
      goldenPath = args[i + 1];
      i++;
    } else if (!args[i].startsWith('--')) {
      farmSlug = args[i];
    }
  }
  return { farmSlug, goldenPath };
}

// ── Env validation ────────────────────────────────────────────────────────────

function validateEnv(): { baseUrl: string } | { error: string } {
  // This script hits the running dev/prod server, which needs OPENAI + ANTHROPIC.
  // We don't check those keys directly (they live on the server, not here), but
  // we do need a reachable base URL.
  const baseUrl = process.env.EVAL_BASE_URL ?? 'http://localhost:3001';
  if (!baseUrl.startsWith('http')) {
    return { error: `EVAL_BASE_URL must start with http: ${baseUrl}` };
  }
  return { baseUrl };
}

// ── SSE consumer ──────────────────────────────────────────────────────────────

/**
 * POST a question to /api/einstein/ask and consume the entire SSE stream.
 * Returns the accumulated raw SSE text, or throws on network error.
 *
 * Requires EVAL_AUTH_COOKIE to be set for authenticated requests. If not set,
 * the server returns 401 — we propagate this as an error result.
 */
async function askQuestion(
  baseUrl: string,
  farmSlug: string,
  question: string,
): Promise<string> {
  const cookie = process.env.EVAL_AUTH_COOKIE ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (cookie) headers['Cookie'] = cookie;

  const resp = await fetch(`${baseUrl}/api/einstein/ask`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ question, farmSlug }),
  });

  // Non-SSE responses (401, 403, 404, 429, 500) are errors — capture as text.
  if (!resp.ok || resp.headers.get('Content-Type')?.includes('application/json')) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }

  // Consume the SSE stream
  if (!resp.body) {
    throw new Error('No response body (streaming not supported?)');
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    accumulated += decoder.decode(value, { stream: true });
  }
  return accumulated;
}

// ── Per-question runner ───────────────────────────────────────────────────────

async function runQuestion(
  baseUrl: string,
  farmSlug: string,
  entry: GoldenEntry,
): Promise<EvalQuestionResult> {
  let payload: EvalFinalPayload | null = null;
  let errorReason: string | undefined;
  let passed = false;

  try {
    const sseText = await askQuestion(baseUrl, farmSlug, entry.question);
    payload = parseSSEFinalFrame(sseText);

    if (!payload) {
      // No final frame — either stream failed or server returned error
      const errorMatch = /event: error\ndata: ([^\n]+)/.exec(sseText);
      const errorData = errorMatch ? errorMatch[1] : sseText.slice(0, 200);
      errorReason = `No final frame in SSE response. Stream output: ${errorData}`;
    } else if (entry.expectedGroundedAnswer) {
      const score = scoreGroundedQuestion(entry, payload);
      passed = score.passed;
      errorReason = score.reason;
    } else {
      const score = scoreAdversarial(entry, payload);
      passed = score.passed;
      errorReason = score.reason;
    }
  } catch (err) {
    errorReason = `Network/server error: ${err instanceof Error ? err.message : String(err)}`;
    passed = false;
  }

  return {
    id: entry.id,
    question: entry.question,
    category: entry.category,
    expectedGroundedAnswer: entry.expectedGroundedAnswer,
    passed,
    reason: errorReason,
    payload,
  };
}

// ── Report writer ─────────────────────────────────────────────────────────────

interface EvalReport {
  runAt: string;
  farmSlug: string;
  goldenPath: string;
  g4Pass: boolean;
  g4Rate: number;
  totalQuestions: number;
  passedQuestions: number;
  categoryBreakdown: Record<string, { total: number; passed: number }>;
  questions: EvalQuestionResult[];
}

function buildReport(
  farmSlug: string,
  goldenPath: string,
  results: EvalQuestionResult[],
  g4: { pass: boolean; rate: number },
): EvalReport {
  const categoryBreakdown: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    const cat = categoryBreakdown[r.category] ?? { total: 0, passed: 0 };
    cat.total += 1;
    if (r.passed) cat.passed += 1;
    categoryBreakdown[r.category] = cat;
  }

  return {
    runAt: new Date().toISOString(),
    farmSlug,
    goldenPath,
    g4Pass: g4.pass,
    g4Rate: g4.rate,
    totalQuestions: results.length,
    passedQuestions: results.filter((r) => r.passed).length,
    categoryBreakdown,
    questions: results,
  };
}

function writeReport(report: EvalReport): string {
  const tmpDir = join(process.cwd(), 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  const iso = report.runAt.replace(/[:.]/g, '-').replace('Z', '');
  const path = join(tmpDir, `einstein-eval-report-${iso}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { farmSlug, goldenPath } = parseArgs(process.argv);

  // Validate environment
  const envResult = validateEnv();
  if ('error' in envResult) {
    console.error(`[einstein-eval] Environment error: ${envResult.error}`);
    process.exit(1);
  }
  const { baseUrl } = envResult;

  // Check for auth cookie — required to hit protected routes
  if (!process.env.EVAL_AUTH_COOKIE) {
    console.error(
      '[einstein-eval] EVAL_AUTH_COOKIE env var is not set.\n' +
        'Set it to a valid session cookie from a logged-in Advanced/Consulting account.\n' +
        'Example: export EVAL_AUTH_COOKIE="next-auth.session-token=<token>"\n' +
        'Without this the API will return 401 for every question.',
    );
    process.exit(1);
  }

  // Load golden fixture
  let goldenEntries: GoldenEntry[];
  try {
    const raw = readFileSync(goldenPath, 'utf-8');
    goldenEntries = JSON.parse(raw) as GoldenEntry[];
  } catch (err) {
    console.error(
      `[einstein-eval] Failed to load golden fixture from ${goldenPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  console.log(
    `\n[einstein-eval] Running ${goldenEntries.length} questions against ${baseUrl} (farm: ${farmSlug})`,
  );
  console.log(`[einstein-eval] Golden fixture: ${goldenPath}\n`);

  // Run all questions sequentially (avoid rate-limiting the dev server)
  const results: EvalQuestionResult[] = [];
  for (let i = 0; i < goldenEntries.length; i++) {
    const entry = goldenEntries[i];
    process.stdout.write(`  [${i + 1}/${goldenEntries.length}] ${entry.id} ... `);
    const result = await runQuestion(baseUrl, farmSlug, entry);
    results.push(result);
    console.log(result.passed ? 'PASS' : `FAIL — ${result.reason}`);
  }

  // Compute G4
  const g4 = computeOverallG4(results);

  // Print summary table
  console.log(buildSummaryTable(results, g4));

  // Write JSON report
  const report = buildReport(farmSlug, goldenPath, results, g4);
  const reportPath = writeReport(report);
  console.log(`\n[einstein-eval] Report written: ${reportPath}`);

  process.exit(g4.pass ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('[einstein-eval] Unexpected top-level error:', err);
  process.exit(1);
});
