/* Outreach Studio - front end
   Talks to the FastAPI backend in server.py. The agent reply is streamed over
   SSE (plain fetch + ReadableStream) so each research step shows up live. */

(function () {
  "use strict";

  var STORE_KEY = "outreachStudio.sessions.v1";
  var THEME_KEY = "outreachStudio.theme";

  var $ = function (sel) {
    return document.querySelector(sel);
  };

  var els = {
    app: $("#app"),
    stream: $("#stream"),
    inner: $("#streamInner"),
    input: $("#input"),
    send: $("#sendBtn"),
    stop: $("#stopBtn"),
    composer: $("#composer"),
    sessionList: $("#sessionList"),
    newSession: $("#newSession"),
    threadTitle: $("#threadTitle"),
    modelChip: $("#modelChip"),
    serverDot: $("#serverDot"),
    serverText: $("#serverText"),
    serverStatus: $("#serverStatus"),
    themeBtn: $("#themeBtn"),
    menuBtn: $("#menuBtn"),
    scrim: $("#scrim"),
  };

  var state = { sessions: {}, order: [], current: null };
  var busy = false;
  var abortRef = null;

  var AVATAR =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.6 7.2 8.4 5.9 8.4-5.9"/></svg>';
  var CARET =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  var TOOL_COPY = {
    search_web: ["Searching the web", "Searched the web"],
    search_page: ["Reading the page", "Read the page"],
    send_email: ["Sending the email", "Sent the email"],
  };

  var EXAMPLES = [
    "Research Notion and draft an outreach email",
    "https://stripe.com",
    "Follow up with a lead who went quiet",
  ];

  /* ----------------------------------------------------------------- utils */

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function timeOf(ts) {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  function titleFrom(text) {
    var t = text.replace(/\s+/g, " ").trim();
    return t.length > 44 ? t.slice(0, 43) + "\u2026" : t || "New outreach";
  }

  /* ------------------------------------------------------------- tiny markdown */

  function inline(s) {
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    return s;
  }

  function renderMarkdown(src) {
    var lines = esc(src || "").split(/\r?\n/);
    var html = "";
    var list = null;
    var inCode = false;
    var codeBuf = [];

    function flushList() {
      if (list) {
        html += "</" + list + ">";
        list = null;
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (/^\s*```/.test(line)) {
        if (inCode) {
          html += "<pre><code>" + codeBuf.join("\n") + "</code></pre>";
          codeBuf = [];
          inCode = false;
        } else {
          flushList();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        codeBuf.push(line);
        continue;
      }
      if (/^\s*$/.test(line)) {
        flushList();
        continue;
      }

      var m;
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        flushList();
        var lvl = m[1].length;
        html += "<h" + lvl + ">" + inline(m[2]) + "</h" + lvl + ">";
        continue;
      }
      if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
        if (list !== "ul") {
          flushList();
          html += "<ul>";
          list = "ul";
        }
        html += "<li>" + inline(m[1]) + "</li>";
        continue;
      }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        if (list !== "ol") {
          flushList();
          html += "<ol>";
          list = "ol";
        }
        html += "<li>" + inline(m[1]) + "</li>";
        continue;
      }
      if (/^&gt;\s?/.test(line)) {
        flushList();
        html += "<blockquote>" + inline(line.replace(/^&gt;\s?/, "")) + "</blockquote>";
        continue;
      }

      flushList();
      html += "<p>" + inline(line) + "</p>";
    }

    if (inCode) html += "<pre><code>" + codeBuf.join("\n") + "</code></pre>";
    flushList();
    return html;
  }

  /* --------------------------------------------------------------- storage */

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage full or blocked: not fatal */
    }
  }

  function loadStore() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch (e) {
      raw = null;
    }
    if (raw) {
      try {
        var data = JSON.parse(raw);
        if (data && data.sessions && data.order) {
          state = data;
          if (!state.sessions[state.current]) state.current = state.order[0] || null;
        }
      } catch (e) {
        /* corrupt store: start fresh */
      }
    }
    if (!state.current) newSession(false);
  }

  function currentSession() {
    return state.sessions[state.current];
  }

  function newSession(render) {
    var id = uid();
    state.sessions[id] = { id: id, title: "New outreach", createdAt: Date.now(), messages: [] };
    state.order.unshift(id);
    state.current = id;
    saveStore();
    if (render !== false) {
      renderSessions();
      renderThread();
      els.input.focus();
    }
  }

  /* --------------------------------------------------------------- render */

  function renderSessions() {
    var html = "";
    for (var i = 0; i < state.order.length; i++) {
      var id = state.order[i];
      var s = state.sessions[id];
      if (!s) continue;
      html +=
        '<button class="session" type="button" data-id="' + id + '"' +
        (id === state.current ? ' aria-current="true"' : "") +
        '><span class="session-title">' +
        esc(s.title) +
        '</span><span class="session-meta">' +
        timeOf(s.createdAt) +
        "</span></button>";
    }
    els.sessionList.innerHTML = html;
  }

  function trailHTML(msg, idx) {
    if (!msg.trail || !msg.trail.length) return "";
    var done = 0;
    for (var i = 0; i < msg.trail.length; i++) if (msg.trail[i].status === "done") done++;
    var steps = "";
    for (var j = 0; j < msg.trail.length; j++) {
      var t = msg.trail[j];
      var copy = TOOL_COPY[t.name] || [t.name, t.name];
      var label = t.status === "running" ? copy[0] : copy[1];
      steps +=
        '<div class="step" data-status="' + t.status + '">' +
        '<span class="step-dot"></span>' +
        '<span class="step-main">' +
        '<span class="step-name">' + esc(label) + " <span>" + esc(t.name) + "()</span></span>" +
        (t.detail ? '<span class="step-detail">' + esc(t.detail) + "</span>" : "") +
        "</span></div>";
    }
    return (
      '<div class="trail" data-open="' + (msg.trailOpen === false ? "false" : "true") + '">' +
      '<button class="trail-head" type="button" data-trail="' + idx + '">' +
      '<span class="title">Research trail</span>' +
      '<span class="count">' + done + "/" + msg.trail.length + "</span>" +
      '<span class="caret">' + CARET + "</span>" +
      "</button>" +
      '<div class="trail-body">' + steps + "</div></div>"
    );
  }

  function thinkingHTML() {
    return (
      '<div class="thinking"><span class="pips"><i></i><i></i><i></i></span>' +
      "<span>Researching and drafting\u2026</span></div>"
    );
  }

  function msgHTML(msg, idx) {
    if (msg.role === "user") {
      return '<div class="msg user"><div class="bubble-user">' + esc(msg.content) + "</div></div>";
    }
    var toolbar = msg.content ? '<button class="mini-btn" data-copy="' + idx + '">Copy</button>' : "";
    var body =
      msg.pending && !msg.content
        ? thinkingHTML()
        : renderMarkdown(msg.content);
    var note = msg.note ? '<div class="ans-note">' + esc(msg.note) + "</div>" : "";
    return (
      '<div class="msg assistant"><div class="ans">' +
      '<div class="ans-head">' +
      '<span class="ans-avatar">' + AVATAR + "</span>" +
      '<span class="ans-name">Outreach agent</span>' +
      '<span class="ans-time">' + timeOf(msg.ts) + "</span>" +
      '<span class="ans-tools">' + toolbar + "</span>" +
      "</div>" +
      trailHTML(msg, idx) +
      '<div class="ans-body">' + body + "</div>" +
      note +
      "</div></div>"
    );
  }

  function emptyHTML() {
    var chips = "";
    for (var i = 0; i < EXAMPLES.length; i++) {
      chips += '<button class="chip" type="button" data-prompt="' + esc(EXAMPLES[i]) + '">' + esc(EXAMPLES[i]) + "</button>";
    }
    return (
      '<div class="empty">' +
      "<h2>Research a business, then write outreach that <em>sounds human</em>.</h2>" +
      "<p>Describe a company or paste its website. The agent researches it, finds a real angle, and drafts a personalized email you can review and send.</p>" +
      '<div class="chips">' + chips + "</div></div>"
    );
  }

  function isNearBottom() {
    var el = els.stream;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  }

  function scrollToBottom() {
    els.stream.scrollTop = els.stream.scrollHeight;
  }

  function renderThread(stick) {
    var s = currentSession();
    if (!s) return;
    var stickBottom = stick || isNearBottom();
    els.threadTitle.textContent = s.title;

    if (!s.messages.length) {
      els.inner.innerHTML = emptyHTML();
      return;
    }
    var html = "";
    for (var i = 0; i < s.messages.length; i++) {
      html += msgHTML(s.messages[i], i);
    }
    els.inner.innerHTML = html;
    if (stickBottom) scrollToBottom();
  }

  /* ------------------------------------------------------------- streaming */

  function applyEvent(ev, assistant) {
    if (ev.type === "tool") {
      var trail = assistant.trail;
      if (ev.status === "running") {
        trail.push({ name: ev.name, detail: ev.detail || "", status: "running" });
      } else {
        var target = null;
        var k;
        for (k = trail.length - 1; k >= 0; k--) {
          if (trail[k].status === "running" && (!ev.name || trail[k].name === ev.name)) {
            target = trail[k];
            break;
          }
        }
        if (!target) {
          for (k = trail.length - 1; k >= 0; k--) {
            if (trail[k].status === "running") {
              target = trail[k];
              break;
            }
          }
        }
        if (target) {
          target.status = "done";
          if (ev.detail) target.detail = ev.detail;
        } else {
          trail.push({ name: ev.name || "tool", detail: ev.detail || "", status: "done" });
        }
      }
    } else if (ev.type === "answer") {
      assistant.content = ev.text || "";
      assistant.pending = false;
      assistant.trailOpen = false;
      for (var i = 0; i < assistant.trail.length; i++) {
        if (assistant.trail[i].status === "running") assistant.trail[i].status = "done";
      }
    } else if (ev.type === "error") {
      assistant.error = true;
      assistant.pending = false;
      assistant.trailOpen = false;
      assistant.note = ev.message || "Something went wrong.";
      for (var j = 0; j < assistant.trail.length; j++) {
        if (assistant.trail[j].status === "running") assistant.trail[j].status = "done";
      }
    }
  }

  function handleFrame(frame, assistant, session) {
    var lines = frame.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf("data:") !== 0) continue;
      var payload = line.slice(5).trim();
      if (!payload) continue;
      var ev;
      try {
        ev = JSON.parse(payload);
      } catch (e) {
        continue;
      }
      applyEvent(ev, assistant);
      saveStore();
      renderThread();
    }
  }

  function setBusy(value) {
    busy = value;
    els.send.disabled = value || !els.input.value.trim();
    els.stop.hidden = !value;
  }

  function send(text) {
    text = (text || els.input.value).trim();
    if (!text || busy) return;

    var s = currentSession();
    s.messages.push({ role: "user", content: text, ts: Date.now() });
    if (s.title === "New outreach") s.title = titleFrom(text);

    els.input.value = "";
    autosize();
    saveStore();
    renderSessions();
    renderThread(true);
    setBusy(true);

    var assistant = {
      role: "assistant",
      content: "",
      ts: Date.now(),
      trail: [],
      trailOpen: true,
      pending: true,
    };
    s.messages.push(assistant);
    saveStore();
    renderThread(true);

    var controller = new AbortController();
    abortRef = controller;

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, session_id: s.id }),
      signal: controller.signal,
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Server responded " + res.status);
        if (!res.body) throw new Error("This browser cannot stream responses");
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = "";

        function pump() {
          return reader.read().then(function (result) {
            if (result.done) return;
            buffer += decoder.decode(result.value, { stream: true });
            var at;
            while ((at = buffer.indexOf("\n\n")) >= 0) {
              var frame = buffer.slice(0, at);
              buffer = buffer.slice(at + 2);
              handleFrame(frame, assistant, s);
            }
            return pump();
          });
        }
        return pump();
      })
      .catch(function (err) {
        assistant.pending = false;
        assistant.trailOpen = false;
        if (err.name === "AbortError") {
          assistant.note = "Stopped.";
        } else {
          assistant.error = true;
          assistant.note = err.message;
        }
      })
      .then(function () {
        assistant.pending = false;
        abortRef = null;
        setBusy(false);
        saveStore();
        renderSessions();
        renderThread(true);
      });
  }

  /* --------------------------------------------------------------- health */

  function checkHealth() {
    fetch("/api/health")
      .then(function (res) {
        return res.json();
      })
      .then(function (d) {
        els.modelChip.textContent = d.model || "agent";
        if (d.ready) {
          els.serverDot.dataset.state = "ok";
          els.serverText.textContent = "Agent ready";
          els.serverStatus.title = "Model: " + d.model;
        } else if (d.missing_env && d.missing_env.length) {
          els.serverDot.dataset.state = "warn";
          els.serverText.textContent = "Awaiting API keys";
          els.serverStatus.title = "Set these environment variables: " + d.missing_env.join(", ");
        } else {
          els.serverDot.dataset.state = "err";
          els.serverText.textContent = "Agent offline";
          els.serverStatus.title = d.agent_error || "The agent could not be started.";
        }
      })
      .catch(function () {
        els.serverDot.dataset.state = "err";
        els.serverText.textContent = "Server unreachable";
        els.serverStatus.title = "Could not reach /api/health";
      });
  }

  /* ------------------------------------------------------------- composer */

  function autosize() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 190) + "px";
  }

  /* ------------------------------------------------------------------ theme */

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      /* ignore */
    }
  }

  function initTheme() {
    var saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch (e) {
      saved = null;
    }
    if (!saved) {
      saved = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    applyTheme(saved);
  }

  /* --------------------------------------------------------------- wiring */

  function openRail(open) {
    els.app.dataset.rail = open ? "open" : "closed";
    els.scrim.hidden = !open;
  }

  els.composer.addEventListener("submit", function (e) {
    e.preventDefault();
    send();
  });

  els.input.addEventListener("input", function () {
    autosize();
    els.send.disabled = busy || !els.input.value.trim();
  });

  els.input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  els.stop.addEventListener("click", function () {
    if (abortRef) abortRef.abort();
  });

  els.newSession.addEventListener("click", function () {
    newSession(true);
    openRail(false);
  });

  els.themeBtn.addEventListener("click", function () {
    applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
  });

  els.menuBtn.addEventListener("click", function () {
    openRail(els.app.dataset.rail !== "open");
  });

  els.scrim.addEventListener("click", function () {
    openRail(false);
  });

  els.sessionList.addEventListener("click", function (e) {
    var btn = e.target.closest(".session");
    if (!btn) return;
    state.current = btn.dataset.id;
    saveStore();
    renderSessions();
    renderThread(true);
    openRail(false);
  });

  els.inner.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (chip) {
      els.input.value = chip.dataset.prompt;
      autosize();
      els.send.disabled = false;
      els.input.focus();
      return;
    }

    var copy = e.target.closest("[data-copy]");
    if (copy) {
      var idx = Number(copy.dataset.copy);
      var msg = currentSession().messages[idx];
      if (msg && navigator.clipboard) {
        navigator.clipboard.writeText(msg.content).then(function () {
          copy.textContent = "Copied";
          setTimeout(function () {
            copy.textContent = "Copy";
          }, 1400);
        });
      }
      return;
    }

    var head = e.target.closest("[data-trail]");
    if (head) {
      var mi = Number(head.dataset.trail);
      var m = currentSession().messages[mi];
      if (m) {
        m.trailOpen = m.trailOpen === false;
        saveStore();
        renderThread();
      }
    }
  });

  /* ------------------------------------------------------------------- init */

  initTheme();
  loadStore();
  renderSessions();
  renderThread();
  autosize();
  els.send.disabled = true;
  checkHealth();
})();
