const output = document.getElementById("output");
const statusNode = document.getElementById("status");
const promptLabel = document.getElementById("promptLabel");
const commandForm = document.getElementById("commandForm");
const commandInput = document.getElementById("commandInput");

let sessionId = "";
let currentPrompt = "$";

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

function appendOutput(text) {
  if (!text) {
    return;
  }

  output.textContent += `${text}\n`;
  output.scrollTop = output.scrollHeight;
}

function updatePrompt(cwd) {
  currentPrompt = `${cwd} $`;
  promptLabel.textContent = currentPrompt;
}

async function callApi(action, command = "") {
  const body = new URLSearchParams();
  body.set("action", action);
  if (sessionId) {
    body.set("sid", sessionId);
  }
  if (command) {
    body.set("cmd", command);
  }

  const response = await fetch("shell.cgi", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: body.toString()
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function initSession() {
  setStatus("Connecting...");
  commandInput.disabled = true;

  try {
    const payload = await callApi("init");
    if (!payload.ok) {
      throw new Error(payload.error || "Unable to initialize shell session");
    }

    sessionId = payload.sid;
    updatePrompt(payload.cwd || "~");
    appendOutput(`Connected user: ${payload.user || "session"}`);
    appendOutput("Commands execute in DSM's web context and are not an administrator shell.");
    setStatus("");
  } catch (error) {
    setStatus(`Failed to initialize session: ${error.message}`, true);
  } finally {
    commandInput.disabled = false;
    commandInput.focus();
  }
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
    commandInput.focus();
    return;
  }

  appendOutput(`${currentPrompt} ${command}`);
  commandInput.value = "";
  setStatus("");
  commandInput.disabled = true;

  try {
    const payload = await callApi("run", command);
    if (!payload.ok) {
      throw new Error(payload.error || "Command failed");
    }

    if (payload.output) {
      appendOutput(payload.output);
    }
    updatePrompt(payload.cwd || "~");
    setStatus(payload.exit_status === 0 ? "" : `Exit status ${payload.exit_status}`, payload.exit_status !== 0);
  } catch (error) {
    appendOutput(`ERROR: ${error.message}`);
    setStatus(`Command failed: ${error.message}`, true);
  } finally {
    commandInput.disabled = false;
    commandInput.focus();
  }
});

document.addEventListener("mousedown", activateParentWindow);
document.addEventListener("focusin", activateParentWindow);

void initSession();
