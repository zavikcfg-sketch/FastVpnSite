(function () {
  const API = window.FASTVPN_API;
  const TOKEN_KEY = "fastvpn_token";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const authScreen = $("#auth-screen");
  const dashboard = $("#dashboard");
  const authError = $("#auth-error");
  const tgMount = $("#telegram-login");

  function token() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(value) {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function showError(msg) {
    if (!authError) return;
    authError.textContent = msg;
    authError.hidden = !msg;
  }

  async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
    const res = await fetch(`${API}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.message || "request_failed");
    return data;
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function fmtMoney(n) {
    return `${Number(n || 0).toLocaleString("ru-RU")} ₽`;
  }

  function statusBadge(status) {
    const map = {
      active: { cls: "badge-green", text: "Активна" },
      expired: { cls: "badge-gray", text: "Истекла" },
      blocked: { cls: "badge-red", text: "Заблокирована" },
    };
    const s = map[status] || { cls: "badge-gray", text: status };
    return `<span class="badge ${s.cls}">${s.text}</span>`;
  }

  async function loadConfig() {
    try {
      const cfg = await api("/api/config");
      window.__fastvpn_cfg = cfg;
      if (cfg.telegram_login_enabled && cfg.bot_username) {
        mountTelegramWidget(tgMount, cfg.bot_username);
      } else if (tgMount) {
        tgMount.innerHTML =
          '<p class="muted">Telegram-вход: укажите BOT_TOKEN на сервере API.</p>';
      }
    } catch {
      if (tgMount) {
        tgMount.innerHTML =
          '<p class="muted">API недоступен. Запустите web_server.py на порту 8787.</p>';
      }
    }
  }

  function mountTelegramWidget(mount, botUsername) {
    if (!mount) return;
    const cfg = window.__fastvpn_cfg || {};
    const username = botUsername || cfg.bot_username;
    if (!username) return;
    mount.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", username);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    mount.appendChild(script);
  }

  window.onTelegramAuth = async function (user) {
    showError("");
    try {
      if (token() && !dashboard.hidden) {
        await api("/api/auth/link-telegram", {
          method: "POST",
          body: JSON.stringify(user),
        });
        await showDashboard();
        return;
      }
      const data = await api("/api/auth/telegram", {
        method: "POST",
        body: JSON.stringify(user),
      });
      setToken(data.token);
      await showDashboard();
    } catch (e) {
      showError(e.message === "telegram_already_linked"
        ? "Этот Telegram уже привязан к другому аккаунту"
        : "Ошибка входа через Telegram");
    }
  };

  async function showDashboard() {
    authScreen.hidden = true;
    dashboard.hidden = false;
    showError("");

    let profile;
    try {
      profile = await api("/api/me");
    } catch {
      setToken(null);
      showAuth();
      return;
    }

    const u = profile.user;
    const vpn = profile.vpn;
    const stats = profile.stats;
    const subs = profile.subscriptions || [];

    $("#user-name").textContent = u.display_name || u.email || "Пользователь FastVpn";
    $("#user-meta").textContent = u.has_telegram
      ? `@${vpn?.username || "telegram"} · ID ${u.telegram_id}`
      : u.email || "Email-аккаунт";

    $("#stat-balance").textContent = vpn ? fmtMoney(vpn.balance) : "—";
    $("#stat-active").textContent = stats.active_subscriptions ?? 0;
    $("#stat-total").textContent = stats.total_subscriptions ?? 0;
    $("#stat-spent").textContent = fmtMoney(stats.total_spent);

    const linkBanner = $("#link-telegram-banner");
    if (linkBanner) {
      linkBanner.hidden = !!u.has_telegram;
      if (!u.has_telegram) mountTelegramWidget($("#telegram-link-widget"));
    }

    const subsList = $("#subs-list");
    const subsEmpty = $("#subs-empty");
    subsList.innerHTML = "";

    if (!subs.length) {
      subsEmpty.hidden = false;
    } else {
      subsEmpty.hidden = true;
      subs.forEach((sub) => {
        const el = document.createElement("article");
        el.className = "sub-card";
        el.innerHTML = `
          <div class="sub-head">
            <strong>${sub.is_trial ? "🎁 Пробная" : "🛡️"} ${sub.name}</strong>
            ${statusBadge(sub.status)}
          </div>
          <div class="sub-meta">
            <span>До: ${fmtDate(sub.expires_at)}</span>
            <span>${sub.days_left} дн.</span>
            <span>${sub.devices || "∞"} устр.</span>
          </div>
          ${
            sub.subscription_url
              ? `<div class="sub-url"><input readonly value="${sub.subscription_url}" /><button type="button" class="button secondary copy-btn">Копировать</button></div>`
              : ""
          }
          <a class="button plan-btn" href="https://t.me/Fastsave_VpN_bot" target="_blank" rel="noopener">Управлять в боте</a>
        `;
        const copyBtn = el.querySelector(".copy-btn");
        if (copyBtn) {
          copyBtn.addEventListener("click", () => {
            const input = el.querySelector("input");
            input.select();
            navigator.clipboard.writeText(input.value);
            copyBtn.textContent = "Скопировано!";
            setTimeout(() => (copyBtn.textContent = "Копировать"), 1500);
          });
        }
        subsList.appendChild(el);
      });
    }

    renderConnections(subs);
    renderActivity(stats, vpn);
  }

  function renderConnections(subs) {
    const grid = $("#connections-grid");
    grid.innerHTML = "";
    const servers = [
      { flag: "🇳🇱", name: "Нидерланды" },
      { flag: "🇨🇭", name: "Швейцария" },
      { flag: "🇸🇪", name: "Швеция" },
      { flag: "🇫🇮", name: "Финляндия" },
    ];
    const hasActive = subs.some((s) => s.status === "active");
    servers.forEach((srv) => {
      const el = document.createElement("div");
      el.className = "connection-row";
      el.innerHTML = `
        <span>${srv.flag}</span>
        <strong>${srv.name}</strong>
        <span class="ping">${hasActive ? '<span class="ping-dot"></span>Online' : "—"}</span>
      `;
      grid.appendChild(el);
    });
  }

  function renderActivity(stats, vpn) {
    const list = $("#activity-list");
    list.innerHTML = "";
    const items = [
      { label: "Пополнений", value: fmtMoney(stats.total_topups) },
      { label: "Заказов", value: stats.total_orders ?? 0 },
      { label: "С нами с", value: vpn ? fmtDate(vpn.member_since) : "—" },
      { label: "Пробный период", value: vpn ? (vpn.trial_used ? "Использован" : "Доступен") : "—" },
    ];
    items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "activity-row";
      el.innerHTML = `<span>${item.label}</span><strong>${item.value}</strong>`;
      list.appendChild(el);
    });
  }

  function showAuth() {
    authScreen.hidden = false;
    dashboard.hidden = true;
  }

  $("#login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token);
      await showDashboard();
    } catch {
      showError("Неверный email или пароль");
    }
  });

  $("#register-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const email = $("#reg-email").value.trim();
    const password = $("#reg-password").value;
    const display_name = $("#reg-name").value.trim() || null;
    if (password.length < 6) {
      showError("Пароль минимум 6 символов");
      return;
    }
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, display_name }),
      });
      setToken(data.token);
      await showDashboard();
    } catch (e) {
      const msg = typeof e.message === "string" ? e.message : "request_failed";
      showError(msg === "email_taken" ? "Email уже зарегистрирован" : "Ошибка регистрации");
    }
  });

  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      $$(".tab-panel").forEach((p) => (p.hidden = true));
      btn.classList.add("active");
      const panel = $(`#${btn.dataset.tab}`);
      if (panel) panel.hidden = false;
    });
  });

  $("#logout-btn")?.addEventListener("click", () => {
    setToken(null);
    showAuth();
  });

  document.getElementById("year").textContent = new Date().getFullYear();

  (async function init() {
    await loadConfig();
    if (token()) await showDashboard();
    else showAuth();

    document.querySelectorAll(".reveal").forEach((el, i) => {
      setTimeout(() => el.classList.add("visible"), 80 + i * 60);
    });
  })();
})();
