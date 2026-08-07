/**
 * Receipt OCR, behind a provider switch.
 *
 * Runs server-side on purpose: the API key never reaches the browser, and
 * swapping providers needs no client release.
 *
 *   OCR_PROVIDER=ocrspace   (default) OCR.space free tier — 25k/month, 500/day
 *                           per IP, 1MB per image. Images leave the machine.
 *   OCR_PROVIDER=tesseract  local `tesseract` binary. No limits, nothing
 *                           leaves pinaka, but you must install it:
 *                             sudo apt install tesseract-ocr
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const PROVIDER = (process.env.OCR_PROVIDER ?? 'ocrspace').toLowerCase();
const OCR_SPACE_KEY = process.env.OCR_SPACE_KEY ?? 'helloworld';

async function ocrSpace(imageBase64, filename) {
  const form = new FormData();
  const clean = imageBase64.replace(/^data:[^;]+;base64,/, '');
  const bytes = Buffer.from(clean, 'base64');
  if (bytes.length > 1024 * 1024) {
    throw new Error('Image is over the 1MB free-tier limit — compress it further');
  }
  form.append('file', new Blob([bytes]), filename);
  form.append('OCREngine', '2');
  form.append('scale', 'true');
  form.append('isTable', 'true');

  const resp = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: { apikey: OCR_SPACE_KEY },
    body: form,
  });
  const data = await resp.json();
  if (data.IsErroredOnProcessing) {
    throw new Error([].concat(data.ErrorMessage ?? 'unknown error').join('; '));
  }
  return data.ParsedResults?.[0]?.ParsedText ?? '';
}

async function tesseract(imageBase64) {
  const dir = await mkdtemp(join(tmpdir(), 'ocr-'));
  try {
    const file = join(dir, 'receipt.png');
    await writeFile(file, Buffer.from(imageBase64.replace(/^data:[^;]+;base64,/, ''), 'base64'));
    const { stdout } = await run('tesseract', [file, 'stdout', '--psm', '6']);
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Pull a total and candidate line items out of raw OCR text.
 *
 * Deliberately conservative: a receipt parsed slightly wrong is worse than one
 * that just prefills the total, because a wrong number gets split and silently
 * poisons everyone's balance. The user confirms everything before saving.
 */
export function parseReceipt(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const money = /(\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/;
  const toMinor = (raw) => {
    const normalised = raw.replace(/[\s,](?=\d{3}\b)/g, '').replace(',', '.');
    const value = Number.parseFloat(normalised);
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  };

  let total = null;
  // Walk bottom-up: the grand total is nearly always the last total-ish line,
  // after subtotal/tax.
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!/(grand\s*total|total|amount\s*due|balance|net\s*payable)/i.test(line)) continue;
    if (/sub\s*total|subtotal/i.test(line) && total !== null) continue;
    const match = line.match(new RegExp(money.source + '\\s*$'));
    const value = match ? toMinor(match[1]) : null;
    if (value && value > 0) {
      total = value;
      break;
    }
  }

  const items = [];
  for (const line of lines) {
    if (/(total|subtotal|tax|gst|vat|change|cash|card|tip|discount|balance)/i.test(line)) continue;
    const match = line.match(new RegExp('^(.*?)\\s+' + money.source + '\\s*$'));
    if (!match) continue;
    const label = match[1].replace(/[.\s]+$/, '').trim();
    const value = toMinor(match[2]);
    if (label.length >= 2 && value && value > 0) {
      items.push({ label, amount: value });
    }
  }

  // Fall back to the largest number seen when no total line was found.
  if (total === null && items.length) {
    total = Math.max(...items.map((i) => i.amount));
  }

  const merchant = lines.find((l) => /^[A-Za-z][A-Za-z&'.\s-]{2,}$/.test(l) && l.length <= 40);

  return { total, items, merchant: merchant ?? null, lineCount: lines.length };
}

export async function runOcr(imageBase64, filename) {
  const text =
    PROVIDER === 'tesseract'
      ? await tesseract(imageBase64)
      : await ocrSpace(imageBase64, filename);
  return { provider: PROVIDER, text, ...parseReceipt(text) };
}
