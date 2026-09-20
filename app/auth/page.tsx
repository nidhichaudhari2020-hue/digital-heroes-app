import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
export default function AuthPage(){return <main className="auth-page"><Link className="brand" href="/">impact<b>.</b></Link><div><div className="eyebrow">MEMBER ACCESS</div><h1>Play with <em>purpose.</em></h1><p>Create your membership to track scores, support a charity, and enter the monthly draw.</p><AuthForm /></div></main>}
