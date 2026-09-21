import type { Metadata } from "next";
import "./globals.css";
import "./professional.css";
import "./release.css";
import "./donation.css";
import "./membership.css";
import "./media.css";

export const metadata: Metadata = { title: "impact. | Play with purpose", description: "A charity-led golf membership with score tracking and transparent monthly prize draws.", metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://digital-heroes-app-one.vercel.app") };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
