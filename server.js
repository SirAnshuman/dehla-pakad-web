const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createDehlaState, resolveDehlaTrick } = require("./dehla-rules");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const LOBBY_CODE_LENGTH = 5;
const MAX_PLAYERS = 4;
const TRICK_REVEAL_MS = 5_000;
const LIVEKIT_CLIENT_PATH = path.join(__dirname, "node_modules", "livekit-client", "dist", "livekit-client.umd.js");
const SUITS = ["S", "H", "D", "C"];
const RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUIT_LABELS = {
  S: "Spades",
  H: "Hearts",
  D: "Diamonds",
  C: "Clubs",
};
const RANK_VALUE = new Map(RANKS.map((rank, index) => [rank, RANKS.length - index]));

const lobbies = new Map();
const streamsByLobby = new Map();

function createId() {
  return crypto.randomUUID();
}

function createLobbyCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";
    for (let index = 0; index < LOBBY_CODE_LENGTH; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    if (!lobbies.has(code)) {
      return code;
    }
  }

  throw new Error("Could not allocate a unique lobby code.");
}

function sanitizeName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  return name.slice(0, 24) || "Player";
}

function teamForSeat(seatIndex) {
  return seatIndex === 0 || seatIndex === 2 ? "Satoris" : "Khiladis";
}

function teamForPlayer(lobby, playerId) {
  const seat = lobby.seats.find((candidate) => candidate.playerId === playerId);
  return seat ? seat.team : null;
}

function emptySeats() {
  return Array.from({ length: MAX_PLAYERS }, (_, index) => ({
    index,
    label: ["North", "East", "South", "West"][index],
    team: teamForSeat(index),
    playerId: null,
  }));
}

function createDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({
    id: `${suit}${rank}`,
    suit,
    suitLabel: SUIT_LABELS[suit],
    rank,
  })));
}

function shuffle(cards) {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function sortCards(cards) {
  return [...cards].sort((left, right) => {
    const suitDelta = SUITS.indexOf(left.suit) - SUITS.indexOf(right.suit);
    if (suitDelta !== 0) {
      return suitDelta;
    }
    return RANKS.indexOf(left.rank) - RANKS.indexOf(right.rank);
  });
}

function seatedPlayerIds(lobby) {
  return lobby.seats.map((seat) => seat.playerId).filter(Boolean);
}

function nextPlayerId(lobby, playerId) {
  const order = seatedPlayerIds(lobby);
  const currentIndex = order.indexOf(playerId);
  return order[(currentIndex + 1) % order.length];
}

function legalCardsFor(match, playerId) {
  const hand = match.hands[playerId] || [];
  if (match.status !== "playing" || match.currentTurnPlayerId !== playerId) {
    return [];
  }
  if (!match.leadSuit) {
    return sortCards(hand);
  }

  const followSuitCards = hand.filter((card) => card.suit === match.leadSuit);
  return sortCards(followSuitCards.length > 0 ? followSuitCards : hand);
}

function playerName(lobby, playerId) {
  return lobby.players.find((player) => player.id === playerId)?.name || "Player";
}

function buildRoundResult(lobby, match) {
  const counts = {
    Satoris: match.dehla.captured.Satoris.length,
    Khiladis: match.dehla.captured.Khiladis.length,
  };
  const isDraw = counts.Satoris === counts.Khiladis;
  const winningTeam = isDraw ? null : counts.Satoris > counts.Khiladis ? "Satoris" : "Khiladis";
  const playerNames = winningTeam
    ? lobby.seats
      .filter((seat) => seat.team === winningTeam)
      .map((seat) => playerName(lobby, seat.playerId))
    : [];

  return {
    isDraw,
    winningTeam,
    playerNames,
    dehlaCount: winningTeam ? counts[winningTeam] : 2,
    capturedCounts: counts,
  };
}

function publicMatch(lobby, viewerId) {
  if (!lobby.match) {
    return null;
  }

  const hand = sortCards(lobby.match.hands[viewerId] || []);
  return {
    id: lobby.match.id,
    status: lobby.match.status,
    currentTurnPlayerId: lobby.match.currentTurnPlayerId,
    currentTurnPlayerName: playerName(lobby, lobby.match.currentTurnPlayerId),
    leadSuit: lobby.match.leadSuit,
    trumpSuit: lobby.match.trumpSuit,
    trickNumber: lobby.match.trickNumber,
    isRevealingTrick: Boolean(lobby.match.isRevealingTrick),
    currentTrick: lobby.match.currentTrick.map((play) => ({
      playerId: play.playerId,
      playerName: playerName(lobby, play.playerId),
      card: play.card,
    })),
    hand,
    legalCardIds: legalCardsFor(lobby.match, viewerId).map((card) => card.id),
    dehla: {
      pending: lobby.match.dehla.pending,
      opportunityTeam: lobby.match.dehla.opportunityTeam,
      capturedCounts: {
        Satoris: lobby.match.dehla.captured.Satoris.length,
        Khiladis: lobby.match.dehla.captured.Khiladis.length,
      },
      captured: {
        Satoris: lobby.match.dehla.captured.Satoris,
        Khiladis: lobby.match.dehla.captured.Khiladis,
      },
    },
    lastTrick: lobby.match.lastTrick ? {
      number: lobby.match.lastTrick.number,
      winnerPlayerId: lobby.match.lastTrick.winnerPlayerId,
      winnerPlayerName: playerName(lobby, lobby.match.lastTrick.winnerPlayerId),
      winnerTeam: lobby.match.lastTrick.winnerTeam,
    } : null,
    result: lobby.match.result,
    events: lobby.match.events,
  };
}

function publicLobby(lobby, viewerId = null) {
  return {
    code: lobby.code,
    hostId: lobby.hostId,
    createdAt: lobby.createdAt,
    players: lobby.players,
    seats: lobby.seats,
    status: lobby.status,
    match: publicMatch(lobby, viewerId),
  };
}

function addPlayerToLobby(lobby, playerName, existingPlayerId) {
  const reusablePlayer = existingPlayerId ? lobby.players.find((player) => player.id === existingPlayerId) : null;
  if (reusablePlayer) {
    reusablePlayer.name = sanitizeName(playerName) || reusablePlayer.name;
    reusablePlayer.connected = true;
    reusablePlayer.lastSeenAt = new Date().toISOString();
    return reusablePlayer;
  }

  if (lobby.players.length >= MAX_PLAYERS) {
    throw httpError(409, "This lobby is already full.");
  }

  const player = {
    id: createId(),
    name: sanitizeName(playerName),
    ready: false,
    connected: true,
    joinedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };

  lobby.players.push(player);
  const openSeat = lobby.seats.find((seat) => seat.playerId === null);
  if (openSeat) {
    openSeat.playerId = player.id;
  }

  return player;
}

function updateLobbyStatus(lobby) {
  if (lobby.match?.status === "playing") {
    lobby.status = "playing";
    return;
  }

  const readyToStart = lobby.players.length === MAX_PLAYERS
    && lobby.players.every((candidate) => candidate.ready)
    && seatedPlayerIds(lobby).length === MAX_PLAYERS;

  if (readyToStart) {
    startMatch(lobby);
    return;
  }

  lobby.status = "waiting";
}

function startMatch(lobby) {
  const playerIds = seatedPlayerIds(lobby);
  const deck = shuffle(createDeck());
  const hands = Object.fromEntries(playerIds.map((playerId) => [playerId, []]));

  deck.forEach((card, index) => {
    hands[playerIds[index % playerIds.length]].push(card);
  });

  const firstPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
  lobby.match = {
    id: createId(),
    status: "playing",
    hands,
    currentTurnPlayerId: firstPlayerId,
    leadSuit: null,
    trumpSuit: null,
    currentTrick: [],
    trickNumber: 1,
    isRevealingTrick: false,
    dehla: createDehlaState(),
    lastTrick: null,
    result: null,
    events: [],
  };
  lobby.status = "playing";
}

function removePlayerFromLobby(lobby, playerId) {
  const playerIndex = lobby.players.findIndex((player) => player.id === playerId);
  if (playerIndex === -1) {
    throw httpError(403, "You are not in this lobby.");
  }

  lobby.players.splice(playerIndex, 1);

  for (const seat of lobby.seats) {
    if (seat.playerId === playerId) {
      seat.playerId = null;
    }
  }

  if (lobby.hostId === playerId) {
    lobby.hostId = lobby.players[0]?.id || null;
  }

  if (lobby.match) {
    lobby.match = null;
    for (const player of lobby.players) {
      player.ready = false;
    }
  }

  updateLobbyStatus(lobby);
}

function broadcastLobby(lobby) {
  const streams = streamsByLobby.get(lobby.code);
  if (!streams) {
    return;
  }

  for (const stream of streams) {
    const payload = `event: lobby\ndata: ${JSON.stringify(publicLobby(lobby, stream.playerId))}\n\n`;
    stream.response.write(payload);
  }
}

function cardBeats(card, winningCard, leadSuit, trumpSuit) {
  if (!winningCard) {
    return true;
  }

  if (trumpSuit) {
    if (card.suit === trumpSuit && winningCard.suit !== trumpSuit) {
      return true;
    }
    if (card.suit !== trumpSuit && winningCard.suit === trumpSuit) {
      return false;
    }
    if (card.suit === trumpSuit && winningCard.suit === trumpSuit) {
      return RANK_VALUE.get(card.rank) > RANK_VALUE.get(winningCard.rank);
    }
  }

  if (card.suit !== leadSuit) {
    return false;
  }
  if (winningCard.suit !== leadSuit) {
    return true;
  }
  return RANK_VALUE.get(card.rank) > RANK_VALUE.get(winningCard.rank);
}

function winningPlay(match) {
  return match.currentTrick.reduce((winner, play) => (
    cardBeats(play.card, winner?.card, match.leadSuit, match.trumpSuit) ? play : winner
  ), null);
}

function addMatchEvent(match, type, details = {}) {
  match.events.push({
    id: createId(),
    type,
    createdAt: Date.now(),
    ...details,
  });
  match.events = match.events.slice(-8);
}

function finishTrickReveal(lobby, matchId) {
  const match = lobby.match;
  if (!match || match.id !== matchId || !match.isRevealingTrick || !match.lastTrick) {
    return;
  }

  const noCardsLeft = Object.values(match.hands).every((playerHand) => playerHand.length === 0);
  const allDehlasCaptured = match.dehla.captured.Satoris.length + match.dehla.captured.Khiladis.length === 4;
  match.currentTrick = [];
  match.leadSuit = null;
  match.trickNumber += 1;
  match.isRevealingTrick = false;

  if (noCardsLeft || allDehlasCaptured) {
    match.status = "complete";
    match.currentTurnPlayerId = null;
    match.result = buildRoundResult(lobby, match);
    lobby.status = "complete";
  } else {
    match.currentTurnPlayerId = match.lastTrick.winnerPlayerId;
  }

  broadcastLobby(lobby);
}

function playCard(lobby, playerId, cardId) {
  const match = lobby.match;
  if (!match || match.status !== "playing") {
    throw httpError(409, "The match has not started.");
  }
  if (match.currentTurnPlayerId !== playerId) {
    throw httpError(409, "It is not your turn.");
  }

  const hand = match.hands[playerId] || [];
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex === -1) {
    throw httpError(400, "That card is not in your hand.");
  }

  const legalCardIds = new Set(legalCardsFor(match, playerId).map((card) => card.id));
  if (!legalCardIds.has(cardId)) {
    throw httpError(400, "You must follow suit if you can.");
  }

  const [card] = hand.splice(cardIndex, 1);
  if (!match.leadSuit) {
    match.leadSuit = card.suit;
  } else if (!match.trumpSuit && card.suit !== match.leadSuit) {
    match.trumpSuit = card.suit;
    addMatchEvent(match, "trump-opened", { suit: card.suit });
  }

  match.currentTrick.push({ playerId, card });
  addMatchEvent(match, "card-played", {
    soundVariant: Math.floor(Math.random() * 20),
  });
  if (card.rank === "10") {
    addMatchEvent(match, "dehla-entered", { suit: card.suit });
  }

  if (match.currentTrick.length < MAX_PLAYERS) {
    match.currentTurnPlayerId = nextPlayerId(lobby, playerId);
    return;
  }

  const winner = winningPlay(match);
  const noCardsLeft = Object.values(match.hands).every((playerHand) => playerHand.length === 0);
  const winnerTeam = teamForPlayer(lobby, winner.playerId);
  const capturedBefore = match.dehla.captured.Satoris.length + match.dehla.captured.Khiladis.length;
  match.dehla = resolveDehlaTrick(match.dehla, {
    cards: match.currentTrick.map((play) => play.card),
    winnerTeam,
    isFinalTrick: noCardsLeft,
  });
  const capturedAfter = match.dehla.captured.Satoris.length + match.dehla.captured.Khiladis.length;
  if (capturedAfter > capturedBefore) {
    addMatchEvent(match, "dehlas-covered", {
      count: capturedAfter - capturedBefore,
      team: winnerTeam,
    });
  }
  match.lastTrick = {
    number: match.trickNumber,
    winnerPlayerId: winner.playerId,
    winnerTeam,
  };
  match.currentTurnPlayerId = null;
  match.isRevealingTrick = true;
  setTimeout(() => finishTrickReveal(lobby, match.id), TRICK_REVEAL_MS);
}

function returnMatchToLobby(lobby, playerId) {
  if (!lobby.players.some((player) => player.id === playerId)) {
    throw httpError(403, "You are not in this lobby.");
  }
  if (!lobby.match || lobby.match.status !== "complete") {
    throw httpError(409, "The round is not complete yet.");
  }

  lobby.match = null;
  lobby.status = "waiting";
  for (const player of lobby.players) {
    player.ready = false;
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getLobbyOrThrow(code) {
  const lobby = lobbies.get(String(code || "").toUpperCase());
  if (!lobby) {
    throw httpError(404, "Lobby not found.");
  }
  return lobby;
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16_384) {
        request.destroy();
        reject(httpError(413, "Request body is too large."));
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(httpError(400, "Invalid JSON body."));
      }
    });
  });
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function sendError(response, error) {
  const status = error.status || 500;
  const message = status === 500 ? "Something went wrong." : error.message;
  sendJson(response, status, { error: message });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  };

  return types[ext] || "application/octet-stream";
}

function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  if (requestUrl.pathname === "/vendor/livekit-client.js") {
    fs.readFile(LIVEKIT_CLIENT_PATH, (error, contents) => {
      if (error) {
        response.writeHead(404);
        response.end("LiveKit client not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      });
      response.end(contents);
    });
    return;
  }
  const requestedPath = decodeURIComponent(requestUrl.pathname);
  const safePath = requestedPath === "/" ? "/index.html" : requestedPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallbackContents) => {
        if (fallbackError) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(fallbackContents);
      });
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": "no-store",
    });
    response.end(contents);
  });
}

async function handleApi(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const parts = requestUrl.pathname.split("/").filter(Boolean);

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/lobbies") {
    const body = await parseBody(request);
    const code = createLobbyCode();
    const lobby = {
      code,
      hostId: null,
      createdAt: new Date().toISOString(),
      players: [],
      seats: emptySeats(),
      status: "waiting",
    };

    const host = addPlayerToLobby(lobby, body.playerName);
    lobby.hostId = host.id;
    lobbies.set(code, lobby);
    sendJson(response, 201, { lobby: publicLobby(lobby, host.id), playerId: host.id });
    broadcastLobby(lobby);
    return;
  }

  if (parts[0] === "api" && parts[1] === "lobbies" && parts[2]) {
    const code = parts[2].toUpperCase();
    const lobby = getLobbyOrThrow(code);

    if (request.method === "GET" && parts.length === 3) {
      sendJson(response, 200, { lobby: publicLobby(lobby, requestUrl.searchParams.get("playerId")) });
      return;
    }

    if (request.method === "GET" && parts[3] === "events") {
      const playerId = requestUrl.searchParams.get("playerId");
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      response.write(`event: lobby\ndata: ${JSON.stringify(publicLobby(lobby, playerId))}\n\n`);

      const streams = streamsByLobby.get(code) || new Set();
      const stream = { response, playerId };
      streams.add(stream);
      streamsByLobby.set(code, streams);

      request.on("close", () => {
        streams.delete(stream);
        if (streams.size === 0) {
          streamsByLobby.delete(code);
        }
      });
      return;
    }

    if (request.method === "POST" && parts[3] === "join") {
      const body = await parseBody(request);
      const player = addPlayerToLobby(lobby, body.playerName, body.playerId);
      sendJson(response, 200, { lobby: publicLobby(lobby, player.id), playerId: player.id });
      broadcastLobby(lobby);
      return;
    }

    if (request.method === "POST" && parts[3] === "seat") {
      const body = await parseBody(request);
      const player = lobby.players.find((candidate) => candidate.id === body.playerId);
      const seatIndex = Number(body.seatIndex);

      if (lobby.match?.status === "playing") {
        throw httpError(409, "Seats cannot change during a match.");
      }
      if (!player) {
        throw httpError(403, "Join the lobby before choosing a seat.");
      }
      if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= MAX_PLAYERS) {
        throw httpError(400, "Invalid seat.");
      }

      const desiredSeat = lobby.seats[seatIndex];
      if (desiredSeat.playerId && desiredSeat.playerId !== player.id) {
        throw httpError(409, "That seat is already taken.");
      }

      for (const seat of lobby.seats) {
        if (seat.playerId === player.id) {
          seat.playerId = null;
        }
      }
      desiredSeat.playerId = player.id;

      sendJson(response, 200, { lobby: publicLobby(lobby, body.playerId) });
      broadcastLobby(lobby);
      return;
    }

    if (request.method === "POST" && parts[3] === "ready") {
      const body = await parseBody(request);
      const player = lobby.players.find((candidate) => candidate.id === body.playerId);

      if (lobby.match?.status === "playing") {
        throw httpError(409, "The match has already started.");
      }
      if (!player) {
        throw httpError(403, "Join the lobby before changing ready state.");
      }

      player.ready = Boolean(body.ready);
      player.lastSeenAt = new Date().toISOString();
      updateLobbyStatus(lobby);

      sendJson(response, 200, { lobby: publicLobby(lobby, body.playerId) });
      broadcastLobby(lobby);
      return;
    }

    if (request.method === "POST" && parts[3] === "leave") {
      const body = await parseBody(request);
      removePlayerFromLobby(lobby, body.playerId);

      if (lobby.players.length === 0) {
        lobbies.delete(code);
        sendJson(response, 200, { lobby: null });
        return;
      }

      sendJson(response, 200, { lobby: publicLobby(lobby, body.playerId) });
      broadcastLobby(lobby);
      return;
    }

    if (request.method === "POST" && parts[3] === "play-card") {
      const body = await parseBody(request);
      playCard(lobby, body.playerId, body.cardId);
      sendJson(response, 200, { lobby: publicLobby(lobby, body.playerId) });
      broadcastLobby(lobby);
      return;
    }

    if (request.method === "POST" && parts[3] === "return-to-lobby") {
      const body = await parseBody(request);
      returnMatchToLobby(lobby, body.playerId);
      sendJson(response, 200, { lobby: publicLobby(lobby, body.playerId) });
      broadcastLobby(lobby);
      return;
    }

    if (request.method === "POST" && parts[3] === "voice-token") {
      const body = await parseBody(request);
      const player = lobby.players.find((candidate) => candidate.id === body.playerId);
      if (!player) {
        throw httpError(403, "Join the lobby before joining voice chat.");
      }
      if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
        throw httpError(503, "Voice chat is not configured yet.");
      }

      const { AccessToken } = await import("livekit-server-sdk");
      const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
        identity: player.id,
        name: player.name,
        ttl: "1h",
        metadata: JSON.stringify({ team: teamForPlayer(lobby, player.id) }),
      });
      token.addGrant({
        roomJoin: true,
        room: `dehla-${lobby.code}`,
        canPublish: true,
        canPublishSources: ["microphone"],
        canSubscribe: true,
        canPublishData: false,
      });

      sendJson(response, 200, {
        serverUrl: process.env.LIVEKIT_URL,
        token: await token.toJwt(),
      });
      return;
    }
  }

  throw httpError(404, "Route not found.");
}

const server = http.createServer((request, response) => {
  if (request.url.startsWith("/api/")) {
    handleApi(request, response).catch((error) => sendError(response, error));
    return;
  }

  serveStatic(request, response);
});

server.listen(PORT, () => {
  console.log(`Dehla Pakad lobby app running at http://localhost:${PORT}`);
});
