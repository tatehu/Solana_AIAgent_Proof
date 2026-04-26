#!/usr/bin/env python3
"""
Scrape agents from tars.pro/ai-market (GraphQL) and batch-register them as
manifests in the AgentProof risk-monitor.

Metaplex scraping is currently disabled — see commented-out sections below.

Usage:
    python scripts/tars_scraper.py [--risk-monitor-url http://localhost:8000] [--dry-run]
    python scripts/tars_scraper.py --source tars --dry-run
"""

import argparse
import json
import sys
import time
from typing import Any, Dict, List, Optional

import requests

TARS_GRAPHQL = "https://agentapi.tars.pro/graphql"
# METAPLEX_BASE = "https://www.metaplex.com/api/v1/agents"  # disabled

FIND_ALL_AGENTS_QUERY = """
query FindAllAgents($pagination: PaginationInput, $sort: SortInput) {
  findAllAgents(pagination: $pagination, sort: $sort) {
    agents {
      id
      agentName
      config
      elizaAgentId
      twitterUsername
      status
      owner {
        walletAddress
        username
      }
      token {
        tokenAddress
        tokenName
      }
    }
    totalCount
  }
}
"""


def graphql_post(query: str, variables: Dict[str, Any]) -> Dict[str, Any]:
    resp = requests.post(
        TARS_GRAPHQL,
        json={"query": query, "variables": variables, "operationName": "FindAllAgents"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def fetch_all_agents() -> List[Dict[str, Any]]:
    """Paginate through the full agent list."""
    page_size = 50
    offset = 0
    all_agents: List[Dict[str, Any]] = []
    seen_ids: set = set()

    while True:
        data = graphql_post(FIND_ALL_AGENTS_QUERY, {
            "sort": {"sortOrder": "DESC"},
            "pagination": {"limit": page_size, "offset": offset},
        })
        page = data.get("data", {}).get("findAllAgents", {})
        agents = page.get("agents", [])
        total = page.get("totalCount", 0)

        new_agents = [a for a in agents if a["id"] not in seen_ids]
        for a in new_agents:
            seen_ids.add(a["id"])
        all_agents.extend(new_agents)

        print(f"  Fetched {len(all_agents)}/{total} agents (page offset={offset}, got {len(agents)})...", flush=True)

        if not agents or not new_agents or len(all_agents) >= total:
            break
        offset += page_size
        time.sleep(0.3)

    return all_agents


def build_manifest(agent: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Convert a tars.pro agent record into an AgentProof manifest."""
    wallet = agent.get("owner", {}).get("walletAddress", "")
    if not wallet:
        return None  # skip agents without a wallet

    name = agent.get("agentName") or "Unnamed Agent"

    # config is a JSON string in the API response
    config = agent.get("config") or {}
    if isinstance(config, str):
        try:
            config = json.loads(config)
        except json.JSONDecodeError:
            config = {}

    bio: str = config.get("bio") or ""
    lore: List[str] = config.get("lore") or []
    topics: List[str] = config.get("topics") or []

    # Build a rich description from bio + lore
    description_parts = [bio] if bio else []
    if lore:
        description_parts.append(" ".join(lore[:1]))  # first lore entry
    description = " ".join(description_parts).strip() or f"{name} — AI agent on Solana"

    # Map topics to AgentProof capability task types (best-effort)
    seen: set = set()
    capabilities = []
    for topic in topics:
        tl = topic.lower()
        for keyword, task_type in TOPIC_TO_TASK.items():
            if keyword in tl and task_type not in seen:
                capabilities.append({"task_type": task_type, "description": topic})
                seen.add(task_type)
                break

    # Default capability if nothing matched
    if not capabilities:
        capabilities = [{"task_type": "DATA_ANALYSIS", "description": "General AI agent"}]

    twitter = agent.get("twitterUsername") or ""
    external_url = f"https://tars.pro/ai-market/character/{agent['id']}"

    return {
        "agent_pubkey": wallet,
        "name": name,
        "description": description,
        "capabilities": capabilities,
        "version": "1.0",
        "framework": "elizaos",
        "external_url": external_url,
        # extra metadata (ignored by /manifest endpoint, useful for debugging)
        "_tars_id": agent["id"],
        "_twitter": twitter,
        "_token_address": agent.get("token", {}).get("tokenAddress") if agent.get("token") else None,
    }


def fetch_metaplex_agents(network: str = "solana-mainnet") -> List[Dict[str, Any]]:
    """Paginate through the Metaplex agent registry REST API."""
    # ── DISABLED ──────────────────────────────────────────────────────────────
    # Metaplex agent scraping is temporarily commented out.
    # To re-enable: remove this early return and restore the loop below.
    return []

    # page_size = 24
    # page = 1
    # all_agents: List[Dict[str, Any]] = []
    # seen_ids: set = set()

    # while True:
    #     resp = requests.get(
    #         METAPLEX_BASE,
    #         params={"network": network, "page": page, "pageSize": page_size},
    #         headers={
    #             "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    #             "Referer": "https://www.metaplex.com/",
    #             "Accept": "application/json",
    #         },
    #         timeout=30,
    #     )
    #     resp.raise_for_status()
    #     body = resp.json()

    #     agents = body.get("data", {}).get("agents", [])
    #     total = body.get("data", {}).get("total", 0)

    #     new_agents = [a for a in agents if a["id"] not in seen_ids]
    #     for a in new_agents:
    #         seen_ids.add(a["id"])
    #     all_agents.extend(new_agents)

    #     print(
    #         f"  Fetched {len(all_agents)}/{total} Metaplex agents (page {page}, got {len(agents)})...",
    #         flush=True,
    #     )

    #     if not agents or not new_agents or len(all_agents) >= total:
    #         break
    #     page += 1
    #     time.sleep(0.3)

    # return all_agents


TOPIC_TO_TASK: Dict[str, str] = {
    "crypto": "SOLANA_SWAP",
    "trading": "SOLANA_SWAP",
    "charting": "DATA_ANALYSIS",
    "data": "DATA_ANALYSIS",
    "nft": "NFT_TRADE",
    "gaming": "GAME_PLAY",
    "defi": "DEFI_STRATEGY",
    "yield": "DEFI_STRATEGY",
    "betting": "PREDICTION",
    "prediction": "PREDICTION",
    "social": "SOCIAL_POST",
    "twitter": "SOCIAL_POST",
    "content": "SOCIAL_POST",
    "research": "DATA_ANALYSIS",
}


def _infer_capabilities_from_text(text: str) -> List[Dict[str, str]]:
    """Heuristic: scan text for topic keywords → capability list."""
    seen: set = set()
    capabilities = []
    tl = text.lower()
    for keyword, task_type in TOPIC_TO_TASK.items():
        if keyword in tl and task_type not in seen:
            capabilities.append({"task_type": task_type, "description": keyword})
            seen.add(task_type)
    if not capabilities:
        capabilities = [{"task_type": "DATA_ANALYSIS", "description": "General AI agent"}]
    return capabilities


def build_metaplex_manifest(agent: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Convert a Metaplex agent record into an AgentProof manifest."""
    # ── DISABLED ──────────────────────────────────────────────────────────────
    # Metaplex manifest building is temporarily commented out.
    return None

    # wallet = agent.get("mintAddress", "")
    # if not wallet:
    #     return None

    # name = agent.get("name") or "Unnamed Agent"
    # description = agent.get("description") or f"{name} — AI agent on Solana"
    # capabilities = _infer_capabilities_from_text(f"{name} {description}")

    # return {
    #     "agent_pubkey": wallet,
    #     "name": name,
    #     "description": description,
    #     "capabilities": capabilities,
    #     "version": "1.0",
    #     "framework": "elizaos",
    #     "external_url": f"https://www.metaplex.com/agents/{agent.get('id', '')}",
    #     "_metaplex_id": agent.get("id"),
    #     "_network": agent.get("network"),
    # }


def submit_manifest(manifest: Dict[str, Any], base_url: str) -> bool:
    """POST manifest to /manifest, return True on success."""
    payload = {k: v for k, v in manifest.items() if not k.startswith("_")}
    try:
        resp = requests.post(
            f"{base_url.rstrip('/')}/manifest",
            json=payload,
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("status") == "saved"
    except requests.HTTPError as e:
        print(f"    HTTP {e.response.status_code}: {e.response.text[:200]}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"    Error: {e}", file=sys.stderr)
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape agent markets → AgentProof manifests")
    parser.add_argument("--risk-monitor-url", default="http://localhost:8000",
                        help="Base URL of the risk-monitor service")
    parser.add_argument("--dry-run", action="store_true",
                        help="Fetch and parse but do not submit manifests")
    parser.add_argument("--output", default="",
                        help="Optional JSON file path to save scraped manifests")
    parser.add_argument("--source", default="tars", choices=["tars"],
                        help="Which agent market to scrape (metaplex is disabled)")
    args = parser.parse_args()

    print("=== AgentProof Multi-Source Scraper ===")
    print(f"Risk monitor URL : {args.risk_monitor_url}")
    print(f"Source           : {args.source}")
    print(f"Dry run          : {args.dry_run}")
    print()

    manifests: List[Dict[str, Any]] = []

    if args.source in ("tars",):
        print("[tars.pro] Fetching agents from tars.pro...")
        tars_agents = fetch_all_agents()
        print(f"  Total fetched: {len(tars_agents)} agents")
        skipped = 0
        for agent in tars_agents:
            m = build_manifest(agent)
            if m:
                manifests.append(m)
            else:
                skipped += 1
                print(f"  Skipped (no wallet): {agent.get('agentName', agent.get('id'))}")
        print(f"  Built {len(manifests)} tars.pro manifests, skipped {skipped}\n")

    # ── DISABLED: Metaplex scraping ───────────────────────────────────────────
    # if args.source in ("metaplex", "all"):
    #     print("[metaplex] Fetching agents from Metaplex...")
    #     mx_agents = fetch_metaplex_agents()
    #     print(f"  Total fetched: {len(mx_agents)} agents")
    #     before = len(manifests)
    #     skipped = 0
    #     for agent in mx_agents:
    #         m = build_metaplex_manifest(agent)
    #         if m:
    #             manifests.append(m)
    #         else:
    #             skipped += 1
    #     print(f"  Built {len(manifests) - before} Metaplex manifests, skipped {skipped}\n")
    # ─────────────────────────────────────────────────────────────────────────

    print(f"Total manifests  : {len(manifests)}\n")

    if args.output:
        with open(args.output, "w") as f:
            json.dump(manifests, f, indent=2)
        print(f"  Saved to {args.output}\n")

    if args.dry_run:
        print("Dry run — skipping submission. Sample manifest:")
        if manifests:
            print(json.dumps(manifests[0], indent=2))
        return

    print(f"Submitting {len(manifests)} manifests to {args.risk_monitor_url}...")
    ok = 0
    fail = 0
    for i, m in enumerate(manifests):
        name = m["name"]
        wallet = m["agent_pubkey"]
        success = submit_manifest(m, args.risk_monitor_url)
        status = "✓" if success else "✗"
        print(f"  [{i+1:04d}/{len(manifests)}] {status} {name} ({wallet[:8]}...)")
        if success:
            ok += 1
        else:
            fail += 1
        time.sleep(0.05)

    print(f"\n=== Done: {ok} submitted, {fail} failed ===")


if __name__ == "__main__":
    main()
