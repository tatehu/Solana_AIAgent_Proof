"""
chain_reader.py — 从 Solana 链上读取 AgentRecord 和 TaskProof 数据，
转换为 ProofRecord 供风险检测器使用。
"""
import os
import struct
import logging
import asyncio
from dataclasses import dataclass
from typing import List, Optional

import base58
from solana.rpc.async_api import AsyncClient
from solana.rpc.types import MemcmpOpts
from solders.pubkey import Pubkey

from models.detectors import ProofRecord

logger = logging.getLogger(__name__)

PROGRAM_ID_STR = os.getenv(
    "AGENTPROOF_PROGRAM_ID",
    "GdJFUktyh4SFxDfqeFE33KvXf5u6TMrDzmMs5Je2NKjG"
)
RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")

# Anchor discriminators (sha256("account:<StructName>")[0:8])
AGENT_RECORD_DISC = bytes([4, 201, 129, 70, 197, 134, 47, 169])
TASK_PROOF_DISC   = bytes([217, 208, 14, 234, 191, 204, 81, 220])


@dataclass
class ChainAgentRecord:
    agent_pubkey: str
    staked_lamports: int
    reputation_score: int
    tasks_completed: int
    tasks_failed: int
    success_rate_bps: int   # basis points, 10000 = 100%
    is_frozen: bool
    registered_at: int
    last_active_at: int


@dataclass
class ChainTaskProof:
    task_id: bytes          # [u8;32]
    agent_pubkey: str
    output_hash: bytes      # [u8;32]
    input_hash: bytes       # [u8;32]
    tx_signature: bytes     # [u8;64]
    slot: int
    task_type: int
    status: int             # 0=pending 1=verified 2=rejected
    submitted_at: int
    settled_at: int


def _parse_agent_record(data: bytes) -> Optional[ChainAgentRecord]:
    """解析 AgentRecord 链上数据（跳过 8 字节 discriminator）

    Layout (Anchor account, little-endian):
      8  discriminator
      32 agent_pubkey
      32 capability_hash
      8  staked_lamports   (u64)
      8  credit_score      (u64) — formerly reputation_score
      8  safety_index      (u64) — added in new layout (132+ bytes total)
      8  tasks_completed   (u64)
      8  tasks_failed      (u64)
      2  success_rate_bps  (u16)
      1  is_frozen         (bool)
      8  registered_at     (i64)
      8  last_active_at    (i64)
      1  bump              (u8)
    Old accounts (124 bytes) lack safety_index; new accounts are 133 bytes.
    """
    try:
        off = 8
        agent_pubkey = base58.b58encode(data[off:off+32]).decode(); off += 32
        off += 32  # capability_hash
        staked_lamports, = struct.unpack_from("<Q", data, off); off += 8
        reputation_score, = struct.unpack_from("<Q", data, off); off += 8  # credit_score
        # New layout includes safety_index (u64) before tasks_completed.
        # Total account data: 8+32+32+8+8+8+8+8+2+1+8+8+1 = 133 bytes (new)
        #                     8+32+32+8+8+8+8+2+1+8+8+1   = 124 bytes (old, no safety_index)
        if len(data) >= 133:
            off += 8  # skip safety_index
        tasks_completed,  = struct.unpack_from("<Q", data, off); off += 8
        tasks_failed,     = struct.unpack_from("<Q", data, off); off += 8
        success_rate_bps, = struct.unpack_from("<H", data, off); off += 2
        is_frozen = bool(data[off]);                               off += 1
        registered_at,  = struct.unpack_from("<q", data, off);    off += 8
        last_active_at, = struct.unpack_from("<q", data, off)
        return ChainAgentRecord(
            agent_pubkey=agent_pubkey,
            staked_lamports=staked_lamports,
            reputation_score=reputation_score,
            tasks_completed=tasks_completed,
            tasks_failed=tasks_failed,
            success_rate_bps=success_rate_bps,
            is_frozen=is_frozen,
            registered_at=registered_at,
            last_active_at=last_active_at,
        )
    except Exception as e:
        logger.warning(f"Failed to parse AgentRecord: {e}")
        return None


def _parse_task_proof(data: bytes) -> Optional[ChainTaskProof]:
    """解析 TaskProof 链上数据（跳过 8 字节 discriminator）"""
    try:
        off = 8
        task_id      = data[off:off+32]; off += 32
        agent_pubkey = base58.b58encode(data[off:off+32]).decode(); off += 32
        instruction_hash = data[off:off+32]; off += 32  # noqa: F841
        input_hash   = data[off:off+32]; off += 32
        output_hash  = data[off:off+32]; off += 32
        tx_signature = data[off:off+64]; off += 64
        slot,        = struct.unpack_from("<Q", data, off); off += 8
        task_type    = data[off]; off += 1
        # witnesses [Pubkey;3] = 96 bytes, witness_signatures [64;3] = 192, witness_status [3] = 3
        off += 96 + 192 + 3
        signature_count = data[off]; off += 1
        status          = data[off]; off += 1
        submitted_at, = struct.unpack_from("<q", data, off); off += 8
        settled_at,   = struct.unpack_from("<q", data, off)
        return ChainTaskProof(
            task_id=task_id,
            agent_pubkey=agent_pubkey,
            output_hash=output_hash,
            input_hash=input_hash,
            tx_signature=tx_signature,
            slot=slot,
            task_type=task_type,
            status=status,
            submitted_at=submitted_at,
            settled_at=settled_at,
        )
    except Exception as e:
        logger.warning(f"Failed to parse TaskProof: {e}")
        return None


class SolanaChainReader:
    """从链上读取 AgentRecord 和 TaskProof，构建风险分析所需的 ProofRecord 列表"""

    def __init__(self) -> None:
        self._client = AsyncClient(RPC_URL, commitment="confirmed")
        self._program_id = Pubkey.from_string(PROGRAM_ID_STR)

    async def fetch_agent_record(self, agent_pubkey: str) -> Optional[ChainAgentRecord]:
        """读取单个 AgentRecord PDA"""
        try:
            agent_key = Pubkey.from_string(agent_pubkey)
            pda, _ = Pubkey.find_program_address(
                [b"agent", bytes(agent_key)],
                self._program_id,
            )
            resp = await self._client.get_account_info(pda, encoding="base64")
            account = resp.value
            if account is None:
                return None
            raw = bytes(account.data)
            if not raw or raw[:8] != AGENT_RECORD_DISC:
                return None
            return _parse_agent_record(raw)
        except Exception as e:
            logger.warning(f"fetch_agent_record({agent_pubkey}): {e}")
            return None

    async def fetch_all_agents(self) -> List[ChainAgentRecord]:
        """列出链上所有已注册的 AgentRecord（用 discriminator memcmp 过滤）"""
        try:
            filters = [
                MemcmpOpts(
                    offset=0,
                    bytes=base58.b58encode(AGENT_RECORD_DISC).decode(),
                ),
            ]
            resp = await self._client.get_program_accounts(
                self._program_id,
                encoding="base64",
                filters=filters,
            )
            agents: List[ChainAgentRecord] = []
            for account_info in (resp.value or []):
                raw = bytes(account_info.account.data)
                parsed = _parse_agent_record(raw)
                if parsed:
                    agents.append(parsed)
            logger.info(f"fetch_all_agents: found {len(agents)} on-chain agents")
            return agents
        except Exception as e:
            logger.warning(f"fetch_all_agents failed: {e}")
            return []

    async def fetch_task_proofs(self, agent_pubkey: str) -> List[ChainTaskProof]:
        """读取该 agent 的所有 TaskProof（通过 getProgramAccounts + memcmp）"""
        try:
            agent_key = Pubkey.from_string(agent_pubkey)
            agent_bytes = bytes(agent_key)

            # memcmp: offset=8(disc)+32(task_id)=40 匹配 agent_pubkey
            filters = [
                MemcmpOpts(offset=0,  bytes=base58.b58encode(TASK_PROOF_DISC).decode()),
                MemcmpOpts(offset=40, bytes=base58.b58encode(agent_bytes).decode()),
            ]
            resp = await self._client.get_program_accounts(
                self._program_id,
                encoding="base64",
                filters=filters,
            )
            proofs = []
            for account_info in (resp.value or []):
                raw = bytes(account_info.account.data)
                parsed = _parse_task_proof(raw)
                if parsed:
                    proofs.append(parsed)
            # 按 submitted_at 升序排列
            proofs.sort(key=lambda p: p.submitted_at)
            return proofs
        except Exception as e:
            logger.warning(f"fetch_task_proofs({agent_pubkey}): {e}")
            return []

    def build_proof_records(
        self,
        agent_record: Optional[ChainAgentRecord],
        task_proofs: List[ChainTaskProof],
    ) -> List[ProofRecord]:
        """
        将链上数据转换为 ProofRecord 列表供检测器使用。

        如果没有 TaskProof（agent 刚注册、还没完成任务），
        用 AgentRecord 的汇总数据合成一条「基线记录」。
        """
        records: List[ProofRecord] = []

        for proof in task_proofs:
            success = proof.status == 1  # 1=verified
            records.append(ProofRecord(
                task_id=proof.task_id.hex(),
                success=success,
                output_hash=proof.output_hash.hex(),
                input_hash=proof.input_hash.hex(),
                submitted_at=float(proof.submitted_at),
                slot=proof.slot,
            ))

        # 若链上无 TaskProof，但 AgentRecord 有历史统计，合成记录让检测器有数据可分析
        if not records and agent_record and (
            agent_record.tasks_completed + agent_record.tasks_failed > 0
        ):
            total = agent_record.tasks_completed + agent_record.tasks_failed
            import time
            import hashlib
            base_time = float(agent_record.last_active_at or agent_record.registered_at)
            for i in range(min(int(total), 20)):
                success = i < agent_record.tasks_completed
                fake_hash = hashlib.sha256(f"{agent_record.agent_pubkey}-{i}".encode()).hexdigest()
                records.append(ProofRecord(
                    task_id=f"synthetic-{i}",
                    success=success,
                    output_hash=fake_hash,
                    input_hash=fake_hash,
                    submitted_at=base_time - (total - i) * 60,
                ))

        return records

    async def close(self) -> None:
        await self._client.close()


# 模块级单例，路由层复用
_reader: Optional[SolanaChainReader] = None


def get_chain_reader() -> SolanaChainReader:
    global _reader
    if _reader is None:
        _reader = SolanaChainReader()
    return _reader
