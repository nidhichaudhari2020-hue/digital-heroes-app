"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Charity = {
  id: string;
  name: string;
};

type CharityState = "loading" | "ready" | "empty" | "error";

function authErrorMessage(message: string) {
  // Supabase email/rate-limit errors
  if (
    /rate limit|too many requests|email rate limit exceeded/i.test(
      message
    )
  ) {
    return "Too many confirmation emails were requested. Please wait a few minutes and try again.";
  }

  // Network / configuration errors
  if (
    /failed to fetch|network|load failed|invalid api key|invalid supabase/i.test(
      message
    )
  ) {
    return "The membership service is temporarily unavailable. Please try again shortly.";
  }

  // Database errors
  if (/database error/i.test(message)) {
    return "We could not finish creating your account. Please try again shortly.";
  }

  // Invalid login
  if (/invalid login credentials/i.test(message)) {
    return "Incorrect email or password. Please check your details and try again.";
  }

  // Email not confirmed
  if (/email not confirmed/i.test(message)) {
    return "Please confirm your email address before logging in.";
  }

  return message;
}

export function AuthForm() {
  const [mode, setMode] =
    useState<"login" | "signup">("signup");

  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] =
    useState(false);

  const [busy, setBusy] = useState(false);

  const [charities, setCharities] =
    useState<Charity[]>([]);

  const [charityId, setCharityId] = useState("");

  const [charityState, setCharityState] =
    useState<CharityState>("loading");

  const [charityAttempt, setCharityAttempt] =
    useState(0);

  const [
    contributionPercent,
    setContributionPercent,
  ] = useState(10);

  const router = useRouter();

  // ==================================================
  // LOAD CHARITIES
  // ==================================================

  useEffect(() => {
    let mounted = true;
    let timedOut = false;

    const controller = new AbortController();

    setCharityState("loading");

    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();

      if (mounted) {
        setCharityState("error");
      }
    }, 12000);

    async function loadCharities() {
      try {
        const supabase = createClient();

        const { data, error } = await supabase
          .from("charities")
          .select("id,name")
          .order("is_featured", {
            ascending: false,
          })
          .abortSignal(controller.signal);

        if (!mounted || timedOut) {
          return;
        }

        if (error) {
          console.error(
            "Charity loading error:",
            error
          );

          setCharityState("error");
          return;
        }

        const available = data ?? [];

        setCharities(available);

        setCharityId((current) =>
          available.some(
            (charity) => charity.id === current
          )
            ? current
            : available[0]?.id ?? ""
        );

        setCharityState(
          available.length > 0
            ? "ready"
            : "empty"
        );
      } catch (error) {
        console.error(
          "Charity request failed:",
          error
        );

        if (mounted) {
          setCharityState("error");
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    loadCharities();

    return () => {
      mounted = false;

      window.clearTimeout(timeout);

      controller.abort();
    };
  }, [charityAttempt]);

  // ==================================================
  // SUBMIT
  // ==================================================

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    setMessageIsError(true);

    const email = String(
      formData.get("email") ?? ""
    ).trim();

    const password = String(
      formData.get("password") ?? ""
    );

    try {
      const supabase = createClient();

      // ================================================
      // CREATE ACCOUNT
      // ================================================

      if (mode === "signup") {
        const fullName = String(
          formData.get("fullName") ?? ""
        ).trim();

        // Validate name
        if (!fullName) {
          setMessage(
            "Please enter your full name."
          );
          return;
        }

        // Validate charity
        if (
          charityState !== "ready" ||
          !charities.some(
            (charity) =>
              charity.id === charityId
          )
        ) {
          setMessage(
            "Please load and choose an available charity before creating your account."
          );

          return;
        }

        // Validate contribution
        if (
          !Number.isFinite(
            contributionPercent
          ) ||
          contributionPercent < 10 ||
          contributionPercent > 100
        ) {
          setMessage(
            "Please choose a contribution between 10% and 100%."
          );

          return;
        }

        // ==============================================
        // SUPABASE SIGNUP
        // ==============================================

        const { data, error } =
          await supabase.auth.signUp({
            email,
            password,

            options: {
              // IMPORTANT:
              // Automatically uses 3000, 3001,
              // production Vercel URL, etc.
              emailRedirectTo:
                `${window.location.origin}/auth/callback?next=/dashboard`,

              data: {
                full_name: fullName,
                charity_id: charityId,
                contribution_percent:
                  contributionPercent,
              },
            },
          });

        // ==============================================
        // SIGNUP ERROR
        // ==============================================
if (error) {
  // Expected Supabase rate-limit error
  if (
    /rate limit|too many requests|email rate limit exceeded/i.test(
      error.message
    )
  ) {
    setMessageIsError(true);
    setMessage(
      "Too many confirmation emails have been requested. Please wait a few minutes and try again."
    );
    return;
  }

  console.warn("Signup failed:", error.message);

  setMessageIsError(true);
  setMessage(authErrorMessage(error.message));

  return;
}
        // ==============================================
        // EMAIL CONFIRMATION DISABLED
        // ==============================================

        if (data.session) {
          setMessageIsError(false);

          router.replace("/dashboard");
          router.refresh();

          return;
        }

        // ==============================================
        // EMAIL CONFIRMATION REQUIRED
        // ==============================================

        setMessageIsError(false);

        setMessage(
          "Account created. Check your inbox and click the confirmation link to activate your membership."
        );

        return;
      }

      // ==================================================
      // LOGIN
      // ==================================================

      const { error } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });

      if (error) {
        console.error(
          "Login error:",
          error
        );

        setMessage(
          authErrorMessage(error.message)
        );

        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      console.error(
        "Authentication error:",
        error
      );

      setMessage(
        "The membership service is temporarily unavailable. Please try again shortly."
      );
    } finally {
      setBusy(false);
    }
  }

  // ==================================================
  // UI
  // ==================================================

  return (
    <section className="auth-card">

      {/* TABS */}

      <div className="tabs">
        <button
          type="button"
          disabled={busy}
          aria-pressed={mode === "signup"}
          className={
            mode === "signup"
              ? "active"
              : ""
          }
          onClick={() => {
            setMode("signup");
            setMessage("");
          }}
        >
          Create account
        </button>

        <button
          type="button"
          disabled={busy}
          aria-pressed={mode === "login"}
          className={
            mode === "login"
              ? "active"
              : ""
          }
          onClick={() => {
            setMode("login");
            setMessage("");
          }}
        >
          Log in
        </button>
      </div>

      {/* FORM */}

      <form action={submit}>

        {/* FULL NAME */}

        {mode === "signup" && (
          <label>
            Full name

            <input
              name="fullName"
              required
              placeholder="Alex Morgan"
            />
          </label>
        )}

        {/* EMAIL */}

        <label>
          Email

          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
        </label>

        {/* PASSWORD */}

        <label>
          Password

          <input
            name="password"
            type="password"
            minLength={8}
            required
            autoComplete={
              mode === "signup"
                ? "new-password"
                : "current-password"
            }
            placeholder="At least 8 characters"
          />
        </label>

        {/* SIGNUP OPTIONS */}

        {mode === "signup" && (
          <fieldset className="signup-impact">

            <legend>Your impact</legend>

            <p>
              Choose where your membership
              contribution will go. You can
              change this later in your
              dashboard.
            </p>

            {/* CHARITY */}

            <label>
              Choose a charity

              <select
                value={charityId}
                onChange={(event) =>
                  setCharityId(
                    event.target.value
                  )
                }
                required
                disabled={
                  charityState !== "ready" ||
                  busy
                }
                aria-describedby={
                  charityState !== "ready"
                    ? "charity-status"
                    : undefined
                }
              >
                {!charities.length && (
                  <option value="">
                    {charityState ===
                    "loading"
                      ? "Loading available causes…"
                      : "Charities unavailable"}
                  </option>
                )}

                {charities.map(
                  (charity) => (
                    <option
                      key={charity.id}
                      value={charity.id}
                    >
                      {charity.name}
                    </option>
                  )
                )}
              </select>
            </label>

            {/* CHARITY ERROR */}

            {charityState !== "ready" && (
              <div>
                <p
                  id="charity-status"
                  className={
                    charityState ===
                    "loading"
                      ? "message"
                      : "message message--error"
                  }
                  role={
                    charityState ===
                    "loading"
                      ? "status"
                      : "alert"
                  }
                >
                  {charityState ===
                  "loading"
                    ? "Finding available charities…"
                    : charityState ===
                      "empty"
                    ? "No charities are available yet. Please check again shortly. Existing members can still log in."
                    : "We could not load the charities. Please retry in a moment. Existing members can still log in."}
                </p>

                {charityState !==
                  "loading" && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      setCharityAttempt(
                        (attempt) =>
                          attempt + 1
                      )
                    }
                  >
                    Retry loading charities
                  </button>
                )}
              </div>
            )}

            {/* CONTRIBUTION */}

            <label>
              Contribution percentage

              <input
                value={
                  contributionPercent
                }
                onChange={(event) =>
                  setContributionPercent(
                    Number(
                      event.target.value
                    )
                  )
                }
                type="number"
                min="10"
                max="100"
                step="0.01"
                required
              />
            </label>
          </fieldset>
        )}

        {/* SUBMIT */}

        <button
          className="button"
          disabled={
            busy ||
            (mode === "signup" &&
              (charityState !==
                "ready" ||
                !charities.some(
                  (charity) =>
                    charity.id ===
                    charityId
                )))
          }
        >
          {busy
            ? "Please wait…"
            : mode === "signup"
            ? "Create account"
            : "Log in"}
        </button>
      </form>

      {/* STATUS MESSAGE */}

      {message && (
        <p
          className={
            messageIsError
              ? "message message--error"
              : "message"
          }
          role={
            messageIsError
              ? "alert"
              : "status"
          }
        >
          {message}
        </p>
      )}
    </section>
  );
}