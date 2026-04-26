import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/components/WalletProvider";
import { Navigation } from "@/components/Navigation";
import Link from "next/link";
import { Mail, MapPin, Shield } from "lucide-react";

export const metadata: Metadata = {
  title: "AgentProof — Verifiable AI Agent Behavior Oracle",
  description:
    "The first verifiable AI Agent behavior protocol on Solana. Every Agent action, proven on-chain.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#020617] text-white min-h-screen font-sans antialiased flex flex-col">
        {/* ── Full-page ambient background ── */}
        <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
          {/* base dark gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#020617] via-[#0d0f1f] to-[#020617]" />
          {/* massive blob orbs — spread across full page */}
          <div className="blob absolute -top-1/4 -left-1/4 w-[90vw] h-[90vh] rounded-full bg-blue-600/8 blur-[120px]" />
          <div className="blob blob-delay-2 absolute top-1/4 -right-1/4 w-[80vw] h-[80vh] rounded-full bg-purple-600/8 blur-[120px]" />
          <div className="blob blob-delay-4 absolute bottom-0 left-1/4 w-[70vw] h-[70vh] rounded-full bg-blue-500/6 blur-[100px]" />
          <div className="blob absolute bottom-1/4 right-1/3 w-[60vw] h-[60vh] rounded-full bg-violet-600/6 blur-[100px]" />
        </div>
        <WalletProvider>
          <Navigation />
          <main className="container mx-auto max-w-7xl px-6 pt-16 flex-1 pb-16">{children}</main>

          {/* ── Footer ── */}
          <footer className="border-t border-white/5 bg-[#07071a]/80 mt-8">
            <div className="container mx-auto max-w-7xl px-6 py-14">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-10">

                {/* Brand */}
                <div className="md:col-span-1 space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
                      <Shield className="h-4 w-4 text-blue-400" />
                    </div>
                    <span className="font-extrabold text-lg gradient-text-animated">AgentProof</span>
                  </div>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    The first verifiable AI agent behavior protocol on Solana. Every agent action, proven on-chain.
                  </p>
                  <div className="space-y-2 text-sm text-slate-500">
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <a href="mailto:contact@agentproof.xyz" className="hover:text-blue-400 transition-colors">
                        contact@agentproof.xyz
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span>Built on Solana</span>
                    </div>
                  </div>
                </div>

                {/* Protocol */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Protocol</p>
                  <ul className="space-y-2.5 text-sm text-slate-500">
                    <li><Link href="/" className="hover:text-blue-400 transition-colors">Home</Link></li>
                    <li><Link href="/leaderboard" className="hover:text-blue-400 transition-colors">Reputation Board</Link></li>
                    <li><Link href="/monitor" className="hover:text-blue-400 transition-colors">Risk Monitor</Link></li>
                    <li><Link href="/register" className="hover:text-blue-400 transition-colors">Register Agent</Link></li>
                  </ul>
                </div>

                {/* Resources */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Resources</p>
                  <ul className="space-y-2.5 text-sm text-slate-500">
                    <li>
                      <a href="https://solana.com" target="_blank" rel="noreferrer" className="hover:text-blue-400 transition-colors">
                        Solana Network
                      </a>
                    </li>
                    <li>
                      <a href="https://explorer.solana.com" target="_blank" rel="noreferrer" className="hover:text-blue-400 transition-colors">
                        Block Explorer
                      </a>
                    </li>
                    <li>
                      <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-blue-400 transition-colors">
                        GitHub
                      </a>
                    </li>
                  </ul>
                </div>

                {/* Legal */}
                <div className="space-y-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Legal</p>
                  <ul className="space-y-2.5 text-sm text-slate-500">
                    <li><a href="#" className="hover:text-blue-400 transition-colors">Terms of Service</a></li>
                    <li><a href="#" className="hover:text-blue-400 transition-colors">Privacy Policy</a></li>
                    <li><a href="#" className="hover:text-blue-400 transition-colors">Disclaimer</a></li>
                  </ul>
                </div>

              </div>
            </div>

            {/* Bottom bar */}
            <div className="border-t border-white/5">
              <div className="container mx-auto max-w-7xl px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
                <span>© 2026 AgentProof. All rights reserved.</span>
                <span>
                  Built on{" "}
                  <a href="https://solana.com" target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-400 transition-colors">
                    Solana
                  </a>
                  {" · "}Powered by on-chain proofs
                </span>
              </div>
            </div>
          </footer>

        </WalletProvider>
      </body>
    </html>
  );
}
