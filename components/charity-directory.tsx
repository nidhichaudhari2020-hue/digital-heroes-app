"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Charity = { id: string; name: string; slug: string; description: string; image_url: string | null; is_featured: boolean };
const fallback: Charity[] = [
  { id: "mind", name: "Mind", slug: "mind", description: "Mental health support and advocacy for everyone.", image_url: null, is_featured: true },
  { id: "shelter", name: "Shelter", slug: "shelter", description: "Helping people find and keep a safe place to call home.", image_url: null, is_featured: false },
  { id: "wwf", name: "WWF", slug: "wwf", description: "Protecting and restoring the natural world.", image_url: null, is_featured: false },
];

export function CharityDirectory() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "featured">("all");
  const [items, setItems] = useState<Charity[]>(fallback);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const { data } = await createClient().from("charities").select("id,name,slug,description,image_url,is_featured").order("is_featured", { ascending: false });
        if (data?.length && mounted) setItems(data);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  const shown = useMemo(() => items.filter((item) => {
    const matchesText = `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase());
    return matchesText && (filter === "all" || item.is_featured);
  }), [filter, items, query]);

  return <section className="directory">
    <div className="directory-toolbar">
      <label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search causes" aria-label="Search charities" /></label>
      <div className="directory-controls" aria-label="Charity filters">
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All causes</button>
        <button type="button" className={filter === "featured" ? "active" : ""} onClick={() => setFilter("featured")}>Featured</button>
        <span>{loading ? "Finding causes…" : `${shown.length} causes to explore`}</span>
      </div>
    </div>
    <div className="charity-grid">{shown.map((item, index) => <article className={`charity-card charity-card--${index % 3}`} key={item.id}><small>{item.is_featured ? "FEATURED CAUSE" : `CAUSE ${String(index + 1).padStart(2, "0")}`}</small>{item.image_url ? <img className="charity-image" src={item.image_url} alt="" /> : <div className="charity-mark">{item.name.slice(0, 1)}</div>}<h2>{item.name}</h2><p>{item.description}</p><a href={`/charities/${item.slug}`}>Meet the cause <b>→</b></a></article>)}</div>
    {!shown.length && <p className="empty-state">No causes match that search or filter. Try another option.</p>}
  </section>;
}
