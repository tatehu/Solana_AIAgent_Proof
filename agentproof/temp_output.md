
5️⃣  Deploying to Devnet...
Deploying cluster: https://api.devnet.solana.com
Upgrade authority: /Users/tate/.config/solana/id.json
Deploying program "agentproof"...
Program path: /Users/tate/program/rust/agentproof-dev/agentproof/target/deploy/agentproof.so...
Program Id: GdJFUktyh4SFxDfqeFE33KvXf5u6TMrDzmMs5Je2NKjG

Signature: 29CcDuPa3Mz5v5eRADeQYjfmRxnF3LBDGKpXNmo2iKoUyr7tZLULeiPVQnDr4e9zuEzM9mvaLCMAyrdL2eEeQcKz

Deploy success

✅ Program deployed: GdJFUktyh4SFxDfqeFE33KvXf5u6TMrDzmMs5Je2NKjG

6️⃣  Generating witness node keypairs...
Wrote new keypair to keys/witness-1.json
   Witness 1: GixFGAMfLnWf1puDd8TSA7fgTLtME9aYsAokWGCtR9B
Wrote new keypair to keys/witness-2.json
   Witness 2: 92Lz3v5Lock18rzo93w4JKxN77FC58TPAWggzAdF88bp
Wrote new keypair to keys/witness-3.json
   Witness 3: EQwmJuWYw6o9NHawoN23cahxJd8AG33h5oP3pSZtfuB
Wrote new keypair to keys/risk-monitor.json
   Risk Monitor: H75Hwk3QuqryDaeo4KBPkd3o5Dg99WPBX3nnFs7JgbpV

7️⃣  Writing keys to .env files...
Error processing line 1 of /Users/tate/miniconda3/envs/myenv/lib/python3.11/site-packages/distutils-precedence.pth:

  Traceback (most recent call last):
    File "<frozen site>", line 195, in addpackage
    File "<string>", line 1, in <module>
  ModuleNotFoundError: No module named '_distutils_hack'

Remainder of file ignored
Error processing line 1 of /Users/tate/miniconda3/envs/myenv/lib/python3.11/site-packages/distutils-precedence.pth:

  Traceback (most recent call last):
    File "<frozen site>", line 195, in addpackage
    File "<string>", line 1, in <module>
  ModuleNotFoundError: No module named '_distutils_hack'

Remainder of file ignored
Error processing line 1 of /Users/tate/miniconda3/envs/myenv/lib/python3.11/site-packages/distutils-precedence.pth:

  Traceback (most recent call last):
    File "<frozen site>", line 195, in addpackage
    File "<string>", line 1, in <module>
  ModuleNotFoundError: No module named '_distutils_hack'

Remainder of file ignored
Error processing line 1 of /Users/tate/miniconda3/envs/myenv/lib/python3.11/site-packages/distutils-precedence.pth:

  Traceback (most recent call last):
    File "<frozen site>", line 195, in addpackage
    File "<string>", line 1, in <module>
  ModuleNotFoundError: No module named '_distutils_hack'

Remainder of file ignored
   ✅ .env
   ✅ witness-node/.env
   ✅ risk-monitor/.env

8️⃣  Deployment summary:
   Program ID:     GdJFUktyh4SFxDfqeFE33KvXf5u6TMrDzmMs5Je2NKjG
   Network:        Devnet
   Witness 1:      GixFGAMfLnWf1puDd8TSA7fgTLtME9aYsAokWGCtR9B
   Witness 2:      92Lz3v5Lock18rzo93w4JKxN77FC58TPAWggzAdF88bp
   Witness 3:      EQwmJuWYw6o9NHawoN23cahxJd8AG33h5oP3pSZtfuB
   Risk Monitor:   H75Hwk3QuqryDaeo4KBPkd3o5Dg99WPBX3nnFs7JgbpV

📋 Next steps:
   1. Ensure HELIUS_API_KEY is set in your shell
   2. cd witness-node && npm run dev
   3. cd risk-monitor && python main.py
   4. cd app && npm run dev

🌐 Explorer: https://explorer.solana.com/address/GdJFUktyh4SFxDfqeFE33KvXf5u6TMrDzmMs5Je2NKjG?cluster=devnet
(myenv) tate@MacBook-Pro agentproof % 