import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/components/WalletProvider";
import { Navigation } from "@/components/Navigation";

const inter = Inter({ subsets: ["latin"] });

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
      <body className={`${inter.className} bg-gray-950 text-white min-h-screen`}>
        <WalletProvider>
          <Navigation />
          <main className="container mx-auto px-4 py-8">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
