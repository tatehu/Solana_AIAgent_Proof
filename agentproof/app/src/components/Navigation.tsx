"use client";
import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Shield } from "lucide-react";

export function Navigation() {
  return (
    <nav className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-purple-400" />
          <span className="font-bold text-xl">AgentProof</span>
          <span className="text-xs bg-purple-900 text-purple-300 px-2 py-0.5 rounded-full ml-2">
            Devnet
          </span>
        </div>

        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-gray-400 hover:text-white transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href="/register"
            className="text-gray-400 hover:text-white transition-colors"
          >
            Register Agent
          </Link>
          <Link
            href="/verify"
            className="text-gray-400 hover:text-white transition-colors"
          >
            Verify Task
          </Link>
          <Link
            href="/monitor"
            className="text-gray-400 hover:text-white transition-colors"
          >
            Risk Monitor
          </Link>
          <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700" />
        </div>
      </div>
    </nav>
  );
}
