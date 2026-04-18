# Graph Report - .  (2026-04-18)

## Corpus Check
- Corpus is ~19,582 words - fits in a single context window. You may not need a graph.

## Summary
- 234 nodes · 295 edges · 32 communities detected
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 48 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `AgentRiskMonitor` - 15 edges
2. `AgentRiskMonitor Model` - 9 edges
3. `AgentProofClient Class (SDK)` - 9 edges
4. `ChainVerifier` - 8 edges
5. `AgentProofSDK` - 8 edges
6. `AgentProofClient` - 8 edges
7. `ProofRecord` - 8 edges
8. `RiskScore` - 8 edges
9. `AI Agent 行为风险监控主模型      风险评分组成：     - 失败率异常：最高 40 分     - 重放攻击：最高 30 分     - ATA` - 8 edges
10. `分析 Agent 风险评分          Args:             agent_id: Agent 公钥             recent_p` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Agent Registry Module` --semantically_similar_to--> `Agent Registry Program`  [INFERRED] [semantically similar]
  01-project-overview.md → 02-architecture.md
- `Proof Engine Module (3-Layer)` --semantically_similar_to--> `Proof Settlement Program`  [INFERRED] [semantically similar]
  01-project-overview.md → 02-architecture.md
- `Consumer SDK Module` --semantically_similar_to--> `AgentProofClient Class (SDK)`  [INFERRED] [semantically similar]
  01-project-overview.md → 07-sdk.md
- `AgentRecord PDA` --semantically_similar_to--> `AgentRecord State Account`  [INFERRED] [semantically similar]
  02-architecture.md → 03-onchain-program.md
- `TaskProof PDA` --semantically_similar_to--> `TaskProof State Account`  [INFERRED] [semantically similar]
  02-architecture.md → 03-onchain-program.md

## Hyperedges (group relationships)
- **Task Proof Verification Pipeline** — onchain_submit_proof_ix, witness_chain_verifier, onchain_witness_sign_ix, risk_agent_risk_monitor [EXTRACTED 0.95]
- **Risk Detection Detector Ensemble** — risk_failure_rate_detector, risk_replay_attack_detector, risk_ata_creation_detector, risk_sol_drain_detector, risk_output_drift_detector [EXTRACTED 1.00]
- **On-chain PDA Account Model** — arch_pda_agent_record, arch_pda_task_proof, arch_pda_witness_pool, arch_pda_reputation_sbt [EXTRACTED 1.00]

## Communities

### Community 0 - "AI Risk Detection Engine"
Cohesion: 0.13
Nodes (20): BaseModel, ATACreationDetector, FailureRateDetector, OutputDriftDetector, ProofRecord, 重放攻击检测（相同 output_hash 重复提交）, ATA 账户爆炸检测（Solana 特有风险）, ReplayAttackDetector (+12 more)

### Community 1 - "Frontend SDK Layer"
Cohesion: 0.09
Nodes (1): AgentProofSDK

### Community 2 - "Solana On-Chain Programs"
Cohesion: 0.13
Nodes (20): Agent Registry Program, AgentRecord PDA, ReputationSBT Token-2022, TaskProof PDA, Proof Settlement Program, Rationale: Anchor Framework Choice, Reputation SBT Minter Program, Risk Monitor REST API (+12 more)

### Community 3 - "System Architecture Overview"
Cohesion: 0.12
Nodes (19): Task Submission and Verification Data Flow, Helius RPC / WebSocket, Proof Engine (Node.js Service), Rationale: Helius WebSocket for Real-time, Rationale: Python for AI Risk Monitor, Risk Monitor (Python/FastAPI Service), System Architecture Overview, Demo Scenario 1: Agent Hiring Agent (+11 more)

### Community 4 - "Proof Engine Service"
Cohesion: 0.21
Nodes (1): WitnessSigner

### Community 5 - "Submit Proof Instruction"
Cohesion: 0.14
Nodes (6): ProofSubmitted, SubmitProof, SubmitProofParams, TaskProof, WitnessPool, WitnessRecord

### Community 6 - "Demo Scenarios & Testing"
Cohesion: 0.22
Nodes (14): WitnessPool PDA, Demo Scenario 3: Consumer SDK Reputation Query, Demo Seed Script (seed-demo.ts), AgentRecord State Account, Anchor Integration Tests, AgentProofError Codes, Anchor Program Entry (lib.rs), register_agent Instruction (+6 more)

### Community 7 - "Freeze Agent & Risk Monitoring"
Cohesion: 0.18
Nodes (14): Demo Scenario 2: AI Risk Intercepts Malicious Agent, freeze_agent Instruction, RISK_MONITOR_AUTHORITY Constant, AgentRiskMonitor Model, ATACreationDetector, FailureRateDetector, Freeze Threshold (Score > 80), OutputDriftDetector (+6 more)

### Community 8 - "Deployment & Startup Flow"
Cohesion: 0.18
Nodes (12): Anchor Build and Deploy Steps, Complete Startup Flow, Risk Monitor FastAPI App (main.py), Risk Monitor Requirements (requirements.txt), TaskType Enum (SOLANA_SWAP, DATA_ANALYSIS, etc.), Witness Node REST API (api.ts), ChainVerifier Class, Witness Node Cluster (Docker Compose 3-node) (+4 more)

### Community 9 - "ChainVerifier Logic"
Cohesion: 0.39
Nodes (1): ChainVerifier

### Community 10 - "AgentProofClient Core"
Cohesion: 0.36
Nodes (1): AgentProofClient

### Community 11 - "Anchor Program Entry (lib.rs)"
Cohesion: 0.29
Nodes (0): 

### Community 12 - "Witness Sign Instruction"
Cohesion: 0.4
Nodes (3): ProofRejected, ProofVerified, WitnessSign

### Community 13 - "Malicious Agent Simulation"
Cohesion: 0.6
Nodes (3): random_hash(), simulate_attack_behavior(), simulate_normal_behavior()

### Community 14 - "Freeze Agent Instruction"
Cohesion: 0.5
Nodes (2): AgentFrozen, FreezeAgent

### Community 15 - "Register Agent Instruction"
Cohesion: 0.5
Nodes (2): AgentRegistered, RegisterAgent

### Community 16 - "Register Witness Instruction"
Cohesion: 0.67
Nodes (1): RegisterWitness

### Community 17 - "Initialize Witness Pool"
Cohesion: 0.67
Nodes (1): InitializeWitnessPool

### Community 18 - "AgentRecord State"
Cohesion: 0.67
Nodes (1): AgentRecord

### Community 19 - "Competitor Analysis"
Cohesion: 0.67
Nodes (3): Judge Q&A Reference, Pyth Network (Competitor), Switchboard (Competitor)

### Community 20 - "Error Codes"
Cohesion: 1.0
Nodes (1): AgentProofError

### Community 21 - "Demo Seed Script"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "FastAPI Health Endpoint"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Project Overview"
Cohesion: 1.0
Nodes (2): AgentProof Project, Colosseum Frontier 2026

### Community 24 - "Anchor IDL Types"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Next.js Config"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Python Package Init"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "MVP Scope"
Cohesion: 1.0
Nodes (1): MVP Scope (3.5 weeks)

### Community 28 - "Technology Stack"
Cohesion: 1.0
Nodes (1): Technology Stack

### Community 29 - "WitnessRecord State"
Cohesion: 1.0
Nodes (1): WitnessRecord State Account

### Community 30 - "Pre-submission Checklist"
Cohesion: 1.0
Nodes (1): Pre-submission Verification Checklist

### Community 31 - "Pitch Video Script"
Cohesion: 1.0
Nodes (1): Pitch Video Script (3 minutes)

## Knowledge Gaps
- **53 isolated node(s):** `AgentProofError`, `SubmitProofParams`, `SubmitProof`, `ProofSubmitted`, `FreezeAgent` (+48 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Error Codes`** (2 nodes): `errors.rs`, `AgentProofError`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Demo Seed Script`** (2 nodes): `seed-demo.ts`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `FastAPI Health Endpoint`** (2 nodes): `main.py`, `health()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Project Overview`** (2 nodes): `AgentProof Project`, `Colosseum Frontier 2026`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Anchor IDL Types`** (1 nodes): `agentproof.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Next.js Config`** (1 nodes): `next.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Python Package Init`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `MVP Scope`** (1 nodes): `MVP Scope (3.5 weeks)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Technology Stack`** (1 nodes): `Technology Stack`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `WitnessRecord State`** (1 nodes): `WitnessRecord State Account`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Pre-submission Checklist`** (1 nodes): `Pre-submission Verification Checklist`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Pitch Video Script`** (1 nodes): `Pitch Video Script (3 minutes)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AgentProofClient Class (SDK)` connect `Solana On-Chain Programs` to `Demo Scenarios & Testing`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `AgentRecord State Account` connect `Demo Scenarios & Testing` to `Solana On-Chain Programs`, `Freeze Agent & Risk Monitoring`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `AgentRecord PDA` connect `Solana On-Chain Programs` to `Demo Scenarios & Testing`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `AgentRiskMonitor` (e.g. with `ProofRecord` and `RiskScore`) actually correct?**
  _`AgentRiskMonitor` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `AgentProofClient Class (SDK)` (e.g. with `Consumer SDK Module` and `Frontend AgentProof SDK (agentproof-sdk.ts)`) actually correct?**
  _`AgentProofClient Class (SDK)` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AgentProofError`, `SubmitProofParams`, `SubmitProof` to the rest of the system?**
  _53 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `AI Risk Detection Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._