import { useState, type FormEvent } from "react";
import { api, ApiRequestError, NetworkError } from "../api.ts";
import { useApp } from "../store.tsx";

export function SignIn() {
  const { setAccount, online } = useApp();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const describe = (err: unknown) =>
    err instanceof NetworkError
      ? "You're offline. Signing in needs a connection."
      : err instanceof ApiRequestError && err.status === 429
        ? "Too many attempts. Wait a minute and try again."
        : "That didn't work. Check the code and try again.";

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.sendCode(email.trim());
      setStep("code");
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.signIn(email.trim(), code.trim());
      setAccount(await api.me());
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <div className="signin-card">
        <p className="eyebrow">The Better Plate</p>
        <h1>Your kitchen, with you everywhere</h1>
        <p className="lede">Save recipes on this device, cook with clear steps, and see nutrition estimates traced to USDA data.</p>
        {step === "email" ? (
          <form onSubmit={sendCode}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn-primary" type="submit" disabled={busy || !online}>
              {busy ? "Sending…" : "Email me a sign-in code"}
            </button>
            {!online && <p className="hint">You're offline. Signing in needs a connection.</p>}
          </form>
        ) : (
          <form onSubmit={verify}>
            <p className="hint">We sent a 6-digit code to {email}.</p>
            <label htmlFor="code">Code</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? "Checking…" : "Sign in"}
            </button>
            <button className="btn-link" type="button" onClick={() => setStep("email")}>
              Use a different email
            </button>
          </form>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="fine">For adults. Estimates are educational, not medical advice. We store your email and the meals you choose to save.</p>
      </div>
    </main>
  );
}
