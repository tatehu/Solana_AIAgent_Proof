// agentproof/audit-engine/src/index.ts
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createRoutes } from './routes';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/', createRoutes());

const PORT = parseInt(process.env.PORT ?? '3002', 10);
app.listen(PORT, () => {
  console.log(`[audit-engine] listening on port ${PORT}`);
});
