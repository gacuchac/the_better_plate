import { useEffect, useState, type FormEvent } from "react";
import { api, ApiRequestError, NetworkError } from "../api.ts";
import { useApp } from "../store.tsx";

export function SignIn() {
  const { setAccount, online } = useApp();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(location.search).has("signin") ? "Google sign-in didn't finish. Try again, or use an email code." : null,
  );
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    // Drop the one-time ?signin=… marker so a reload doesn't show the message again.
    if (location.search) history.replaceState(null, "", location.pathname + location.hash);
  }, []);

  useEffect(() => {
    if (!online) return;
    void api.signInMethods().then((r) => setGoogle(r.methods.includes("google")), () => setGoogle(false));
  }, [online]);

  async function continueWithGoogle() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.googleSignIn(`${location.origin}/`);
      location.assign(url);
    } catch (err) {
      setError(describe(err, "Google sign-in isn't available right now. Use an email code instead."));
      setBusy(false);
    }
  }

  const describe = (err: unknown, fallback: string) =>
    err instanceof NetworkError
      ? "You're offline. Signing in needs a connection."
      : err instanceof ApiRequestError && err.status === 429
        ? "Too many attempts. Wait a minute and try again."
        : fallback;

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.sendCode(email.trim());
      setStep("code");
    } catch (err) {
      setError(describe(err, "We couldn't send a code right now. Check the address and try again in a moment."));
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
      setError(describe(err, "That didn't work. Check the code and try again."));
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
        {step === "email" && google && (
          <>
            <button className="btn-google" type="button" onClick={() => void continueWithGoogle()} disabled={busy || !online}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.7 17.8 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
                <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
                <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
              </svg>
              Continue with Google
            </button>
            <p className="divider" aria-hidden="true">
              <span>or</span>
            </p>
          </>
        )}
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
