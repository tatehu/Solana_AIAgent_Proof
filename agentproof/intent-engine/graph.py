"""
Intent Engine — LangGraph workflow
Flow: intent_recognition → planning → tools → verdict
"""
from __future__ import annotations

import json
import os
import re
from typing import Annotated, Any, Literal, Optional
import operator

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field


# ── State ─────────────────────────────────────────────────────────────────────

class IntentState(BaseModel):
    # ── inputs ──
    task_type: str
    agent_pubkey: str
    tx_signature: str
    slot: int
    expected_output: dict[str, Any] = Field(default_factory=dict)
    manifest: Optional[dict[str, Any]] = None

    # ── fetched from chain ──
    tx_data: Optional[dict[str, Any]] = None

    # ── node outputs ──
    intent: Optional[str] = None              # recognised intent label
    plan: Optional[list[str]] = None          # list of tool names to run
    tool_results: Annotated[list[dict], operator.add] = Field(default_factory=list)

    # ── final ──
    aligned: Optional[bool] = None
    confidence: float = 0.5
    reason: str = ""
    risk_flags: list[str] = Field(default_factory=list)
    error: Optional[str] = None


# ── LLM ───────────────────────────────────────────────────────────────────────

def _llm(max_tokens: int = 1024) -> ChatAnthropic:
    return ChatAnthropic(
        model="claude-haiku-4-5",
        max_tokens=max_tokens,
        api_key=os.environ["ANTHROPIC_AUTH_TOKEN"],
        base_url=os.getenv("ANTHROPIC_BASE_URL"),
    )


def _parse_json(text: str) -> dict:
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError(f"No JSON found in: {text[:200]}")
    return json.loads(match.group())


# ── Node 1: Intent Recognition ─────────────────────────────────────────────────

INTENT_LABELS = {
    "SOLANA_SWAP": "swap",
    "DEFI_OPERATION": "defi",
    "DATA_ANALYSIS": "data_analysis",
    "REPORT_GENERATION": "report",
    "CUSTOM": "custom",
}

SYSTEM_INTENT = SystemMessage(content="""你是 AgentProof 意图识别引擎。
你的任务：根据任务类型、Agent 能力声明和预期输出，精确识别 Agent 本次行为的具体意图。

输出严格为 JSON，不含其他文字：
{
  "intent": "<精确意图标签>",
  "sub_intent": "<细分意图，如 token_swap_exact_in / liquidity_add>",
  "requires_tools": ["<tool1>", "<tool2>"],
  "risk_level": "low|medium|high"
}
""")

async def node_recognize_intent(state: IntentState) -> dict:
    manifest_str = json.dumps(state.manifest, ensure_ascii=False) if state.manifest else "未提供"
    expected_str = json.dumps(state.expected_output, ensure_ascii=False)

    msg = HumanMessage(content=f"""
任务类型: {state.task_type}
Agent 公钥: {state.agent_pubkey}
Agent 能力声明 (manifest): {manifest_str}
预期输出: {expected_str}
交易签名: {state.tx_signature}
Slot: {state.slot}

请识别此次行为的精确意图，并列出需要调用的验证工具。
可用工具: check_tx_exists, parse_token_flows, parse_programs_called,
          verify_swap_params, verify_data_account, check_fund_leak,
          check_slippage, verify_output_hash
""")

    llm = _llm(512)
    resp = await llm.ainvoke([SYSTEM_INTENT, msg])
    parsed = _parse_json(resp.content)

    # merge coarse task_type label
    base_intent = INTENT_LABELS.get(state.task_type, "custom")
    intent = parsed.get("intent", base_intent)

    return {
        "intent": intent,
        "plan": parsed.get("requires_tools", ["check_tx_exists"]),
    }


# ── Node 2: Planning ───────────────────────────────────────────────────────────

SYSTEM_PLAN = SystemMessage(content="""你是 AgentProof 验证规划引擎。
根据识别到的意图和交易数据，制定最优验证计划。

输出严格为 JSON：
{
  "ordered_tools": ["<tool1>", "<tool2>", ...],
  "stop_on_failure": true,
  "reasoning": "<规划理由>"
}
""")

async def node_plan(state: IntentState) -> dict:
    tx_summary = json.dumps(state.tx_data or {}, ensure_ascii=False)[:800]
    initial_tools = json.dumps(state.plan or [], ensure_ascii=False)

    msg = HumanMessage(content=f"""
意图: {state.intent}
初步工具列表: {initial_tools}
链上原始数据摘要: {tx_summary}
Agent 声明能力: {json.dumps(state.manifest or {}, ensure_ascii=False)}

请优化验证顺序，确保最关键的验证先执行，减少不必要的 RPC 调用。
""")

    llm = _llm(512)
    resp = await llm.ainvoke([SYSTEM_PLAN, msg])
    parsed = _parse_json(resp.content)

    return {"plan": parsed.get("ordered_tools", state.plan or [])}


# ── Node 3: Tools ──────────────────────────────────────────────────────────────

async def node_execute_tools(state: IntentState) -> dict:
    """Dispatch plan → tool functions, collect results."""
    from tools.chain_tools import TOOL_REGISTRY

    results: list[dict] = []
    stop_on_failure = True

    for tool_name in (state.plan or []):
        fn = TOOL_REGISTRY.get(tool_name)
        if fn is None:
            results.append({"tool": tool_name, "ok": False, "error": "unknown tool"})
            continue

        try:
            result = await fn(state)
            results.append({"tool": tool_name, "ok": True, **result})
            if stop_on_failure and not result.get("passed", True):
                results.append({
                    "tool": "__stopped__",
                    "ok": False,
                    "reason": f"Stopped after {tool_name} failed",
                })
                break
        except Exception as exc:
            results.append({"tool": tool_name, "ok": False, "error": str(exc)})
            if stop_on_failure:
                break

    return {"tool_results": results}


# ── Node 4: Verdict ────────────────────────────────────────────────────────────

SYSTEM_VERDICT = SystemMessage(content="""你是 AgentProof 最终裁判引擎。
根据所有工具验证结果，给出最终判断。

输出严格为 JSON：
{
  "aligned": true或false,
  "confidence": 0.0到1.0,
  "reason": "<综合判断理由，中文>",
  "risk_flags": ["<flag1>", ...]
}
""")

async def node_verdict(state: IntentState) -> dict:
    tool_summary = json.dumps(state.tool_results, ensure_ascii=False, indent=2)
    manifest_str = json.dumps(state.manifest or {}, ensure_ascii=False)

    msg = HumanMessage(content=f"""
意图: {state.intent}
Agent 声明能力: {manifest_str}
工具验证结果:
{tool_summary}

综合以上证据，判断 Agent 行为是否与声明意图和用户委托一致。
""")

    llm = _llm(512)
    resp = await llm.ainvoke([SYSTEM_VERDICT, msg])
    parsed = _parse_json(resp.content)

    return {
        "aligned": bool(parsed.get("aligned", False)),
        "confidence": float(max(0.0, min(1.0, parsed.get("confidence", 0.5)))),
        "reason": parsed.get("reason", ""),
        "risk_flags": parsed.get("risk_flags", []),
    }


# ── Routing ────────────────────────────────────────────────────────────────────

def route_after_tools(state: IntentState) -> Literal["verdict", END]:
    """If any critical tool hard-failed (not just passed=False), skip verdict."""
    hard_errors = [r for r in state.tool_results if not r.get("ok") and r.get("tool") != "__stopped__"]
    if hard_errors and state.intent not in ("custom",):
        return "verdict"  # still let Claude reason over partial data
    return "verdict"


# ── Graph ──────────────────────────────────────────────────────────────────────

def build_graph() -> StateGraph:
    g = StateGraph(IntentState)

    g.add_node("recognize_intent", node_recognize_intent)
    g.add_node("plan",             node_plan)
    g.add_node("execute_tools",    node_execute_tools)
    g.add_node("verdict",          node_verdict)

    g.add_edge(START,              "recognize_intent")
    g.add_edge("recognize_intent", "plan")
    g.add_edge("plan",             "execute_tools")
    g.add_conditional_edges("execute_tools", route_after_tools, {"verdict": "verdict"})
    g.add_edge("verdict",          END)

    return g.compile()


_graph = None

def get_graph():
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph
