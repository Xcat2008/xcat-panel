import systemRoutes from './routes/system.js';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import serverRoutes from './routes/servers.js';
import filesRoutes from './routes/files.js';
import requestsRoutes from './routes/requests.js';
import activityRoutes from './routes/activity.js';
import backupsRoutes from './routes/backups.js';
import libraryRoutes from './routes/library.js';
import updatesRoutes from './routes/updates.js';
import consoleRoutes from './routes/console.js';
import monitorRoutes from './routes/monitor.js';
import pluginRoutes from './routes/plugins.js';
import cs2ConfigRoutes from './routes/cs2Config.routes.js';
import cs2AdminsRoutes from './routes/cs2-admins.js';
import cs2LiveControlRoutes from './routes/cs2-live-control.js';
import templatesRoutes from './routes/templates.js';
import serverModeRoutes from './routes/server-mode.js';
import workshopRoutes from './routes/workshop.js';
import gameModeRoutes from './routes/game-modes.js';
import gameModeMapsRoutes from './routes/game-mode-maps.js';
import gameModeMapUploadRoutes from './routes/game-mode-map-upload.js';
import teamspeakRoutes from './routes/teamspeak.js';
import storageRoutes from './routes/storage.js';


import { requireAuth } from './middleware/auth.js';
import { attachConsoleSocket } from './ws/consoleSocket.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 3101);
const CORS_ORIGIN = process.env.GAMEFORGE_CORS_ORIGIN || '*';




app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);

app.use('/api/catalog', requireAuth, catalogRoutes);
app.use('/api/servers', requireAuth, serverRoutes);
app.use('/api/files', requireAuth, filesRoutes);
app.use('/api/requests', requireAuth, requestsRoutes);
app.use('/api/activity', requireAuth, activityRoutes);
app.use('/api/backups', requireAuth, backupsRoutes);
app.use('/api/library', requireAuth, libraryRoutes);
app.use('/api/updates', requireAuth, updatesRoutes);
app.use('/api/console', requireAuth, consoleRoutes);
app.use('/api/monitor', requireAuth, monitorRoutes);
app.use('/api/cs2/admins', requireAuth, cs2AdminsRoutes);

app.use('/api', requireAuth, cs2LiveControlRoutes);
app.use('/api', cs2ConfigRoutes);
app.use('/api', pluginRoutes);
app.use('/api', requireAuth, templatesRoutes);
app.use('/api', requireAuth, serverModeRoutes);
app.use('/api', requireAuth, workshopRoutes);
app.use('/api', requireAuth, gameModeRoutes);
app.use('/api', requireAuth, gameModeMapsRoutes);
app.use('/api', requireAuth, gameModeMapUploadRoutes);
app.use('/api/teamspeak', requireAuth, teamspeakRoutes);
app.use('/api/storage', requireAuth, storageRoutes);
app.use('/api', requireAuth, systemRoutes);

attachConsoleSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`GameForge API online on port ${PORT}`);
});
