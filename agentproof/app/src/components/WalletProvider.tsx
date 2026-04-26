"use client";
import { useCallback, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletError } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { RPC_URL } from "@/lib/solana";
import "@solana/wallet-adapter-react-ui/styles.css";

const WALLET_STORAGE_KEY = "walletName";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  const onError = useCallback((error: WalletError) => {
    const isExtensionError =
      error.message?.includes("extension not found") ||
      error.message?.includes("MetaMask extension not found");

    if (isExtensionError) {
      alert(
        "Wallet extension error: the wallet extension may have crashed.\nPlease restart your browser and try again."
      );
    } else if (
      error.name === "WalletConnectionError" ||
      error.name === "WalletNotReadyError"
    ) {
      console.warn("Wallet connection failed:", error.message);
    }

    // Clear cached selection so user can pick a different wallet
    if (
      error.name === "WalletConnectionError" ||
      error.name === "WalletNotReadyError"
    ) {
      localStorage.removeItem(WALLET_STORAGE_KEY);
    }
  }, []);

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <SolanaWalletProvider
        wallets={wallets}
        autoConnect
        onError={onError}
        localStorageKey={WALLET_STORAGE_KEY}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
