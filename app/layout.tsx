import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "impact. | Play with purpose", description: "Golf membership that gives back." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
