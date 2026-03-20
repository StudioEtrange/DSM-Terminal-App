const mount = document.getElementById("terminalMount");
const statusNode = document.getElementById("status");
const topbarNode = document.getElementById("topbar");

let sessionId = "";
let cursor = 0;
let pollTimer = null;
let terminal = null;
let pendingWrites = [];
let processingWriteQueue = false;
let pollInFlight = false;
let pollRequestedWhileBusy = false;
let lastQueuedInput = "";
let lastQueuedInputAt = 0;
const INIT_RETRY_DELAY_MS = 350;
const INIT_TIMEOUT_MS = 15000;
const DUPLICATE_INPUT_WINDOW_MS = 90;
const DEBUG_FRONTEND = false;

function activateParentWindow() {
  try {
    const frame = window.frameElement;
    const winId = frame && frame.getAttribute("data-window-id");
    if (!winId || !window.parent || !window.parent.Ext) {
      return;
    }

    const cmp = window.parent.Ext.getCmp(winId);
    if (!cmp) {
      return;
    }

    cmp.toFront();
    if (typeof cmp.setActive === "function") {
      cmp.setActive();
    }
  } catch (error) {
  }
}

function focusTerminal() {
  if (!terminal) {
    return;
  }

  terminal.focus();
  scrollTerminalToBottom();
}

function setStatus(message, isError = false) {
  statusNode.textContent = message || "";
  statusNode.classList.toggle("error", isError);
  if (topbarNode) {
    topbarNode.classList.toggle("hidden", !message);
  }
}

function base64Encode(value) {
  return window.btoa(unescape(encodeURIComponent(value)));
}

function base64Decode(value) {
  return decodeURIComponent(escape(window.atob(value)));
}

function terminalCols() {
  const cellWidth = terminal && terminal._core && terminal._core._renderService &&
    terminal._core._renderService.dimensions &&
    terminal._core._renderService.dimensions.css &&
    terminal._core._renderService.dimensions.css.cell &&
    terminal._core._renderService.dimensions.css.cell.width;
  return Math.max(40, Math.floor(mount.clientWidth / (cellWidth || 9)));
}

function terminalRows() {
  const cellHeight = terminal && terminal._core && terminal._core._renderService &&
    terminal._core._renderService.dimensions &&
    terminal._core._renderService.dimensions.css &&
    terminal._core._renderService.dimensions.css.cell &&
    terminal._core._renderService.dimensions.css.cell.height;
  return Math.max(10, Math.floor(mount.clientHeight / (cellHeight || 18)));
}

function scrollTerminalToBottom() {
  if (!terminal) {
    return;
  }

  window.setTimeout(() => {
    if (terminal) {
      terminal.scrollToBottom();
    }
  }, 0);
}

function syncTerminalSize() {
  if (!terminal) {
    return;
  }

  const cols = terminalCols();
  const rows = terminalRows();
  if (cols !== terminal.cols || rows !== terminal.rows) {
    terminal.resize(cols, rows);
  }
}

function debugLog(event, data) {
  if (!DEBUG_FRONTEND) {
    return;
  }

  const payload = JSON.stringify({
    event,
    data
  });

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("debug.cgi", new Blob([payload], { type: "application/json" }));
      return;
    }
  } catch (error) {
  }

  try {
    void fetch("debug.cgi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: payload
    });
  } catch (error) {
  }
}

async function callApi(payload) {
  const response = await fetch("pty.cgi", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function queueInput(data) {
  if (!data) {
    return;
  }

  const now = Date.now();
  if (data === lastQueuedInput && (now - lastQueuedInputAt) < DUPLICATE_INPUT_WINDOW_MS) {
    debugLog("queueInput:deduped", {
      data
    });
    return;
  }

  lastQueuedInput = data;
  lastQueuedInputAt = now;
  debugLog("queueInput", {
    data
  });

  pendingWrites.push(data);
  void processWriteQueue();
}

async function processWriteQueue() {
  if (!sessionId || !terminal || processingWriteQueue || pendingWrites.length === 0) {
    return;
  }

  processingWriteQueue = true;

  while (sessionId && terminal && pendingWrites.length > 0) {
    const data = pendingWrites.shift();
    debugLog("flushInput:start", {
      data
    });

    try {
      const payload = await callApi({
        action: "write",
        sid: sessionId,
        data: base64Encode(data)
      });
      if (!payload.ok) {
        throw new Error(payload.error || "Write failed");
      }
      debugLog("flushInput:ok", {
        data
      });
      schedulePoll(true);
    } catch (error) {
      debugLog("flushInput:error", {
        data,
        error: error.message
      });
      pendingWrites.unshift(data);
      terminal.write(`\r\nERROR: ${error.message}\r\n`);
      setStatus(`PTY write failed: ${error.message}`, true);
      break;
    }
  }

  processingWriteQueue = false;
}

function schedulePoll(immediate = false) {
  if (pollInFlight) {
    pollRequestedWhileBusy = true;
    return;
  }
  if (pollTimer) {
    window.clearTimeout(pollTimer);
  }
  pollTimer = window.setTimeout(pollOutput, immediate ? 0 : 50);
}

async function pollOutput() {
  if (!sessionId || !terminal || pollInFlight) {
    return;
  }

  if (pollTimer) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  pollInFlight = true;

  try {
    const payload = await callApi({
      action: "read",
      sid: sessionId,
      cursor
    });

    if (!payload.ok) {
      throw new Error(payload.error || "Read failed");
    }

    if (payload.data) {
      debugLog("pollOutput:data", {
        cursor,
        nextCursor: payload.cursor,
        bytes: payload.data.length
      });
      terminal.write(base64Decode(payload.data), scrollTerminalToBottom);
    }
    cursor = payload.cursor;

    if (payload.closed) {
      setStatus("PTY session closed.", true);
      sessionId = "";
      pollInFlight = false;
      return;
    }

    setStatus("");
  } catch (error) {
    setStatus(`PTY read failed: ${error.message}`, true);
    pollInFlight = false;
    return;
  }

  pollInFlight = false;
  if (pollRequestedWhileBusy) {
    pollRequestedWhileBusy = false;
    schedulePoll(true);
    return;
  }
  schedulePoll();
}

async function sendResize() {
  if (!sessionId || !terminal) {
    return;
  }
  try {
    syncTerminalSize();
    const cols = terminal.cols;
    const rows = terminal.rows;
    scrollTerminalToBottom();
    await callApi({
      action: "resize",
      sid: sessionId,
      cols,
      rows
    });
  } catch (error) {
  }
}

async function initSession() {
  const deadline = Date.now() + INIT_TIMEOUT_MS;
  setStatus("PTY service starting...");

  while (Date.now() < deadline) {
    try {
      const payload = await callApi({
        action: "create",
        cols: terminalCols(),
        rows: terminalRows()
      });
      if (!payload.ok) {
        throw new Error(payload.error || "Unable to initialize PTY session");
      }

      sessionId = payload.sid;
      cursor = payload.cursor || 0;
      setStatus("");
      await sendResize();
      terminal.focus();
      schedulePoll(true);
      return;
    } catch (error) {
      const message = error && error.message ? error.message : "Unable to initialize PTY session";
      if (message === "PTY service is not running" || message === "Failed to reach PTY service") {
        setStatus("PTY service starting...");
        await new Promise((resolve) => window.setTimeout(resolve, INIT_RETRY_DELAY_MS));
        continue;
      }

      setStatus(`Failed to initialize PTY session: ${message}`, true);
      return;
    }
  }

  setStatus("Failed to initialize PTY session: timed out waiting for PTY service", true);
}

function initTerminal() {
  terminal = new Terminal({
    cols: terminalCols(),
    rows: terminalRows(),
    cursorBlink: true,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.45,
    theme: {
      background: "#f3f5f9",
      foreground: "#1f1f1f",
      cursor: "#0f6fdb",
      selectionBackground: "rgba(15, 111, 219, 0.18)"
    },
    allowTransparency: false,
    convertEol: false,
    scrollback: 5000,
    disableStdin: false,
    cancelEvents: true
  });

  terminal.open(mount);
  terminal.focus();
  syncTerminalSize();
  terminal.attachCustomKeyEventHandler((event) => {
    activateParentWindow();
    debugLog("customKeyEvent", {
      type: event.type,
      key: event.key,
      code: event.code,
      repeat: !!event.repeat,
      ctrl: !!event.ctrlKey,
      alt: !!event.altKey,
      shift: !!event.shiftKey,
      meta: !!event.metaKey
    });
    return true;
  });
  terminal.onData((data) => {
    debugLog("terminal:onData", {
      data
    });
    if (sessionId) {
      queueInput(data);
    }
  });
  terminal.onWriteParsed(() => {
    debugLog("terminal:writeParsed", {
      baseY: terminal.buffer.active.baseY,
      viewportY: terminal.buffer.active.viewportY,
      cols: terminal.cols,
      rows: terminal.rows
    });
    scrollTerminalToBottom();
  });
  terminal.onLineFeed(() => {
    debugLog("terminal:lineFeed", {
      baseY: terminal.buffer.active.baseY,
      viewportY: terminal.buffer.active.viewportY
    });
    scrollTerminalToBottom();
  });

  if (window.ResizeObserver) {
    const observer = new window.ResizeObserver(() => {
      void sendResize();
    });
    observer.observe(mount);
  }
}

document.addEventListener("mousedown", activateParentWindow);
document.addEventListener("focusin", activateParentWindow);
window.addEventListener("resize", sendResize);
window.addEventListener("message", (event) => {
  const data = event && event.data;
  if (!data || data.type !== "dsm-terminal-focus") {
    return;
  }
  focusTerminal();
});
window.addEventListener("beforeunload", () => {
  if (!sessionId) {
    return;
  }
  navigator.sendBeacon("pty.cgi", JSON.stringify({
    action: "close",
    sid: sessionId
  }));
});

initTerminal();
void initSession();
