import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { createHash } from "crypto";

const PROGRAM_ID_STR = process.env.AGENTPROOF_PROGRAM_ID ?? "";

// Anchor discriminator = sha256("global:{name}")[0..8]
function discriminator(name: string): Buffer {
  return Buffer.from(
    createHash("sha256").update(`global:${name}`).digest()
  ).slice(0, 8);
}

const WITNESS_SIGN_DISC = discriminator("witness_sign");
const INIT_WITNESS_POOL_DISC = discriminator("initialize_witness_pool");

// Derive a deterministic child keypair from a primary secret key
function deriveChildKeypair(primarySecret: Uint8Array, index: number): Keypair {
  const seed = createHash("sha256")
    .update(Buffer.from(primarySecret))
    .update(Buffer.from(`witness-${index}`))
    .digest();
  return Keypair.fromSeed(seed);
}

// Encode a borsh Option<String>: 0x00 = None, 0x01 + u32LE len + utf8 bytes
function encodeOptionString(value: string | undefined): Buffer {
  if (value === undefined || value === null) {
    return Buffer.from([0]);
  }
  const strBytes = Buffer.from(value, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(strBytes.length, 0);
  return Buffer.concat([Buffer.from([1]), lenBuf, strBytes]);
}

// Encode witness_sign instruction data:
// discriminator(8) + task_id([u8;32]) + approved(bool u8) + rejection_reason(Option<String>)
function encodeWitnessSignArgs(
  taskId: Uint8Array,
  approved: boolean,
  rejectionReason?: string
): Buffer {
  return Buffer.concat([
    WITNESS_SIGN_DISC,
    Buffer.from(taskId),
    Buffer.from([approved ? 1 : 0]),
    encodeOptionString(rejectionReason),
  ]);
}

export interface WitnessPublicKeys {
  primary: string;
  secondary1: string;
  secondary2: string;
}

export class ChainClient {
  private connection: Connection;
  private programId: PublicKey;
  private primaryKeypair: Keypair;
  private witness1: Keypair;
  private witness2: Keypair;

  constructor(rpcUrl: string, primaryKeyBase58: string, programId: string) {
    this.connection = new Connection(rpcUrl, { commitment: "confirmed" });
    this.programId = new PublicKey(programId);

    const primarySecret = bs58.decode(primaryKeyBase58);
    this.primaryKeypair = Keypair.fromSecretKey(primarySecret);
    this.witness1 = deriveChildKeypair(primarySecret, 1);
    this.witness2 = deriveChildKeypair(primarySecret, 2);
  }

  getWitnessPublicKeys(): WitnessPublicKeys {
    return {
      primary: this.primaryKeypair.publicKey.toBase58(),
      secondary1: this.witness1.publicKey.toBase58(),
      secondary2: this.witness2.publicKey.toBase58(),
    };
  }

  getWitnessKeypairs(): Keypair[] {
    return [this.primaryKeypair, this.witness1, this.witness2];
  }

  // Ensure WitnessPool PDA exists; initialize it if not
  async ensureWitnessPool(): Promise<void> {
    const [witnessPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("witness_pool")],
      this.programId
    );

    const accountInfo = await this.connection.getAccountInfo(witnessPoolPda);
    if (accountInfo && accountInfo.data.length > 0) {
      console.log(`[ChainClient] WitnessPool already initialized at ${witnessPoolPda.toBase58()}`);
      return;
    }

    const balance = await this.connection.getBalance(this.primaryKeypair.publicKey);
    if (balance < 10_000_000) {
      console.warn(
        `[ChainClient] Primary keypair has insufficient SOL (${(balance / 1e9).toFixed(4)}) to init WitnessPool. ` +
        `Fund it: solana airdrop 1 ${this.primaryKeypair.publicKey.toBase58()} --url devnet`
      );
      return;
    }

    console.log("[ChainClient] Initializing WitnessPool...");
    const data = INIT_WITNESS_POOL_DISC;

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: witnessPoolPda, isSigner: false, isWritable: true },
        { pubkey: this.primaryKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(this.connection, tx, [this.primaryKeypair]);
    console.log(`[ChainClient] WitnessPool initialized: ${sig}`);
  }

  // Submit witness_sign on-chain for all 3 keypairs
  // Returns array of { keypairIndex, signature, error }
  async submitWitnessSign(
    taskIdHex: string,
    agentPubkeyBase58: string,
    approved: boolean,
    rejectionReason?: string
  ): Promise<Array<{ keypairIndex: number; signature?: string; error?: string }>> {
    const taskIdBytes = this.hexToTaskId(taskIdHex);
    const [taskProofPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proof"), taskIdBytes],
      this.programId
    );
    const agentPubkey = new PublicKey(agentPubkeyBase58);
    const [agentRecordPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agentPubkey.toBuffer()],
      this.programId
    );

    const data = encodeWitnessSignArgs(taskIdBytes, approved, rejectionReason);
    const results: Array<{ keypairIndex: number; signature?: string; error?: string }> = [];

    for (let i = 0; i < 3; i++) {
      const keypair = [this.primaryKeypair, this.witness1, this.witness2][i];
      try {
        const ix = new TransactionInstruction({
          programId: this.programId,
          keys: [
            { pubkey: taskProofPda, isSigner: false, isWritable: true },
            { pubkey: agentRecordPda, isSigner: false, isWritable: true },
            { pubkey: keypair.publicKey, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        });

        const tx = new Transaction().add(ix);
        const sig = await sendAndConfirmTransaction(this.connection, tx, [keypair]);
        console.log(`[ChainClient] witness_sign[${i}] confirmed: ${sig}`);
        results.push({ keypairIndex: i, signature: sig });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // AlreadySigned or ProofAlreadySettled are expected — break early
        if (msg.includes("AlreadySigned") || msg.includes("ProofAlreadySettled")) {
          console.log(`[ChainClient] witness_sign[${i}] already settled, stopping`);
          results.push({ keypairIndex: i, error: msg });
          break;
        }
        console.error(`[ChainClient] witness_sign[${i}] failed: ${msg}`);
        results.push({ keypairIndex: i, error: msg });
      }
    }

    return results;
  }

  // Convert task_id string to 32-byte Uint8Array
  // If it's a 64-char hex string, decode it; otherwise SHA256 it
  private hexToTaskId(taskId: string): Uint8Array {
    if (/^[0-9a-fA-F]{64}$/.test(taskId)) {
      return Buffer.from(taskId, "hex");
    }
    return createHash("sha256").update(taskId).digest();
  }

  // Read agentPubkey from TaskProof PDA (offset 8 discriminator + 32 task_id)
  async readAgentPubkeyFromProof(taskIdHex: string): Promise<string | null> {
    try {
      const taskIdBytes = this.hexToTaskId(taskIdHex);
      const [taskProofPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("proof"), taskIdBytes],
        this.programId
      );
      const info = await this.connection.getAccountInfo(taskProofPda);
      if (!info || info.data.length < 8 + 32 + 32) return null;
      const agentBytes = info.data.slice(8 + 32, 8 + 32 + 32);
      return new PublicKey(agentBytes).toBase58();
    } catch {
      return null;
    }
  }

  // Airdrop SOL to all 3 witness keypairs (for devnet testing)
  async airdropWitnessKeypairs(): Promise<void> {
    const keypairs = [
      { kp: this.primaryKeypair, label: "primary" },
      { kp: this.witness1, label: "witness1" },
      { kp: this.witness2, label: "witness2" },
    ];

    for (const { kp, label } of keypairs) {
      try {
        const balance = await this.connection.getBalance(kp.publicKey);
        if (balance >= 50_000_000) {
          console.log(`[ChainClient] ${label} already has ${(balance / 1e9).toFixed(3)} SOL`);
          continue;
        }
        const sig = await this.connection.requestAirdrop(kp.publicKey, 500_000_000);
        await this.connection.confirmTransaction(sig, "confirmed");
        console.log(`[ChainClient] Airdropped 0.5 SOL to ${label}: ${kp.publicKey.toBase58()}`);
      } catch {
        const balance = await this.connection.getBalance(kp.publicKey).catch(() => 0);
        if (balance < 10_000_000) {
          console.warn(`[ChainClient] ${label} has ${(balance / 1e9).toFixed(4)} SOL — airdrop failed (rate limited). Fund it manually: ${kp.publicKey.toBase58()}`);
        } else {
          console.log(`[ChainClient] ${label} has ${(balance / 1e9).toFixed(3)} SOL (airdrop skipped)`);
        }
      }
    }
  }
}
