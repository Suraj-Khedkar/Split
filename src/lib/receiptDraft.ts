import type { ReceiptItem } from './api';

export interface ReceiptDraft {
  groupId: string;
  /** What OCR read off the receipt, minus anything the user unticked. */
  items: ReceiptItem[];
  /** The receipt's own total, which usually exceeds the items by tax/service. */
  total: number;
  merchant: string | null;
}

/**
 * Hands a scanned receipt from the scan screen to the assign screen.
 *
 * Module state rather than route params: a long receipt is tens of items, and
 * JSON-encoding that into a query string runs into URL length limits on web
 * and is unreadable in the address bar. The two screens are one navigation
 * apart, so nothing needs to survive a reload — and if it does not, the assign
 * screen sends the user back to scan rather than showing an empty list.
 */
let draft: ReceiptDraft | null = null;

export function setReceiptDraft(next: ReceiptDraft): void {
  draft = next;
}

export function readReceiptDraft(): ReceiptDraft | null {
  return draft;
}

export function clearReceiptDraft(): void {
  draft = null;
}
