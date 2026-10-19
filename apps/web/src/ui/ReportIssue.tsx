import { useEffect, useState } from "react";
import { snapshot, track } from "../activity.ts";
import { ApiRequestError } from "../api.ts";
import { flushReports, submitReport } from "../feedbackQueue.ts";
import { Sheet } from "./common.tsx";
import { Icon } from "./icons.tsx";

const KINDS = [
  { value: "bug", label: "Something's wrong" },
  { value: "feedback", label: "General feedback" },
  { value: "suggestion", label: "Suggestion" },
] as const;

const deviceClass = (): "phone" | "tablet" | "desktop" => (innerWidth < 600 ? "phone" : innerWidth < 1024 ? "tablet" : "desktop");

/** Captures the visible screen with typed text and private fields hidden. Loaded only when asked. */
async function captureScreen(): Promise<string | null> {
  const { toJpeg } = await import("html-to-image");
  document.documentElement.classList.add("bp-capturing");
  try {
    const ratio = Math.min(1, 720 / innerWidth);
    for (const quality of [0.7, 0.5, 0.35]) {
      const url = await toJpeg(document.body, {
        quality,
        pixelRatio: ratio,
        backgroundColor: "#FAFBF9",
        skipFonts: true,
        height: innerHeight,
        width: innerWidth,
        style: { transform: `translateY(-${scrollY}px)` },
        filter: (node) => !(node instanceof HTMLElement && node.dataset.noCapture !== undefined),
      });
      if (url.length < 390_000) return url;
    }
    return null;
  } catch {
    return null;
  } finally {
    document.documentElement.classList.remove("bp-capturing");
  }
}

function ReportSheet({ route, shot, onClose }: { route: string; shot: string | null; onClose: () => void }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("bug");
  const [message, setMessage] = useState("");
  const [steps, setSteps] = useState(() => snapshot().events.slice(-12));
  const [attach, setAttach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"sent" | "queued" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const snap = snapshot();
    try {
      const outcome = await submitReport({
        id: crypto.randomUUID(),
        kind,
        message: message.trim(),
        activity: steps,
        context: {
          route: route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id"),
          appVersion: import.meta.env.PUBLIC_APP_VERSION ?? "dev",
          deviceClass: deviceClass(),
          online: navigator.onLine,
          requestIds: snap.requestIds,
          error: snap.error,
        },
        screenshot: attach ? shot : null,
      });
      track(outcome === "sent" ? "Sent an issue report" : "Saved an issue report to send later");
      setDone(outcome);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't send the report. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Sheet title="Thanks for telling us" onClose={onClose}>
        <p data-testid="report-done">
          {done === "sent" ? "Your report was sent. It helps us fix things faster." : "You're offline, so your report is saved on this device. It will be sent when you're back online."}
        </p>
        <div className="sheet-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Report an issue" onClose={onClose}>
      <div className="choice-row" role="group" aria-label="Kind of report">
        {KINDS.map((k) => (
          <button key={k.value} type="button" aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>
            {k.label}
          </button>
        ))}
      </div>
      <label htmlFor="report-message">What happened?</label>
      <textarea id="report-message" rows={4} value={message} maxLength={4000} placeholder="What you were doing and what you expected" onChange={(e) => setMessage(e.target.value)} />

      <h3 style={{ marginTop: 18 }}>Recent steps we'll include</h3>
      {steps.length === 0 ? (
        <p className="hint">No recent steps.</p>
      ) : (
        <ol className="report-steps" data-testid="report-steps">
          {steps.map((s, i) => (
            <li key={`${s.at}-${i}`}>
              <span>{s.event}</span>
              <button type="button" className="icon-btn" aria-label={`Leave out "${s.event}"`} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                <Icon name="close" size={16} />
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="hint">Steps never include what you type, your recipes' contents or anything you ate.</p>

      {shot ? (
        <>
          <label className="check">
            <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
            Include a screenshot of this screen
          </label>
          {attach && (
            <figure className="report-shot">
              <img src={shot} alt="Screenshot that will be sent, with typed text hidden" />
              <figcaption className="hint">Text you typed into fields and your email are hidden. Everything else on the screen is visible, so check it first. Uncheck to leave it out.</figcaption>
            </figure>
          )}
        </>
      ) : (
        <p className="hint">A screenshot isn't available on this screen.</p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="sheet-actions">
        <button type="button" className="btn-primary" disabled={busy || !message.trim()} onClick={() => void send()}>
          {busy ? "Sending…" : "Send report"}
        </button>
      </div>
      <p className="fine">We use reports only to fix and improve the app. We also attach the app version, screen name, device type and error codes.</p>
    </Sheet>
  );
}

/** The persistent "Report an issue" button, present on every screen. */
export function ReportIssue({ route, className = "report-btn" }: { route: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState<string | null>(null);

  useEffect(() => {
    const flush = () => void flushReports();
    flush();
    addEventListener("online", flush);
    return () => removeEventListener("online", flush);
  }, []);

  async function start() {
    setShot(await captureScreen());
    setOpen(true);
  }

  return (
    <>
      <button type="button" className={className} aria-label="Report an issue" title="Report an issue" data-no-capture onClick={() => void start()}>
        <Icon name="flag" />
      </button>
      {open && <ReportSheet route={route} shot={shot} onClose={() => setOpen(false)} />}
    </>
  );
}
