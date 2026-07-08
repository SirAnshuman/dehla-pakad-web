function createDehlaState() {
  return {
    pending: [],
    opportunityTeam: null,
    captured: {
      Satoris: [],
      Khiladis: [],
    },
  };
}

function resolveDehlaTrick(state, { cards, winnerTeam, isFinalTrick = false }) {
  const next = {
    pending: [...state.pending],
    opportunityTeam: state.opportunityTeam,
    captured: {
      Satoris: [...state.captured.Satoris],
      Khiladis: [...state.captured.Khiladis],
    },
  };
  const dehlas = cards.filter((card) => card.rank === "10");

  next.pending.push(...dehlas);

  if (next.pending.length === 0) {
    return next;
  }

  if (isFinalTrick) {
    next.captured[winnerTeam].push(...next.pending);
    next.pending = [];
    next.opportunityTeam = null;
    return next;
  }

  if (dehlas.length > 0) {
    next.opportunityTeam = winnerTeam;
    return next;
  }

  if (winnerTeam === next.opportunityTeam) {
    next.captured[winnerTeam].push(...next.pending);
    next.pending = [];
    next.opportunityTeam = null;
    return next;
  }

  next.opportunityTeam = winnerTeam;
  return next;
}

module.exports = {
  createDehlaState,
  resolveDehlaTrick,
};
