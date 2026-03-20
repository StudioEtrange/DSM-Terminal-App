const output = document.getElementById("output");
const statusNode = document.getElementById("status");
const promptLabel = document.getElementById("promptLabel");
const commandForm = document.getElementById("commandForm");
const commandInput = document.getElementById("commandInput");
const helpButton = document.getElementById("helpButton");
const helpModal = document.getElementById("helpModal");
const closeHelpButton = document.getElementById("closeHelpButton");
const sudoStatusBadge = document.getElementById("sudoStatusBadge");
const helpStatus = document.getElementById("helpStatus");
const copyButtons = Array.from(document.querySelectorAll(".copy-button"));

let sessionId = "";
let cursor = 0;
let pollTimer = null;
let autoFollowOutput = true;
let sudoStatusLoaded = false;
const INIT_RETRY_DELAY_MS = 350;
const INIT_TIMEOUT_MS = 15000;

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

function setStatus(message, isError = false) {
  statusNode.textContent = message || "";
  statusNode.classList.toggle("error", isError);
}

function scrollOutputToBottom() {
  window.requestAnimationFrame(() => {
    output.scrollTop = output.scrollHeight;
  });
}

function appendOutput(text) {
  if (!text) {
    return;
  }

  output.textContent += text;
  if (autoFollowOutput) {
    scrollOutputToBottom();
  }
}

function base64Encode(value) {
  return window.btoa(unescape(encodeURIComponent(value)));
}

function base64Decode(value) {
  return decodeURIComponent(escape(window.atob(value)));
}

function stripAnsi(text) {
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b[@-Z\\-_]/g, "");
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

async function callJsonEndpoint(url, payload = null) {
  const response = await fetch(url, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function setHelpStatus(message, isError = false) {
  helpStatus.textContent = message || "";
  helpStatus.style.color = isError ? "var(--danger)" : "";
}

function setSudoBadge(state, label) {
  sudoStatusBadge.textContent = label;
  sudoStatusBadge.classList.remove("enabled", "disabled");
  if (state) {
    sudoStatusBadge.classList.add(state);
  }
}

async function loadSudoStatus(force = false) {
  if (sudoStatusLoaded && !force) {
    return;
  }

  setSudoBadge("", "Checking...");
  setHelpStatus("");
  try {
    const payload = await callJsonEndpoint("sudo_status.cgi");
    if (!payload.ok) {
      throw new Error(payload.error || "Unable to check sudo status");
    }

    if (payload.available === false) {
      setSudoBadge("disabled", "Unavailable");
      setHelpStatus("`sudo` is not available in this package environment.");
    } else if (payload.enabled) {
      setSudoBadge("enabled", "Enabled");
      setHelpStatus("Passwordless sudo is currently enabled for `sc-dsm-terminal`.");
    } else {
      setSudoBadge("disabled", "Disabled");
      setHelpStatus("Passwordless sudo is currently disabled for `sc-dsm-terminal`.");
    }
    sudoStatusLoaded = true;
  } catch (error) {
    setSudoBadge("disabled", "Unknown");
    setHelpStatus(`Unable to check sudo status: ${error.message}`, true);
  }
}

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "readonly");
  area.style.position = "absolute";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

function openHelp() {
  activateParentWindow();
  helpModal.classList.remove("hidden");
  helpModal.setAttribute("aria-hidden", "false");
  void loadSudoStatus();
}

function closeHelp() {
  helpModal.classList.add("hidden");
  helpModal.setAttribute("aria-hidden", "true");
}

function schedulePoll(immediate = false) {
  if (pollTimer) {
    window.clearTimeout(pollTimer);
  }
  pollTimer = window.setTimeout(pollOutput, immediate ? 0 : 120);
}

async function pollOutput() {
  if (!sessionId) {
    return;
  }

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
      appendOutput(stripAnsi(base64Decode(payload.data)));
    }
    cursor = payload.cursor;

    if (payload.closed) {
      setStatus("PTY session closed.", true);
      sessionId = "";
      return;
    }
    setStatus("");
    if (autoFollowOutput) {
      scrollOutputToBottom();
    }
  } catch (error) {
    setStatus(`PTY read failed: ${error.message}`, true);
    return;
  }

  schedulePoll();
}

async function sendResize() {
  if (!sessionId) {
    return;
  }
  try {
    await callApi({
      action: "resize",
      sid: sessionId,
      cols: Math.max(40, Math.floor(output.clientWidth / 8)),
      rows: Math.max(10, Math.floor(output.clientHeight / 18))
    });
    if (autoFollowOutput) {
      scrollOutputToBottom();
    }
  } catch (error) {
  }
}

async function initSession() {
  const deadline = Date.now() + INIT_TIMEOUT_MS;
  setStatus("PTY service starting...");
  commandInput.disabled = true;

  while (Date.now() < deadline) {
    try {
      const payload = await callApi({
        action: "create",
        cols: Math.max(40, Math.floor(output.clientWidth / 8)),
        rows: Math.max(10, Math.floor(output.clientHeight / 18))
      });
      if (!payload.ok) {
        throw new Error(payload.error || "Unable to initialize PTY session");
      }

      sessionId = payload.sid;
      cursor = payload.cursor || 0;
      appendOutput("PTY session ready.\n");
      appendOutput("Interactive input is supported, but the current frontend is still plain text and not a full terminal emulator.\n");
      setStatus("");
      await sendResize();
      scrollOutputToBottom();
      schedulePoll(true);
      commandInput.disabled = false;
      commandInput.focus();
      return;
    } catch (error) {
      const message = error && error.message ? error.message : "Unable to initialize PTY session";
      if (message === "PTY service is not running" || message === "Failed to reach PTY service") {
        setStatus("PTY service starting...");
        await new Promise((resolve) => window.setTimeout(resolve, INIT_RETRY_DELAY_MS));
        continue;
      }

      setStatus(`Failed to initialize PTY session: ${message}`, true);
      commandInput.disabled = false;
      commandInput.focus();
      return;
    }
  }

  setStatus("Failed to initialize PTY session: timed out waiting for PTY service", true);
  commandInput.disabled = false;
  commandInput.focus();
}

commandForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  activateParentWindow();

  const command = commandInput.value.trim();
  if (!command) {
    return;
  }

  if (command === "clear") {
    output.textContent = "";
    commandInput.value = "";
    setStatus("");
    autoFollowOutput = true;
    scrollOutputToBottom();
    commandInput.focus();
    return;
  }
  commandInput.value = "";
  setStatus("");
  commandInput.disabled = true;

  try {
    autoFollowOutput = true;
    const payload = await callApi({
      action: "write",
      sid: sessionId,
      data: base64Encode(`${command}\n`)
    });
    if (!payload.ok) {
      throw new Error(payload.error || "Write failed");
    }
    if (autoFollowOutput) {
      scrollOutputToBottom();
    }
    schedulePoll(true);
  } catch (error) {
    appendOutput(`ERROR: ${error.message}\n`);
    setStatus(`PTY write failed: ${error.message}`, true);
  } finally {
    commandInput.disabled = false;
    commandInput.focus();
  }
});

helpButton.addEventListener("click", openHelp);
closeHelpButton.addEventListener("click", closeHelp);
copyButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const targetId = button.getAttribute("data-copy-target");
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) {
      return;
    }
    try {
      await copyText(target.textContent || "");
      const original = button.textContent;
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = original;
      }, 1200);
    } catch (error) {
      setHelpStatus(`Copy failed: ${error.message}`, true);
    }
  });
});

helpModal.addEventListener("mousedown", (event) => {
  if (event.target === helpModal) {
    closeHelp();
  }
});

output.addEventListener("scroll", () => {
  autoFollowOutput = output.scrollTop + output.clientHeight >= output.scrollHeight - 24;
});

document.addEventListener("mousedown", activateParentWindow);
document.addEventListener("focusin", activateParentWindow);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !helpModal.classList.contains("hidden")) {
    closeHelp();
  }
});
window.addEventListener("resize", sendResize);
window.addEventListener("beforeunload", () => {
  if (!sessionId) {
    return;
  }
  navigator.sendBeacon("pty.cgi", JSON.stringify({
    action: "close",
    sid: sessionId
  }));
});

void initSession();
