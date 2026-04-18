# scripts/simulate_malicious_agent.py
import requests
import random
import time
import hashlib


RISK_MONITOR_URL = "http://localhost:8000"
AGENT_ID = "MaliciousAgent111111111111111111111111111"


def random_hash() -> str:
    return hashlib.sha256(str(random.random()).encode()).hexdigest()


def simulate_normal_behavior(n: int = 10):
    """模拟正常行为"""
    for i in range(n):
        requests.post(f"{RISK_MONITOR_URL}/api/v1/proof_event", json={
            "agent_id": AGENT_ID,
            "task_id": random_hash(),
            "success": True,
            "output_hash": random_hash(),
            "input_hash": random_hash(),
            "ata_created": random.randint(0, 2),
            "sol_delta": -random.uniform(0, 0.01),
            "slot": 1000 + i,
        })
        print(f"  ✓ Normal task {i+1}/{n}")
        time.sleep(0.1)


def simulate_attack_behavior():
    """模拟攻击行为：重放攻击 + 高失败率"""
    fixed_hash = random_hash()  # 重复使用同一个 output_hash

    for i in range(15):
        requests.post(f"{RISK_MONITOR_URL}/api/v1/proof_event", json={
            "agent_id": AGENT_ID,
            "task_id": random_hash(),
            "success": random.random() > 0.6,  # 40% 失败率
            "output_hash": fixed_hash,           # 重放：相同 output_hash
            "input_hash": random_hash(),
            "ata_created": random.randint(5, 10),  # ATA 疯狂创建
            "sol_delta": -random.uniform(0.1, 0.5),  # SOL 快速减少
            "slot": 2000 + i,
        })
        print(f"  ⚠️  Attack task {i+1}/15")
        time.sleep(0.1)


def check_risk():
    """查询风险评分"""
    response = requests.post(f"{RISK_MONITOR_URL}/api/v1/analyze", json={
        "agent_id": AGENT_ID
    })
    data = response.json()
    print(f"\n📊 Risk Score: {data['score']:.1f} ({data['level'].upper()})")
    if data['reasons']:
        for reason in data['reasons']:
            print(f"   ⚠️  {reason}")
    return data['score']


if __name__ == "__main__":
    print("Phase 1: Normal behavior (10 tasks)")
    simulate_normal_behavior(10)
    score = check_risk()

    print(f"\nPhase 2: Attack behavior (15 tasks)")
    simulate_attack_behavior()
    score = check_risk()

    if score > 80:
        print(f"\n🚨 FREEZE TRIGGERED! Agent should be frozen on-chain")
    else:
        print(f"\n Score: {score} - threshold 80 not reached yet")
