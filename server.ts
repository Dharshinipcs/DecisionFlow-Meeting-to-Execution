import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { getDb } from './server/db/schema.ts';
import { seedDemoWorkspace } from './server/db/seed.ts';
import { evaluateReminders } from './server/agents/followup-agent.ts';
import { ACME_TEAM_ID } from './server/db/seed.ts';
import { createApiRouter } from './server/routes/api.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));

  // Initialize database & seed Acme Product Team demo state
  const db = getDb();
  seedDemoWorkspace(db);
  evaluateReminders(db, ACME_TEAM_ID);

  // API Routes
  app.use('/api', createApiRouter(db));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DecisionFlow server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start DecisionFlow server:', err);
  process.exit(1);
});
