"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AppHeader({ admin = false }: { admin?: boolean }) {
  const router = useRouter();
  async function signOut(){await createClient().auth.signOut();router.push("/");router.refresh();}
  return <header className="app-topbar"><div className="app-topbar__left"><Link className="brand" href="/">impact<b>.</b></Link><span className="app-topbar__label">{admin?"ADMIN CONTROL ROOM":"MEMBER SPACE"}</span></div><nav><Link href="/dashboard">Dashboard</Link>{admin&&<Link href="/admin">Admin</Link>}<Link href="/charities">Causes</Link><button className="nav-button" onClick={signOut}>Log out</button></nav></header>;
}
