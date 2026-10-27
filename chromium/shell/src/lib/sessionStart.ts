// The work a browser start needs (rules in step with the settings, sidebars
// in the open windows) can't hang on runtime.onStartup: Unveil's browser
// loads the shell once its extensions are ready (patch 0016), after that event
// has gone out. So the service worker's first run in a session does it. The
// flag is in chrome.storage.session, which a browser restart and an install or
// update of the shell clear, and a service worker restart keeps.

const STARTED_KEY = 'sessionStarted';

/** True the first time it's called in a browser session. */
export async function firstRunThisSession(): Promise<boolean> {
  const { [STARTED_KEY]: started } = await chrome.storage.session.get(STARTED_KEY);
  if (started) return false;
  await chrome.storage.session.set({ [STARTED_KEY]: true });
  return true;
}
