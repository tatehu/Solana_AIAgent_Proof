"""SQLite persistence layer for AgentProof risk monitor."""
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

import aiosqlite

logger = logging.getLogger(__name__)

_DB_PATH = Path(os.getenv("DB_PATH", "data/agentproof.db"))


@asynccontextmanager
async def _get_db() -> AsyncIterator[aiosqlite.Connection]:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA synchronous=NORMAL")
        yield db


async def init_db() -> None:
    is_new = not _DB_PATH.exists()
    async with _get_db() as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS reputation_scores (
                agent_id    TEXT PRIMARY KEY,
                data        TEXT NOT NULL,
                updated_at  REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS score_history (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id    TEXT NOT NULL,
                total_score REAL NOT NULL,
                scored_at   REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_score_history_agent ON score_history(agent_id);

            CREATE TABLE IF NOT EXISTS insurance_policies (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                data        TEXT NOT NULL,
                created_at  REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS leaderboard_snapshot (
                agent_id    TEXT PRIMARY KEY,
                data        TEXT NOT NULL,
                updated_at  REAL NOT NULL
            );
        """)
        await db.commit()

    if is_new:
        seed_path = Path(__file__).parent / "data" / "seed.sql"
        if seed_path.exists():
            async with _get_db() as db:
                await db.executescript(seed_path.read_text())
                await db.commit()
            logger.info("Seeded database from seed.sql")

    logger.info(f"Database initialised at {_DB_PATH}")


# ── Reputation scores ─────────────────────────────────────────────────────────

async def save_reputation(agent_id: str, score_dict: Dict[str, Any]) -> None:
    async with _get_db() as db:
        await db.execute(
            "INSERT OR REPLACE INTO reputation_scores(agent_id, data, updated_at) VALUES (?,?,?)",
            (agent_id, json.dumps(score_dict), time.time()),
        )
        await db.commit()


async def load_reputation(agent_id: str) -> Optional[Dict[str, Any]]:
    async with _get_db() as db:
        async with db.execute(
            "SELECT data FROM reputation_scores WHERE agent_id=?", (agent_id,)
        ) as cur:
            row = await cur.fetchone()
            return json.loads(row["data"]) if row else None


async def load_all_reputations() -> Dict[str, Dict[str, Any]]:
    async with _get_db() as db:
        async with db.execute("SELECT agent_id, data FROM reputation_scores") as cur:
            rows = await cur.fetchall()
            return {r["agent_id"]: json.loads(r["data"]) for r in rows}


# ── Score history ─────────────────────────────────────────────────────────────

async def append_score_history(agent_id: str, total_score: float) -> None:
    async with _get_db() as db:
        await db.execute(
            "INSERT INTO score_history(agent_id, total_score, scored_at) VALUES (?,?,?)",
            (agent_id, total_score, time.time()),
        )
        # Keep only last 90 entries per agent
        await db.execute(
            """DELETE FROM score_history WHERE agent_id=? AND id NOT IN (
                SELECT id FROM score_history WHERE agent_id=? ORDER BY scored_at DESC LIMIT 90
            )""",
            (agent_id, agent_id),
        )
        await db.commit()


async def load_score_history(agent_id: str) -> List[Dict[str, Any]]:
    async with _get_db() as db:
        async with db.execute(
            "SELECT total_score, scored_at FROM score_history WHERE agent_id=? ORDER BY scored_at ASC",
            (agent_id,),
        ) as cur:
            rows = await cur.fetchall()
            return [{"total_score": r["total_score"], "scored_at": r["scored_at"]} for r in rows]


# ── Leaderboard snapshot ──────────────────────────────────────────────────────

async def save_leaderboard_snapshot(entries: List[Dict[str, Any]]) -> None:
    async with _get_db() as db:
        now = time.time()
        await db.executemany(
            "INSERT OR REPLACE INTO leaderboard_snapshot(agent_id, data, updated_at) VALUES (?,?,?)",
            [(e["agent_id"], json.dumps(e), now) for e in entries if "agent_id" in e],
        )
        await db.commit()
    logger.info(f"Leaderboard snapshot saved: {len(entries)} entries")


async def load_leaderboard_snapshot() -> List[Dict[str, Any]]:
    async with _get_db() as db:
        async with db.execute(
            "SELECT data FROM leaderboard_snapshot ORDER BY json_extract(data,'$.total_score') DESC"
        ) as cur:
            rows = await cur.fetchall()
            return [json.loads(r["data"]) for r in rows]


async def load_leaderboard_snapshot_age() -> Optional[float]:
    """Return how many seconds ago the snapshot was last updated (None if empty)."""
    async with _get_db() as db:
        async with db.execute("SELECT MAX(updated_at) as t FROM leaderboard_snapshot") as cur:
            row = await cur.fetchone()
            if row and row["t"]:
                return time.time() - row["t"]
            return None


# ── Insurance policies ────────────────────────────────────────────────────────

async def save_policy(policy: Dict[str, Any]) -> int:
    async with _get_db() as db:
        cur = await db.execute(
            "INSERT INTO insurance_policies(data, created_at) VALUES (?,?)",
            (json.dumps(policy), time.time()),
        )
        await db.commit()
        return cur.lastrowid  # type: ignore[return-value]


async def load_policies(buyer_wallet: Optional[str] = None) -> List[Dict[str, Any]]:
    async with _get_db() as db:
        if buyer_wallet:
            async with db.execute(
                "SELECT rowid AS rid, data FROM insurance_policies WHERE json_extract(data,'$.buyer_wallet')=?",
                (buyer_wallet,),
            ) as cur:
                rows = await cur.fetchall()
        else:
            async with db.execute("SELECT rowid AS rid, data FROM insurance_policies") as cur:
                rows = await cur.fetchall()
        result = []
        for r in rows:
            p = json.loads(r["data"])
            p["id"] = r["rid"] - 1  # keep 0-based id compatible with old code
            result.append(p)
        return result


async def append_claim_record(policy_id: int, claim: Dict[str, Any]) -> None:
    """Append a claim audit record into the policy's JSON data."""
    async with _get_db() as db:
        async with db.execute(
            "SELECT rowid AS rid, data FROM insurance_policies WHERE rowid=?", (policy_id + 1,)
        ) as cur:
            row = await cur.fetchone()
        if row:
            p = json.loads(row["data"])
            p.setdefault("claims", []).append(claim)
            await db.execute(
                "UPDATE insurance_policies SET data=? WHERE rowid=?",
                (json.dumps(p), row["rid"]),
            )
            await db.commit()


async def update_policy_status(policy_id: int, status: str) -> None:
    async with _get_db() as db:
        async with db.execute(
            "SELECT rowid AS rid, data FROM insurance_policies WHERE rowid=?", (policy_id + 1,)
        ) as cur:
            row = await cur.fetchone()
        if row:
            p = json.loads(row["data"])
            p["status"] = status
            await db.execute(
                "UPDATE insurance_policies SET data=? WHERE rowid=?",
                (json.dumps(p), row["rid"]),
            )
            await db.commit()


async def update_claimed_sol(policy_id: int, claimed_sol: float) -> None:
    """Update cumulative claimed amount for a periodic policy."""
    async with _get_db() as db:
        async with db.execute(
            "SELECT rowid AS rid, data FROM insurance_policies WHERE rowid=?", (policy_id + 1,)
        ) as cur:
            row = await cur.fetchone()
        if row:
            p = json.loads(row["data"])
            p["claimed_sol"] = claimed_sol
            await db.execute(
                "UPDATE insurance_policies SET data=? WHERE rowid=?",
                (json.dumps(p), row["rid"]),
            )
            await db.commit()

