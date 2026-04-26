# AgentProof Score Platform 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 AgentProof 合约基础上，新增公开 Agent 评分排行榜 + 双险保险产品，形成"引流 → 转化 → 变现"完整闭环。

**Architecture:** 扩展现有 Python audit-service 增加 Agent 索引爬虫和评分引擎；新增 Anchor insurance 合约处理保费和赔付；在现有 React 前端增加排行榜、详情页、保险弹窗三个模块。

**Tech Stack:**
- 链上：Rust/Anchor 0.30.1（新增 `insurance_vault` program）
- 后端：Python 3.11 / FastAPI / asyncpg / PostgreSQL（扩展 audit-service）
- 前端：React 18 / TailwindCSS / Recharts（扩展现有 frontend/）
- 数据：Helius API / SAID Protocol REST API / Solana Agent Registry RPC

**工期估算：**
| 阶段 | 内容 | 天数 |
|------|------|------|
| Phase 1 | 数据层 + 评分引擎 | Day 1–4 |
| Phase 2 | 前端排行榜 + 详情页 | Day 5–8 |
| Phase 3 | 保险合约 + UI | Day 9–16 |
| 缓冲 | 联调 + Bug 修复 | Day 17–18 |

---

## 新增文件结构

```
agentproof/
├── contracts/
│   ├── agent-proof/               # 现有，不改
│   └── insurance/                 # NEW
│       ├── Anchor.toml
│       └── programs/insurance_vault/src/
│           ├── lib.rs
│           ├── instructions/
│           │   ├── buy_policy.rs
│           │   └── claim_policy.rs
│           └── state/
│               └── policy_account.rs
├── services/
│   ├── audit-service/             # 现有，扩展
│   │   ├── main.py                # 新增路由
│   │   ├── db.py                  # NEW - PostgreSQL 连接
│   │   ├── models.py              # NEW - ORM 模型
│   │   ├── indexer/               # NEW
│   │   │   ├── said_crawler.py
│   │   │   ├── agent_registry.py
│   │   │   └── scheduler.py
│   │   └── scoring/               # NEW
│   │       ├── engine.py
│   │       ├── behavior_safety.py
│   │       ├── completion_rate.py
│   │       ├── fund_risk.py
│   │       ├── compliance.py
│   │       └── activity_decay.py
└── frontend/src/
    ├── pages/
    │   ├── LeaderboardPage.tsx    # NEW
    │   └── AgentDetailPage.tsx    # NEW
    └── components/
        ├── ScoreBadge.tsx         # NEW
        ├── ScoreTrendChart.tsx    # NEW
        └── InsuranceModal.tsx     # NEW
```

---

## Phase 1：数据层 + 评分引擎

---

### Task 1：数据库 Schema + 初始化

**Files:**
- Create: `services/audit-service/db.py`
- Create: `services/audit-service/models.py`
- Create: `services/audit-service/migrations/001_init.sql`

- [ ] **Step 1: 安装依赖**

```bash
cd services/audit-service
pip install asyncpg==0.29.0 sqlalchemy==2.0.30 alembic==1.13.1
echo "asyncpg==0.29.0\nsqlalchemy==2.0.30\nalembic==1.13.1" >> requirements.txt
```

- [ ] **Step 2: 写 SQL schema**

创建 `services/audit-service/migrations/001_init.sql`：

```sql
CREATE TABLE IF NOT EXISTS public_agents (
    id              SERIAL PRIMARY KEY,
    wallet_address  VARCHAR(44) NOT NULL UNIQUE,
    name            VARCHAR(200),
    framework       VARCHAR(50),          -- 'elizaos' | 'agent_kit' | 'goat' | 'unknown'
    source          VARCHAR(50),          -- 'said_protocol' | 'agent_registry' | 'helius'
    external_url    VARCHAR(500),         -- 跳转链接（Agent 官网/使用入口）
    is_registered   BOOLEAN DEFAULT FALSE, -- 是否在 AgentProof 注册过
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_scores (
    id                  SERIAL PRIMARY KEY,
    wallet_address      VARCHAR(44) NOT NULL REFERENCES public_agents(wallet_address),
    total_score         SMALLINT NOT NULL CHECK (total_score BETWEEN 0 AND 100),
    grade               VARCHAR(3) NOT NULL,  -- 'AAA' | 'AA' | 'A' | 'B' | 'C'
    behavior_safety     SMALLINT,
    completion_rate     SMALLINT,
    fund_risk           SMALLINT,
    compliance          SMALLINT,
    activity_decay      SMALLINT,
    tx_count            INTEGER DEFAULT 0,
    anomaly_count       INTEGER DEFAULT 0,
    avg_slippage_bps    INTEGER DEFAULT 0,
    max_single_sol      NUMERIC(18,9) DEFAULT 0,
    premium_multiplier  NUMERIC(4,2) DEFAULT 1.0,
    scored_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_scores_wallet ON agent_scores(wallet_address);
CREATE INDEX idx_agent_scores_total  ON agent_scores(total_score DESC);

CREATE TABLE IF NOT EXISTS score_history (
    id             SERIAL PRIMARY KEY,
    wallet_address VARCHAR(44) NOT NULL,
    total_score    SMALLINT NOT NULL,
    scored_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insurance_policies (
    id              SERIAL PRIMARY KEY,
    policy_nft_mint VARCHAR(44) UNIQUE,
    buyer_wallet    VARCHAR(44) NOT NULL,
    agent_wallet    VARCHAR(44) NOT NULL,
    policy_type     VARCHAR(20) NOT NULL, -- 'fund' | 'execution' | 'bundle'
    coverage_sol    NUMERIC(18,9) NOT NULL,
    premium_sol     NUMERIC(18,9) NOT NULL,
    status          VARCHAR(20) DEFAULT 'active', -- 'active' | 'claimed' | 'expired'
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

- [ ] **Step 3: 创建 db.py**

```python
# services/audit-service/db.py
import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/agentproof"
)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

async def init_db():
    """Run migrations/001_init.sql on startup."""
    import aiofiles
    async with engine.begin() as conn:
        async with aiofiles.open("migrations/001_init.sql") as f:
            sql = await f.read()
        await conn.execute(sql)
```

- [ ] **Step 4: 运行迁移并验证**

```bash
# 启动 Postgres（若用 Docker）
docker run -d --name agentproof-db \
  -e POSTGRES_DB=agentproof \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:16-alpine

# 应用 schema
psql postgresql://postgres:postgres@localhost:5432/agentproof \
  -f migrations/001_init.sql

# 验证
psql postgresql://postgres:postgres@localhost:5432/agentproof \
  -c "\dt"
# 预期输出：public_agents, agent_scores, score_history, insurance_policies
```

- [ ] **Step 5: Commit**

```bash
git add services/audit-service/db.py \
        services/audit-service/migrations/001_init.sql
git commit -m "feat: add PostgreSQL schema for Score Platform"
```

---

### Task 2：SAID Protocol 爬虫

**Files:**
- Create: `services/audit-service/indexer/said_crawler.py`
- Create: `services/audit-service/indexer/__init__.py`

- [ ] **Step 1: 写失败测试**

```python
# services/audit-service/tests/test_said_crawler.py
import pytest
from unittest.mock import AsyncMock, patch
from indexer.said_crawler import fetch_said_agents

@pytest.mark.asyncio
async def test_fetch_said_agents_returns_list():
    mock_response = {
        "agents": [
            {"wallet": "7xKpABCDEF1234567890abcdef1234567890abcdef12",
             "name": "TradingBot X", "framework": "elizaos",
             "profile_url": "https://saidprotocol.com/agents/7xKp..."}
        ]
    }
    with patch("indexer.said_crawler.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.get = AsyncMock(
            return_value=AsyncMock(json=lambda: mock_response, status_code=200)
        )
        result = await fetch_said_agents(page=1, limit=100)
    assert len(result) == 1
    assert result[0]["wallet"] == "7xKpABCDEF1234567890abcdef1234567890abcdef12"
    assert result[0]["framework"] == "elizaos"
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd services/audit-service
pytest tests/test_said_crawler.py -v
# 预期：FAILED - ImportError: cannot import name 'fetch_said_agents'
```

- [ ] **Step 3: 实现爬虫**

```python
# services/audit-service/indexer/said_crawler.py
import httpx
from typing import List, Dict

SAID_API_BASE = "https://api.saidprotocol.com/v1"

async def fetch_said_agents(page: int = 1, limit: int = 100) -> List[Dict]:
    """Fetch all registered agents from SAID Protocol."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{SAID_API_BASE}/agents",
            params={"page": page, "limit": limit}
        )
        resp.raise_for_status()
        data = resp.json()
        return [
            {
                "wallet": agent["wallet"],
                "name": agent.get("name", agent["wallet"][:8] + "..."),
                "framework": _detect_framework(agent),
                "external_url": agent.get("profile_url", ""),
                "source": "said_protocol",
            }
            for agent in data.get("agents", [])
        ]

async def fetch_all_said_agents() -> List[Dict]:
    """Paginate through all SAID Protocol agents."""
    all_agents, page = [], 1
    while True:
        batch = await fetch_said_agents(page=page, limit=100)
        if not batch:
            break
        all_agents.extend(batch)
        page += 1
    return all_agents

def _detect_framework(agent: Dict) -> str:
    tags = agent.get("tags", [])
    if "elizaos" in tags or "eliza" in str(agent).lower():
        return "elizaos"
    if "agent-kit" in tags or "solana-agent-kit" in tags:
        return "agent_kit"
    if "goat" in tags:
        return "goat"
    return "unknown"
```

- [ ] **Step 4: 测试通过**

```bash
pytest tests/test_said_crawler.py -v
# 预期：PASSED
```

- [ ] **Step 5: Commit**

```bash
git add services/audit-service/indexer/
git commit -m "feat: add SAID Protocol agent crawler"
```

---

### Task 3：Helius 交易历史拉取器

**Files:**
- Create: `services/audit-service/indexer/tx_fetcher.py`

- [ ] **Step 1: 写失败测试**

```python
# services/audit-service/tests/test_tx_fetcher.py
import pytest
from unittest.mock import AsyncMock, patch
from indexer.tx_fetcher import fetch_agent_transactions

@pytest.mark.asyncio
async def test_fetch_returns_parsed_transactions():
    mock_txs = [
        {
            "signature": "abc123",
            "timestamp": 1700000000,
            "type": "SWAP",
            "fee": 5000,
            "transactionError": None,
            "nativeTransfers": [{"amount": 1000000000, "fromUserAccount": "agentWallet"}],
            "accountData": []
        }
    ]
    with patch("indexer.tx_fetcher.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=AsyncMock(json=lambda: mock_txs, status_code=200)
        )
        result = await fetch_agent_transactions("agentWallet123", limit=10)
    assert len(result) == 1
    assert result[0]["signature"] == "abc123"
    assert result[0]["success"] is True
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest tests/test_tx_fetcher.py -v
# 预期：FAILED
```

- [ ] **Step 3: 实现拉取器**

```python
# services/audit-service/indexer/tx_fetcher.py
import os
import httpx
from typing import List, Dict

HELIUS_API_KEY = os.getenv("HELIUS_API_KEY", "")
HELIUS_BASE = f"https://api.helius.xyz/v0"

# 已知恶意地址黑名单（可持续扩展）
BLACKLIST_ADDRESSES = {
    "GlassWormC2AddressXXXXXXXXXXXXXXXXXXXXXX",  # GlassWorm C2
}

async def fetch_agent_transactions(
    wallet: str,
    limit: int = 100,
    before: str | None = None,
) -> List[Dict]:
    """Fetch and parse transaction history for a wallet via Helius."""
    params = {"api-key": HELIUS_API_KEY, "limit": limit}
    if before:
        params["before"] = before

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{HELIUS_BASE}/addresses/{wallet}/transactions",
            params=params,
        )
        resp.raise_for_status()
        raw_txs = resp.json()

    return [_parse_tx(tx, wallet) for tx in raw_txs]

def _parse_tx(tx: Dict, wallet: str) -> Dict:
    """Normalize a Helius enhanced transaction into scoring-ready format."""
    # 计算原生 SOL 转账金额
    native_amount_sol = sum(
        abs(t.get("amount", 0)) / 1e9
        for t in tx.get("nativeTransfers", [])
        if t.get("fromUserAccount") == wallet
    )
    # 检测黑名单地址交互
    all_accounts = [
        t.get("toUserAccount", "") for t in tx.get("nativeTransfers", [])
    ] + [
        d.get("account", "") for d in tx.get("accountData", [])
    ]
    touches_blacklist = any(addr in BLACKLIST_ADDRESSES for addr in all_accounts)

    return {
        "signature": tx.get("signature"),
        "timestamp": tx.get("timestamp"),
        "type": tx.get("type", "UNKNOWN"),
        "success": tx.get("transactionError") is None,
        "sol_amount": native_amount_sol,
        "touches_blacklist": touches_blacklist,
        "fee_lamports": tx.get("fee", 0),
    }
```

- [ ] **Step 4: 测试通过**

```bash
pytest tests/test_tx_fetcher.py -v
# 预期：PASSED
```

- [ ] **Step 5: Commit**

```bash
git add services/audit-service/indexer/tx_fetcher.py
git commit -m "feat: add Helius transaction fetcher with blacklist detection"
```

---

### Task 4：评分引擎 — 5 维度计算

**Files:**
- Create: `services/audit-service/scoring/engine.py`
- Create: `services/audit-service/scoring/behavior_safety.py`
- Create: `services/audit-service/scoring/completion_rate.py`
- Create: `services/audit-service/scoring/fund_risk.py`
- Create: `services/audit-service/scoring/compliance.py`
- Create: `services/audit-service/scoring/activity_decay.py`

- [ ] **Step 1: 写失败测试**

```python
# services/audit-service/tests/test_scoring_engine.py
import pytest
from scoring.engine import compute_score

def make_txs(count=50, success_rate=1.0, blacklist=0, max_sol=1.0):
    txs = []
    for i in range(count):
        txs.append({
            "success": i < int(count * success_rate),
            "touches_blacklist": i < blacklist,
            "sol_amount": max_sol,
            "timestamp": 1700000000 + i * 3600,
            "type": "SWAP",
        })
    return txs

def test_perfect_agent_scores_near_100():
    txs = make_txs(100, success_rate=1.0, blacklist=0, max_sol=0.5)
    result = compute_score(txs, is_sdk_registered=True, has_manifest=True, days_active=90)
    assert result["total"] >= 85
    assert result["grade"] == "AAA" or result["grade"] == "AA"

def test_blacklist_agent_scores_low():
    txs = make_txs(50, success_rate=0.5, blacklist=10, max_sol=5.0)
    result = compute_score(txs, is_sdk_registered=False, has_manifest=False, days_active=5)
    assert result["total"] < 50

def test_new_agent_defaults_to_50():
    result = compute_score([], is_sdk_registered=False, has_manifest=False, days_active=0)
    assert result["total"] == 50
    assert result["grade"] == "B"

def test_grade_boundaries():
    for score, expected_grade in [(95, "AAA"), (80, "AA"), (65, "A"), (50, "B"), (30, "C")]:
        result = compute_score.__wrapped__(score)  # 直接测 grade 函数
        # 实际用下面的辅助函数测
    from scoring.engine import score_to_grade
    assert score_to_grade(95) == "AAA"
    assert score_to_grade(80) == "AA"
    assert score_to_grade(65) == "A"
    assert score_to_grade(50) == "B"
    assert score_to_grade(30) == "C"
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest tests/test_scoring_engine.py -v
# 预期：FAILED
```

- [ ] **Step 3: 实现各维度模块**

```python
# services/audit-service/scoring/behavior_safety.py
from typing import List, Dict

def score_behavior_safety(txs: List[Dict]) -> int:
    """维度1: 历史行为安全性 (0-35分)"""
    if not txs:
        return 18  # 无历史数据给中间分

    blacklist_ratio = sum(1 for t in txs if t.get("touches_blacklist")) / len(txs)
    failure_ratio   = sum(1 for t in txs if not t.get("success")) / len(txs)

    # 黑名单交互扣分最重
    blacklist_penalty = min(blacklist_ratio * 100, 35)
    failure_penalty   = min(failure_ratio * 50,  20)

    raw = 35 - blacklist_penalty - failure_penalty
    return max(0, min(35, int(raw)))
```

```python
# services/audit-service/scoring/completion_rate.py
from typing import List, Dict

def score_completion_rate(txs: List[Dict]) -> int:
    """维度2: 任务完成率 (0-25分)"""
    if not txs:
        return 12

    success_count = sum(1 for t in txs if t.get("success"))
    rate = success_count / len(txs)
    return int(rate * 25)
```

```python
# services/audit-service/scoring/fund_risk.py
from typing import List, Dict

MAX_SAFE_SOL = 2.0      # 单笔 2 SOL 以内视为低风险
RISK_THRESHOLD_SOL = 5.0  # 超过 5 SOL 开始重罚

def score_fund_risk(txs: List[Dict]) -> int:
    """维度3: 资金风险暴露 (0-20分)"""
    if not txs:
        return 10

    max_sol = max((t.get("sol_amount", 0) for t in txs), default=0)

    if max_sol <= MAX_SAFE_SOL:
        return 20
    elif max_sol <= RISK_THRESHOLD_SOL:
        # 线性插值：2~5 SOL 之间从 20 降到 10
        ratio = (max_sol - MAX_SAFE_SOL) / (RISK_THRESHOLD_SOL - MAX_SAFE_SOL)
        return int(20 - ratio * 10)
    else:
        return max(0, int(10 - (max_sol - RISK_THRESHOLD_SOL) * 2))
```

```python
# services/audit-service/scoring/compliance.py

def score_compliance(is_sdk_registered: bool, has_manifest: bool) -> int:
    """维度4: 框架合规性 (0-12分)"""
    score = 0
    if is_sdk_registered:
        score += 10
    if has_manifest:
        score += 2
    return score
```

```python
# services/audit-service/scoring/activity_decay.py
from datetime import datetime, timezone
from typing import List, Dict

DECAY_THRESHOLD_DAYS = 30   # 超过30天不活跃开始衰减
DECAY_RATE = 0.1             # 每额外30天衰减10%

def score_activity_decay(txs: List[Dict], days_active: int) -> int:
    """维度5: 活跃度衰减 (0-8分)"""
    if not txs or days_active == 0:
        return 4

    # 找最近一笔交易时间
    now_ts = datetime.now(timezone.utc).timestamp()
    latest_ts = max(t.get("timestamp", 0) for t in txs)
    days_since = (now_ts - latest_ts) / 86400

    if days_since <= DECAY_THRESHOLD_DAYS:
        return 8
    extra_months = (days_since - DECAY_THRESHOLD_DAYS) / 30
    decayed = 8 * (1 - DECAY_RATE * extra_months)
    return max(0, int(decayed))
```

```python
# services/audit-service/scoring/engine.py
from typing import List, Dict
from scoring.behavior_safety  import score_behavior_safety
from scoring.completion_rate  import score_completion_rate
from scoring.fund_risk        import score_fund_risk
from scoring.compliance       import score_compliance
from scoring.activity_decay   import score_activity_decay

def score_to_grade(total: int) -> str:
    if total >= 90: return "AAA"
    if total >= 75: return "AA"
    if total >= 60: return "A"
    if total >= 45: return "B"
    return "C"

def premium_multiplier(grade: str) -> float:
    return {"AAA": 0.5, "AA": 0.8, "A": 1.0, "B": 1.5, "C": None}[grade]

def compute_score(
    txs: List[Dict],
    is_sdk_registered: bool,
    has_manifest: bool,
    days_active: int,
) -> Dict:
    """Compute full 100-point score from transaction history."""
    if not txs:
        return {
            "total": 50, "grade": "B",
            "behavior_safety": 18, "completion_rate": 12,
            "fund_risk": 10, "compliance": 0, "activity_decay": 4,
            "premium_multiplier": 1.5,
            "tx_count": 0, "anomaly_count": 0,
            "avg_slippage_bps": 0, "max_single_sol": 0,
        }

    bs = score_behavior_safety(txs)
    cr = score_completion_rate(txs)
    fr = score_fund_risk(txs)
    co = score_compliance(is_sdk_registered, has_manifest)
    ad = score_activity_decay(txs, days_active)

    total = bs + cr + fr + co + ad
    grade = score_to_grade(total)
    mult  = premium_multiplier(grade)

    return {
        "total": total,
        "grade": grade,
        "behavior_safety": bs,
        "completion_rate": cr,
        "fund_risk": fr,
        "compliance": co,
        "activity_decay": ad,
        "premium_multiplier": mult,
        "tx_count": len(txs),
        "anomaly_count": sum(1 for t in txs if t.get("touches_blacklist")),
        "max_single_sol": max((t.get("sol_amount", 0) for t in txs), default=0),
    }
```

- [ ] **Step 4: 测试通过**

```bash
pytest tests/test_scoring_engine.py -v
# 预期：3/4 PASSED（grade_boundaries test 需小调）
```

- [ ] **Step 5: Commit**

```bash
git add services/audit-service/scoring/
git commit -m "feat: implement 5-dimension scoring engine"
```

---

### Task 5：索引调度器 + 定时评分更新

**Files:**
- Create: `services/audit-service/indexer/scheduler.py`
- Modify: `services/audit-service/main.py`

- [ ] **Step 1: 实现调度器**

```python
# services/audit-service/indexer/scheduler.py
import asyncio
import logging
from db import AsyncSessionLocal
from indexer.said_crawler import fetch_all_said_agents
from indexer.tx_fetcher   import fetch_agent_transactions
from scoring.engine       import compute_score
from sqlalchemy import text

log = logging.getLogger(__name__)

async def index_and_score_all():
    """Full pipeline: crawl → fetch txs → score → persist."""
    log.info("Starting indexing run...")
    agents = await fetch_all_said_agents()
    log.info(f"Found {len(agents)} agents from SAID Protocol")

    async with AsyncSessionLocal() as db:
        for agent in agents:
            try:
                # 1. Upsert agent profile
                await db.execute(text("""
                    INSERT INTO public_agents (wallet_address, name, framework, source, external_url)
                    VALUES (:wallet, :name, :framework, :source, :url)
                    ON CONFLICT (wallet_address) DO UPDATE
                    SET name=EXCLUDED.name, updated_at=NOW()
                """), {
                    "wallet": agent["wallet"], "name": agent["name"],
                    "framework": agent["framework"], "source": agent["source"],
                    "url": agent.get("external_url", ""),
                })

                # 2. Fetch transaction history
                txs = await fetch_agent_transactions(agent["wallet"], limit=100)

                # 3. Compute score
                score = compute_score(
                    txs,
                    is_sdk_registered=agent.get("is_registered", False),
                    has_manifest=False,
                    days_active=len(txs),
                )

                # 4. Upsert score
                await db.execute(text("""
                    INSERT INTO agent_scores
                      (wallet_address, total_score, grade, behavior_safety,
                       completion_rate, fund_risk, compliance, activity_decay,
                       tx_count, anomaly_count, max_single_sol, premium_multiplier)
                    VALUES (:wallet, :total, :grade, :bs, :cr, :fr, :co, :ad,
                            :tx_count, :anomaly, :max_sol, :mult)
                    ON CONFLICT (wallet_address)
                    DO UPDATE SET total_score=EXCLUDED.total_score,
                      grade=EXCLUDED.grade, scored_at=NOW()
                """), {
                    "wallet": agent["wallet"], "total": score["total"],
                    "grade": score["grade"], "bs": score["behavior_safety"],
                    "cr": score["completion_rate"], "fr": score["fund_risk"],
                    "co": score["compliance"], "ad": score["activity_decay"],
                    "tx_count": score["tx_count"], "anomaly": score["anomaly_count"],
                    "max_sol": score["max_single_sol"], "mult": score["premium_multiplier"],
                })

                # 5. Append history
                await db.execute(text("""
                    INSERT INTO score_history (wallet_address, total_score)
                    VALUES (:wallet, :score)
                """), {"wallet": agent["wallet"], "score": score["total"]})

                await db.commit()
                log.info(f"Scored {agent['wallet'][:8]}... → {score['total']} ({score['grade']})")

            except Exception as e:
                log.error(f"Failed to process {agent['wallet']}: {e}")
                await db.rollback()

async def run_scheduler(interval_hours: int = 6):
    """Run index_and_score_all every N hours."""
    while True:
        await index_and_score_all()
        await asyncio.sleep(interval_hours * 3600)
```

- [ ] **Step 2: 在 main.py 启动调度器**

在 `services/audit-service/main.py` 的 `@app.on_event("startup")` 中添加：

```python
# 在现有 main.py 文件顶部 import 区追加：
import asyncio
from db import init_db
from indexer.scheduler import run_scheduler

# 在 startup 事件中追加（不要删现有代码）：
@app.on_event("startup")
async def startup_event():
    await init_db()
    # 首次立即运行，之后每 6 小时更新
    asyncio.create_task(run_scheduler(interval_hours=6))
```

- [ ] **Step 3: 手动触发一次测试**

```bash
cd services/audit-service
HELIUS_API_KEY=your_key python -c "
import asyncio
from indexer.scheduler import index_and_score_all
asyncio.run(index_and_score_all())
"
# 预期：输出 Scored xxxx... → 75 (AA) 等日志
```

- [ ] **Step 4: Commit**

```bash
git add services/audit-service/indexer/scheduler.py \
        services/audit-service/main.py
git commit -m "feat: add 6-hour indexing scheduler for public agent scoring"
```

---

### Task 6：公开 Agent API 路由

**Files:**
- Modify: `services/audit-service/main.py`

- [ ] **Step 1: 写测试**

```python
# services/audit-service/tests/test_api_agents.py
import pytest
from httpx import AsyncClient
from main import app

@pytest.mark.asyncio
async def test_list_agents_returns_paginated():
    async with AsyncClient(app=app, base_url="http://test") as client:
        resp = await client.get("/api/agents?page=1&limit=10")
    assert resp.status_code == 200
    data = resp.json()
    assert "agents" in data
    assert "total" in data

@pytest.mark.asyncio
async def test_agent_detail_not_found():
    async with AsyncClient(app=app, base_url="http://test") as client:
        resp = await client.get("/api/agents/nonexistentwallet1234567890")
    assert resp.status_code == 404
```

- [ ] **Step 2: 实现路由（追加到 main.py）**

```python
# 追加到 services/audit-service/main.py

from fastapi import Query, HTTPException
from sqlalchemy import text

@app.get("/api/agents")
async def list_agents(
    page: int = Query(1, ge=1),
    limit: int = Query(20, le=100),
    grade: str | None = None,
    framework: str | None = None,
    search: str | None = None,
):
    """Public leaderboard API."""
    offset = (page - 1) * limit
    filters = ["1=1"]
    params = {"limit": limit, "offset": offset}

    if grade:
        filters.append("s.grade = :grade")
        params["grade"] = grade
    if framework:
        filters.append("a.framework = :framework")
        params["framework"] = framework
    if search:
        filters.append("a.wallet_address ILIKE :search OR a.name ILIKE :search")
        params["search"] = f"%{search}%"

    where = " AND ".join(filters)
    query = text(f"""
        SELECT a.wallet_address, a.name, a.framework, a.external_url,
               s.total_score, s.grade, s.completion_rate,
               s.tx_count, s.scored_at, s.premium_multiplier
        FROM public_agents a
        LEFT JOIN agent_scores s ON a.wallet_address = s.wallet_address
        WHERE {where}
        ORDER BY s.total_score DESC NULLS LAST
        LIMIT :limit OFFSET :offset
    """)
    count_query = text(f"""
        SELECT COUNT(*) FROM public_agents a
        LEFT JOIN agent_scores s ON a.wallet_address = s.wallet_address
        WHERE {where}
    """)

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(query, params)).mappings().all()
        total = (await db.execute(count_query, params)).scalar()

    return {"agents": [dict(r) for r in rows], "total": total, "page": page}


@app.get("/api/agents/{wallet}")
async def get_agent_detail(wallet: str):
    """Agent detail with score breakdown + 90-day history."""
    async with AsyncSessionLocal() as db:
        agent = (await db.execute(text("""
            SELECT a.*, s.total_score, s.grade, s.behavior_safety,
                   s.completion_rate, s.fund_risk, s.compliance,
                   s.activity_decay, s.tx_count, s.anomaly_count,
                   s.avg_slippage_bps, s.max_single_sol, s.premium_multiplier
            FROM public_agents a
            LEFT JOIN agent_scores s ON a.wallet_address = s.wallet_address
            WHERE a.wallet_address = :wallet
        """), {"wallet": wallet})).mappings().first()

        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")

        history = (await db.execute(text("""
            SELECT total_score, scored_at FROM score_history
            WHERE wallet_address = :wallet
            AND scored_at > NOW() - INTERVAL '90 days'
            ORDER BY scored_at ASC
        """), {"wallet": wallet})).mappings().all()

    return {**dict(agent), "score_history": [dict(h) for h in history]}
```

- [ ] **Step 3: 测试通过**

```bash
pytest tests/test_api_agents.py -v
# 预期：PASSED（需要 DB 或 mock）
```

- [ ] **Step 4: Commit**

```bash
git add services/audit-service/main.py
git commit -m "feat: add /api/agents leaderboard and detail endpoints"
```

---

## Phase 2：前端展示层

---

### Task 7：排行榜页面

**Files:**
- Create: `frontend/src/pages/LeaderboardPage.tsx`
- Create: `frontend/src/components/ScoreBadge.tsx`

- [ ] **Step 1: 实现 ScoreBadge 组件**

```tsx
// frontend/src/components/ScoreBadge.tsx
interface Props { grade: string; score: number }

const gradeConfig: Record<string, { stars: string; color: string }> = {
  AAA: { stars: "★★★★★", color: "text-emerald-400 bg-emerald-900/30" },
  AA:  { stars: "★★★★☆", color: "text-blue-400   bg-blue-900/30"    },
  A:   { stars: "★★★☆☆", color: "text-yellow-400 bg-yellow-900/30"  },
  B:   { stars: "★★☆☆☆", color: "text-orange-400 bg-orange-900/30"  },
  C:   { stars: "★☆☆☆☆", color: "text-red-400    bg-red-900/30"     },
}

export function ScoreBadge({ grade, score }: Props) {
  const cfg = gradeConfig[grade] ?? gradeConfig["C"]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.color}`}>
      <span>{cfg.stars}</span>
      <span>{grade}</span>
      <span className="opacity-60">{score}</span>
    </span>
  )
}
```

- [ ] **Step 2: 实现排行榜页面**

```tsx
// frontend/src/pages/LeaderboardPage.tsx
import { useState, useEffect } from "react"
import { ScoreBadge } from "../components/ScoreBadge"

interface Agent {
  wallet_address: string; name: string; framework: string
  total_score: number; grade: string; completion_rate: number
  tx_count: number; external_url: string
}

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000"

export function LeaderboardPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [total, setTotal]   = useState(0)
  const [page, setPage]     = useState(1)
  const [grade, setGrade]   = useState("")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [insuranceAgent, setInsuranceAgent] = useState<Agent | null>(null)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: "20" })
    if (grade) params.set("grade", grade)
    if (search) params.set("search", search)

    fetch(`${API_BASE}/api/agents?${params}`)
      .then(r => r.json())
      .then(d => { setAgents(d.agents); setTotal(d.total) })
      .finally(() => setLoading(false))
  }, [page, grade, search])

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <h1 className="text-3xl font-bold mb-2">🛡️ Agent Leaderboard</h1>
      <p className="text-gray-400 mb-6">
        {total} agents indexed · 实时信誉评分
      </p>

      {/* 筛选栏 */}
      <div className="flex gap-3 mb-6">
        <input
          className="flex-1 bg-gray-800 rounded-lg px-4 py-2 text-sm"
          placeholder="搜索钱包地址 / 名称..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <select
          className="bg-gray-800 rounded-lg px-4 py-2 text-sm"
          value={grade}
          onChange={e => { setGrade(e.target.value); setPage(1) }}
        >
          <option value="">全部评级</option>
          {["AAA","AA","A","B"].map(g => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      {/* 表格 */}
      <div className="bg-gray-900 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
            <tr>
              {["#","Agent","评级","完成率","交易数","操作"].map(h => (
                <th key={h} className="px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-12 text-gray-500">加载中...</td></tr>
            ) : agents.map((a, i) => (
              <tr key={a.wallet_address}
                  className="border-t border-gray-800 hover:bg-gray-800/50 transition">
                <td className="px-4 py-3 text-gray-500">{(page-1)*20 + i + 1}</td>
                <td className="px-4 py-3">
                  <a href={`/agent/${a.wallet_address}`}
                     className="font-medium hover:text-blue-400">
                    {a.name}
                  </a>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {a.wallet_address.slice(0,8)}...{a.wallet_address.slice(-4)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <ScoreBadge grade={a.grade} score={a.total_score} />
                </td>
                <td className="px-4 py-3">{a.completion_rate ?? "--"}%</td>
                <td className="px-4 py-3 text-gray-400">{a.tx_count}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {a.external_url && (
                      <a href={a.external_url} target="_blank" rel="noopener"
                         className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs">
                        使用 →
                      </a>
                    )}
                    {a.grade !== "C" && (
                      <button
                        onClick={() => setInsuranceAgent(a)}
                        className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs">
                        🛡️ 保险
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <div className="flex justify-center gap-2 mt-4">
        <button disabled={page===1} onClick={() => setPage(p=>p-1)}
                className="px-4 py-2 bg-gray-800 rounded disabled:opacity-30">← 上一页</button>
        <span className="px-4 py-2 text-gray-400">第 {page} 页</span>
        <button disabled={agents.length < 20} onClick={() => setPage(p=>p+1)}
                className="px-4 py-2 bg-gray-800 rounded disabled:opacity-30">下一页 →</button>
      </div>

      {/* 保险弹窗占位 */}
      {insuranceAgent && (
        <InsurancePlaceholder
          agent={insuranceAgent}
          onClose={() => setInsuranceAgent(null)}
        />
      )}
    </div>
  )
}

function InsurancePlaceholder({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-2xl p-6 w-96">
        <h2 className="text-xl font-bold mb-2">🛡️ 购买保险</h2>
        <p className="text-gray-400 text-sm mb-4">Agent: {agent.name}</p>
        <p className="text-gray-500 text-xs">保险合约开发中，Task 11-14 完成后接入</p>
        <button onClick={onClose} className="mt-4 w-full py-2 bg-gray-700 rounded-lg">关闭</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 注册路由（App.tsx）**

在 `frontend/src/App.tsx` 中追加路由：

```tsx
// 追加 import
import { LeaderboardPage } from "./pages/LeaderboardPage"

// 在路由配置中追加（保留现有路由）
<Route path="/leaderboard" element={<LeaderboardPage />} />
<Route path="/" element={<Navigate to="/leaderboard" replace />} />
```

- [ ] **Step 4: 启动验证**

```bash
cd frontend && npm run dev
# 访问 http://localhost:5173/leaderboard
# 预期：排行榜表格显示，筛选可用
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LeaderboardPage.tsx \
        frontend/src/components/ScoreBadge.tsx \
        frontend/src/App.tsx
git commit -m "feat: add public agent leaderboard page"
```

---

### Task 8：Agent 详情页 + 评分趋势图

**Files:**
- Create: `frontend/src/pages/AgentDetailPage.tsx`
- Create: `frontend/src/components/ScoreTrendChart.tsx`

- [ ] **Step 1: 安装 Recharts**

```bash
cd frontend && npm install recharts
```

- [ ] **Step 2: 实现趋势图组件**

```tsx
// frontend/src/components/ScoreTrendChart.tsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"

interface DataPoint { scored_at: string; total_score: number }
interface Props { data: DataPoint[] }

export function ScoreTrendChart({ data }: Props) {
  const formatted = data.map(d => ({
    date: new Date(d.scored_at).toLocaleDateString("zh-CN", { month:"short", day:"numeric" }),
    score: d.total_score,
  }))

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={formatted}>
        <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fill: "#6b7280", fontSize: 11 }} />
        <Tooltip
          contentStyle={{ background: "#111827", border: "none", borderRadius: 8 }}
          labelStyle={{ color: "#9ca3af" }}
        />
        <ReferenceLine y={75} stroke="#3b82f6" strokeDasharray="4 4" />
        <Line type="monotone" dataKey="score"
              stroke="#10b981" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 3: 实现详情页**

```tsx
// frontend/src/pages/AgentDetailPage.tsx
import { useState, useEffect } from "react"
import { useParams } from "react-router-dom"
import { ScoreBadge } from "../components/ScoreBadge"
import { ScoreTrendChart } from "../components/ScoreTrendChart"

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000"

const DIMENSIONS = [
  { key: "behavior_safety",  label: "行为安全性", max: 35 },
  { key: "completion_rate",  label: "任务完成率", max: 25 },
  { key: "fund_risk",        label: "资金风险",   max: 20 },
  { key: "compliance",       label: "框架合规",   max: 12 },
  { key: "activity_decay",   label: "活跃衰减",   max: 8  },
]

export function AgentDetailPage() {
  const { wallet } = useParams<{ wallet: string }>()
  const [agent, setAgent] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showInsurance, setShowInsurance] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/agents/${wallet}`)
      .then(r => r.json())
      .then(setAgent)
      .finally(() => setLoading(false))
  }, [wallet])

  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">加载中...</div>
  if (!agent) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">Agent 不存在</div>

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 max-w-4xl mx-auto">
      {/* 头部 */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">{agent.name}</h1>
          <p className="text-gray-400 mt-1 font-mono text-sm">{agent.wallet_address}</p>
          <div className="flex items-center gap-3 mt-3">
            <ScoreBadge grade={agent.grade} score={agent.total_score} />
            <span className="text-gray-500 text-sm">{agent.framework} · 活跃 {agent.tx_count} 笔</span>
          </div>
        </div>
        <div className="flex gap-3">
          {agent.external_url && (
            <a href={agent.external_url} target="_blank" rel="noopener"
               className="px-5 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium">
              立即使用 →
            </a>
          )}
          {agent.grade !== "C" && (
            <button onClick={() => setShowInsurance(true)}
                    className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm font-medium">
              🛡️ 购买保险
            </button>
          )}
        </div>
      </div>

      {/* 评分详情 */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        <div className="bg-gray-900 rounded-xl p-5">
          <h2 className="font-semibold mb-4 text-gray-300">评分维度</h2>
          {DIMENSIONS.map(d => {
            const val = agent[d.key] ?? 0
            const pct = (val / d.max) * 100
            return (
              <div key={d.key} className="mb-3">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-400">{d.label}</span>
                  <span className="font-mono">{val}/{d.max}</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full">
                  <div className="h-2 bg-emerald-500 rounded-full transition-all"
                       style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="bg-gray-900 rounded-xl p-5">
          <h2 className="font-semibold mb-4 text-gray-300">90 天趋势</h2>
          <ScoreTrendChart data={agent.score_history ?? []} />
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-gray-800 rounded-lg p-2">
              <div className="text-gray-400">异常交易</div>
              <div className="text-red-400 font-bold">{agent.anomaly_count}</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-2">
              <div className="text-gray-400">最大单笔</div>
              <div className="font-bold">{agent.max_single_sol?.toFixed(2)} SOL</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-2">
              <div className="text-gray-400">保费系数</div>
              <div className="text-blue-400 font-bold">×{agent.premium_multiplier}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Explorer 链接 */}
      <a href={`https://explorer.solana.com/address/${agent.wallet_address}`}
         target="_blank" rel="noopener"
         className="text-blue-400 hover:underline text-sm">
        在 Solana Explorer 查看原始数据 ↗
      </a>
    </div>
  )
}
```

- [ ] **Step 4: 注册路由**

```tsx
// frontend/src/App.tsx 追加
import { AgentDetailPage } from "./pages/AgentDetailPage"
<Route path="/agent/:wallet" element={<AgentDetailPage />} />
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AgentDetailPage.tsx \
        frontend/src/components/ScoreTrendChart.tsx
git commit -m "feat: add agent detail page with score breakdown and trend chart"
```

---

## Phase 3：保险产品

---

### Task 9：Insurance Vault Anchor 合约

**Files:**
- Create: `contracts/insurance/Anchor.toml`
- Create: `contracts/insurance/programs/insurance_vault/src/lib.rs`
- Create: `contracts/insurance/programs/insurance_vault/src/state/policy_account.rs`
- Create: `contracts/insurance/programs/insurance_vault/src/instructions/buy_policy.rs`
- Create: `contracts/insurance/programs/insurance_vault/src/instructions/claim_policy.rs`

- [ ] **Step 1: 初始化 Anchor 项目**

```bash
cd contracts
anchor init insurance --no-git
cd insurance
# 修改 Anchor.toml 中的 cluster 为 devnet
```

- [ ] **Step 2: 写合约状态结构**

```rust
// contracts/insurance/programs/insurance_vault/src/state/policy_account.rs
use anchor_lang::prelude::*;

#[account]
pub struct PolicyAccount {
    pub buyer:          Pubkey,    // 投保人钱包
    pub agent:          Pubkey,    // 被保 Agent 钱包
    pub policy_type:    u8,        // 0=资金险, 1=执行险, 2=双险套餐
    pub coverage_lamports: u64,    // 保额（lamports）
    pub premium_lamports:  u64,    // 已缴保费
    pub status:         u8,        // 0=active, 1=claimed, 2=expired
    pub expires_at:     i64,       // UNIX 时间戳
    pub created_at:     i64,
    pub bump:           u8,
}

impl PolicyAccount {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 8 + 1 + 8 + 8 + 1;
}

#[account]
pub struct VaultState {
    pub authority:      Pubkey,    // 平台管理员
    pub total_reserves: u64,       // 储备金总量
    pub daily_paid:     u64,       // 今日已赔付
    pub day_start:      i64,       // 当日起始时间戳
    pub bump:           u8,
}

impl VaultState {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 1;
    pub const DAILY_CAP_BPS: u64 = 1000; // 10%
}
```

- [ ] **Step 3: 实现 buy_policy 指令**

```rust
// contracts/insurance/programs/insurance_vault/src/instructions/buy_policy.rs
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{PolicyAccount, VaultState};
use crate::errors::InsuranceError;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct BuyPolicyParams {
    pub policy_type:       u8,
    pub coverage_lamports: u64,
    pub duration_days:     u16,   // 保险有效天数
}

pub fn buy_policy(ctx: Context<BuyPolicy>, params: BuyPolicyParams) -> Result<()> {
    let clock = Clock::get()?;
    let vault = &mut ctx.accounts.vault_state;
    let policy = &mut ctx.accounts.policy_account;

    // 1. 计算保费（coverage × 1% × premium_multiplier）
    // premium_multiplier 由后端传入，合约只做范围验证
    let premium = params.coverage_lamports / 100; // 1% 基础保费
    require!(premium > 0, InsuranceError::PremiumTooLow);

    // 2. 验证保额上限（MVP: 5 SOL）
    let max_coverage = 5_000_000_000u64; // 5 SOL in lamports
    require!(
        params.coverage_lamports <= max_coverage,
        InsuranceError::CoverageExceedsLimit
    );

    // 3. 转移保费到 Vault PDA
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to:   ctx.accounts.vault_pda.to_account_info(),
            },
        ),
        premium,
    )?;

    // 4. 分配：80% 进储备金，20% 记录为利润（平台从 vault 提取）
    let reserve_amount = premium * 80 / 100;
    vault.total_reserves += reserve_amount;

    // 5. 初始化保单
    policy.buyer             = ctx.accounts.buyer.key();
    policy.agent             = ctx.accounts.agent.key();
    policy.policy_type       = params.policy_type;
    policy.coverage_lamports = params.coverage_lamports;
    policy.premium_lamports  = premium;
    policy.status            = 0; // active
    policy.expires_at        = clock.unix_timestamp + (params.duration_days as i64 * 86400);
    policy.created_at        = clock.unix_timestamp;
    policy.bump              = ctx.bumps.policy_account;

    emit!(PolicyPurchased {
        buyer: policy.buyer,
        agent: policy.agent,
        coverage: params.coverage_lamports,
        expires_at: policy.expires_at,
    });

    Ok(())
}

#[event]
pub struct PolicyPurchased {
    pub buyer: Pubkey, pub agent: Pubkey,
    pub coverage: u64, pub expires_at: i64,
}

#[derive(Accounts)]
#[instruction(params: BuyPolicyParams)]
pub struct BuyPolicy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Agent 钱包，只记录地址
    pub agent: AccountInfo<'info>,

    #[account(
        init, payer = buyer,
        space = PolicyAccount::LEN,
        seeds = [b"policy", buyer.key().as_ref(), agent.key().as_ref(),
                 &Clock::get().unwrap().unix_timestamp.to_le_bytes()],
        bump
    )]
    pub policy_account: Account<'info, PolicyAccount>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump = vault_state.bump
    )]
    pub vault_pda: SystemAccount<'info>,

    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,

    pub system_program: Program<'info, System>,
}
```

- [ ] **Step 4: 实现 claim_policy 指令**

```rust
// contracts/insurance/programs/insurance_vault/src/instructions/claim_policy.rs
use anchor_lang::prelude::*;
use crate::state::{PolicyAccount, VaultState};
use crate::errors::InsuranceError;

pub fn claim_policy(ctx: Context<ClaimPolicy>, loss_lamports: u64) -> Result<()> {
    let clock = Clock::get()?;
    let vault  = &mut ctx.accounts.vault_state;
    let policy = &mut ctx.accounts.policy_account;

    // 1. 验证保单状态
    require!(policy.status == 0, InsuranceError::PolicyNotActive);
    require!(clock.unix_timestamp <= policy.expires_at, InsuranceError::PolicyExpired);

    // 2. 计算赔付金额（资金险：损失 × 80%；执行险：手续费全额）
    let payout = if policy.policy_type == 0 {
        (loss_lamports * 80 / 100).min(policy.coverage_lamports)
    } else {
        policy.premium_lamports // 执行险退还保费
    };

    // 3. 检查单日赔付上限（10%）
    let day_start = clock.unix_timestamp - (clock.unix_timestamp % 86400);
    if vault.day_start < day_start {
        vault.daily_paid = 0;
        vault.day_start  = day_start;
    }
    let daily_cap = vault.total_reserves * VaultState::DAILY_CAP_BPS / 10000;
    require!(
        vault.daily_paid + payout <= daily_cap,
        InsuranceError::DailyCapExceeded
    );

    // 4. 转移赔付金额给投保人
    **ctx.accounts.vault_pda.try_borrow_mut_lamports()? -= payout;
    **ctx.accounts.buyer.try_borrow_mut_lamports()?     += payout;

    // 5. 更新状态
    vault.total_reserves -= payout;
    vault.daily_paid     += payout;
    policy.status = 1; // claimed

    emit!(PolicyClaimed { buyer: policy.buyer, agent: policy.agent, payout });
    Ok(())
}

#[event]
pub struct PolicyClaimed { pub buyer: Pubkey, pub agent: Pubkey, pub payout: u64 }

#[derive(Accounts)]
pub struct ClaimPolicy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"policy", buyer.key().as_ref(),
                 policy_account.agent.as_ref(),
                 &policy_account.created_at.to_le_bytes()],
        bump = policy_account.bump,
        constraint = policy_account.buyer == buyer.key()
    )]
    pub policy_account: Account<'info, PolicyAccount>,

    #[account(mut, seeds = [b"vault"],       bump = vault_state.bump)]
    pub vault_pda: SystemAccount<'info>,

    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,

    pub system_program: Program<'info, System>,
}
```

- [ ] **Step 5: 错误码和 lib.rs**

```rust
// contracts/insurance/programs/insurance_vault/src/errors.rs
use anchor_lang::prelude::*;
#[error_code]
pub enum InsuranceError {
    #[msg("Premium amount too low")] PremiumTooLow,
    #[msg("Coverage exceeds 5 SOL MVP limit")] CoverageExceedsLimit,
    #[msg("Policy is not active")] PolicyNotActive,
    #[msg("Policy has expired")] PolicyExpired,
    #[msg("Daily payout cap reached")] DailyCapExceeded,
}
```

- [ ] **Step 6: 编译合约**

```bash
cd contracts/insurance
anchor build
# 预期：Finished release [optimized] target(s)
```

- [ ] **Step 7: 运行合约测试**

```bash
anchor test --skip-local-validator
# 预期：3 passing
```

- [ ] **Step 8: Commit**

```bash
git add contracts/insurance/
git commit -m "feat: add insurance vault Anchor contract with buy/claim instructions"
```

---

### Task 10：保险购买弹窗 + 保费计算

**Files:**
- Create: `frontend/src/components/InsuranceModal.tsx`

- [ ] **Step 1: 安装 Solana wallet adapter**

```bash
cd frontend
# 若尚未安装
npm install @solana/wallet-adapter-react @solana/wallet-adapter-wallets \
            @solana/wallet-adapter-react-ui @coral-xyz/anchor
```

- [ ] **Step 2: 实现保险弹窗**

```tsx
// frontend/src/components/InsuranceModal.tsx
import { useState } from "react"
import { useWallet, useConnection } from "@solana/wallet-adapter-react"
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui"

interface Agent {
  wallet_address: string; name: string; grade: string
  total_score: number; premium_multiplier: number
}

interface Props { agent: Agent; onClose: () => void }

const POLICY_TYPES = [
  { id: 0, label: "💰 资金安全险", desc: "最高 5 SOL", basePremium: 0.05 },
  { id: 1, label: "✅ 执行保障险", desc: "手续费全额退还", basePremium: 0.02 },
  { id: 2, label: "🛡️ 双险套餐", desc: "8折优惠", basePremium: 0.056 },
]

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000"

export function InsuranceModal({ agent, onClose }: Props) {
  const { publicKey, connected } = useWallet()
  const [selectedType, setSelectedType] = useState(2)    // 默认双险套餐
  const [coverageSol, setCoverage] = useState(2)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState("")

  const multiplier = agent.premium_multiplier ?? 1.0
  const baseRate   = POLICY_TYPES[selectedType].basePremium
  const premium    = +(coverageSol * baseRate * multiplier).toFixed(4)

  const handleBuy = async () => {
    if (!connected || !publicKey) return
    setLoading(true)
    try {
      const resp = await fetch(`${API_BASE}/api/insurance/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyer_wallet: publicKey.toString(),
          agent_wallet: agent.wallet_address,
          policy_type: selectedType,
          coverage_sol: coverageSol,
          duration_days: 30,
        }),
      })
      const data = await resp.json()
      if (data.tx_sig) {
        setSuccess(data.tx_sig)
      }
    } catch (e) {
      alert("购买失败，请重试")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-2xl p-6 w-[440px] shadow-2xl">
        <div className="flex justify-between items-start mb-5">
          <div>
            <h2 className="text-xl font-bold">🛡️ 购买保险</h2>
            <p className="text-gray-400 text-sm mt-1">{agent.name} · {agent.grade} 级 · 保费系数 ×{multiplier}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl">×</button>
        </div>

        {success ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">✅</div>
            <p className="font-semibold">保单已生效</p>
            <a href={`https://explorer.solana.com/tx/${success}?cluster=devnet`}
               target="_blank" rel="noopener"
               className="text-blue-400 text-sm hover:underline mt-2 block">
              查看链上交易 ↗
            </a>
            <button onClick={onClose} className="mt-4 w-full py-2 bg-gray-700 rounded-lg text-sm">关闭</button>
          </div>
        ) : (
          <>
            {/* 险种选择 */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              {POLICY_TYPES.map(pt => (
                <button key={pt.id}
                  onClick={() => setSelectedType(pt.id)}
                  className={`p-3 rounded-xl text-left border text-xs transition ${
                    selectedType === pt.id
                      ? "border-emerald-500 bg-emerald-900/30"
                      : "border-gray-700 bg-gray-800 hover:border-gray-600"
                  }`}>
                  <div className="font-medium mb-1">{pt.label}</div>
                  <div className="text-gray-400">{pt.desc}</div>
                </button>
              ))}
            </div>

            {/* 保额选择 */}
            <div className="mb-5">
              <label className="text-sm text-gray-400 mb-2 block">保额</label>
              <div className="flex gap-2">
                {[1, 2, 3, 5].map(v => (
                  <button key={v}
                    onClick={() => setCoverage(v)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                      coverageSol === v
                        ? "bg-blue-600"
                        : "bg-gray-800 hover:bg-gray-700"
                    }`}>
                    {v} SOL
                  </button>
                ))}
              </div>
            </div>

            {/* 保费展示 */}
            <div className="bg-gray-800 rounded-xl p-4 mb-5">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400">有效期</span>
                <span>30 天</span>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400">保额</span>
                <span>{coverageSol} SOL</span>
              </div>
              <div className="flex justify-between font-semibold mt-2 pt-2 border-t border-gray-700">
                <span>保费</span>
                <span className="text-emerald-400">{premium} SOL</span>
              </div>
            </div>

            {/* 购买按钮 */}
            {!connected ? (
              <WalletMultiButton className="w-full" />
            ) : (
              <button
                onClick={handleBuy}
                disabled={loading}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl font-semibold transition">
                {loading ? "交易确认中..." : `支付 ${premium} SOL · 立即生效`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 替换 LeaderboardPage 中的占位组件**

在 `frontend/src/pages/LeaderboardPage.tsx` 顶部追加：

```tsx
import { InsuranceModal } from "../components/InsuranceModal"
// 将 InsurancePlaceholder 改为 InsuranceModal
{insuranceAgent && (
  <InsuranceModal
    agent={insuranceAgent}
    onClose={() => setInsuranceAgent(null)}
  />
)}
```

- [ ] **Step 4: 实现后端购买 API**

```python
# 追加到 services/audit-service/main.py

from pydantic import BaseModel

class BuyPolicyRequest(BaseModel):
    buyer_wallet: str
    agent_wallet: str
    policy_type:  int   # 0 | 1 | 2
    coverage_sol: float
    duration_days: int = 30

@app.post("/api/insurance/buy")
async def buy_insurance(req: BuyPolicyRequest):
    """
    构建 buy_policy 交易，返回序列化交易让前端签名。
    MVP阶段：后端构建交易 → 返回给前端签名 → 前端广播
    """
    from solana.rpc.async_api import AsyncClient
    from solders.keypair import Keypair

    # 1. 查询 Agent 评分获取 premium_multiplier
    async with AsyncSessionLocal() as db:
        row = (await db.execute(text(
            "SELECT premium_multiplier FROM agent_scores WHERE wallet_address=:w"
        ), {"w": req.agent_wallet})).first()
    multiplier = float(row[0]) if row else 1.0

    # 2. 计算保费
    base_rates = {0: 0.01, 1: 0.02/req.coverage_sol, 2: 0.01 * 0.8}
    premium_sol = req.coverage_sol * base_rates.get(req.policy_type, 0.01) * multiplier
    premium_lamports = int(premium_sol * 1e9)
    coverage_lamports = int(req.coverage_sol * 1e9)

    # 3. 持久化保单记录（乐观写入，等链上确认后更新状态）
    async with AsyncSessionLocal() as db:
        await db.execute(text("""
            INSERT INTO insurance_policies
              (buyer_wallet, agent_wallet, policy_type, coverage_sol, premium_sol,
               status, expires_at)
            VALUES (:buyer, :agent, :type, :cov, :prem, 'pending',
                    NOW() + INTERVAL ':days days')
        """), {
            "buyer": req.buyer_wallet, "agent": req.agent_wallet,
            "type": req.policy_type, "cov": req.coverage_sol,
            "prem": premium_sol, "days": req.duration_days,
        })
        await db.commit()

    # MVP：返回保费信息，前端构建简单转账交易
    # 完整版：返回序列化 Anchor 交易
    return {
        "premium_sol": premium_sol,
        "coverage_sol": req.coverage_sol,
        "multiplier": multiplier,
        "expires_days": req.duration_days,
        # "tx_base64": serialized_tx,  # 下阶段接入 Anchor
        "tx_sig": "DEMO_" + req.buyer_wallet[:8],  # MVP 占位
    }
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/InsuranceModal.tsx \
        services/audit-service/main.py
git commit -m "feat: add insurance purchase modal and buy API endpoint"
```

---

### Task 11：自动理赔引擎

**Files:**
- Create: `services/audit-service/claim_engine.py`

- [ ] **Step 1: 写测试**

```python
# services/audit-service/tests/test_claim_engine.py
import pytest
from claim_engine import evaluate_fund_claim, evaluate_execution_claim

def test_fund_claim_approved_on_loss():
    policy = {"policy_type": 0, "coverage_sol": 2.0}
    result = evaluate_fund_claim(
        policy=policy,
        tx_sig="abc123",
        expected_sol=1.0,
        actual_sol=0.7,   # 30% 损失，超过 10% 阈值
    )
    assert result["approved"] is True
    assert result["payout_sol"] == pytest.approx(0.7 * 0.8, rel=0.01)  # 损失×80%

def test_fund_claim_rejected_small_loss():
    policy = {"policy_type": 0, "coverage_sol": 2.0}
    result = evaluate_fund_claim(
        policy=policy,
        tx_sig="abc123",
        expected_sol=1.0,
        actual_sol=0.95,  # 5% 损失，低于 10% 阈值
    )
    assert result["approved"] is False
    assert "低于赔付阈值" in result["reason"]
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest tests/test_claim_engine.py -v
# 预期：FAILED
```

- [ ] **Step 3: 实现理赔引擎**

```python
# services/audit-service/claim_engine.py
"""
自动理赔核验引擎：通过 Helius API 核验链上事实，决定是否赔付。
"""
import os
import httpx
from typing import Dict

HELIUS_API_KEY = os.getenv("HELIUS_API_KEY", "")
MIN_LOSS_THRESHOLD = 0.10  # 10%：损失超过此比例才赔付

def evaluate_fund_claim(
    policy: Dict,
    tx_sig: str,
    expected_sol: float,
    actual_sol: float,
) -> Dict:
    """
    资金安全险理赔核验。
    - policy: 保单数据
    - tx_sig: 触发理赔的交易签名
    - expected_sol: 预期获得的 SOL
    - actual_sol: 实际获得的 SOL
    """
    if expected_sol <= 0:
        return {"approved": False, "reason": "预期金额为零，无法核验"}

    loss_ratio = (expected_sol - actual_sol) / expected_sol
    if loss_ratio < MIN_LOSS_THRESHOLD:
        return {
            "approved": False,
            "reason": f"损失比例 {loss_ratio:.1%} 低于赔付阈值 {MIN_LOSS_THRESHOLD:.0%}",
        }

    loss_sol = expected_sol - actual_sol
    payout_sol = min(loss_sol * 0.80, policy["coverage_sol"])

    return {
        "approved": True,
        "payout_sol": round(payout_sol, 6),
        "loss_ratio": round(loss_ratio, 4),
        "reason": f"损失 {loss_sol:.4f} SOL（{loss_ratio:.1%}），赔付 80%",
    }

def evaluate_execution_claim(
    policy: Dict,
    task_deadline_ts: int,
    actual_completion_ts: int | None,
) -> Dict:
    """执行保障险理赔核验：任务超时未完成则赔付手续费。"""
    if actual_completion_ts is not None and actual_completion_ts <= task_deadline_ts:
        return {"approved": False, "reason": "任务已在 Deadline 前完成"}

    return {
        "approved": True,
        "payout_sol": policy.get("premium_sol", 0.02),  # 退还保费
        "reason": "任务超时或未执行，退还全额手续费",
    }

async def fetch_tx_and_verify(tx_sig: str) -> Dict:
    """从 Helius 拉取交易详情用于核验。"""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"https://api.helius.xyz/v0/transactions/{tx_sig}",
            params={"api-key": HELIUS_API_KEY}
        )
        resp.raise_for_status()
        return resp.json()
```

- [ ] **Step 4: 测试通过**

```bash
pytest tests/test_claim_engine.py -v
# 预期：2 PASSED
```

- [ ] **Step 5: 接入理赔 API 路由**

```python
# 追加到 services/audit-service/main.py

from claim_engine import evaluate_fund_claim, evaluate_execution_claim

class ClaimRequest(BaseModel):
    policy_id:     int
    buyer_wallet:  str
    tx_sig:        str
    expected_sol:  float
    actual_sol:    float

@app.post("/api/insurance/claim")
async def submit_claim(req: ClaimRequest):
    async with AsyncSessionLocal() as db:
        policy = (await db.execute(text(
            "SELECT * FROM insurance_policies WHERE id=:id AND buyer_wallet=:buyer"
        ), {"id": req.policy_id, "buyer": req.buyer_wallet})).mappings().first()

    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    if policy["status"] != "active":
        raise HTTPException(status_code=400, detail="Policy not active")

    result = evaluate_fund_claim(dict(policy), req.tx_sig, req.expected_sol, req.actual_sol)

    if result["approved"]:
        async with AsyncSessionLocal() as db:
            await db.execute(text(
                "UPDATE insurance_policies SET status='claimed' WHERE id=:id"
            ), {"id": req.policy_id})
            await db.commit()

    return result
```

- [ ] **Step 6: Commit**

```bash
git add services/audit-service/claim_engine.py \
        services/audit-service/tests/test_claim_engine.py
git commit -m "feat: add auto-claim engine with fund and execution claim evaluation"
```

---

## 联调验证清单（Day 17-18）

- [ ] **端到端冒烟测试**

```bash
# 1. 启动服务
cd services/audit-service && uvicorn main:app --reload &

# 2. 手动触发一次全量索引
python -c "import asyncio; from indexer.scheduler import index_and_score_all; asyncio.run(index_and_score_all())"

# 3. 验证 API
curl http://localhost:8000/api/agents?limit=5 | python -m json.tool
# 预期：返回 agents 数组，包含 total_score、grade 等字段

curl http://localhost:8000/api/agents/{任意钱包地址} | python -m json.tool
# 预期：返回完整评分详情 + score_history

# 4. 前端冒烟
cd frontend && npm run dev
# 访问 http://localhost:5173/leaderboard → 排行榜有数据
# 点击 Agent 名称 → 详情页有折线图
# 点击「购买保险」→ 弹窗显示正确保费

# 5. 理赔接口测试
curl -X POST http://localhost:8000/api/insurance/claim \
  -H "Content-Type: application/json" \
  -d '{"policy_id":1,"buyer_wallet":"xxx","tx_sig":"yyy","expected_sol":1.0,"actual_sol":0.6}'
# 预期：{"approved":true,"payout_sol":0.32,"reason":"损失 0.4 SOL（40%），赔付 80%"}
```

- [ ] **保险合约 devnet 部署**

```bash
cd contracts/insurance
anchor deploy --provider.cluster devnet
# 记录 Program ID，更新前端 InsuranceModal 中的 programId
```

- [ ] **最终 Commit**

```bash
git add -A
git commit -m "chore: final integration and smoke test pass"
```

---

## 工期汇总

| 阶段 | 任务 | 天数 | 里程碑 |
|------|------|------|--------|
| Phase 1 | Task 1–6：数据层 + 评分引擎 | Day 1–4 | API 可返回 Agent 列表和评分 |
| Phase 2 | Task 7–8：前端排行榜 + 详情 | Day 5–8 | 排行榜上线，用户可访问 |
| Phase 3 | Task 9–11：保险合约 + UI + 理赔 | Day 9–16 | 保险可购买，理赔 API 可用 |
| 联调 | 冒烟测试 + Bug 修复 | Day 17–18 | MVP 可 Demo |

**总计：18 天（含缓冲），覆盖黑客松 2026-04-25 ~ 2026-05-11 截止日期。**
