import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Agentproof } from "../target/types/agentproof";
import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as crypto from "crypto";

describe("agentproof", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Agentproof as Program<Agentproof>;

  const agent = Keypair.generate();
  const witness1 = Keypair.generate();
  const witness2 = Keypair.generate();
  const witness3 = Keypair.generate();

  const taskId = crypto.randomBytes(32);
  const capabilityHash = crypto.randomBytes(32);

  before(async () => {
    // 给测试账户充值
    for (const kp of [agent, witness1, witness2, witness3]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }
  });

  it("initializes witness pool", async () => {
    const [witnessPool] = PublicKey.findProgramAddressSync(
      [Buffer.from("witness_pool")],
      program.programId
    );

    try {
      await program.methods
        .initializeWitnessPool()
        .accounts({
          witnessPool,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      console.log("✓ WitnessPool initialized");
    } catch (e: unknown) {
      // 已初始化则跳过
      if (e instanceof Error && e.message.includes("already in use")) {
        console.log("✓ WitnessPool already exists");
      } else {
        throw e;
      }
    }
  });

  it("registers an agent", async () => {
    const [agentRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agent.publicKey.toBuffer()],
      program.programId
    );
    const [stakeVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_vault"), agent.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerAgent(
        Array.from(capabilityHash),
        new anchor.BN(0.1 * LAMPORTS_PER_SOL)
      )
      .accounts({
        agentRecord,
        agent: agent.publicKey,
        stakeVault,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([agent])
      .rpc();

    const record = await program.account.agentRecord.fetch(agentRecord);
    expect(record.agentPubkey.toString()).to.equal(agent.publicKey.toString());
    expect(record.reputationScore.toNumber()).to.equal(100);
    expect(record.isFrozen).to.equal(false);
    console.log("✓ Agent registered with reputation:", record.reputationScore.toNumber());
  });

  it("submits a task proof", async () => {
    const [agentRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agent.publicKey.toBuffer()],
      program.programId
    );
    const [taskProof] = PublicKey.findProgramAddressSync(
      [Buffer.from("proof"), taskId],
      program.programId
    );
    const [witnessPool] = PublicKey.findProgramAddressSync(
      [Buffer.from("witness_pool")],
      program.programId
    );

    const params = {
      taskId: Array.from(taskId),
      instructionHash: Array.from(crypto.randomBytes(32)),
      inputHash: Array.from(crypto.randomBytes(32)),
      outputHash: Array.from(crypto.randomBytes(32)),
      txSignature: Array.from(crypto.randomBytes(64)),
      slot: new anchor.BN(1000),
      taskType: 1, // SOLANA_SWAP
      witnesses: [witness1.publicKey, witness2.publicKey, witness3.publicKey],
    };

    await program.methods
      .submitProof(params)
      .accounts({
        taskProof,
        agentRecord,
        witnessPool,
        agent: agent.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([agent])
      .rpc();

    const proof = await program.account.taskProof.fetch(taskProof);
    expect(proof.status).to.equal(0); // pending
    console.log("✓ Proof submitted, status: pending");
  });

  it("witnesses sign and proof reaches 2-of-3 threshold", async () => {
    const [taskProof] = PublicKey.findProgramAddressSync(
      [Buffer.from("proof"), taskId],
      program.programId
    );
    const [agentRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agent.publicKey.toBuffer()],
      program.programId
    );

    // witness1 签名（approve）
    await program.methods
      .witnessSign(Array.from(taskId), true, null)
      .accounts({ taskProof, agentRecord, witness: witness1.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([witness1])
      .rpc();

    let proof = await program.account.taskProof.fetch(taskProof);
    expect(proof.signatureCount).to.equal(1);
    expect(proof.status).to.equal(0); // still pending

    // witness2 签名 → 达到 2-of-3 阈值 → 自动结算
    await program.methods
      .witnessSign(Array.from(taskId), true, null)
      .accounts({ taskProof, agentRecord, witness: witness2.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([witness2])
      .rpc();

    proof = await program.account.taskProof.fetch(taskProof);
    expect(proof.status).to.equal(1); // verified
    expect(proof.signatureCount).to.equal(2);

    const record = await program.account.agentRecord.fetch(agentRecord);
    expect(record.tasksCompleted.toNumber()).to.equal(1);
    expect(record.reputationScore.toNumber()).to.equal(101); // 100 + 1
    console.log("✓ Proof verified! Agent reputation:", record.reputationScore.toNumber());
  });
});
