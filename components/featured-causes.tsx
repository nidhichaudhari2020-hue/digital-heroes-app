import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type FeaturedCause = { id: string; name: string; slug: string; description: string };
const fallback: FeaturedCause[] = [
  { id: "mind", name: "Mind", slug: "mind", description: "Mental health for all" },
  { id: "shelter", name: "Shelter", slug: "shelter", description: "A home for everyone" },
  { id: "wwf", name: "WWF", slug: "wwf", description: "For a living planet" },
];
const colors = ["coral", "violet", "lime"];

export async function FeaturedCauses() {
  let causes = fallback;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("charities")
      .select("id,name,slug,description")
      .eq("is_featured", true)
      .limit(3);
    if (data?.length) causes = data;
  } catch {
    // The marketing page remains useful during local visual development before
    // Supabase has been connected.
  }

  return <div className="cause-showcase">{causes.map((cause, index) => <article className={`cause-showcase__card cause-showcase__card--${colors[index % colors.length]}`} key={cause.id}><small>{String(index + 1).padStart(2, "0")}</small><div>{cause.name}</div><p>{cause.description}</p><Link href={`/charities/${cause.slug}`}>Meet the cause <b>→</b></Link></article>)}</div>;
}
