(function () {
  const root = document.getElementById("panel-root");

  if (!root) {
    return;
  }

  const DEFAULT_LINES = [
    {
      id: "partner-primary",
      name: "Partner A",
      appliesTo: "total",
      percent: 65,
      fixed: 0,
    },
    {
      id: "partner-secondary",
      name: "Partner B",
      appliesTo: "total",
      percent: 35,
      fixed: 0,
    },
  ];

  const state = {
    sdk: null,
    dealId: null,
    deal: null,
    dealValue: 0,
    currency: "EUR",
    currencyFormatter: null,
    config: [],
    depositPercent: 0,
    summary: null,
    isLoading: true,
    isSaving: false,
    error: null,
    requiresAuth: false,
    authUrl: "/auth/pipedrive",
  };

  let heightFrame = null;
  let toastTimeout = null;
  let pendingFocus = null;
  const toast = createToast();

  function createToast() {
    const el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
    return el;
  }

  function showToast(message, tone) {
    const variant =
      tone === "success" ? "success" : tone === "error" ? "error" : "info";
    toast.textContent = message;
    toast.dataset.variant = variant;
    toast.classList.add("visible");

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove("visible");
    }, 3200);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function roundCurrency(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function sanitizeConfig(rawConfig) {
    if (!Array.isArray(rawConfig)) {
      return [];
    }

    return rawConfig
      .map((entry, index) => {
        if (!entry) {
          return null;
        }

        const name = typeof entry.name === "string" ? entry.name.trim() : "";
        const appliesTo =
          entry.appliesTo === "deposit"
            ? "deposit"
            : entry.appliesTo === "remaining"
            ? "remaining"
            : "total";

        return {
          id: entry.id || `line-${index + 1}`,
          name: name || `Line ${index + 1}`,
          appliesTo,
          percent: Number(entry.percent) || 0,
          fixed: Number(entry.fixed) || 0,
        };
      })
      .filter(Boolean);
  }

  function ensureConfig(config) {
    const cleaned = sanitizeConfig(config);
    return cleaned.length
      ? cleaned
      : DEFAULT_LINES.map((item) => ({ ...item }));
  }

  function computeSummary(dealValueInput, depositPercentInput, configInput) {
    const dealValue = roundCurrency(dealValueInput);
    const depositPercentRaw = Number(depositPercentInput) || 0;
    const depositPercent = Math.min(Math.max(depositPercentRaw, 0), 100);
    const config = ensureConfig(configInput);

    const depositAmount = roundCurrency((dealValue * depositPercent) / 100);
    const remainingAmount = roundCurrency(dealValue - depositAmount);

    let totalDisbursed = 0;

    const lines = config.map((entry) => {
      const baseAmount =
        entry.appliesTo === "deposit"
          ? depositAmount
          : entry.appliesTo === "remaining"
          ? remainingAmount
          : dealValue;
      const percentAmount = roundCurrency(
        (baseAmount * (entry.percent || 0)) / 100
      );
      const total = roundCurrency(percentAmount + (entry.fixed || 0));

      totalDisbursed += total;

      return {
        ...entry,
        baseAmount,
        percentAmount,
        total,
      };
    });

    totalDisbursed = roundCurrency(totalDisbursed);
    const differenceToDealValue = roundCurrency(dealValue - totalDisbursed);
    const matchesDealValue = Math.abs(differenceToDealValue) < 0.01;

    return {
      dealValue,
      depositPercent,
      depositAmount,
      remainingAmount,
      totalDisbursed,
      differenceToDealValue,
      matchesDealValue,
      commissionConfig: config,
      lines,
    };
  }

  function formatCurrency(value) {
    const amount = roundCurrency(value);

    if (typeof Intl !== "undefined") {
      try {
        if (
          !state.currencyFormatter ||
          state.currencyFormatter.resolvedOptions().currency !== state.currency
        ) {
          state.currencyFormatter = new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: state.currency || "EUR",
            maximumFractionDigits: 2,
          });
        }

        return state.currencyFormatter.format(amount);
      } catch (error) {
        console.warn("Failed to format currency", error);
      }
    }

    return `${amount.toFixed(2)} ${state.currency || ""}`.trim();
  }

  function scheduleHeightUpdate() {
    if (heightFrame) {
      cancelAnimationFrame(heightFrame);
    }

    heightFrame = requestAnimationFrame(() => {
      const height = document.documentElement.scrollHeight;
      if (state.sdk && typeof state.sdk.setHeight === "function") {
        state.sdk.setHeight(height);
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: "pipedrive:custom-panel-height",
            height,
          },
          "*"
        );
      }
    });
  }

  async function initializeSdk() {
    if (!window.AppExtensionsSDK) {
      return { sdk: null, context: null };
    }

    const sdk = new window.AppExtensionsSDK();

    try {
      const context = await sdk.initialize();
      return { sdk, context };
    } catch (error) {
      console.warn("Failed to initialize Pipedrive SDK", error);
      return { sdk: null, context: null };
    }
  }

  async function loadData(dealId) {
    state.isLoading = true;
    render();

    try {
      const response = await fetch(`/api/deals/${dealId}/commission`);

      if (response.status === 401) {
        const payload = await response.json().catch(() => ({}));
        state.requiresAuth = true;
        state.authUrl =
          payload.loginUrl || payload.authorizeUrl || "/auth/pipedrive";
        state.error = null;
        state.summary = null;
        state.deal = null;
        state.config = ensureConfig([]);
        state.depositPercent = 0;
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.error || `Failed to load data (HTTP ${response.status})`
        );
      }

      const payload = await response.json();

      state.requiresAuth = false;
      state.deal = payload.deal;
      state.dealValue =
        Number(payload.summary?.dealValue) || Number(payload.deal?.value) || 0;
      state.currency = payload.deal?.currency || state.currency;
      state.config = ensureConfig(payload.summary?.commissionConfig);
      state.depositPercent = Number(payload.summary?.depositPercent) || 0;
      state.summary = computeSummary(
        state.dealValue,
        state.depositPercent,
        state.config
      );
      state.error = null;
    } catch (error) {
      console.error(error);
      state.error = error.message || "Unable to load commission data";
      showToast(state.error, "error");
    } finally {
      if (!state.requiresAuth) {
        state.authUrl = "/auth/pipedrive";
      }
      state.isLoading = false;
      render();
    }
  }

  function render() {
    if (state.isLoading) {
      root.innerHTML = `
        <div class="loading-state">
          <div class="spinner" aria-hidden="true"></div>
          <p>Loading commission data…</p>
        </div>
      `;
      scheduleHeightUpdate();
      return;
    }

    if (state.requiresAuth) {
      const authUrl = escapeHtml(state.authUrl || "/auth/pipedrive");
      root.innerHTML = `
        <div class="card">
          <h2>Authorize access</h2>
          <p>To load commissions we need to connect this app to your Pipedrive account. Open the authorization flow, grant access, then reload this panel.</p>
          <div class="actions-bar" style="justify-content:flex-start">
            <button class="button button-primary" data-action="start-auth" data-auth-url="${authUrl}">Connect Pipedrive</button>
          </div>
        </div>
      `;
      bindAuthActions();
      scheduleHeightUpdate();
      return;
    }

    if (state.error) {
      root.innerHTML = `
        <div class="card">
          <h2>Something went wrong</h2>
          <p>${escapeHtml(state.error)}</p>
          <div class="actions-bar" style="justify-content:flex-start">
            <button class="button button-secondary" data-action="retry">Try again</button>
            <a class="button button-secondary" href="/" target="_blank" rel="noreferrer">Open deals list</a>
          </div>
        </div>
      `;
      bindErrorActions();
      scheduleHeightUpdate();
      return;
    }

    if (!state.dealId) {
      root.innerHTML = `
        <div class="card">
          <h2>No deal selected</h2>
          <p>We could not determine which deal to load. If you are testing locally, pass a <code>?dealId=123</code> query parameter.</p>
        </div>
      `;
      scheduleHeightUpdate();
      return;
    }

    const summary =
      state.summary ||
      computeSummary(state.dealValue, state.depositPercent, state.config);
    state.summary = summary;

    const rows = summary.lines
      .map((line, index) => {
        const nameValue = escapeHtml(line.name);
        const percentValue = Number.isFinite(line.percent) ? line.percent : 0;
        const fixedValue = Number.isFinite(line.fixed) ? line.fixed : 0;
        const canRemove = state.config.length > 1;

        return `
          <tr data-index="${index}">
            <td>
              <input
                type="text"
                data-action="update-field"
                data-field="name"
                data-line-index="${index}"
                value="${nameValue}"
                placeholder="Party name"
              />
            </td>
            <td>
              <select data-action="update-field" data-field="appliesTo" data-line-index="${index}" value="${
          line.appliesTo
        }">
                <option value="total"${
                  line.appliesTo === "total" ? " selected" : ""
                }>Total</option>
                <option value="deposit"${
                  line.appliesTo === "deposit" ? " selected" : ""
                }>Deposit</option>
                <option value="remaining"${
                  line.appliesTo === "remaining" ? " selected" : ""
                }>Remaining</option>
              </select>
            </td>
            <td>
              <input
                type="number"
                data-action="update-field"
                data-field="percent"
                data-line-index="${index}"
                step="0.1"
                value="${percentValue}"
              />
            </td>
            <td>
              <input
                type="number"
                data-action="update-field"
                data-field="fixed"
                data-line-index="${index}"
                step="0.01"
                value="${fixedValue}"
              />
            </td>
            <td class="numeric">${formatCurrency(line.baseAmount)}</td>
            <td class="numeric">${formatCurrency(line.percentAmount)}</td>
            <td class="numeric">${formatCurrency(line.total)}</td>
            <td class="row-actions">
              <button
                class="button button-secondary"
                data-action="remove-line"
                data-index="${index}"
                data-line-index="${index}"
                ${canRemove ? "" : "disabled"}
              >Remove</button>
            </td>
          </tr>
        `;
      })
      .join("");

    const difference = summary.differenceToDealValue;
    const balanced = summary.matchesDealValue;
    const differenceLabel = `${
      difference > 0 ? "Short" : "Over"
    } by ${formatCurrency(Math.abs(difference))}`;

    const statusBanner = balanced
      ? `
        <div class="status-banner success">
          <span class="status-dot"></span>
          <div>
            <strong>Balanced</strong>
            <div>The sum of all lines matches the deal value.</div>
          </div>
        </div>
      `
      : `
        <div class="status-banner error">
          <span class="status-dot"></span>
          <div>
            <strong>Totals do not match</strong>
            <div>${differenceLabel}. Adjust the percentages or fixed amounts.</div>
          </div>
        </div>
      `;

    const dealTitle = state.deal?.title
      ? escapeHtml(state.deal.title)
      : `Deal #${state.dealId}`;
    const depositInputId = "deposit-percent-input";

    root.innerHTML = `
      <div class="panel-header">
        <h1>Commission breakdown</h1>
        <p>${dealTitle}</p>
      </div>

      <section class="card">
        <h2>Deal snapshot</h2>
        <div class="deal-meta">
          <div class="deal-meta-item">
            <span class="deal-meta-label">Deal value</span>
            <span class="deal-meta-value">${formatCurrency(
              summary.dealValue
            )}</span>
          </div>
          <div class="deal-meta-item">
            <span class="deal-meta-label">Currency</span>
            <span class="deal-meta-value">${escapeHtml(state.currency)}</span>
          </div>
          <div class="deal-meta-item field">
            <label for="${depositInputId}">Deposit %</label>
            <input
              id="${depositInputId}"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value="${summary.depositPercent}"
              data-action="update-deposit"
            />
          </div>
          <div class="deal-meta-item">
            <span class="deal-meta-label">Deposit amount</span>
            <span class="deal-meta-value">${formatCurrency(
              summary.depositAmount
            )}</span>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Commission lines</h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Party</th>
                <th>Applies to</th>
                <th>Percent</th>
                <th>Fixed</th>
                <th>Base</th>
                <th>Percent amount</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
        <div class="actions-bar">
          <button class="button button-secondary" data-action="add-line">Add line</button>
          <button
            class="button button-primary"
            data-action="save"
            ${state.isSaving || !balanced ? "disabled" : ""}
          >${state.isSaving ? "Saving…" : "Save to Pipedrive"}</button>
        </div>
        ${statusBanner}
      </section>

      <section class="card">
        <h2>Summary</h2>
        <div class="summary-grid">
          <div class="summary-card">
            <strong>Total to distribute</strong>
            <span>${formatCurrency(summary.dealValue)}</span>
          </div>
          <div class="summary-card">
            <strong>Total assigned</strong>
            <span>${formatCurrency(summary.totalDisbursed)}</span>
          </div>
          <div class="summary-card">
            <strong>Deposit</strong>
            <span>${formatCurrency(summary.depositAmount)}</span>
          </div>
          <div class="summary-card">
            <strong>Remaining</strong>
            <span>${formatCurrency(summary.remainingAmount)}</span>
          </div>
        </div>
      </section>
    `;

    bindMainActions();
    restoreFocus();
    scheduleHeightUpdate();
  }

  function bindErrorActions() {
    const retryBtn = root.querySelector('[data-action="retry"]');

    if (retryBtn) {
      retryBtn.addEventListener("click", () => {
        if (state.dealId) {
          loadData(state.dealId);
        }
      });
    }
  }

  function bindAuthActions() {
    const authButton = root.querySelector('[data-action="start-auth"]');

    if (authButton) {
      authButton.addEventListener("click", () => {
        const url =
          authButton.dataset.authUrl || state.authUrl || "/auth/pipedrive";

        const opened = window.open(url, "_blank", "noopener");
        if (!opened) {
          window.location.href = url;
        }
      });
    }
  }

  function bindMainActions() {
    root.querySelectorAll('[data-action="update-field"]').forEach((input) => {
      input.addEventListener("input", onLineFieldChange);
    });

    const depositInput = root.querySelector('[data-action="update-deposit"]');
    if (depositInput) {
      depositInput.addEventListener("input", onDepositChange);
      depositInput.addEventListener("blur", () => {
        if (Number(depositInput.value) < 0) {
          depositInput.value = 0;
        }
        if (Number(depositInput.value) > 100) {
          depositInput.value = 100;
        }
      });
    }

    root.querySelectorAll('[data-action="remove-line"]').forEach((button) => {
      button.addEventListener("click", onRemoveLine);
    });

    const addLineBtn = root.querySelector('[data-action="add-line"]');
    if (addLineBtn) {
      addLineBtn.addEventListener("click", onAddLine);
    }

    const saveBtn = root.querySelector('[data-action="save"]');
    if (saveBtn) {
      saveBtn.addEventListener("click", onSave);
    }
  }

  function restoreFocus() {
    if (!pendingFocus) {
      return;
    }

    const focusDetails = pendingFocus;
    pendingFocus = null;

    requestAnimationFrame(() => {
      if (focusDetails.type === "line") {
        const selector = `[data-action="update-field"][data-field="${focusDetails.field}"][data-line-index="${focusDetails.index}"]`;
        const target = root.querySelector(selector);
        if (target) {
          target.focus();
          if (
            typeof focusDetails.selectionStart === "number" &&
            typeof focusDetails.selectionEnd === "number" &&
            typeof target.setSelectionRange === "function"
          ) {
            try {
              target.setSelectionRange(
                focusDetails.selectionStart,
                focusDetails.selectionEnd
              );
            } catch (error) {
              // Some inputs (e.g. type=number) may not support selection ranges.
            }
          }
        }
        return;
      }

      if (focusDetails.type === "deposit") {
        const target = root.querySelector('[data-action="update-deposit"]');
        if (target) {
          target.focus();
          if (
            typeof focusDetails.selectionStart === "number" &&
            typeof focusDetails.selectionEnd === "number" &&
            typeof target.setSelectionRange === "function"
          ) {
            try {
              target.setSelectionRange(
                focusDetails.selectionStart,
                focusDetails.selectionEnd
              );
            } catch (error) {
              // Ignore selection issues for unsupported inputs.
            }
          }
        }
      }
    });
  }

  function onLineFieldChange(event) {
    const el = event.currentTarget;
    const lineIndexAttr = el.dataset.lineIndex;
    const rowEl = el.closest("tr[data-index]");
    if (!lineIndexAttr && !rowEl) {
      return;
    }

    const index = Number(
      lineIndexAttr != null ? lineIndexAttr : rowEl.dataset.index
    );
    const field = el.dataset.field;

    if (!Number.isInteger(index) || !field) {
      return;
    }

    pendingFocus = {
      type: "line",
      index,
      field,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
    };

    const nextConfig = state.config.slice();
    const current = { ...nextConfig[index] };

    if (field === "name") {
      current.name = el.value;
    }

    if (field === "appliesTo") {
      current.appliesTo =
        el.value === "deposit"
          ? "deposit"
          : el.value === "remaining"
          ? "remaining"
          : "total";
    }

    if (field === "percent") {
      current.percent = Number(el.value) || 0;
    }

    if (field === "fixed") {
      current.fixed = Number(el.value) || 0;
    }

    nextConfig[index] = current;
    state.config = ensureConfig(nextConfig);
    state.summary = computeSummary(
      state.dealValue,
      state.depositPercent,
      state.config
    );
    render();
  }

  function onDepositChange(event) {
    const value = Number(event.currentTarget.value);
    pendingFocus = {
      type: "deposit",
      selectionStart: event.currentTarget.selectionStart,
      selectionEnd: event.currentTarget.selectionEnd,
    };
    state.depositPercent = Number.isFinite(value) ? value : 0;
    state.summary = computeSummary(
      state.dealValue,
      state.depositPercent,
      state.config
    );
    render();
  }

  function onAddLine() {
    const newLine = {
      id: `line-${Date.now()}`,
      name: `New line ${state.config.length + 1}`,
      appliesTo: "total",
      percent: 0,
      fixed: 0,
    };

    state.config = [...state.config, newLine];
    state.summary = computeSummary(
      state.dealValue,
      state.depositPercent,
      state.config
    );
    render();
  }

  function onRemoveLine(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) {
      return;
    }

    if (state.config.length <= 1) {
      showToast("You need at least one line", "info");
      return;
    }

    const nextConfig = state.config.slice();
    nextConfig.splice(index, 1);
    state.config = ensureConfig(nextConfig);
    state.summary = computeSummary(
      state.dealValue,
      state.depositPercent,
      state.config
    );
    render();
  }

  async function onSave() {
    if (state.isSaving || !state.summary?.matchesDealValue) {
      return;
    }

    state.isSaving = true;
    render();

    try {
      const response = await fetch(`/api/deals/${state.dealId}/commission`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          commissionConfig: state.config,
          depositPercent: state.depositPercent,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || "Failed to save commission data");
      }

      if (payload.summary) {
        state.config = ensureConfig(payload.summary.commissionConfig);
        state.depositPercent =
          Number(payload.summary.depositPercent) || state.depositPercent;
        state.dealValue = Number(payload.summary.dealValue) || state.dealValue;
        state.summary = computeSummary(
          state.dealValue,
          state.depositPercent,
          state.config
        );
      }

      showToast("Commission settings saved", "success");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Failed to save commission data", "error");
    } finally {
      state.isSaving = false;
      render();
    }
  }

  async function boot() {
    const bootstrap = window.__PANEL_BOOTSTRAP__ || {};
    const { sdk, context } = await initializeSdk();

    let dealId = bootstrap.dealId || "";
    if (
      !dealId &&
      Array.isArray(bootstrap.selectedIds) &&
      bootstrap.selectedIds.length
    ) {
      dealId = bootstrap.selectedIds[0];
    }

    let derivedContext =
      context && context.context ? context.context : context || null;

    if (!dealId && derivedContext) {
      if (
        Array.isArray(derivedContext.selectedIds) &&
        derivedContext.selectedIds.length
      ) {
        dealId = derivedContext.selectedIds[0];
      } else if (derivedContext.entity && derivedContext.entity.id) {
        dealId = derivedContext.entity.id;
      }
    }

    state.sdk = sdk;
    state.dealId = dealId ? String(dealId) : null;

    if (!state.dealId) {
      state.isLoading = false;
      state.error = null;
      render();
      return;
    }

    await loadData(state.dealId);

    window.addEventListener("resize", scheduleHeightUpdate);
  }

  boot();
})();
