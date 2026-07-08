const state = {
  lobby: null,
  playerId: localStorage.getItem("dehla.playerId"),
  eventSource: null,
  voice: {
    room: null,
    connecting: false,
    speakingIds: new Set(),
    soundEnabled: localStorage.getItem("dehla.voice.sound") !== "off",
  },
  matchEvents: {
    seenIds: new Set(),
    queue: [],
    showing: false,
  },
  audioContext: null,
  gameSoundEnabled: localStorage.getItem("dehla.game.sound") !== "off",
  musicEnabled: localStorage.getItem("dehla.music") !== "off",
  musicTimer: null,
  musicStep: 0,
  nextMusicNoteTime: 0,
  celebratedResult: null,
  introMatchId: null,
  introTimer: null,
};

const elements = {
  createForm: document.querySelector("#createForm"),
  joinForm: document.querySelector("#joinForm"),
  createName: document.querySelector("#createName"),
  joinName: document.querySelector("#joinName"),
  joinCode: document.querySelector("#joinCode"),
  tableTitle: document.querySelector("#tableTitle"),
  tableSubtitle: document.querySelector("#tableSubtitle"),
  statusStrip: document.querySelector("#statusStrip"),
  mobileCode: document.querySelector("#mobileCode"),
  shareCode: document.querySelector("#shareCode"),
  lobbyTools: document.querySelector("#lobbyTools"),
  seriesTeamAlpha: document.querySelector("#seriesTeamAlpha"),
  seriesScoreAlpha: document.querySelector("#seriesScoreAlpha"),
  seriesTeamBeta: document.querySelector("#seriesTeamBeta"),
  seriesScoreBeta: document.querySelector("#seriesScoreBeta"),
  readyButton: document.querySelector("#readyButton"),
  leaveButton: document.querySelector("#leaveButton"),
  copyButton: document.querySelector("#copyButton"),
  gamePanel: document.querySelector("#gamePanel"),
  turnLabel: document.querySelector("#turnLabel"),
  trickLabel: document.querySelector("#trickLabel"),
  trickRow: document.querySelector("#trickRow"),
  handRow: document.querySelector("#handRow"),
  matchStatusLabel: document.querySelector("#matchStatusLabel"),
  trumpChip: document.querySelector("#trumpChip"),
  dehlaChip: document.querySelector("#dehlaChip"),
  dehlaCards: document.querySelector("#dehlaCards"),
  matchIdentity: document.querySelector("#matchIdentity"),
  playerRing: document.querySelector("#playerRing"),
  playField: document.querySelector(".play-field"),
  matchLeaveButton: document.querySelector("#matchLeaveButton"),
  matchTrickRow: document.querySelector("#matchTrickRow"),
  matchHandRow: document.querySelector("#matchHandRow"),
  handHint: document.querySelector("#handHint"),
  resultScreen: document.querySelector(".result-screen"),
  resultKicker: document.querySelector(".result-kicker"),
  resultSymbols: document.querySelector(".result-symbols"),
  resultTitle: document.querySelector("#resultTitle"),
  resultPlayers: document.querySelector("#resultPlayers"),
  resultScore: document.querySelector("#resultScore"),
  returnLobbyButton: document.querySelector("#returnLobbyButton"),
  voiceSettingsButton: document.querySelector("#voiceSettingsButton"),
  voicePanel: document.querySelector("#voicePanel"),
  closeVoicePanel: document.querySelector("#closeVoicePanel"),
  voiceStatus: document.querySelector("#voiceStatus"),
  microphoneToggle: document.querySelector("#microphoneToggle"),
  soundToggle: document.querySelector("#soundToggle"),
  gameSoundToggle: document.querySelector("#gameSoundToggle"),
  musicToggle: document.querySelector("#musicToggle"),
  voiceAudio: document.querySelector("#voiceAudio"),
  vsScreen: document.querySelector("#vsScreen"),
  vsTeamAlpha: document.querySelector("#vsTeamAlpha"),
  vsPlayersAlpha: document.querySelector("#vsPlayersAlpha"),
  vsTeamBeta: document.querySelector("#vsTeamBeta"),
  vsPlayersBeta: document.querySelector("#vsPlayersBeta"),
  eventBanner: document.querySelector("#eventBanner"),
  eventBannerKicker: document.querySelector("#eventBannerKicker"),
  eventBannerTitle: document.querySelector("#eventBannerTitle"),
  eventBannerSubtitle: document.querySelector("#eventBannerSubtitle"),
  message: document.querySelector("#message"),
  seats: Array.from(document.querySelectorAll("[data-seat]")),
};

function setMessage(message, isError = false) {
  elements.message.textContent = message;
  elements.message.classList.toggle("is-error", isError);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function currentPlayer() {
  if (!state.lobby || !state.playerId) {
    return null;
  }

  return state.lobby.players.find((player) => player.id === state.playerId) || null;
}

function playerById(playerId) {
  if (!state.lobby || !playerId) {
    return null;
  }

  return state.lobby.players.find((player) => player.id === playerId) || null;
}

function hasLocalPlayer(lobby) {
  return Boolean(state.playerId && lobby.players.some((player) => player.id === state.playerId));
}

function setLobby(lobby, playerId = state.playerId) {
  state.lobby = lobby;
  state.playerId = playerId;

  if (playerId) {
    localStorage.setItem("dehla.playerId", playerId);
  }
  if (lobby?.code) {
    localStorage.setItem("dehla.lobbyCode", lobby.code);
    history.replaceState(null, "", `#${lobby.code}`);
  }

  render();
}

function returnToStart(message = "") {
  state.lobby = null;
  state.playerId = null;

  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }

  localStorage.removeItem("dehla.playerId");
  localStorage.removeItem("dehla.lobbyCode");
  disconnectVoice();
  history.replaceState(null, "", location.pathname);
  render();
  setMessage(message);
}

function connectEvents(code) {
  if (state.eventSource) {
    state.eventSource.close();
  }

  state.eventSource = new EventSource(`/api/lobbies/${code}/events?playerId=${encodeURIComponent(state.playerId || "")}`);
  state.eventSource.addEventListener("lobby", (event) => {
    const lobby = JSON.parse(event.data);
    if (!hasLocalPlayer(lobby)) {
      returnToStart("You left the lobby.");
      return;
    }
    setLobby(lobby);
  });
  state.eventSource.onerror = () => {
    setMessage("Live connection is retrying...");
  };
}

function renderSeat(seat) {
  const seatElement = elements.seats[seat.index];
  const player = playerById(seat.playerId);
  const isMine = player?.id === state.playerId;
  const canClaim = Boolean(state.lobby && state.playerId && (!seat.playerId || isMine));
  const actionLabel = isMine ? "You" : player ? "Taken" : "Sit";
  const readiness = player ? `<span class="ready-dot ${player.ready ? "is-ready" : ""}" title="${player.ready ? "Ready" : "Not ready"}"></span>` : "";

  seatElement.innerHTML = `
    <div class="seat-header">
      <span class="seat-label">${seat.label}</span>
      <span class="team-pill team-${seat.teamKey}">${escapeHtml(seat.team)}</span>
    </div>
    <div class="player-name">${player ? escapeHtml(player.name) : "Open seat"}</div>
    <div class="seat-header">
      ${readiness}
      <button class="seat-action" type="button" data-claim-seat="${seat.index}" ${canClaim && !isMine ? "" : "disabled"}>
        ${actionLabel}
      </button>
    </div>
  `;
}

function render() {
  const lobby = state.lobby;
  const player = currentPlayer();
  const match = lobby?.match || null;
  document.body.classList.toggle("has-lobby", Boolean(lobby));
  document.body.classList.toggle("has-match", Boolean(match));
  document.body.classList.toggle("has-result", Boolean(match?.result));

  if (!lobby) {
    elements.tableTitle.textContent = "Family Table";
    elements.tableSubtitle.textContent = "Create a lobby or join with a code.";
    elements.statusStrip.textContent = "Waiting for players";
    elements.mobileCode.textContent = "-----";
    elements.gamePanel.hidden = true;
    emptyTable();
    renderHand(null);
    processMatchEvents(null);
    return;
  }

  const seatedCount = lobby.seats.filter((seat) => seat.playerId).length;
  const readyCount = lobby.players.filter((candidate) => candidate.ready).length;

  elements.tableTitle.textContent = match ? `Sir ${match.trickNumber}` : lobby.code;
  elements.tableSubtitle.textContent = match
    ? matchSummary(match)
    : `${seatedCount}/4 seats filled`;
  elements.statusStrip.textContent = match
    ? (match.currentTurnPlayerId === state.playerId ? "Your turn" : `${match.currentTurnPlayerName}'s turn`)
    : `${readyCount}/${lobby.players.length} ready`;
  elements.mobileCode.textContent = lobby.code;
  elements.shareCode.textContent = lobby.code;
  const [alphaTeam, betaTeam] = lobby.teamNames;
  elements.seriesTeamAlpha.textContent = alphaTeam;
  elements.seriesScoreAlpha.textContent = String(lobby.score[alphaTeam]);
  elements.seriesTeamBeta.textContent = betaTeam;
  elements.seriesScoreBeta.textContent = String(lobby.score[betaTeam]);
  elements.readyButton.textContent = match ? "Playing" : player?.ready ? "Unready" : "Ready";
  elements.readyButton.disabled = !player || Boolean(match);
  elements.leaveButton.disabled = !player;

  for (const seat of lobby.seats) {
    renderSeat(seat);
  }

  renderGame(match);
  renderResult(match?.result || null);
  processMatchIntro(match);
  processMatchEvents(match);
}

function playVsSound() {
  const context = ensureAudioContext();
  if (!context || context.state === "closed") {
    return;
  }
  const now = context.currentTime;
  [98, 147, 196].forEach((frequency, index) => {
    scheduleMusicNote(context, frequency, now + index * 0.08, 0.28, 0.055, "sawtooth");
  });
  scheduleMusicNote(context, 784, now + 0.34, 0.18, 0.04, "square");
  scheduleMusicNote(context, 1_176, now + 0.43, 0.3, 0.032, "square");
}

function processMatchIntro(match) {
  if (!match) {
    state.introMatchId = null;
    if (state.introTimer) {
      window.clearTimeout(state.introTimer);
      state.introTimer = null;
    }
    elements.vsScreen.hidden = true;
    return;
  }
  if (state.introMatchId === match.id || match.result) {
    return;
  }

  state.introMatchId = match.id;
  if (!match.startedAt || Date.now() - match.startedAt > 6_000) {
    return;
  }

  const [alphaTeam, betaTeam] = state.lobby.teamNames;
  const playersForTeam = (team) => state.lobby.seats
    .filter((seat) => seat.team === team)
    .map((seat) => playerById(seat.playerId)?.name)
    .filter(Boolean)
    .join(" + ");
  elements.vsTeamAlpha.textContent = alphaTeam;
  elements.vsPlayersAlpha.textContent = playersForTeam(alphaTeam);
  elements.vsTeamBeta.textContent = betaTeam;
  elements.vsPlayersBeta.textContent = playersForTeam(betaTeam);
  elements.vsScreen.className = "vs-screen";
  elements.vsScreen.hidden = false;
  playVsSound();

  state.introTimer = window.setTimeout(() => {
    elements.vsScreen.classList.add("is-leaving");
    state.introTimer = window.setTimeout(() => {
      elements.vsScreen.hidden = true;
      elements.vsScreen.classList.remove("is-leaving");
      state.introTimer = null;
    }, 320);
  }, 2_700);
}

function processMatchEvents(match) {
  if (!match) {
    state.matchEvents.queue = [];
    elements.eventBanner.hidden = true;
    state.matchEvents.showing = false;
    return;
  }

  for (const event of match.events || []) {
    if (state.matchEvents.seenIds.has(event.id)) {
      continue;
    }
    state.matchEvents.seenIds.add(event.id);
    if (event.type === "card-played") {
      if (Date.now() - event.createdAt < 2_000) {
        playCardSound(event.soundVariant);
      }
      continue;
    }
    if (Date.now() - event.createdAt < 10_000) {
      state.matchEvents.queue.push(event);
    }
  }
  showNextMatchEvent();
}

function ensureAudioContext(forMusic = false) {
  if (forMusic ? !state.musicEnabled : !state.gameSoundEnabled) {
    return null;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }
  if (!state.audioContext) {
    state.audioContext = new AudioContextClass();
  }
  if (state.audioContext.state === "suspended") {
    state.audioContext.resume().catch(() => {});
  }
  return state.audioContext;
}

function scheduleMusicNote(context, frequency, start, duration, volume, type = "square") {
  if (!frequency) {
    return;
  }
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function musicFrequency(midiNote) {
  return 440 * (2 ** ((midiNote - 69) / 12));
}

function queueBackgroundMusic() {
  const context = ensureAudioContext(true);
  if (!context || context.state === "closed") {
    return;
  }
  const chordRoots = [
    48, 48, 53, 55, 48, 57, 53, 55,
    48, 52, 53, 55, 57, 53, 55, 55,
    45, 53, 48, 55, 45, 53, 50, 55,
  ];
  const motifs = [
    [12, null, 16, 19, 16, 14, 12, null],
    [19, 16, 17, null, 21, 19, 16, 14],
    [12, 14, 16, 19, 21, null, 19, 16],
    [16, 14, 12, 9, 12, 14, 16, null],
  ];
  const stepDuration = 0.17;
  const songSteps = chordRoots.length * 8;
  while (state.nextMusicNoteTime < context.currentTime + 0.3) {
    const songStep = state.musicStep % songSteps;
    const bar = Math.floor(songStep / 8);
    const beat = songStep % 8;
    const section = Math.floor(bar / 8);
    const root = chordRoots[bar];
    const motif = motifs[(bar + section) % motifs.length];
    let leadOffset = motif[beat];

    if (section === 0 && bar < 2 && beat % 2 === 1) {
      leadOffset = null;
    } else if (section === 1 && leadOffset !== null && bar % 2 === 1) {
      leadOffset += beat === 6 ? 12 : 0;
    } else if (section === 2 && leadOffset !== null) {
      leadOffset += beat % 3 === 0 ? -3 : 0;
    }

    if (leadOffset !== null) {
      scheduleMusicNote(context, musicFrequency(root + leadOffset), state.nextMusicNoteTime, 0.125, 0.014, "square");
    }

    if (beat % 2 === 0) {
      const bassOffset = beat === 6 && bar % 3 === 2 ? 7 : 0;
      scheduleMusicNote(context, musicFrequency(root - 12 + bassOffset), state.nextMusicNoteTime, 0.15, 0.018, "triangle");
    }

    if (section > 0 && beat % 2 === 1) {
      const chordTone = [0, 4, 7, 11][Math.floor(beat / 2)];
      scheduleMusicNote(context, musicFrequency(root + chordTone + 12), state.nextMusicNoteTime, 0.08, 0.0055, "sine");
    }

    if (beat === 0 || beat === 4) {
      scheduleMusicNote(context, beat === 0 ? 74 : 92, state.nextMusicNoteTime, 0.07, 0.012, "triangle");
    } else if (section === 2 && beat === 7) {
      scheduleMusicNote(context, 1_480, state.nextMusicNoteTime, 0.035, 0.004, "square");
    }
    state.musicStep += 1;
    state.nextMusicNoteTime += stepDuration;
  }
}

function startBackgroundMusic() {
  if (!state.musicEnabled || state.musicTimer) {
    return;
  }
  const context = ensureAudioContext(true);
  if (!context) {
    return;
  }
  state.nextMusicNoteTime = context.currentTime + 0.05;
  queueBackgroundMusic();
  state.musicTimer = window.setInterval(queueBackgroundMusic, 100);
}

function stopBackgroundMusic() {
  if (state.musicTimer) {
    window.clearInterval(state.musicTimer);
    state.musicTimer = null;
  }
}

function playCardSound(variantValue) {
  const context = ensureAudioContext();
  if (!context || context.state === "closed") {
    return;
  }

  const variant = Math.abs(Number(variantValue) || 0) % 20;
  const duration = 0.055 + (variant % 5) * 0.012;
  const sampleCount = Math.ceil(context.sampleRate * duration);
  const noiseBuffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const samples = noiseBuffer.getChannelData(0);
  const texture = 0.35 + (variant % 4) * 0.12;
  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / sampleCount;
    samples[index] = (Math.random() * 2 - 1) * Math.pow(1 - progress, 2.4) * texture;
  }

  const now = context.currentTime;
  const noise = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const noiseGain = context.createGain();
  noise.buffer = noiseBuffer;
  filter.type = variant % 3 === 0 ? "highpass" : "bandpass";
  filter.frequency.value = 650 + ((variant * 173) % 1_850);
  filter.Q.value = 0.7 + (variant % 4) * 0.45;
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.22 + (variant % 3) * 0.035, now + 0.004);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  noise.connect(filter).connect(noiseGain).connect(context.destination);

  const tap = context.createOscillator();
  const tapGain = context.createGain();
  tap.type = variant % 2 === 0 ? "triangle" : "sine";
  tap.frequency.setValueAtTime(105 + variant * 4.5, now);
  tap.frequency.exponentialRampToValueAtTime(58 + (variant % 5) * 5, now + duration);
  tapGain.gain.setValueAtTime(0.12 + (variant % 4) * 0.012, now);
  tapGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  tap.connect(tapGain).connect(context.destination);

  noise.start(now);
  noise.stop(now + duration);
  tap.start(now);
  tap.stop(now + duration);
}

function playBannerSound(event) {
  const context = ensureAudioContext();
  if (!context || context.state === "closed") {
    return;
  }

  const now = context.currentTime;
  const playTone = (frequency, startOffset, duration, volume, type = "sawtooth", endFrequency = frequency) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + startOffset;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  };

  if (event.type === "coat") {
    [110, 165, 220].forEach((frequency, index) => {
      playTone(frequency, index * 0.11, 0.3, 0.075, "sawtooth", frequency * 2);
    });
    [440, 554, 659, 880].forEach((frequency, index) => {
      playTone(frequency, 0.36 + index * 0.1, 0.38, 0.06, "square", frequency * 1.12);
    });
    playTone(110, 0.7, 0.8, 0.09, "triangle", 55);
    return;
  }

  if (event.type === "dehla-entered") {
    playTone(180, 0, 0.34, 0.075, "sawtooth", 520);
    playTone(360, 0.09, 0.3, 0.055, "square", 780);
    playTone(920, 0.22, 0.22, 0.04, "triangle", 1_280);
    return;
  }

  if (event.type === "dehlas-covered") {
    const hits = Math.min(4, Math.max(1, Number(event.count) || 1));
    for (let index = 0; index < hits; index += 1) {
      const offset = index * 0.105;
      playTone(135 + index * 28, offset, 0.2, 0.095, "triangle", 72 + index * 12);
      playTone(540 + index * 85, offset + 0.025, 0.18, 0.04, "square", 690 + index * 90);
    }
    playTone(330, hits * 0.105, 0.46, 0.065, "sawtooth", 660);
    playTone(495, hits * 0.105, 0.46, 0.045, "triangle", 990);
    return;
  }

  if (event.type === "trump-opened") {
    playTone(72, 0, 0.58, 0.11, "sawtooth", 150);
    playTone(220, 0.16, 0.48, 0.06, "triangle", 440);
    playTone(330, 0.23, 0.42, 0.05, "triangle", 660);
    playTone(495, 0.3, 0.36, 0.04, "sine", 990);
  }
}

function playButtonSound(button) {
  const context = ensureAudioContext();
  if (!context || button.disabled || button.matches("[data-card-id]")) {
    return;
  }

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const isSecondary = button.classList.contains("secondary") || button.id === "copyButton";
  const isQuiet = button.classList.contains("quiet-button") || button.classList.contains("match-leave");
  const baseFrequency = isQuiet ? 150 : isSecondary ? 310 : 240;
  oscillator.type = isSecondary ? "square" : "triangle";
  oscillator.frequency.setValueAtTime(baseFrequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(baseFrequency * (isQuiet ? 0.72 : 1.38), now + 0.065);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(isQuiet ? 0.035 : 0.05, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.085);
}

function matchEventCopy(event) {
  if (event.type === "dehla-entered") {
    return {
      tone: "dehla",
      kicker: "Dehla alert",
      title: "A DEHLA HAS ENTERED PLAY",
      subtitle: `${suitSymbol(event.suit)}10 joins the pending pile`,
    };
  }
  if (event.type === "dehlas-covered") {
    return {
      tone: "covered",
      kicker: "Pile captured",
      title: `${event.count} DEHLA${event.count === 1 ? "" : "S"} COVERED`,
      subtitle: `${event.team} claim the pile`,
    };
  }
  return {
    tone: "trump",
    kicker: "Open trump",
    title: "TRUMP HAS AWAKENED",
    subtitle: `${suitSymbol(event.suit)} ${suitName(event.suit)} now rule the table`,
  };
}

function showNextMatchEvent() {
  if (state.matchEvents.showing || state.matchEvents.queue.length === 0) {
    return;
  }

  state.matchEvents.showing = true;
  const event = state.matchEvents.queue.shift();
  const copy = matchEventCopy(event);
  playBannerSound(event);
  elements.eventBanner.className = `event-banner is-${copy.tone}`;
  elements.eventBannerKicker.textContent = copy.kicker;
  elements.eventBannerTitle.textContent = copy.title;
  elements.eventBannerSubtitle.textContent = copy.subtitle;
  elements.eventBanner.hidden = false;
  positionEventBanner();

  window.setTimeout(() => {
    elements.eventBanner.classList.add("is-leaving");
    window.setTimeout(() => {
      elements.eventBanner.hidden = true;
      elements.eventBanner.classList.remove("is-leaving");
      state.matchEvents.showing = false;
      showNextMatchEvent();
    }, 280);
  }, 2_600);
}

function positionEventBanner() {
  if (elements.eventBanner.hidden || !elements.playField) {
    return;
  }
  const playRect = elements.playField.getBoundingClientRect();
  const bannerRect = elements.eventBanner.getBoundingClientRect();
  const width = Math.min(520, playRect.width, window.innerWidth - 28);
  const top = Math.max(8, playRect.top - bannerRect.height - 10);
  elements.eventBanner.style.width = `${width}px`;
  elements.eventBanner.style.top = `${top}px`;
}

function renderResult(result) {
  if (!result) {
    state.celebratedResult = null;
    elements.resultScreen.classList.remove("is-coat");
    return;
  }

  const isCoat = !result.isDraw && result.dehlaCount === 4;
  elements.resultScreen.classList.toggle("is-coat", isCoat);

  if (result.isDraw) {
    elements.resultKicker.textContent = "Round complete";
    elements.resultSymbols.textContent = "10♠ 10♥ 10♦ 10♣";
    elements.resultTitle.textContent = "Round drawn";
    elements.resultPlayers.textContent = `${result.teamNames.join(" and ")} finish level`;
    elements.resultScore.textContent = "2 Dehlas each";
    return;
  }

  if (isCoat) {
    const resultKey = `${result.winningTeam}:${result.playerNames.join(":")}:4`;
    elements.resultKicker.textContent = "Flawless capture";
    elements.resultSymbols.textContent = "10♠ 10♥ 10♦ 10♣";
    elements.resultTitle.textContent = "COAT!";
    elements.resultPlayers.textContent = `${result.playerNames.join(" and ")} · Team ${result.winningTeam}`;
    elements.resultScore.textContent = "4–0 · All Dehlas captured";
    if (state.celebratedResult !== resultKey) {
      state.celebratedResult = resultKey;
      playBannerSound({ type: "coat" });
    }
    return;
  }

  elements.resultKicker.textContent = "Round complete";
  elements.resultSymbols.textContent = "10♠ 10♥ 10♦ 10♣";
  elements.resultTitle.textContent = `Team ${result.winningTeam} win`;
  elements.resultPlayers.textContent = result.playerNames.join(" and ");
  elements.resultScore.textContent = `${result.dehlaCount} Dehla${result.dehlaCount === 1 ? "" : "s"} captured`;
}

function matchSummary(match) {
  if (match.status === "complete") {
    return "Round complete";
  }
  const parts = [];
  if (match.leadSuit) {
    parts.push(`Lead ${suitName(match.leadSuit)}`);
  }
  if (match.trumpSuit) {
    parts.push(`Trump ${suitName(match.trumpSuit)}`);
  }
  return parts.join(" · ") || "Lead any card";
}

function renderGame(match) {
  elements.gamePanel.hidden = !match;
  if (!match) {
    renderHand(null);
    elements.trickRow.innerHTML = "";
    return;
  }

  elements.turnLabel.textContent = match.status === "complete"
    ? "Complete"
    : match.currentTurnPlayerId === state.playerId
      ? "You"
      : match.currentTurnPlayerName;
  elements.trickLabel.textContent = String(match.trickNumber);
  elements.trickRow.innerHTML = match.currentTrick.length
    ? match.currentTrick.map((play) => `
        <div class="played-card">
          <span>${escapeHtml(play.playerName)}</span>
          ${cardMarkup(play.card)}
        </div>
      `).join("")
    : `<span class="empty-trick">No cards played</span>`;
  renderHand(match);

  elements.trumpChip.textContent = match.trumpSuit ? `${suitSymbol(match.trumpSuit)} ${suitName(match.trumpSuit)}` : "Not opened";
  renderMatchPlayers(match);
  const pendingCount = match.dehla.pending.length;
  elements.dehlaChip.hidden = pendingCount === 0;
  elements.dehlaChip.textContent = pendingCount
    ? `${pendingCount} pending · ${match.dehla.opportunityTeam} can cover`
    : "";
  const capturedById = new Map();
  for (const team of state.lobby.teamNames) {
    for (const card of match.dehla.captured[team]) {
      capturedById.set(card.id, team);
    }
  }
  const pendingIds = new Set(match.dehla.pending.map((card) => card.id));
  elements.dehlaCards.innerHTML = ["S", "H", "D", "C"].map((suit) => {
    const id = `${suit}10`;
    const team = capturedById.get(id);
    const status = team || (pendingIds.has(id) ? "Pending" : "In play");
    const teamIndex = state.lobby.teamNames.indexOf(team);
    const stateClass = team ? `is-captured is-${teamIndex === 0 ? "alpha" : "beta"}` : pendingIds.has(id) ? "is-pending" : "";
    return `
      <div class="dehla-card ${stateClass} ${cardColorClass({ suit })}">
        <strong>10${suitSymbol(suit)}</strong>
        <span>${status}</span>
      </div>
    `;
  }).join("");
  const [firstTeam, secondTeam] = state.lobby.teamNames;
  const totalCaptured = match.dehla.capturedCounts[firstTeam] + match.dehla.capturedCounts[secondTeam];
  elements.matchStatusLabel.textContent = totalCaptured
    ? `${firstTeam} ${match.dehla.capturedCounts[firstTeam]} · ${secondTeam} ${match.dehla.capturedCounts[secondTeam]}`
    : "None captured";
  elements.matchTrickRow.innerHTML = match.currentTrick.length
    ? match.currentTrick.map((play) => `
        <div class="match-play">
          ${cardMarkup(play.card)}
          <span>${escapeHtml(play.playerName)}</span>
        </div>
      `).join("")
    : `<span class="empty-trick">Waiting for the first card</span>`;
  elements.handHint.textContent = match.currentTurnPlayerId === state.playerId
    ? "Choose a highlighted card"
    : match.isRevealingTrick && match.lastTrick
      ? `${match.lastTrick.winnerPlayerName} won · Next sir in 3 seconds`
    : `Waiting for ${match.currentTurnPlayerName}`;
}

function playerInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function renderMatchPlayers(match) {
  const mySeat = state.lobby.seats.find((seat) => seat.playerId === state.playerId);
  const me = currentPlayer();
  if (!mySeat || !me) {
    elements.matchIdentity.innerHTML = "";
    elements.playerRing.innerHTML = "";
    return;
  }

  elements.matchIdentity.innerHTML = `
    <span class="identity-avatar">${escapeHtml(playerInitials(me.name))}</span>
    <span><strong>${escapeHtml(me.name)}</strong><small>${escapeHtml(mySeat.team)}</small></span>
  `;
  elements.matchIdentity.classList.toggle("team-alpha", mySeat.teamKey === "alpha");
  elements.matchIdentity.classList.toggle("team-beta", mySeat.teamKey === "beta");

  const positions = ["bottom", "left", "top", "right"];
  elements.playerRing.innerHTML = state.lobby.seats.map((seat) => {
    const player = playerById(seat.playerId);
    if (!player) {
      return "";
    }
    const relativeIndex = (seat.index - mySeat.index + 4) % 4;
    const isActive = player.id === match.currentTurnPlayerId;
    const wonTrick = match.isRevealingTrick && player.id === match.lastTrick?.winnerPlayerId;
    const isMe = player.id === state.playerId;
    const isSpeaking = state.voice.speakingIds.has(player.id);
    return `
      <div data-player-id="${player.id}" class="table-player team-${seat.teamKey} player-${positions[relativeIndex]} ${isActive ? "is-active" : ""} ${wonTrick ? "won-trick" : ""} ${isSpeaking ? "is-speaking" : ""} ${isMe ? "is-me" : ""}">
        <span class="player-avatar">${escapeHtml(playerInitials(player.name))}</span>
        <span class="table-player-name">${isMe ? "You" : escapeHtml(player.name)}</span>
        <span class="table-player-team">${escapeHtml(seat.team)}</span>
      </div>
    `;
  }).join("");
}

function updateSpeakingIndicators(activeSpeakers = []) {
  state.voice.speakingIds = new Set(activeSpeakers.map((participant) => participant.identity));
  for (const marker of document.querySelectorAll("[data-player-id]")) {
    marker.classList.toggle("is-speaking", state.voice.speakingIds.has(marker.dataset.playerId));
  }
}

function updateVoiceStatus(message) {
  elements.voiceStatus.textContent = message;
  elements.voiceSettingsButton.classList.toggle("is-connected", Boolean(state.voice.room));
  elements.voiceSettingsButton.classList.toggle("is-live", Boolean(state.voice.room && elements.microphoneToggle.checked));
}

function applySoundSetting() {
  for (const audio of elements.voiceAudio.querySelectorAll("audio")) {
    audio.muted = !state.voice.soundEnabled;
  }
}

async function connectVoice() {
  if (state.voice.room || state.voice.connecting) {
    return state.voice.room;
  }
  if (!state.lobby || !state.playerId) {
    throw new Error("Join a lobby before using voice chat.");
  }
  if (!window.LivekitClient) {
    throw new Error("Voice chat could not load.");
  }

  state.voice.connecting = true;
  updateVoiceStatus("Connecting...");
  try {
    const credentials = await postJson(`/api/lobbies/${state.lobby.code}/voice-token`, {
      playerId: state.playerId,
    });
    const room = new window.LivekitClient.Room({ adaptiveStream: true, dynacast: true });
    room.on(window.LivekitClient.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== window.LivekitClient.Track.Kind.Audio) {
        return;
      }
      const audio = track.attach();
      audio.autoplay = true;
      audio.muted = !state.voice.soundEnabled;
      elements.voiceAudio.append(audio);
    });
    room.on(window.LivekitClient.RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((element) => element.remove()));
    room.on(window.LivekitClient.RoomEvent.ActiveSpeakersChanged, updateSpeakingIndicators);
    room.on(window.LivekitClient.RoomEvent.Disconnected, () => {
      state.voice.room = null;
      elements.microphoneToggle.checked = false;
      updateSpeakingIndicators([]);
      updateVoiceStatus("Off");
    });
    await room.connect(credentials.serverUrl, credentials.token);
    state.voice.room = room;
    if (state.voice.soundEnabled) {
      await room.startAudio().catch(() => {});
    }
    updateVoiceStatus("Connected");
    return room;
  } finally {
    state.voice.connecting = false;
  }
}

function disconnectVoice() {
  if (state.voice.room) {
    const room = state.voice.room;
    state.voice.room = null;
    room.disconnect();
  }
  elements.voiceAudio.replaceChildren();
  elements.microphoneToggle.checked = false;
  updateSpeakingIndicators([]);
  updateVoiceStatus("Off");
}

function renderHand(match) {
  if (!match) {
    elements.handRow.innerHTML = "";
    elements.matchHandRow.innerHTML = "";
    return;
  }

  const legalIds = new Set(match.legalCardIds);
  elements.handRow.innerHTML = match.hand.map((card) => {
    const isLegal = legalIds.has(card.id);
    return `
      <button
        class="card-button ${isLegal ? "is-legal" : "is-locked"} ${cardColorClass(card)}"
        type="button"
        data-card-id="${card.id}"
        ${isLegal ? "" : "disabled"}
      >
        <span>${escapeHtml(card.rank)}</span>
        <span>${suitSymbol(card.suit)}</span>
      </button>
    `;
  }).join("");
  elements.matchHandRow.innerHTML = elements.handRow.innerHTML;
}

function cardMarkup(card) {
  return `
    <span class="mini-card ${cardColorClass(card)}">
      <span>${escapeHtml(card.rank)}</span>
      <span>${suitSymbol(card.suit)}</span>
    </span>
  `;
}

function suitSymbol(suit) {
  return { S: "♠", H: "♥", D: "♦", C: "♣" }[suit] || suit;
}

function suitName(suit) {
  return { S: "Spades", H: "Hearts", D: "Diamonds", C: "Clubs" }[suit] || suit;
}

function cardColorClass(card) {
  if (card.suit === "H") {
    return "is-red is-heart";
  }
  if (card.suit === "D") {
    return "is-red is-diamond";
  }
  if (card.suit === "S") {
    return "is-black is-spade";
  }
  return "is-black is-club";
}

function emptyTable() {
  const labels = ["North", "East", "South", "West"];
  const teams = ["Team 1", "Team 2", "Team 1", "Team 2"];

  labels.forEach((label, index) => {
    elements.seats[index].innerHTML = `
      <div class="seat-header">
        <span class="seat-label">${label}</span>
        <span class="team-pill team-${index % 2 === 0 ? "alpha" : "beta"}">${teams[index]}</span>
      </div>
      <div class="player-name">Open seat</div>
      <button class="seat-action" type="button" disabled>Sit</button>
    `;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

elements.createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Creating lobby...");

  try {
    const payload = await postJson("/api/lobbies", {
      playerName: elements.createName.value,
    });
    setLobby(payload.lobby, payload.playerId);
    connectEvents(payload.lobby.code);
    setMessage("Lobby created. Share the code when you are ready.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

elements.joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = normalizeCode(elements.joinCode.value);
  setMessage("Joining lobby...");

  try {
    const payload = await postJson(`/api/lobbies/${code}/join`, {
      playerName: elements.joinName.value,
      playerId: state.playerId,
    });
    setLobby(payload.lobby, payload.playerId);
    connectEvents(payload.lobby.code);
    setMessage("Joined lobby.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.addEventListener("click", async (event) => {
  const cardButton = event.target.closest("[data-card-id]");
  if (cardButton && state.lobby) {
    ensureAudioContext();
    try {
      const payload = await postJson(`/api/lobbies/${state.lobby.code}/play-card`, {
        playerId: state.playerId,
        cardId: cardButton.dataset.cardId,
      });
      setLobby(payload.lobby);
      setMessage("Card played.");
    } catch (error) {
      setMessage(error.message, true);
    }
    return;
  }

  const seatButton = event.target.closest("[data-claim-seat]");
  if (!seatButton || !state.lobby) {
    return;
  }

  try {
    const payload = await postJson(`/api/lobbies/${state.lobby.code}/seat`, {
      playerId: state.playerId,
      seatIndex: Number(seatButton.dataset.claimSeat),
    });
    setLobby(payload.lobby);
    setMessage("Seat updated.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

elements.readyButton.addEventListener("click", async () => {
  const player = currentPlayer();
  if (!state.lobby || !player) {
    return;
  }

  ensureAudioContext();

  try {
    const payload = await postJson(`/api/lobbies/${state.lobby.code}/ready`, {
      playerId: state.playerId,
      ready: !player.ready,
    });
    setLobby(payload.lobby);
    setMessage(!player.ready ? "You are ready." : "Ready cancelled.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

elements.leaveButton.addEventListener("click", async () => {
  if (!state.lobby || !state.playerId) {
    returnToStart();
    return;
  }

  try {
    await postJson(`/api/lobbies/${state.lobby.code}/leave`, {
      playerId: state.playerId,
    });
    returnToStart("You left the lobby.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

elements.matchLeaveButton.addEventListener("click", () => elements.leaveButton.click());

elements.returnLobbyButton.addEventListener("click", async () => {
  if (!state.lobby || !state.playerId) {
    return;
  }

  elements.returnLobbyButton.disabled = true;
  try {
    const payload = await postJson(`/api/lobbies/${state.lobby.code}/return-to-lobby`, {
      playerId: state.playerId,
    });
    setLobby(payload.lobby);
    setMessage("Back in the lobby. Ready up for another round.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    elements.returnLobbyButton.disabled = false;
  }
});

elements.voiceSettingsButton.addEventListener("click", () => {
  elements.voicePanel.hidden = !elements.voicePanel.hidden;
});

elements.closeVoicePanel.addEventListener("click", () => {
  elements.voicePanel.hidden = true;
});

elements.microphoneToggle.addEventListener("change", async () => {
  const shouldEnable = elements.microphoneToggle.checked;
  elements.microphoneToggle.disabled = true;
  try {
    const room = await connectVoice();
    await room.localParticipant.setMicrophoneEnabled(shouldEnable);
    updateVoiceStatus(shouldEnable ? "Microphone on" : "Listening");
  } catch (error) {
    elements.microphoneToggle.checked = false;
    updateVoiceStatus(error.name === "NotAllowedError" ? "Microphone blocked" : error.message);
  } finally {
    elements.microphoneToggle.disabled = false;
  }
});

elements.soundToggle.addEventListener("change", async () => {
  state.voice.soundEnabled = elements.soundToggle.checked;
  localStorage.setItem("dehla.voice.sound", state.voice.soundEnabled ? "on" : "off");
  ensureAudioContext();
  applySoundSetting();
  if (state.voice.room && state.voice.soundEnabled) {
    await state.voice.room.startAudio().catch(() => {});
  }
  if (state.voice.room && !elements.microphoneToggle.checked) {
    updateVoiceStatus(state.voice.soundEnabled ? "Listening" : "Muted");
  }
});

elements.gameSoundToggle.addEventListener("change", () => {
  state.gameSoundEnabled = elements.gameSoundToggle.checked;
  localStorage.setItem("dehla.game.sound", state.gameSoundEnabled ? "on" : "off");
  if (state.gameSoundEnabled) {
    ensureAudioContext();
  }
});

elements.musicToggle.addEventListener("change", () => {
  state.musicEnabled = elements.musicToggle.checked;
  localStorage.setItem("dehla.music", state.musicEnabled ? "on" : "off");
  if (state.musicEnabled) {
    startBackgroundMusic();
  } else {
    stopBackgroundMusic();
  }
});

elements.copyButton.addEventListener("click", async () => {
  if (!state.lobby) {
    return;
  }

  try {
    await navigator.clipboard.writeText(state.lobby.code);
    setMessage("Lobby code copied.");
  } catch {
    setMessage(`Code: ${state.lobby.code}`);
  }
});

elements.joinCode.addEventListener("input", () => {
  elements.joinCode.value = normalizeCode(elements.joinCode.value);
});

async function restoreFromUrl() {
  const code = normalizeCode(location.hash.slice(1) || localStorage.getItem("dehla.lobbyCode"));
  if (!code) {
    render();
    return;
  }

  try {
    const response = await fetch(`/api/lobbies/${code}?playerId=${encodeURIComponent(state.playerId || "")}`);
    if (!response.ok) {
      render();
      return;
    }
    const payload = await response.json();
    elements.joinCode.value = payload.lobby.code;

    if (!hasLocalPlayer(payload.lobby)) {
      localStorage.setItem("dehla.lobbyCode", payload.lobby.code);
      render();
      return;
    }

    setLobby(payload.lobby);
    connectEvents(payload.lobby.code);
  } catch {
    render();
  }
}

elements.soundToggle.checked = state.voice.soundEnabled;
elements.gameSoundToggle.checked = state.gameSoundEnabled;
elements.musicToggle.checked = state.musicEnabled;
updateVoiceStatus("Off");
document.addEventListener("pointerdown", () => {
  ensureAudioContext();
  startBackgroundMusic();
}, { once: true });
document.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("button");
  if (button) {
    playButtonSound(button);
  }
});
window.addEventListener("resize", positionEventBanner);
restoreFromUrl();
