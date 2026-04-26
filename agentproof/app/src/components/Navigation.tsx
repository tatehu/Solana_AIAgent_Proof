"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { Shield } from "lucide-react";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

const NAV_LINKS = [
  { href: "/", label: "Explore" },
  { href: "/leaderboard", label: "Reputation" },
  { href: "/register", label: "Register" },
  { href: "/verify", label: "Verify" },
  { href: "/insurance", label: "Insurance" },
  { href: "/monitor", label: "Risk Monitor" },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-white/5 bg-slate-950/80 backdrop-blur-xl">
      <div className="container mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="h-9 w-9 rounded-2xl gradient-btn flex items-center justify-center shadow-blue-glow">
            <Shield className="h-4 w-4 text-white" />
          </div>
          <span className="font-bold text-lg text-white tracking-tight">AgentProof</span>
          <span className="text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-medium">
            Devnet
          </span>
        </Link>

        {/* Links */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`nav-link ${active ? "active bg-white/5" : ""}`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        {/* Wallet */}
        <WalletMultiButton
          style={{
            background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #db2777 100%)",
            borderRadius: "14px",
            height: "38px",
            fontSize: "13px",
            fontWeight: 600,
            padding: "0 16px",
            boxShadow: "rgba(59, 130, 246, 0.2) 0px 10px 15px -3px",
          }}
        />
      </div>
    </nav>
  );
}
