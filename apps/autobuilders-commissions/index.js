const express = require("express");
const path = require("path");
const passport = require("passport");
const { Strategy } = require("passport-oauth2");

const api = require("./api");
const config = require("./config");
const User = require("./db/user");

User.createTable();

const app = express();

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

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(passport.initialize());
app.use(async (req, res, next) => {
  req.user = await User.getById(1);
  next();
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
  const randomBoolean = Math.random() >= 0.5;
  const outcome = randomBoolean === true ? "won" : "lost";

  try {
    await api.updateDeal(req.params.id, outcome, req.user[0].access_token);

    res.render("outcome", { outcome });
  } catch (error) {
    console.log(error);

    return res.send("Failed to update the deal");
  }
});

// Extension route for deal panel
app.get("/extension/deal", async (req, res) => {
  res.render("commission-panel", {
    layout: false,
  });
});

// API endpoint to calculate commissions
app.post("/api/calculate-commission", async (req, res) => {
  try {
    console.log("=== Calculate Commission Request ===");
    console.log("Body:", req.body);
    console.log("User:", req.user);

    const { dealId, selectedUserId } = req.body;

    if (!dealId || !selectedUserId) {
      console.log("Missing dealId or selectedUserId");
      return res
        .status(400)
        .json({ error: "Missing dealId or selectedUserId" });
    }

    if (!req.user || req.user.length < 1 || !req.user[0].access_token) {
      console.log("No authenticated user found");
      return res.status(401).json({ error: "Not authenticated" });
    }

    console.log("Fetching deal:", dealId);
    const deal = await api.getDealById(dealId, req.user[0].access_token);
    console.log("Deal response:", deal);

    if (!deal.success) {
      console.log("Deal not found");
      return res.status(404).json({ error: "Deal not found" });
    }

    const dealData = deal.data;
    const dealValue = dealData.value || 0;

    console.log("Deal value:", dealValue);
    console.log("Deal data keys:", Object.keys(dealData));

    // Get commission config from custom field
    let commissionConfig = [];
    if (dealData.commission_config_json) {
      try {
        commissionConfig = JSON.parse(dealData.commission_config_json);
        console.log("Commission config loaded:", commissionConfig);
      } catch (e) {
        console.log("Failed to parse commission config:", e.message);
        commissionConfig = [];
      }
    } else {
      console.log("No commission_config_json field found");
    }

    // Get deposit percentage (assuming it's a custom field)
    const depositPercent = dealData.deposit_percent || 0;
    const depositAmount = (dealValue * depositPercent) / 100;
    const remainingAmount = dealValue - depositAmount;

    console.log("Deposit percent:", depositPercent);

    // Calculate commissions for each party
    const calculations = commissionConfig.map((party) => {
      const baseAmount =
        party.appliesTo === "deposit" ? depositAmount : dealValue;
      const percentAmount = (baseAmount * party.percent) / 100;
      const total = percentAmount + party.fixed;

      return {
        name: party.name,
        percent: party.percent,
        fixed: party.fixed,
        appliesTo: party.appliesTo,
        baseAmount: baseAmount,
        percentAmount: percentAmount,
        total: total,
      };
    });

    console.log("Calculations:", calculations);

    res.json({
      success: true,
      dealValue: dealValue,
      depositPercent: depositPercent,
      depositAmount: depositAmount,
      remainingAmount: remainingAmount,
      calculations: calculations,
      commissionConfig: commissionConfig,
    });
  } catch (error) {
    console.error("Error calculating commission:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      error: "Failed to calculate commission",
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
