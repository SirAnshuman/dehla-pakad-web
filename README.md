# Dehla Pakad Web

A small first milestone for the multiplayer Dehla Pakad project.

## What works

- Create a lobby with a five-character invite code.
- Join an existing lobby by code.
- Auto-assign up to four players to seats.
- Move between open seats.
- Mark yourself ready or unready.
- Receive live lobby updates through Server-Sent Events.

## Run locally

```powershell
node server.js
```

Then open:

```text
http://localhost:4173
```

## Current architecture

- `server.js` owns lobby state and exposes HTTP/SSE endpoints.
- `public/index.html` contains the app shell.
- `public/app.js` sends player intents and renders server-confirmed lobby state.
- `public/styles.css` handles the table-first UI.

Lobby state is in-memory. That is deliberate for now: it keeps iteration fast while we are still discovering the exact game/session model. Persistence should come after the lobby and game engine contracts are clearer.

## LiveKit voice chat

Create a LiveKit Cloud project, then start the server with these environment variables:

```powershell
$env:LIVEKIT_URL="wss://your-project.livekit.cloud"
$env:LIVEKIT_API_KEY="your-api-key"
$env:LIVEKIT_API_SECRET="your-api-secret"
node server.js
```

The API secret stays on the server and is used to create short-lived, microphone-only room tokens. Mobile microphone access requires the app to be served over HTTPS.

## Deploy on Koyeb

1. Push this directory to a GitHub repository.
2. In Koyeb, create a Web Service from that repository and keep the Node.js buildpack defaults.
3. Set the health check path to `/api/health`.
4. Add `LIVEKIT_URL` as an environment variable.
5. Create Koyeb Secrets for `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`, then expose them to the service with the same environment variable names.
6. Deploy. Koyeb supplies `PORT` automatically and `npm start` launches the server.

Use a single service instance while lobby state remains in memory. Multiple instances would not share games or SSE connections until lobby state moves to a shared store such as Redis.

## Next likely milestone

Add a minimal game-room transition once all four players are ready, then introduce a pure game engine package with tests before any real card play reaches the UI.
