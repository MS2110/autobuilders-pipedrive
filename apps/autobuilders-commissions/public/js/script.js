(function () {
  const COMMISSION_FIELD_KEY = "1a514f40d36407ecd675c76cc539481989400ac6";
  const DEPOSIT_PERCENT_FIELD_KEY = "315e79ee4cf37b98a64b73194f3f32da234278ba";
  const COMMISSION_FIELD_NAME = "commission_config_json";
  const root = document.getElementById("root");
  const queryParams = new URLSearchParams(window.location.search);
  const panelState = {
    ready: false,
    dealId: null,
    dealName: null,
    source: null,
    dealValue: 0,
    depositPercent: 0,
    commissionConfig: [],
    originalLines: [],
    originalSnapshot: "[]",
    isDirty: false,
    saving: false,
    lastError: null,
    lastSavedAt: null,
  };

  if (root) {
    root.addEventListener("input", handleCommissionInput, true);
    root.addEventListener("change", handleCommissionInput, true);
    root.addEventListener("click", handleRootClick, true);
  }

  function getDealIdFromQuery() {
    const params = queryParams;

    function pickFirstSelectedId() {
      const rawValues = [];

      if (params.has("selectedIds")) {
        rawValues.push(params.get("selectedIds"));
      }

      if (params.has("selected_ids")) {
        rawValues.push(params.get("selected_ids"));
      }

      params.getAll("selectedIds").forEach((value) => {
        if (!rawValues.includes(value)) {
          rawValues.push(value);
        }
      });

      params.getAll("selected_ids").forEach((value) => {
        if (!rawValues.includes(value)) {
          rawValues.push(value);
        }
      });

      for (const candidate of rawValues) {
        if (!candidate) {
          continue;
        }

        const parts = String(candidate)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

        if (parts.length) {
          return parts[0];
        }
      }

      return null;
    }

    const selectedId = pickFirstSelectedId();
    if (selectedId) {
      return selectedId;
    }

    return (
      params.get("dealId") ||
      params.get("deal_id") ||
      params.get("itemId") ||
      params.get("id") ||
      null
    );
  }

  function normalizeName(value) {
    if (value === null || value === undefined) {
      return null;
    }

    const trimmed = String(value).trim();
    return trimmed.length ? trimmed : null;
  }

  function getDealNameFromQuery() {
    const params = queryParams;
    const keys = [
      "dealTitle",
      "deal_title",
      "dealName",
      "deal_name",
      "title",
      "name",
    ];

    for (const key of keys) {
      if (!params.has(key)) {
        continue;
      }

      const candidate = normalizeName(params.get(key));
      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  function extractDealName(context) {
    if (!context || typeof context !== "object") {
      return null;
    }

    const contextsToCheck = [context];

    if (context.context && typeof context.context === "object") {
      contextsToCheck.push(context.context);
    }

    if (context.data && typeof context.data === "object") {
      contextsToCheck.push(context.data);
    }

    const nameCandidates = [];

    function pushName(value) {
      const candidate = normalizeName(value);
      if (candidate && !nameCandidates.includes(candidate)) {
        nameCandidates.push(candidate);
      }
    }

    function collect(candidateContext) {
      if (!candidateContext || typeof candidateContext !== "object") {
        return;
      }

      pushName(candidateContext.dealTitle);
      pushName(candidateContext.deal_name);
      pushName(candidateContext.dealName);
      pushName(candidateContext.title);
      pushName(candidateContext.name);

      if (candidateContext.deal && typeof candidateContext.deal === "object") {
        pushName(candidateContext.deal.title);
        pushName(candidateContext.deal.name);
      }

      if (
        candidateContext.currentDeal &&
        typeof candidateContext.currentDeal === "object"
      ) {
        pushName(candidateContext.currentDeal.title);
        pushName(candidateContext.currentDeal.name);
      }

      if (
        candidateContext.entity &&
        typeof candidateContext.entity === "object"
      ) {
        pushName(candidateContext.entity.title);
        pushName(candidateContext.entity.name);
      }

      if (
        candidateContext.object &&
        typeof candidateContext.object === "object"
      ) {
        pushName(candidateContext.object.title);
        pushName(candidateContext.object.name);
      }

      if (candidateContext.item && typeof candidateContext.item === "object") {
        pushName(candidateContext.item.title);
        pushName(candidateContext.item.name);
      }

      if (Array.isArray(candidateContext.selectedItems)) {
        candidateContext.selectedItems.forEach((item) => {
          if (item && typeof item === "object") {
            pushName(item.title);
            pushName(item.name);
          }
        });
      }

      if (Array.isArray(candidateContext.items)) {
        candidateContext.items.forEach((item) => {
          if (item && typeof item === "object") {
            pushName(item.title);
            pushName(item.name);
          }
        });
      }
    }

    contextsToCheck.forEach(collect);

    if (nameCandidates.length) {
      return nameCandidates[0];
    }

    return null;
  }

  function coerceId(value) {
    if (value === null || value === undefined) {
      return null;
    }
    const trimmed = String(value).trim();
    return trimmed.length ? trimmed : null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function extractDealId(context) {
    if (!context || typeof context !== "object") {
      return null;
    }

    const contextsToCheck = [context];

    if (context.context && typeof context.context === "object") {
      contextsToCheck.push(context.context);
    }

    if (context.data && typeof context.data === "object") {
      contextsToCheck.push(context.data);
    }

    const candidates = [];

    function pushCandidate(value) {
      const coerced = coerceId(value);
      if (coerced && !candidates.includes(coerced)) {
        candidates.push(coerced);
      }
    }

    function collectFromCandidate(candidateContext) {
      if (!candidateContext || typeof candidateContext !== "object") {
        return;
      }

      pushCandidate(candidateContext.dealId);
      pushCandidate(candidateContext.deal_id);

      if (candidateContext.deal && typeof candidateContext.deal === "object") {
        pushCandidate(candidateContext.deal.id);
        pushCandidate(candidateContext.deal.dealId);
        pushCandidate(candidateContext.deal.deal_id);
      }

      if (
        candidateContext.currentDeal &&
        typeof candidateContext.currentDeal === "object"
      ) {
        pushCandidate(candidateContext.currentDeal.id);
      }

      if (
        candidateContext.object &&
        typeof candidateContext.object === "object"
      ) {
        const object = candidateContext.object;
        pushCandidate(object.dealId);
        if (
          object.type === "deal" ||
          object.object === "deal" ||
          object.entity === "deal" ||
          object.entity_type === "deal"
        ) {
          pushCandidate(object.id);
        }
      }

      if (candidateContext.item && typeof candidateContext.item === "object") {
        const item = candidateContext.item;
        pushCandidate(item.dealId);
        if (!item.type || item.type === "deal") {
          pushCandidate(item.id);
        }
      }

      if (
        candidateContext.entity &&
        typeof candidateContext.entity === "object"
      ) {
        const entity = candidateContext.entity;
        if (entity.type === "deal" || entity.entity === "deal") {
          pushCandidate(entity.id);
        }
      }

      if (Array.isArray(candidateContext.selectedIds)) {
        candidateContext.selectedIds.forEach(pushCandidate);
      }

      if (Array.isArray(candidateContext.items)) {
        candidateContext.items.forEach((item) => {
          if (item && typeof item === "object") {
            pushCandidate(item.dealId);
            if (!item.type || item.type === "deal") {
              pushCandidate(item.id);
            }
          }
        });
      }

      if (Array.isArray(candidateContext.selectedItems)) {
        candidateContext.selectedItems.forEach((item) => {
          if (item && typeof item === "object") {
            pushCandidate(item.dealId);
            if (!item.type || item.type === "deal") {
              pushCandidate(item.id);
            }
          }
        });
      }
    }

    contextsToCheck.forEach(collectFromCandidate);

    const numericCandidate = candidates.find((value) => /^\d+$/.test(value));
    if (numericCandidate) {
      return numericCandidate;
    }

    for (const candidate of candidates) {
      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  function isTraversableCandidate(value) {
    if (!value || typeof value !== "object") {
      return false;
    }

    const tag = Object.prototype.toString.call(value);
    return tag === "[object Object]" || tag === "[object Array]";
  }

  function extractCustomField(context, fieldKey) {
    if (!context || typeof context !== "object") {
      return { value: null, source: null };
    }

    const visited = new WeakSet();
    const queue = [];
    const MAX_STEPS = 400;
    let steps = 0;

    function enqueue(candidate, label) {
      if (!isTraversableCandidate(candidate)) {
        return;
      }
      if (visited.has(candidate)) {
        return;
      }
      queue.push({ node: candidate, label });
    }

    enqueue(context, "sdk.initialize context");
    enqueue(context.context, "context.context");
    enqueue(context.data, "context.data");
    enqueue(context.deal, "context.deal");
    enqueue(context.object, "context.object");
    enqueue(context.item, "context.item");
    enqueue(context.currentDeal, "context.currentDeal");

    if (Array.isArray(context.selectedItems)) {
      context.selectedItems.forEach((item, index) => {
        enqueue(item, `context.selectedItems[${index}]`);
      });
    }

    while (queue.length && steps < MAX_STEPS) {
      const { node, label } = queue.shift();
      if (!isTraversableCandidate(node)) {
        continue;
      }

      if (visited.has(node)) {
        continue;
      }

      visited.add(node);
      steps += 1;

      let hasField = false;
      try {
        hasField = Object.prototype.hasOwnProperty.call(node, fieldKey);
      } catch (error) {
        hasField = false;
      }

      if (hasField) {
        let fieldValue = null;
        try {
          fieldValue = node[fieldKey];
        } catch (error) {
          fieldValue = null;
        }
        return { value: fieldValue, source: label };
      }

      let values;
      try {
        values = Array.isArray(node) ? node : Object.values(node);
      } catch (error) {
        continue;
      }
      values.forEach((value) => {
        if (value && typeof value === "object" && !visited.has(value)) {
          enqueue(value, label);
        }
      });
    }

    return { value: null, source: null };
  }

  function formatFieldValue(value) {
    if (value === null || value === undefined || value === "") {
      return { text: "Not set", isPlaceholder: true };
    }

    if (typeof value === "object") {
      try {
        return {
          text: JSON.stringify(value, null, 2),
          isPlaceholder: false,
        };
      } catch (error) {
        return {
          text: "[Unable to serialize value]",
          isPlaceholder: true,
        };
      }
    }

    const raw = String(value);
    const trimmed = raw.trim();

    if (!trimmed) {
      return { text: "Not set", isPlaceholder: true };
    }

    try {
      const parsed = JSON.parse(trimmed);
      return {
        text: JSON.stringify(parsed, null, 2),
        isPlaceholder: false,
      };
    } catch (error) {
      return { text: raw, isPlaceholder: false };
    }
  }

  function calculateCommissions(commissionConfig, dealValue, depositPercent) {
    const originalDepositAmount = (dealValue * depositPercent) / 100;
    const originalRemainingAmount = dealValue - originalDepositAmount;

    // First pass: calculate fixed amounts and ALL deposit-related fees
    let totalFixedAmounts = 0;
    let pureDepositCommissions = 0; // Malt-like fees without substractOtherDepostit
    let netDepositCommissions = 0; // Mathieu-like fees with substractOtherDepostit

    commissionConfig.forEach((config) => {
      totalFixedAmounts += config.fixed || 0;

      if (config.appliesTo === "deposit") {
        if (!config.substractOtherDepostit) {
          // Pure deposit commission (like Malt) - calculated on original deposit
          const depositCommission =
            (originalDepositAmount * config.percent) / 100;
          pureDepositCommissions += depositCommission;
        }
      }
    });

    // Calculate adjusted deposit after pure deposit fees (for net deposit calculations)
    const adjustedDepositForNet =
      originalDepositAmount - pureDepositCommissions;

    // Second pass: calculate net deposit commissions (with substractOtherDepostit flag)
    commissionConfig.forEach((config) => {
      if (config.appliesTo === "deposit" && config.substractOtherDepostit) {
        const netCommission = (adjustedDepositForNet * config.percent) / 100;
        netDepositCommissions += netCommission;
      }
    });

    // Total of ALL deposit commissions
    const totalAllDepositCommissions =
      pureDepositCommissions + netDepositCommissions;

    // Calculate the adjusted base for "total" commissions
    // Deal value minus fixed amounts minus ALL deposit commissions
    const adjustedBaseForTotal =
      dealValue - totalFixedAmounts - totalAllDepositCommissions;
    const adjustedDepositForTotal =
      originalDepositAmount - totalAllDepositCommissions;
    const adjustedRemainingForTotal =
      adjustedBaseForTotal - adjustedDepositForTotal;

    // Third pass: calculate actual commissions for display
    const commissions = commissionConfig.map((config) => {
      const fixedAmount = config.fixed || 0;
      let percentAmount = 0;
      let onDeposit = 0;
      let onRemaining = 0;

      if (config.appliesTo === "deposit") {
        if (config.substractOtherDepostit) {
          // Deposit with substractOtherDepostit: calculate on deposit minus pure deposit fees
          percentAmount = (adjustedDepositForNet * config.percent) / 100;
          onDeposit = percentAmount;
          onRemaining = 0;
        } else {
          // Pure deposit-only: calculate on original deposit amount
          percentAmount = (originalDepositAmount * config.percent) / 100;
          onDeposit = percentAmount;
          onRemaining = 0;
        }
      } else {
        // Total: calculate on adjusted base (excluding fixed and ALL deposit commissions)
        percentAmount = (adjustedBaseForTotal * config.percent) / 100;
        onDeposit = (adjustedDepositForTotal * config.percent) / 100;
        onRemaining = (adjustedRemainingForTotal * config.percent) / 100;
      }

      const total = percentAmount + fixedAmount;

      return {
        name: config.name,
        percent: config.percent,
        fixed: fixedAmount,
        appliesTo: config.appliesTo || "total",
        substractOtherDepostit: config.substractOtherDepostit || false,
        depositAmount: onDeposit,
        remainingAmount: onRemaining,
        total: total,
      };
    });

    const totalCommissions = commissions.reduce((sum, c) => sum + c.total, 0);

    return {
      commissions,
      dealValue,
      depositAmount: originalDepositAmount,
      remainingAmount: originalRemainingAmount,
      totalCommissions,
      isValid: Math.abs(totalCommissions - dealValue) < 0.01,
    };
  }

  function formatCurrency(value) {
    if (value === null || value === undefined || isNaN(value)) {
      return "€0";
    }
    return `€${value.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function normalizeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseCommissionPayload(rawValue) {
    if (!rawValue) {
      return { commissionConfig: [], depositPercent: null, dealValue: null };
    }

    let parsed = rawValue;
    if (typeof rawValue === "string") {
      try {
        parsed = JSON.parse(rawValue);
      } catch (error) {
        return { commissionConfig: [], depositPercent: null, dealValue: null };
      }
    }

    if (Array.isArray(parsed)) {
      return {
        commissionConfig: parsed,
        depositPercent: null,
        dealValue: null,
      };
    }

    if (parsed && typeof parsed === "object") {
      const commissionConfig = Array.isArray(parsed.commissionConfig)
        ? parsed.commissionConfig
        : [];

      return {
        commissionConfig,
        depositPercent:
          parsed.depositPercent !== undefined ? parsed.depositPercent : null,
        dealValue: parsed.dealValue !== undefined ? parsed.dealValue : null,
      };
    }

    return { commissionConfig: [], depositPercent: null, dealValue: null };
  }

  function sanitizeLines(lines) {
    if (!Array.isArray(lines)) {
      return [];
    }

    return lines
      .map((entry, index) => {
        if (!entry) {
          return null;
        }

        const appliesToRaw =
          typeof entry.appliesTo === "string"
            ? entry.appliesTo.toLowerCase()
            : "";
        const appliesTo = appliesToRaw === "deposit" ? "deposit" : "total";
        const percentValue = Number(entry.percent);
        const fixedValue = Number(entry.fixed);

        const safeName = (() => {
          if (entry.name === null || entry.name === undefined) {
            return `Line ${index + 1}`;
          }
          const trimmed = String(entry.name).trim();
          return trimmed.length ? trimmed : `Line ${index + 1}`;
        })();

        return {
          id: String(entry.id || `line-${index + 1}`),
          name: safeName,
          appliesTo,
          percent: Number.isFinite(percentValue) ? percentValue : 0,
          fixed: Number.isFinite(fixedValue) ? fixedValue : 0,
          substractOtherDepostit: Boolean(entry.substractOtherDepostit),
        };
      })
      .filter(Boolean);
  }

  function createEditingLines(lines) {
    return lines.map((line) => ({
      id: line.id,
      name: line.name,
      appliesTo: line.appliesTo === "deposit" ? "deposit" : "total",
      percent:
        line.percent === 0 || Number.isFinite(line.percent)
          ? String(line.percent)
          : "",
      fixed:
        line.fixed === 0 || Number.isFinite(line.fixed)
          ? String(line.fixed)
          : "",
      substractOtherDepostit: Boolean(line.substractOtherDepostit),
    }));
  }

  function snapshotLines(lines) {
    try {
      return JSON.stringify(lines);
    } catch (error) {
      return "[]";
    }
  }

  function parseResultIntoState(result) {
    const summaryLines = Array.isArray(result?.summary?.commissionConfig)
      ? result.summary.commissionConfig
      : null;
    const rawPayload =
      result?.commissionConfig !== undefined
        ? result.commissionConfig
        : result?.fieldValue ?? null;
    const parsedPayload = parseCommissionPayload(rawPayload);

    const lines =
      summaryLines && summaryLines.length
        ? summaryLines
        : parsedPayload.commissionConfig || [];

    const depositPercent =
      normalizeNumber(result?.summary?.depositPercent) ??
      normalizeNumber(result?.depositPercent) ??
      normalizeNumber(parsedPayload.depositPercent) ??
      0;

    const dealValue =
      normalizeNumber(result?.summary?.dealValue) ??
      normalizeNumber(result?.dealValue) ??
      normalizeNumber(parsedPayload.dealValue) ??
      0;

    return { lines, depositPercent, dealValue };
  }

  function markSavedState(lines) {
    panelState.originalLines = lines.map((line) => ({ ...line }));
    panelState.originalSnapshot = snapshotLines(panelState.originalLines);
  }

  function hydratePanelState(result) {
    const parsed = parseResultIntoState(result || {});
    const sanitizedLines = sanitizeLines(parsed.lines);
    const editingLines = createEditingLines(sanitizedLines);

    panelState.ready = true;
    panelState.dealId = result?.dealId || panelState.dealId;
    panelState.dealName = result?.dealName || panelState.dealName;
    panelState.source = result?.source || panelState.source || null;
    panelState.dealValue = parsed.dealValue;
    panelState.depositPercent = parsed.depositPercent;
    panelState.commissionConfig = editingLines;
    markSavedState(sanitizedLines);
    panelState.isDirty = false;
    panelState.saving = false;
    panelState.lastError = null;
  }

  function getSanitizedLinesFromState() {
    return sanitizeLines(panelState.commissionConfig);
  }

  function updateDirtyFlag() {
    const currentSnapshot = snapshotLines(getSanitizedLinesFromState());
    panelState.isDirty = currentSnapshot !== panelState.originalSnapshot;
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) {
      return "";
    }
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch (error) {
      return String(timestamp);
    }
  }

  function buildMetricsHTML(calculations) {
    const depositPercent = panelState.depositPercent;
    const metrics = [
      {
        label:
          depositPercent && !Number.isNaN(depositPercent)
            ? `Deposit (${depositPercent}%)`
            : "Deposit",
        value: formatCurrency(calculations.depositAmount),
      },
      {
        label: "Remaining",
        value: formatCurrency(calculations.remainingAmount),
      },
    ];

    return metrics
      .map(
        (metric) => `
              <div class="metric-card">
                <span class="metric-label">${escapeHtml(metric.label)}</span>
                <span class="metric-value">${metric.value}</span>
                ${
                  metric.note
                    ? `<span class="metric-note">${escapeHtml(
                        metric.note
                      )}</span>`
                    : ""
                }
              </div>
            `
      )
      .join("");
  }

  function buildCommissionRows(calculations) {
    return calculations.commissions
      .map(
        (commission) => `
              <div class="commission-row">
                <div class="commission-row-main">
                  <div>
                    <p class="commission-name">${escapeHtml(
                      commission.name
                    )}</p>
                  </div>
                  <div class="commission-amount">${formatCurrency(
                    commission.total
                  )}</div>
                </div>
                <div class="commission-breakdown">
                  <div class="breakdown-item">
                    <span class="breakdown-label">Rate</span>
                    <span class="breakdown-value">${
                      commission.percent !== undefined &&
                      commission.percent !== null
                        ? `${commission.percent}%`
                        : "—"
                    }</span>
                  </div>
                  <div class="breakdown-item">
                    <span class="breakdown-label">On deposit</span>
                    <span class="breakdown-value">${formatCurrency(
                      commission.depositAmount
                    )}</span>
                  </div>
                  <div class="breakdown-item">
                    <span class="breakdown-label">On remaining</span>
                    <span class="breakdown-value">${formatCurrency(
                      commission.remainingAmount
                    )}</span>
                  </div>
                  <div class="breakdown-item">
                    <span class="breakdown-label">Fixed</span>
                    <span class="breakdown-value">${
                      commission.fixed > 0
                        ? formatCurrency(commission.fixed)
                        : "—"
                    }</span>
                  </div>
                </div>
              </div>
    `
      )
      .join("");
  }

  function renderEditorRow(line, index) {
    const isDeposit = line.appliesTo === "deposit";
    const percentValue = line.percent ?? "";
    const fixedValue = line.fixed ?? "";

    return `
      <div class="commission-form-row">
        <div class="form-field grow">
          <label for="commission-name-${index}">Name</label>
          <input
            id="commission-name-${index}"
            type="text"
            class="input"
            data-commission-input
            data-field="name"
            data-index="${index}"
            value="${escapeHtml(line.name ?? "")}" />
        </div>
        <div class="form-field">
          <label for="commission-applies-${index}">Applies to</label>
          <select
            id="commission-applies-${index}"
            class="input"
            data-commission-input
            data-field="appliesTo"
            data-index="${index}">
            <option value="total" ${
              line.appliesTo === "total" ? "selected" : ""
            }>Total</option>
            <option value="deposit" ${
              isDeposit ? "selected" : ""
            }>Deposit</option>
          </select>
        </div>
        <div class="form-field compact">
          <label for="commission-percent-${index}">% rate</label>
          <input
            id="commission-percent-${index}"
            type="number"
            step="0.01"
            class="input"
            data-commission-input
            data-field="percent"
            data-index="${index}"
            value="${escapeHtml(percentValue)}" />
        </div>
        <div class="form-field compact">
          <label for="commission-fixed-${index}">Fixed (€)</label>
          <input
            id="commission-fixed-${index}"
            type="number"
            step="0.01"
            class="input"
            data-commission-input
            data-field="fixed"
            data-index="${index}"
            value="${escapeHtml(fixedValue)}" />
        </div>
        <div class="form-field checkbox-field">
          <label>
            <input
              type="checkbox"
              data-commission-input
              data-field="substractOtherDepostit"
              data-index="${index}"
              ${line.substractOtherDepostit ? "checked" : ""}
              ${isDeposit ? "" : "disabled"} />
            <span>Subtract other deposit fees</span>
          </label>
        </div>
        <button
          type="button"
          class="icon-button danger"
          data-action="delete-line"
          data-index="${index}"
          aria-label="Delete commission line">
          ×
        </button>
      </div>
    `;
  }

  function renderEditorSection() {
    const lines = panelState.commissionConfig;
    const listContent = lines.length
      ? lines.map(renderEditorRow).join("")
      : '<div class="commission-editor-empty">No commission lines yet. Add one to start distributing the deal value.</div>';

    const statusMessage = panelState.lastError
      ? `<p class="form-error">${escapeHtml(panelState.lastError)}</p>`
      : panelState.lastSavedAt
      ? `<p class="form-note">Last saved ${escapeHtml(
          formatTimestamp(panelState.lastSavedAt)
        )}</p>`
      : "";

    return `
      <section class="section-card editor-card">
        <div class="section-heading">
          <span class="section-title">Edit commission configuration</span>
          <span class="section-subtitle">Updates ${escapeHtml(
            COMMISSION_FIELD_NAME
          )} on this deal</span>
        </div>
        <div class="commission-editor-meta">
          <div class="meta-row">
            <span class="meta-label">Deal</span>
            <span class="meta-value">${escapeHtml(
              panelState.dealName || panelState.dealId || "Current deal"
            )}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Lines</span>
            <span class="meta-value">${lines.length}</span>
          </div>
        </div>
        <div class="commission-form-list">
          ${listContent}
        </div>
        <button type="button" class="button ghost" data-action="add-line">
          Add commission line
        </button>
        <div class="form-actions">
          <button
            type="button"
            class="button secondary"
            data-action="reset-lines"
            ${panelState.isDirty && !panelState.saving ? "" : "disabled"}>
            Discard changes
          </button>
          <button
            type="button"
            class="button primary"
            data-action="save-lines"
            ${panelState.isDirty && !panelState.saving ? "" : "disabled"}>
            ${panelState.saving ? "Saving…" : "Save changes"}
          </button>
        </div>
        ${statusMessage}
      </section>
    `;
  }

  function renderPanel() {
    if (!root) {
      return;
    }

    if (!panelState.ready) {
      root.innerHTML = `
        <div class="panel-stack">
          <section class="section-card">
            <div class="empty-state">Loading commission data…</div>
          </section>
        </div>
      `;
      return;
    }

    const sanitizedLines = getSanitizedLinesFromState();
    const calculations = calculateCommissions(
      sanitizedLines,
      panelState.dealValue,
      panelState.depositPercent
    );

    const metricsHTML = buildMetricsHTML(calculations);
    const commissionRows = buildCommissionRows(calculations);
    const commissionsHTML = commissionRows
      ? `<div class="commission-list">${commissionRows}</div>`
      : '<div class="empty-state">No commission configuration found</div>';

    const verificationClass = calculations.isValid ? "" : " error";
    const validationSummary = calculations.isValid
      ? "Matches deal value"
      : "Needs review";
    const totalCommissionsText = formatCurrency(calculations.totalCommissions);

    root.innerHTML = `
          <div class="panel-stack">
            <section class="section-card">
              <div class="metrics-grid">
                ${metricsHTML}
              </div>
            </section>

            <section class="section-card">
              <div class="section-heading">
                <span class="section-title">Commission distribution</span>
                <span class="section-subtitle">Auto-calculated from commission configuration</span>
              </div>
              ${commissionsHTML}
            </section>

            <div class="validation${verificationClass}">
              <span class="validation-label">Total commissions</span>
              <span class="validation-value">${totalCommissionsText} · ${validationSummary}</span>
            </div>

            ${renderEditorSection()}
          </div>
        `;
  }

  function generateLineId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function handleCommissionInput(event) {
    const target = event.target.closest("[data-commission-input]");
    if (!target || target.disabled) {
      return;
    }

    const index = Number(target.dataset.index);
    const field = target.dataset.field;

    if (!Number.isInteger(index) || !field) {
      return;
    }

    const value = target.type === "checkbox" ? target.checked : target.value;
    updateLineField(index, field, value);
  }

  function handleRootClick(event) {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget || actionTarget.disabled) {
      return;
    }

    const action = actionTarget.dataset.action;
    if (action === "add-line") {
      event.preventDefault();
      addNewLine();
      return;
    }

    if (action === "delete-line") {
      event.preventDefault();
      const index = Number(actionTarget.dataset.index);
      deleteLine(index);
      return;
    }

    if (action === "reset-lines") {
      event.preventDefault();
      resetLines();
      return;
    }

    if (action === "save-lines") {
      event.preventDefault();
      savePanelChanges();
      return;
    }
  }

  function updateLineField(index, field, rawValue) {
    if (
      !panelState.ready ||
      index < 0 ||
      index >= panelState.commissionConfig.length
    ) {
      return;
    }

    const nextLines = panelState.commissionConfig.slice();
    const currentLine = { ...nextLines[index] };

    if (field === "substractOtherDepostit") {
      currentLine.substractOtherDepostit = Boolean(rawValue);
    } else if (field === "appliesTo") {
      currentLine.appliesTo = rawValue === "deposit" ? "deposit" : "total";
      if (currentLine.appliesTo !== "deposit") {
        currentLine.substractOtherDepostit = false;
      }
    } else if (field === "percent" || field === "fixed") {
      currentLine[field] = String(rawValue ?? "").replace(/,/g, ".");
    } else {
      currentLine[field] = rawValue;
    }

    nextLines[index] = currentLine;
    panelState.commissionConfig = nextLines;
    updateDirtyFlag();
    renderPanel();
  }

  function addNewLine() {
    const newLine = {
      id: generateLineId(),
      name: "New commission",
      appliesTo: "total",
      percent: "0",
      fixed: "0",
      substractOtherDepostit: false,
    };

    panelState.commissionConfig = [...panelState.commissionConfig, newLine];
    updateDirtyFlag();
    renderPanel();
  }

  function deleteLine(index) {
    if (
      index < 0 ||
      index >= panelState.commissionConfig.length ||
      panelState.commissionConfig.length === 0
    ) {
      return;
    }

    const target = panelState.commissionConfig[index];
    const label = target?.name?.trim() || `Line ${index + 1}`;
    if (!window.confirm(`Delete "${label}"?`)) {
      return;
    }

    const nextLines = panelState.commissionConfig.slice();
    nextLines.splice(index, 1);
    panelState.commissionConfig = nextLines;
    updateDirtyFlag();
    renderPanel();
  }

  function resetLines() {
    const restored = createEditingLines(panelState.originalLines || []);
    panelState.commissionConfig = restored;
    panelState.lastError = null;
    panelState.isDirty = false;
    renderPanel();
  }

  async function savePanelChanges() {
    if (
      !panelState.ready ||
      !panelState.dealId ||
      panelState.saving ||
      !panelState.isDirty
    ) {
      return;
    }

    const sanitizedLines = getSanitizedLinesFromState();
    panelState.saving = true;
    panelState.lastError = null;
    renderPanel();

    try {
      const response = await fetch(
        `/api/deals/${encodeURIComponent(panelState.dealId)}/commission`,
        {
          method: "PUT",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            commissionConfig: sanitizedLines,
            depositPercent: panelState.depositPercent,
          }),
        }
      );

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 401) {
          panelState.saving = false;
          renderPanel();
          showAuthRequired(payload.loginUrl || payload.authorizeUrl);
          return;
        }
        throw new Error(
          payload.error ||
            `Failed to update commission configuration (HTTP ${response.status})`
        );
      }

      hydratePanelState({
        dealId: panelState.dealId,
        dealName: panelState.dealName,
        source: panelState.source,
        summary: payload?.summary,
        commissionConfig:
          payload?.summary?.commissionConfig ||
          payload?.deal?.[COMMISSION_FIELD_KEY] ||
          sanitizedLines,
        depositPercent:
          payload?.summary?.depositPercent ?? panelState.depositPercent,
        dealValue: payload?.summary?.dealValue ?? panelState.dealValue,
      });

      panelState.lastSavedAt = new Date().toISOString();
      panelState.saving = false;
      renderPanel();
    } catch (error) {
      console.error("Failed to save commission configuration", error);
      panelState.saving = false;
      panelState.lastError = error.message || "Unable to save changes";
      renderPanel();
    }
  }

  function showResult(result) {
    hydratePanelState(result);
    renderPanel();
  }

  function showError(message) {
    root.innerHTML = `
          <h1 class="error">Unable to load commissions</h1>
          <p>${escapeHtml(message)}</p>
          <p class="tips">Confirm this iframe is rendered inside a Deal panel.</p>
        `;
  }

  function showAuthRequired(authUrl) {
    const authorizeUrl = escapeHtml(authUrl || "/auth/pipedrive");

    root.innerHTML = `
          <h1>Connect Autobuilders Commissions</h1>
          <p>We need permission to read and update the commission configuration on this deal.</p>
          <p class="tips">Open the authorization flow, grant access, then reload this panel.</p>
          <p>
            <a
              href="${authorizeUrl}"
              target="_blank"
              rel="noreferrer"
              style="display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;margin-top:12px;border-radius:999px;background:#1f2027;color:#ffffff;font-weight:600;text-decoration:none;"
            >Authorize app</a>
          </p>
        `;
  }

  async function fetchCommissionSummary(dealId) {
    const response = await fetch(
      `/api/deals/${encodeURIComponent(dealId)}/commission`,
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    const payload = await response.json().catch(() => ({}));

    console.log("=== API Response Debug ===");
    console.log("Response status:", response.status);
    console.log("Response OK:", response.ok);
    console.log("Full payload from API:", payload);
    console.log("payload.summary:", payload.summary);
    console.log("payload.deal:", payload.deal);
    console.log("=========================");

    if (!response.ok) {
      const error = new Error(
        payload.error ||
          `Failed to load commission configuration (HTTP ${response.status})`
      );
      error.status = response.status;
      error.payload = payload;
      error.authUrl =
        payload.loginUrl || payload.authorizeUrl || "/auth/pipedrive";
      throw error;
    }

    return payload;
  }

  async function renderDealFromApi(
    dealId,
    detectionSource,
    fallbackField,
    fallbackFieldSource,
    fallbackDealName
  ) {
    try {
      const payload = await fetchCommissionSummary(dealId);
      const dealName =
        payload?.deal?.title || payload?.deal?.name || fallbackDealName || null;

      // Extract the three key fields from payload.deal
      const commissionConfig = payload?.deal?.[COMMISSION_FIELD_KEY] || null;
      const depositPercent = payload?.deal?.[DEPOSIT_PERCENT_FIELD_KEY] || null;
      const dealValue = payload?.deal?.value || null;

      showResult({
        dealId,
        source: detectionSource,
        dealName,
        summary: payload?.summary || null,
        commissionConfig,
        depositPercent,
        dealValue,
      });
    } catch (error) {
      console.error("Failed to fetch commission summary", error);

      if (error.status === 401) {
        showAuthRequired(error.authUrl);
        return;
      }

      if (fallbackField !== null && fallbackField !== undefined) {
        showResult({
          dealId,
          source: detectionSource,
          fieldValue: fallbackField,
          fieldSource: fallbackFieldSource,
          dealName: fallbackDealName,
        });
        return;
      }

      showError(error.message || "Unable to load commission data");
    }
  }

  async function initialize() {
    const fallbackId = coerceId(getDealIdFromQuery());
    const fallbackName = getDealNameFromQuery();

    if (!window.AppExtensionsSDK) {
      if (fallbackId) {
        showResult({
          dealId: fallbackId,
          source: "query string",
          fieldValue: null,
          fieldSource: null,
          dealName: fallbackName,
        });
        return;
      }
      showError("Pipedrive SDK is not available.");
      return;
    }

    const sdk = new window.AppExtensionsSDK();
    let context = null;

    try {
      const initResult = await sdk.initialize();
      if (initResult && typeof initResult === "object") {
        context = initResult.context || initResult.data || initResult;
      }
    } catch (error) {
      console.warn("Pipedrive SDK initialize failed", error);
    }

    if (!context && typeof sdk.getContext === "function") {
      try {
        context = await sdk.getContext();
      } catch (error) {
        console.warn("sdk.getContext() failed", error);
      }
    }

    if (!context && sdk.context && typeof sdk.context === "object") {
      context = sdk.context;
    }

    const dealIdFromContext = coerceId(extractDealId(context));
    const dealId = dealIdFromContext || fallbackId;
    const { value: fieldValue, source: fieldSource } = extractCustomField(
      context,
      COMMISSION_FIELD_KEY
    );
    const dealNameFromContext = extractDealName(context);
    const dealName = dealNameFromContext || fallbackName || null;

    if (dealId) {
      await renderDealFromApi(
        dealId,
        dealIdFromContext ? "Pipedrive context" : "query string",
        fieldValue,
        fieldSource,
        dealName
      );
      return;
    }

    showError("No deal ID found in SDK context or query parameters.");
  }

  initialize();
})();
