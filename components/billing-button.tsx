"use client";
import { useState } from "react";
export function BillingButton() {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function open() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/billing-portal", { method: "POST" }); const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || "Billing could not be opened.");
      window.location.assign(data.url);
    } catch (error) { setError(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="billing-action"><button type="button" className="button button--secondary" onClick={open} disabled={busy}>{busy ? "Opening…" : "Manage billing ↗"}</button>{error && <p role="alert" className="message message--error">{error}</p>}</div>;
}
