/** Notificações do fluxo (decupagem pronta para revisão, edição pronta…), persistidas em data/notifications.json. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { uid, type AppNotification, type Project } from '@neweditor/core';
import { DATA_ROOT } from './config.ts';
import { store } from './store.ts';

const FILE = path.join(DATA_ROOT, 'notifications.json');
let list: AppNotification[] | null = null;

async function load(): Promise<AppNotification[]> {
  if (!list) list = JSON.parse(await fs.readFile(FILE, 'utf8').catch(() => '[]')) as AppNotification[];
  return list;
}
async function save(): Promise<void> {
  await fs.writeFile(FILE + '.tmp', JSON.stringify(list ?? [], null, 1));
  await fs.rename(FILE + '.tmp', FILE);
}

export async function notify(p: Project, kind: AppNotification['kind'], text: string): Promise<AppNotification> {
  const l = await load();
  const n: AppNotification = { id: uid('ntf'), at: new Date().toISOString(), projectId: p.id, projectName: p.name, kind, text };
  l.unshift(n);
  if (l.length > 200) l.length = 200;
  await save();
  store.log(p.id, 'system', `🔔 ${text}`);
  return n;
}

export async function listNotifications(): Promise<AppNotification[]> {
  return (await load()).slice(0, 60);
}

export async function markRead(ids?: string[]): Promise<void> {
  for (const n of await load()) if (!ids || ids.includes(n.id)) n.read = true;
  await save();
}
