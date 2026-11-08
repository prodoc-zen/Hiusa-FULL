// Refuses to let a write-heavy smoke run point at anything but this machine.
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function assertLocalOnly(urls) {
  for (const [name, value] of Object.entries(urls)) {
    let hostname = '';
    try {
      hostname = new URL(value).hostname;
    } catch {
      throw new Error(`${name} is not a valid URL: ${value}`);
    }
    if (!LOCAL_HOSTS.has(hostname)) {
      throw new Error(`${name} points at ${hostname}; this smoke registers users and writes records, so it only runs against 127.0.0.1 or localhost.`);
    }
  }
}
