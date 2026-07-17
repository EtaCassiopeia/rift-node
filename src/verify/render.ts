/**
 * Pure renderer for a `VerificationError` (issue #6, design §6.3) — a standalone function so the
 * testkit's `assertReceived` (issue #12) can reuse it verbatim instead of re-deriving the format.
 *
 * Layout is four blocks joined by a blank line: the header (`err.message`), an `Expected`/`Actual`
 * pair, a middle block that's either the "closest non-match" breakdown, a one-line count
 * explanation, or an empty-journal note, and (when anything was recorded) an `All recorded` list.
 */

import type { JsonValue, Predicate } from '../model/index.js';
import type { RecordedRequest } from './index.js';
import type { VerificationError } from '../errors.js';
import { collectLeafDetails, type LeafDetail } from './eval.js';

const LABEL_WIDTH = 10;

export function renderVerificationFailure(err: VerificationError): string {
  const blocks: string[] = [err.message, `${renderExpectedLine(err)}\n${renderActualLine(err)}`];

  const middle = renderMiddleBlock(err);
  if (middle !== undefined) blocks.push(middle);

  if (err.recorded.length > 0) blocks.push(renderAllRecordedLine(err.recorded));

  return blocks.join('\n\n');
}

function renderExpectedLine(err: VerificationError): string {
  const content = renderExpectedContent(err.expected);
  return `${'Expected'.padEnd(LABEL_WIDTH)}${padGap(content, 24)}${err.count.matcher.describe()}`;
}

function renderActualLine(err: VerificationError): string {
  const { matched, total } = err.count;
  return `${'Actual'.padEnd(LABEL_WIDTH)}${matched} of ${total} recorded requests matched`;
}

function renderMiddleBlock(err: VerificationError): string | undefined {
  if (err.recorded.length === 0) {
    return 'No requests have been recorded on this imposter yet.';
  }
  if (err.count.matched > 0) {
    return explainCount(err.count);
  }
  if (err.closest !== undefined) {
    return renderClosestBlock(err.expected, err.recorded, err.closest);
  }
  return undefined;
}

function explainCount(count: VerificationError['count']): string {
  const { min, max } = count.matcher;
  const requirement =
    min === max
      ? `exactly ${min}`
      : max === Infinity
        ? `at least ${min}`
        : min === 0
          ? `at most ${max}`
          : `between ${min} and ${max}`;
  return `Matched ${count.matched} request(s); ${count.matcher.describe()} requires ${requirement}.`;
}

function renderClosestBlock(
  expected: Predicate[],
  recorded: RecordedRequest[],
  closest: NonNullable<VerificationError['closest']>
): string {
  const index = recorded.indexOf(closest.request);
  const header = `Closest non-match — request #${index + 1} at ${closest.request.timestamp} from ${closest.request.from}:`;
  const leaves = collectLeafDetails(expected, closest.request);
  return [header, ...renderRows(leaves)].join('\n');
}

function renderRows(leaves: LeafDetail[]): string[] {
  if (leaves.length === 0) return [];
  const rows = leaves.map((l) => ({
    label: labelFor(l.field),
    content: contentFor(l),
    mark: l.passed ? '✓' : '✗',
    suffix: l.passed ? undefined : `expected ${formatExpected(l.operator, l.expected)}`,
  }));
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const contentWidth = Math.max(...rows.map((r) => r.content.length));
  return rows.map((r) => {
    const base = `  ${r.label.padEnd(labelWidth + 2)}${r.content.padEnd(contentWidth + 2)}${r.mark}`;
    return r.suffix !== undefined ? `${base}  ${r.suffix}` : base;
  });
}

function labelFor(field: string): string {
  if (field === 'headers') return 'header';
  if (field === 'query') return 'query';
  return field;
}

function contentFor(l: LeafDetail): string {
  let display: string;
  if (l.note === undefined) {
    display = displayValue(l.actual);
  } else if (l.actual === undefined) {
    display = `(${l.note})`;
  } else {
    display = `${displayValue(l.actual)} (${l.note})`;
  }
  return l.key !== undefined ? `${l.key}: ${display}` : display;
}

function displayValue(v: unknown): string {
  if (v === undefined) return '(absent)';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(displayValue).join(', ');
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return JSON.stringify(v);
}

function formatExpected(operator: string, expected: JsonValue | boolean): string {
  if (operator === 'exists') return `exists ${expected}`;
  const display = typeof expected === 'string' ? `"${expected}"` : JSON.stringify(expected);
  return `${operator} ${display}`;
}

function renderAllRecordedLine(recorded: RecordedRequest[]): string {
  return `All recorded: ${recorded.map((r) => `${r.method} ${r.path}`).join(', ')}`;
}

/** Compact `METHOD /path` form for the common two-predicate `equals(method) + equals(path)` shape
 * that `onGet`/`onPost`/... produce; anything else falls back to JSON so nothing is misrepresented. */
function renderExpectedContent(predicates: Predicate[]): string {
  if (predicates.length === 0) return '(no predicates — matches every request)';
  if (predicates.length === 2) {
    const method = simpleEquals(predicates, 'method');
    const path = simpleEquals(predicates, 'path');
    if (method !== undefined && path !== undefined) return `${method} ${path}`;
  }
  if (predicates.length === 1) {
    const path = simpleEquals(predicates, 'path');
    if (path !== undefined) return `ANY ${path}`;
  }
  return JSON.stringify(predicates);
}

function simpleEquals(predicates: Predicate[], field: string): string | undefined {
  const pred = predicates.find((p) => {
    const keys = Object.keys(p);
    return keys.length === 1 && keys[0] === 'equals' && p.equals !== undefined && Object.keys(p.equals).length === 1 && field in p.equals;
  });
  const value = pred?.equals?.[field];
  return typeof value === 'string' ? value : undefined;
}

function padGap(s: string, width: number): string {
  return s.length >= width ? `${s}  ` : s.padEnd(width);
}
