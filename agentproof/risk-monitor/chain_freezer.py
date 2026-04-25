# agentproof/risk-monitor/chain_freezer.py
import os
import struct
import hashlib
import logging
import httpx

logger = logging.getLogger(__name__)

# Anchor discriminator for freeze_agent: sha256("global:freeze_agent")[:8]
def _discriminator(name: str) -> bytes:
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]

FREEZE_AGENT_DISCRIMINATOR = _discriminator("freeze_agent")


class ChainFreezer:
    def __init__(self):
        self.rpc_url = os.environ.get("SOLANA_RPC_URL", "https://api.devnet.solana.com")
        self.authority_key_b58 = os.environ.get("RISK_MONITOR_AUTHORITY_KEY", "")
        self.program_id = os.environ.get("PROGRAM_ID", "GdJFUktyh4SFxDfqeFE33KvXf5u6TMrDzmMs5Je2NKjG")

    async def freeze_on_chain(self, agent_pubkey: str, reason: str) -> str:
        """
        Call freeze_agent on-chain via Solana JSON-RPC.
        Requires RISK_MONITOR_AUTHORITY_KEY env var (base58 private key).
        Returns tx_signature or raises on error.
        """
        if not self.authority_key_b58:
            logger.warning("[chain-freezer] RISK_MONITOR_AUTHORITY_KEY not set — skipping on-chain freeze")
            raise ValueError("RISK_MONITOR_AUTHORITY_KEY not configured")

        try:
            from solders.keypair import Keypair
            from solders.pubkey import Pubkey
            from solders.transaction import Transaction
            from solders.message import Message
            from solders.instruction import Instruction, AccountMeta
            import base58
        except ImportError:
            raise ImportError("solders package required: pip install solders")

        keypair = Keypair.from_bytes(base58.b58decode(self.authority_key_b58))
        agent_pub = Pubkey.from_string(agent_pubkey)
        program_pub = Pubkey.from_string(self.program_id)

        # Encode reason as length-prefixed string (Borsh)
        reason_bytes = reason.encode("utf-8")
        reason_encoded = struct.pack("<I", len(reason_bytes)) + reason_bytes

        # Encode agent_pubkey (32 bytes)
        data = FREEZE_AGENT_DISCRIMINATOR + bytes(agent_pub) + reason_encoded

        # Build AgentRecord PDA seeds: ["agent", agent_pubkey]
        agent_record_pda, _ = Pubkey.find_program_address(
            [b"agent", bytes(agent_pub)],
            program_pub,
        )

        ix = Instruction(
            program_id=program_pub,
            accounts=[
                AccountMeta(pubkey=agent_record_pda, is_signer=False, is_writable=True),
                AccountMeta(pubkey=keypair.pubkey(), is_signer=True, is_writable=False),
            ],
            data=data,
        )

        async with httpx.AsyncClient() as client:
            # Get recent blockhash
            blockhash_resp = await client.post(self.rpc_url, json={
                "jsonrpc": "2.0", "id": 1,
                "method": "getLatestBlockhash",
                "params": [{"commitment": "confirmed"}],
            })
            blockhash = blockhash_resp.json()["result"]["value"]["blockhash"]

            from solders.hash import Hash
            msg = Message.new_with_blockhash(
                [ix], keypair.pubkey(), Hash.from_string(blockhash)
            )
            tx = Transaction([keypair], msg, Hash.from_string(blockhash))

            send_resp = await client.post(self.rpc_url, json={
                "jsonrpc": "2.0", "id": 2,
                "method": "sendTransaction",
                "params": [
                    tx.to_bytes().hex(),
                    {"encoding": "base16", "skipPreflight": False},
                ],
            })
            result = send_resp.json()

            if "error" in result:
                raise RuntimeError(f"RPC error: {result['error']}")

            tx_sig = result["result"]
            logger.info(f"[chain-freezer] freeze_agent tx: {tx_sig}")
            return tx_sig


_freezer: ChainFreezer | None = None

def get_freezer() -> ChainFreezer:
    global _freezer
    if _freezer is None:
        _freezer = ChainFreezer()
    return _freezer
