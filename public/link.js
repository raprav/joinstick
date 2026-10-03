// Shared WebSocket plumbing for host.js and client.js:
// JSON messages, ping/pong, a silence watchdog and reconnect backoff.

const SILENCE = 5000;

export function link(url, { open, message, down }) {
  let ws = null;
  let lastMsg = 0;
  let attempts = 0;
  let retryTimer;
  let stopped = false;

  function connect() {
    clearTimeout(retryTimer);
    lastMsg = Date.now();
    ws = new WebSocket(url);
    ws.onopen = open;
    ws.onmessage = (e) => {
      lastMsg = Date.now();
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'ping') send({ t: 'pong' });
      else message(m);
    };
    // Some runtimes (Node 22) fire 'error' without 'close' on a refused connection.
    ws.onclose = ws.onerror = () => drop();
  }

  // Close the socket right away (a dead connection can take long to report
  // 'close') and tell the owner it is down.
  function drop(code) {
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close(code);
    } catch {}
    ws = null;
    if (!stopped) down();
  }

  function send(m) {
    if (ws?.readyState === 1) ws.send(JSON.stringify(m));
  }

  const watchdog = setInterval(() => {
    if (ws && Date.now() - lastMsg > SILENCE) drop();
  }, 1000);
  watchdog.unref?.();

  return {
    send,
    connect,
    drop,
    up: () => (attempts = 0),
    retry: () => (retryTimer = setTimeout(connect, Math.min(5000, 250 * 2 ** attempts++))),
    stop(code) {
      stopped = true;
      clearInterval(watchdog);
      clearTimeout(retryTimer);
      drop(code);
    },
  };
}
