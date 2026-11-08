import "./globals.css";
import Link from "next/link";
export const metadata = { title: "TicketLine" };
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-6">
          <span className="font-bold text-lg">TicketLine</span>
          <nav className="flex gap-4 text-sm text-zinc-400">
            <Link href="/" className="hover:text-zinc-100">Mainnet Runway</Link>
            <Link href="/pool" className="hover:text-zinc-100">Pool</Link>
            <Link href="/demo" className="hover:text-zinc-100">Demo</Link>
          </nav>
        </header>
        <main className="px-6 py-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
