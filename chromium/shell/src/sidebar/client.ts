// For the sidebar page: runs a command in the service worker (service.ts),
// the sidebar state's only writer.
import type { SidebarCommand } from './service.ts';

export async function send(command: SidebarCommand) {
  const result = await chrome.runtime.sendMessage({ sidebar: command });
  if (!result?.ok) throw new Error(result?.error ?? 'sidebar command failed');
}
