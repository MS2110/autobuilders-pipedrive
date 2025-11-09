# Autobuilders Commissions – Clean Slate

This repository has been reset to the smallest possible Express app that satisfies the Pipedrive Custom UI requirement. The only thing it does right now is serve a deal panel page that handshakes with the App Extensions SDK.

Use this as a fresh starting point to rebuild the commissions experience.

## What is running?

- `GET /` → plain text health response so you can confirm the Render instance is alive.
- `GET /extension/deal` → lightweight HTML file that loads the Pipedrive App Extensions SDK and prints the current deal ID once the handshake completes.
- Static assets are served from `public/` (only `extension-deal.html` today).

## Local development

1. `npm install`
2. `npm run dev`
3. Visit `http://localhost:3000/extension/deal`

When you hit the URL directly you will see a loading screen forever because Pipedrive is not present. Inside the CRM it will resolve to "Commissions panel ready" plus the deal ID.

## Deploying to Render

- Build command: `npm install`
- Start command: `npm start`
- No environment variables are required yet.

## Wiring up the Pipedrive panel

In Developer Hub → App extensions → Deal detail view:

1. Point the panel URL to `https://<your-service>.onrender.com/extension/deal`.
2. Save.
3. Refresh a deal in Pipedrive.

If everything is set correctly the iframe will stop showing "Error loading iframe" and the console noise about cross-domain access becomes harmless warnings.

From here you can incrementally add API endpoints, OAuth, and the full commission editor without carrying over the previous large codebase.
