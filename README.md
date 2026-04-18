# AgentProof — 开发文档索引

> Solana 上第一个可信 AI Agent 行为验证协议
> Colosseum Frontier 2026 参赛项目

## 文档结构

| 文件 | 内容 | 优先级 |
|------|------|--------|
| `01-project-overview.md` | 项目定位、问题、方案概述 | 必读 |
| `02-architecture.md` | 系统架构、技术栈、模块设计 | 必读 |
| `03-onchain-program.md` | Solana Anchor 程序完整实现 | 核心 |
| `04-witness-node.md` | 见证节点服务（Node.js）实现 | 核心 |
| `05-ai-risk-monitor.md` | AI 风控服务（Python/FastAPI）实现 | 核心 |
| `06-frontend.md` | Next.js 前端实现 | 核心 |
| `07-sdk.md` | Consumer SDK 实现 | 扩展 |
| `08-deployment.md` | 部署、环境配置、测试流程 | 必读 |
| `09-demo-scripts.md` | 3 个 Demo 场景完整脚本 | 参赛用 |

## 快速开始（LLM 执行顺序）

```
1. 读 01 → 理解项目全貌
2. 读 02 → 确认架构设计
3. 执行 03 → 先建链上程序（Anchor）
4. 执行 04 → 建见证节点服务
5. 执行 05 → 建 AI 风控服务
6. 执行 06 → 建前端
7. 读 08 → 部署和测试
8. 读 09 → 准备 Demo
```

## 关键约束

- **开发周期**：3.5 周（2026-04-17 至 2026-05-11）
- **团队规模**：1-2 人
- **目标网络**：Solana Devnet（MVP），Mainnet 后续
- **MVP 范围**：链上程序 + 见证节点 + AI 风控 + 前端 Demo
- **评委重点**：可演示 > 功能完整，Solana 深度集成 > 架构复杂度
