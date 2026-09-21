"use client";

import { useState } from "react";

export function DonationForm({ charityId, charityName }: { charityId: string; charityName: string }) {
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function donate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ charityId, amount: Number(amount) }),
      });
      const data = await response.json();
      if (data.url) window.location.assign(data.url);
      else setMessage(data.error || "We could not start your donation.");
    } catch {
      setMessage("We could not start your donation. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="donation-form" onSubmit={donate}>
    <label>
      Give directly to {charityName}
      <span className="donation-field"><b>₹</b><input value={amount} onChange={event => setAmount(event.target.value)} type="number" min="1" max="10000" step="1" required /></span>
    </label>
    <button className="button button--light" disabled={busy}>{busy ? "Opening checkout…" : "Donate securely"}</button>
    {message && <p className="message message--error">{message}</p>}
  </form>;
}
