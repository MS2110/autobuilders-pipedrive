const express = require("express");
const path = require("path");
const fs = require("fs");
const passport = require("passport");
const { Strategy } = require("passport-oauth2");

const api = require("./api");
const config = require("./config");
const User = require("./db/user");

User.createTable();

const app = express();

const DEFAULT_COMMISSION_LINES = [
  {
    id: "partner-primary",
    name: "Partner A",
    percent: 65,
    fixed: 0,
    appliesTo: "total",
  },
  {
    id: "partner-secondary",
    name: "Partner B",
    percent: 35,
    fixed: 0,
    appliesTo: "total",
  },
];

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function sanitizeCommissionConfig(rawConfig) {
  if (!Array.isArray(rawConfig)) {
    return [];
  }

  return rawConfig
    .map((entry, index) => {
      if (!entry) {
        return null;
      }

      const name = typeof entry.name === "string" ? entry.name.trim() : "";

      return {
        id: entry.id || `line-${index + 1}`,
        name: name || `Line ${index + 1}`,
        appliesTo:
          entry.appliesTo === "deposit"
            ? "deposit"
            : entry.appliesTo === "remaining"
            ? "remaining"
            : "total",
        percent: Number(entry.percent) || 0,
        fixed: Number(entry.fixed) || 0,
      };
    })
    .filter(Boolean);
}

function ensureCommissionConfig(config) {
  const cleaned = sanitizeCommissionConfig(config);
  return cleaned.length > 0 ? cleaned : DEFAULT_COMMISSION_LINES;
}

function calculateCommissionSummary(
  dealValueInput,
  depositPercentInput,
  configInput
) {
  const dealValue = roundCurrency(dealValueInput);
  const depositPercentRaw = Number(depositPercentInput) || 0;
  const depositPercent = Math.min(Math.max(depositPercentRaw, 0), 100);
  const commissionConfig = ensureCommissionConfig(configInput);

  const depositAmount = roundCurrency((dealValue * depositPercent) / 100);
  const remainingAmount = roundCurrency(dealValue - depositAmount);

  let totalDisbursed = 0;

  const lines = commissionConfig.map((entry) => {
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
    commissionConfig,
    lines,
  };
}

function getAuthenticatedUser(req) {
  if (!req.user) {
    return null;
  }

  const stored = Array.isArray(req.user) ? req.user[0] : req.user;

  if (!stored || !stored.access_token) {
    return null;
  }

  return stored;
}

function decodePanelContext(contextParam) {
  if (!contextParam) {
    return null;
  }

  try {
    const decoded = Buffer.from(contextParam, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch (error) {
    console.warn("Failed to decode panel context", error.message);
    return null;
  }
}

function toSafeScriptValue(value) {
  return JSON.stringify(value || null).replace(/</g, "\\u003c");
}

function parseSelectedIds(raw) {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw.map((value) => String(value || "").trim()).filter(Boolean);
  }

  return String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

passport.use(
  "pipedrive",
  new Strategy(
    {
      authorizationURL: "https://oauth.pipedrive.com/oauth/authorize",
      tokenURL: "https://oauth.pipedrive.com/oauth/token",
      clientID: config.clientID || "",
      clientSecret: config.clientSecret || "",
      callbackURL: config.callbackURL || "",
    },
    async (accessToken, refreshToken, profile, done) => {
      const userInfo = await api.getUser(accessToken);
      const user = await User.add(
        userInfo.data.name,
        accessToken,
        refreshToken
      );

      done(null, user);
    }
  )
);

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "hbs");

// Add headers to allow iframe embedding and CORS
app.use((req, res, next) => {
  // Allow Pipedrive to embed this app in an iframe
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");

  // Allow CORS for Pipedrive domains
  const origin = req.headers.origin;
  if (origin && origin.includes("pipedrive.com")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
  }

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// Block access to server files through static middleware
app.use((req, res, next) => {
  // Prevent serving any .js files from the root directory (like index.js, config.js, api.js)
  if (req.path.match(/^\/(index|config|api)\.js$/)) {
    return res.status(404).send("Not found");
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(passport.initialize());
app.use(async (req, res, next) => {
  req.user = await User.getById(1);
  next();
});

app.get("/vendor/app-extensions-sdk.js", (req, res, next) => {
  const sdkFilePath = path.join(
    __dirname,
    "node_modules",
    "@pipedrive",
    "app-extensions-sdk",
    "dist",
    "index.umd.js"
  );

  fs.promises
    .access(sdkFilePath, fs.constants.R_OK)
    .then(() => {
      res.type("application/javascript");
      res.sendFile(sdkFilePath);
    })
    .catch((error) => {
      console.error("Failed to serve App Extensions SDK", error.message);
      res
        .status(503)
        .send(
          "App Extensions SDK is not available. Run `npm install` to download dependencies."
        );
    });
});

// Remove this section on Glitch

app.get("/auth/pipedrive", passport.authenticate("pipedrive"));
app.get(
  "/auth/pipedrive/callback",
  passport.authenticate("pipedrive", {
    session: false,
    failureRedirect: "/",
    successRedirect: "/",
  })
);
app.get("/", async (req, res) => {
  if (req.user.length < 1) {
    return res.redirect("/auth/pipedrive");
  }

  try {
    const deals = await api.getDeals(req.user[0].access_token);

    res.render("deals", {
      name: req.user[0].username,
      deals: deals.data,
    });
  } catch (error) {
    console.log(error);

    return res.send("Failed to get deals");
  }
});
app.get("/deals/:id", async (req, res) => {
  // Set headers for iframe embedding
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");

  res.render("commission-panel", {
    layout: false,
    panelProps: toSafeScriptValue({
      dealId: req.params.id,
      context: null,
    }),
  });
});

// Extension route for deal panel (used by Pipedrive)
app.get("/extension/deal", async (req, res) => {
  // Set headers for iframe embedding
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");

  const decodedContext = decodePanelContext(req.query.context);
  const selectedIdsFromQuery = parseSelectedIds(req.query.selectedIds);

  const contextEntity = decodedContext && decodedContext.entity;
  const contextSelectedIds = Array.isArray(decodedContext?.selectedIds)
    ? decodedContext.selectedIds
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];

  const selectedDealId = (() => {
    if (req.query.dealId) {
      return String(req.query.dealId);
    }

    if (selectedIdsFromQuery.length > 0) {
      return selectedIdsFromQuery[0];
    }

    if (contextSelectedIds.length > 0) {
      return contextSelectedIds[0];
    }

    if (contextEntity && contextEntity.id) {
      return String(contextEntity.id);
    }

    return "";
  })();

  res.render("commission-panel", {
    layout: false,
    panelProps: toSafeScriptValue({
      dealId: selectedDealId,
      context: decodedContext,
      selectedIds: selectedIdsFromQuery,
      query: {
        resource: req.query.resource || null,
        view: req.query.view || null,
        userId: req.query.userId || null,
        companyId: req.query.companyId || null,
        theme: req.query.theme || null,
      },
    }),
  });
});

// API endpoint to calculate commissions
app.post("/api/calculate-commission", async (req, res) => {
  try {
    const { dealValue, depositPercent, commissionConfig } = req.body || {};

    const summary = calculateCommissionSummary(
      dealValue,
      depositPercent,
      commissionConfig
    );

    res.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error("Error calculating commission:", error);
    res.status(500).json({
      error: "Failed to calculate commission",
      details: error.message,
    });
  }
});

app.get("/api/deals/:dealId/commission", async (req, res) => {
  try {
    const user = getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const dealId = req.params.dealId;
    const dealResponse = await api.getDealById(dealId, user.access_token);

    if (!dealResponse.success) {
      return res.status(404).json({ error: "Deal not found" });
    }

    const deal = dealResponse.data;
    const parsedConfig = (() => {
      if (!deal.commission_config_json) {
        return [];
      }

      try {
        return JSON.parse(deal.commission_config_json);
      } catch (error) {
        console.warn("Failed to parse commission_config_json", error.message);
        return [];
      }
    })();

    const summary = calculateCommissionSummary(
      deal.value || 0,
      deal.deposit_percent || 0,
      parsedConfig
    );

    res.json({
      success: true,
      deal: {
        id: deal.id,
        title: deal.title,
        value: summary.dealValue,
        currency: deal.currency || "EUR",
        visibleDealUrl: deal.public_link || deal.url || null,
      },
      summary,
    });
  } catch (error) {
    console.error("Error loading commission data:", error);
    res.status(500).json({
      error: "Failed to load commission data",
      details: error.message,
    });
  }
});

app.put("/api/deals/:dealId/commission", async (req, res) => {
  try {
    const user = getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const dealId = req.params.dealId;
    const { commissionConfig, depositPercent } = req.body || {};

    const sanitizedConfig = ensureCommissionConfig(commissionConfig);
    const dealResponse = await api.getDealById(dealId, user.access_token);

    if (!dealResponse.success) {
      return res.status(404).json({ error: "Deal not found" });
    }

    const deal = dealResponse.data;
    const summary = calculateCommissionSummary(
      deal.value || 0,
      depositPercent,
      sanitizedConfig
    );

    if (!summary.matchesDealValue) {
      return res.status(422).json({
        error: "Commission totals do not match deal value",
        summary,
      });
    }

    await api.updateDealFields(
      dealId,
      {
        commission_config_json: JSON.stringify(sanitizedConfig),
        deposit_percent: summary.depositPercent,
      },
      user.access_token
    );

    const refreshedResponse = await api.getDealById(dealId, user.access_token);

    if (!refreshedResponse.success) {
      return res.status(200).json({
        success: true,
        message: "Saved, but failed to reload deal",
        summary,
      });
    }

    const refreshedDeal = refreshedResponse.data;
    const refreshedSummary = calculateCommissionSummary(
      refreshedDeal.value || summary.dealValue,
      refreshedDeal.deposit_percent || summary.depositPercent,
      sanitizedConfig
    );

    res.json({
      success: true,
      message: "Commission settings saved",
      summary: refreshedSummary,
    });
  } catch (error) {
    console.error("Error saving commission data:", error);
    res.status(500).json({
      error: "Failed to save commission data",
      details: error.message,
    });
  }
});

// End of section to remove on Glitch

app.listen(process.env.PORT, () =>
  console.log(`App listening on port ${process.env.PORT}`)
);

if (process.env.IS_LOCAL === "true") {
  console.log(
    `🟢 App has started. \n🔗 Development URL: http://localhost:3000`
  );
} else {
  console.log(
    `🟢 App has started. \n🔗 Live URL: https://${process.env.PROJECT_DOMAIN}.glitch.me`
  );
}
