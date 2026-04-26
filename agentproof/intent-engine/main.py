"""
Intent Engine — FastAPI entry point
Exposes POST /verify for witness-node to call.
"""
from __future__ import annotations

import os
from typing import Any, Optional

import aiohttp
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

from graph import IntentState, get_graph

app = FastAPI(
    title="AgentProof Intent Engine",
    description="LangGraph-powered intent verification: recognize → plan → tools → verdict",
    version="0.2.0",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Request / Response ────────────────────────────────────────────────────────

class VerifyRequest(BaseModel):
    task_type: str
    agent_pubkey: str
    tx_signature: str
    slot: int = 0
    expected_output: dict[str, Any] = {}
    manifest: Optional[dict[str, Any]] = None


class VerifyResponse(BaseModel):
    aligned: bool
    confidence: float
    reason: str
    risk_flags: list[str]
    intent: Optional[str] = None
    plan: Optional[list[str]] = None
    tool_results: list[dict] = []


# ── Manifest fetch helper ─────────────────────────────────────────────────────

RISK_MONITOR_URL = os.getenv("RISK_MONITOR_URL", "http://localhost:8000")

async def _fetch_manifest(agent_pubkey: str) -> Optional[dict]:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{RISK_MONITOR_URL}/manifest/pubkey/{agent_pubkey}",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("manifest")
    except Exception:
        pass
    return None


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "intent-engine", "version": "0.2.0"}


@app.post("/verify", response_model=VerifyResponse)
async def verify(req: VerifyRequest):
    if not os.getenv("ANTHROPIC_AUTH_TOKEN"):
        raise HTTPException(status_code=503, detail="ANTHROPIC_AUTH_TOKEN not configured")
    if not os.getenv("HELIUS_RPC_URL"):
        raise HTTPException(status_code=503, detail="HELIUS_RPC_URL not configured")

    # Fetch manifest if not provided
    manifest = req.manifest or await _fetch_manifest(req.agent_pubkey)

    initial_state = IntentState(
        task_type=req.task_type,
        agent_pubkey=req.agent_pubkey,
        tx_signature=req.tx_signature,
        slot=req.slot,
        expected_output=req.expected_output,
        manifest=manifest,
    )

    try:
        graph = get_graph()
        final: IntentState = await graph.ainvoke(initial_state)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return VerifyResponse(
        aligned=final.aligned if final.aligned is not None else False,
        confidence=final.confidence,
        reason=final.reason,
        risk_flags=final.risk_flags,
        intent=final.intent,
        plan=final.plan,
        tool_results=final.tool_results,
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "3002"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True, log_level="info")
