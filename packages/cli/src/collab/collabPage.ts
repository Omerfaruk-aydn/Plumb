/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F21 (PLUMB-UI-DEVRIM-PROMPT.md): static HTML shell served by CollabServer.
 * Zero external dependencies -- no CDN scripts/styles/fonts, everything
 * inline, so it renders standalone even offline. Semantic markup (list of
 * messages with a text role label) rather than color-only cues, since a
 * viewer's browser color scheme is outside PLUMB's control.
 */

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #0b0f14;
    color: #e6edf3;
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  header {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #1f2937;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  header h1 { font-size: 0.95rem; margin: 0; font-weight: 600; }
  #status { font-size: 0.8rem; color: #8b949e; }
  #status.connected { color: #3fb950; }
  #status.disconnected { color: #f85149; }
  main {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
  }
  ul#messages { list-style: none; margin: 0; padding: 0; }
  li.message {
    margin-bottom: 0.9rem;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.4;
  }
  .role {
    display: inline-block;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-right: 0.5rem;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    background: #1f2937;
    color: #c9d1d9;
  }
  li.message[data-role="user"] .role { color: #79c0ff; }
  li.message[data-role="assistant"] .role { color: #3fb950; }
  li.message[data-role="system"] .role { color: #f0883e; }
  footer {
    padding: 0.5rem 1rem;
    border-top: 1px solid #1f2937;
    font-size: 0.78rem;
    color: #8b949e;
  }
`;

const SCRIPT = `
(function () {
  var messagesEl = document.getElementById('messages');
  var statusEl = document.getElementById('status');
  var main = document.querySelector('main');

  function appendMessage(msg) {
    var li = document.createElement('li');
    li.className = 'message';
    li.setAttribute('data-role', msg.role);
    var role = document.createElement('span');
    role.className = 'role';
    role.textContent = msg.role;
    li.appendChild(role);
    li.appendChild(document.createTextNode(msg.text));
    messagesEl.appendChild(li);
  }

  var atBottom = true;
  main.addEventListener('scroll', function () {
    atBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 40;
  });

  function scrollIfNeeded() {
    if (atBottom) main.scrollTop = main.scrollHeight;
  }

  var source = new EventSource('/events');
  source.addEventListener('init', function (event) {
    var initial = JSON.parse(event.data);
    initial.forEach(appendMessage);
    scrollIfNeeded();
  });
  source.addEventListener('message', function (event) {
    appendMessage(JSON.parse(event.data));
    scrollIfNeeded();
  });
  source.onopen = function () {
    statusEl.textContent = 'connected';
    statusEl.className = 'connected';
  };
  source.onerror = function () {
    statusEl.textContent = 'disconnected';
    statusEl.className = 'disconnected';
  };
})();
`;

export function renderCollabPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PLUMB collab session</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>PLUMB collab session</h1>
  <span id="status">connecting…</span>
</header>
<main>
  <ul id="messages" aria-live="polite"></ul>
</main>
<footer>Read-only live view. Session ends when the host stops sharing.</footer>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
