import { api, ApiRequestError, NetworkError, type FeedbackReport } from "./api.ts";

const retryable = (err: unknown) => err instanceof NetworkError || (err instanceof ApiRequestError && (err.status === 429 || err.status >= 500));

/**
 * Reports the person already approved but couldn't send (offline). Kept outside the
 * per-account database so reports from the sign-in screen survive too; at most 5 are kept.
 */
const KEY = "bp.feedback.queue";
const MAX = 5;

function read(): FeedbackReport[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function write(queue: FeedbackReport[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue.slice(-MAX)));
  } catch {
    // Storage full: drop screenshots first, then give up quietly (the person was told it's queued).
    localStorage.setItem(KEY, JSON.stringify(queue.slice(-MAX).map((r) => ({ ...r, screenshot: null }))));
  }
}

export const queuedReports = () => read().length;

/** Sends now if possible; otherwise queues. Returns "sent" or "queued". */
export async function submitReport(report: FeedbackReport): Promise<"sent" | "queued"> {
  try {
    await api.feedback(report);
    return "sent";
  } catch (err) {
    if (!retryable(err)) throw err;
    write([...read().filter((r) => r.id !== report.id), report]);
    return "queued";
  }
}

/** Retries queued reports (same ids, so the server never stores one twice). */
export async function flushReports(): Promise<void> {
  const queue = read();
  const left: FeedbackReport[] = [];
  for (const r of queue) {
    try {
      await api.feedback(r);
    } catch (err) {
      if (retryable(err)) left.push(r);
      // Any other answer (invalid, rate-limited) is final for this report; keep the queue moving.
    }
  }
  write(left);
}
