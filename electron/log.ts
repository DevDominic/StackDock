import fs from 'fs/promises';
import path from 'path';
import { getLogsDir, ensureDataDirs } from './storage';

export async function logError(message: string, error?: unknown) {
  await ensureDataDirs();
  const file = path.join(getLogsDir(), 'app.log');
  const payload = [`[${new Date().toISOString()}] ${message}`];
  if (error) payload.push(error instanceof Error ? error.stack ?? error.message : String(error));
  payload.push('');
  await fs.appendFile(file, payload.join('\n') + '\n');
}
