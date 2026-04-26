"""
Chain verification tools called by the LangGraph execute_tools node.
Each tool receives IntentState and returns a dict with at least {"passed": bool}.
"""
from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any, Awaitable, Callable

import aiohttp

if TYPE_CHECKING:
    from graph import IntentState

RPC_URL = os.getenv("HELIUS_RPC_URL", "")

ToolFn = Callable[["IntentState"], Awaitable[dict[str, Any]]]


# ── RPC helper ────────────────────────────────────────────────────────────────

async def _rpc(method: str, params: list) -> dict:
    async with aiohttp.ClientSession() as session:
        payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        async with session.post(RPC_URL, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as r:
            data = await r.json()
            if "error" in data:
                raise RuntimeError(f"RPC error: {data['error']}")
            return data.get("result", {})


# ── Tool 1: check_tx_exists ───────────────────────────────────────────────────

async def check_tx_exists(state: "IntentState") -> dict:
    """Verify the tx_signature exists on-chain and is not failed."""
    result = await _rpc(
        "getTransaction",
        [state.tx_signature, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}],
    )
    if not result:
        return {"passed": False, "reason": f"tx {state.tx_signature} not found on-chain"}

    err = result.get("meta", {}).get("err")
    if err:
        return {"passed": False, "reason": f"tx failed on-chain: {err}"}

    slot = result.get("slot", 0)
    block_time = result.get("blockTime", 0)
    fee = result.get("meta", {}).get("fee", 0)

    return {
        "passed": True,
        "slot": slot,
        "block_time": block_time,
        "fee": fee,
        "tx_raw": result,  # downstream tools reuse this
    }


# ── Tool 2: parse_token_flows ─────────────────────────────────────────────────

async def parse_token_flows(state: "IntentState") -> dict:
    """Compute per-owner token balance changes (pre → post)."""
    tx_result = _get_cached_tx(state)
    if not tx_result:
        tx_result = await _fetch_tx(state.tx_signature)

    meta = tx_result.get("meta", {})
    pre: list[dict] = meta.get("preTokenBalances", [])
    post: list[dict] = meta.get("postTokenBalances", [])

    flows: list[dict] = []
    for p in post:
        owner = p.get("owner", "")
        mint = p.get("mint", "")
        post_amt = float(p.get("uiTokenAmount", {}).get("uiAmount") or 0)
        pre_amt = next(
            (float(x.get("uiTokenAmount", {}).get("uiAmount") or 0)
             for x in pre if x.get("owner") == owner and x.get("mint") == mint),
            0.0,
        )
        delta = post_amt - pre_amt
        if abs(delta) > 1e-9:
            flows.append({"owner": owner, "mint": mint, "delta": delta})

    return {"passed": True, "token_flows": flows}


# ── Tool 3: parse_programs_called ─────────────────────────────────────────────

async def parse_programs_called(state: "IntentState") -> dict:
    """Extract all program IDs invoked (outer + inner instructions)."""
    tx_result = _get_cached_tx(state) or await _fetch_tx(state.tx_signature)

    programs: set[str] = set()
    msg = tx_result.get("transaction", {}).get("message", {})

    for ix in msg.get("instructions", []):
        pid = ix.get("programId")
        if pid:
            programs.add(pid)

    for inner in tx_result.get("meta", {}).get("innerInstructions", []):
        for ix in inner.get("instructions", []):
            pid = ix.get("programId")
            if pid:
                programs.add(pid)

    return {"passed": True, "programs_called": sorted(programs)}


# ── Tool 4: verify_swap_params ────────────────────────────────────────────────

KNOWN_DEX_PROGRAMS = {
    "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP": "Orca",
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3sFjзолото": "Whirlpool",
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": "Jupiter v6",
    "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX": "Serum",
}

async def verify_swap_params(state: "IntentState") -> dict:
    """Check DEX program was called and min_amount_out is satisfied."""
    progs_result = await parse_programs_called(state)
    programs_called: list[str] = progs_result.get("programs_called", [])

    dex_used = [KNOWN_DEX_PROGRAMS[p] for p in programs_called if p in KNOWN_DEX_PROGRAMS]
    if not dex_used:
        return {"passed": False, "reason": "No recognised DEX program found in tx", "dex_used": []}

    expected = state.expected_output
    if expected.get("min_amount_out") and expected.get("token_out"):
        flows_result = await parse_token_flows(state)
        flows: list[dict] = flows_result.get("token_flows", [])
        agent_flows = [f for f in flows if f["owner"] == state.agent_pubkey]
        out_flow = next(
            (f for f in agent_flows if f["mint"] == expected["token_out"] and f["delta"] > 0),
            None,
        )
        if not out_flow:
            return {
                "passed": False,
                "reason": f"token_out {expected['token_out']} not received by agent",
                "dex_used": dex_used,
            }
        if out_flow["delta"] < expected["min_amount_out"]:
            return {
                "passed": False,
                "reason": f"received {out_flow['delta']} < min_amount_out {expected['min_amount_out']}",
                "dex_used": dex_used,
            }

    return {"passed": True, "dex_used": dex_used}


# ── Tool 5: check_fund_leak ───────────────────────────────────────────────────

async def check_fund_leak(state: "IntentState") -> dict:
    """Detect unexpected large SOL outflows from agent wallet."""
    tx_result = _get_cached_tx(state) or await _fetch_tx(state.tx_signature)
    meta = tx_result.get("meta", {})
    pre_sol: list[int] = meta.get("preBalances", [])
    post_sol: list[int] = meta.get("postBalances", [])

    account_keys = (
        tx_result.get("transaction", {}).get("message", {}).get("accountKeys", [])
    )

    agent_idx = next(
        (i for i, k in enumerate(account_keys)
         if (k.get("pubkey") if isinstance(k, dict) else str(k)) == state.agent_pubkey),
        None,
    )

    if agent_idx is None or agent_idx >= len(pre_sol):
        return {"passed": True, "note": "agent not found in SOL balance list"}

    delta_lamports = post_sol[agent_idx] - pre_sol[agent_idx]
    LEAK_THRESHOLD = -0.5 * 1_000_000_000  # 0.5 SOL unexpected outflow

    if delta_lamports < LEAK_THRESHOLD:
        sol_lost = abs(delta_lamports) / 1_000_000_000
        return {
            "passed": False,
            "reason": f"Unexpected SOL outflow: {sol_lost:.4f} SOL from agent wallet",
            "delta_lamports": delta_lamports,
        }

    return {"passed": True, "delta_lamports": delta_lamports}


# ── Tool 6: check_slippage ────────────────────────────────────────────────────

async def check_slippage(state: "IntentState") -> dict:
    """Verify slippage is within acceptable bounds (default 3%)."""
    expected = state.expected_output
    if not expected.get("min_amount_out") or not expected.get("expected_amount_out"):
        return {"passed": True, "note": "no slippage params provided"}

    min_out = float(expected["min_amount_out"])
    expected_out = float(expected["expected_amount_out"])
    if expected_out <= 0:
        return {"passed": True, "note": "expected_amount_out is zero"}

    slippage = (expected_out - min_out) / expected_out
    MAX_SLIPPAGE = float(os.getenv("MAX_SLIPPAGE_BPS", "300")) / 10000  # default 3%

    if slippage > MAX_SLIPPAGE:
        return {
            "passed": False,
            "reason": f"Slippage {slippage:.2%} exceeds max {MAX_SLIPPAGE:.2%}",
            "slippage": slippage,
        }

    return {"passed": True, "slippage": slippage}


# ── Tool 7: verify_data_account ───────────────────────────────────────────────

async def verify_data_account(state: "IntentState") -> dict:
    """Check that the output_hash account exists on-chain (DATA_ANALYSIS)."""
    output_hash = state.expected_output.get("output_hash", "")
    if not output_hash or len(output_hash) != 64:
        return {"passed": True, "note": "no valid output_hash provided"}

    try:
        result = await _rpc("getAccountInfo", [output_hash, {"encoding": "base64"}])
        if result and result.get("value"):
            return {"passed": True, "account": output_hash}
        return {"passed": False, "reason": f"Data account {output_hash} not found on-chain"}
    except Exception as exc:
        return {"passed": False, "reason": str(exc)}


# ── Tool 8: verify_output_hash ────────────────────────────────────────────────

async def verify_output_hash(state: "IntentState") -> dict:
    """For report tasks: tx memo field should match declared output_hash."""
    tx_result = _get_cached_tx(state) or await _fetch_tx(state.tx_signature)
    msg = tx_result.get("transaction", {}).get("message", {})

    memo_ix = next(
        (ix for ix in msg.get("instructions", [])
         if ix.get("program") == "spl-memo"),
        None,
    )
    if not memo_ix:
        return {"passed": True, "note": "no memo instruction, skipping output_hash check"}

    memo_data: str = memo_ix.get("parsed", "")
    declared_hash = state.expected_output.get("output_hash", "")

    if declared_hash and declared_hash not in memo_data:
        return {
            "passed": False,
            "reason": f"output_hash {declared_hash[:16]}… not found in tx memo",
        }

    return {"passed": True, "memo": memo_data}


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _fetch_tx(sig: str) -> dict:
    return await _rpc(
        "getTransaction",
        [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}],
    ) or {}


def _get_cached_tx(state: "IntentState") -> dict | None:
    """Return tx_raw from a previous check_tx_exists result, if available."""
    for r in state.tool_results:
        if r.get("tool") == "check_tx_exists" and r.get("ok"):
            return r.get("tx_raw")
    return None


# ── Registry ──────────────────────────────────────────────────────────────────

TOOL_REGISTRY: dict[str, ToolFn] = {
    "check_tx_exists":       check_tx_exists,
    "parse_token_flows":     parse_token_flows,
    "parse_programs_called": parse_programs_called,
    "verify_swap_params":    verify_swap_params,
    "check_fund_leak":       check_fund_leak,
    "check_slippage":        check_slippage,
    "verify_data_account":   verify_data_account,
    "verify_output_hash":    verify_output_hash,
}
