const express = require("express");
const path = require("path");
const app = express();

const PORT = Number(process.env.PORT) || 3000;

// Allow the page to be embedded as a Pipedrive deal panel.
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  next();
});

app.get("/", (req, res) => {
  res
    .type("text/plain")
    .send("Autobuilders Commissions extension stub is running.");
});

app.get("/extension/deal", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "extension-deal.html"));
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Autobuilders Commissions extension listening on port ${PORT}`);
});
