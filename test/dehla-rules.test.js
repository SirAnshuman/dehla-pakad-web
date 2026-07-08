const test = require("node:test");
const assert = require("node:assert/strict");
const { createDehlaState, resolveDehlaTrick } = require("../dehla-rules");

const ten = (suit) => ({ id: `${suit}10`, suit, rank: "10" });
const plain = (suit = "S") => ({ id: `${suit}A`, suit, rank: "A" });
const trick = (state, winnerTeam, cards, isFinalTrick = false) => (
  resolveDehlaTrick(state, { winnerTeam, cards, isFinalTrick })
);

test("a team captures a pending Dehla by winning the next clean trick", () => {
  let state = trick(createDehlaState(), "Satoris", [ten("D")]);
  state = trick(state, "Satoris", [plain()]);

  assert.deepEqual(state.pending, []);
  assert.deepEqual(state.captured.Satoris.map((card) => card.id), ["D10"]);
});

test("the opportunity transfers when the other team wins", () => {
  let state = trick(createDehlaState(), "Satoris", [ten("D")]);
  state = trick(state, "Khiladis", [plain()]);

  assert.deepEqual(state.pending.map((card) => card.id), ["D10"]);
  assert.equal(state.opportunityTeam, "Khiladis");
});

test("another Dehla joins the pile and requires one more clean win", () => {
  let state = trick(createDehlaState(), "Satoris", [ten("D")]);
  state = trick(state, "Khiladis", [plain()]);
  state = trick(state, "Khiladis", [ten("H")]);

  assert.deepEqual(state.pending.map((card) => card.id), ["D10", "H10"]);
  assert.deepEqual(state.captured.Khiladis, []);
  assert.equal(state.opportunityTeam, "Khiladis");
});

test("a later winner takes over the opportunity without scoring", () => {
  let state = trick(createDehlaState(), "Satoris", [ten("D")]);
  state = trick(state, "Khiladis", [plain()]);
  state = trick(state, "Khiladis", [ten("H")]);
  state = trick(state, "Satoris", [plain("C")]);

  assert.equal(state.opportunityTeam, "Satoris");
  assert.equal(state.pending.length, 2);
  assert.deepEqual(state.captured.Satoris, []);
});

test("the final trick winner immediately captures every pending Dehla", () => {
  let state = trick(createDehlaState(), "Satoris", [ten("D")]);
  state = trick(state, "Khiladis", [ten("H")]);
  state = trick(state, "Satoris", [ten("C"), plain()], true);

  assert.deepEqual(state.pending, []);
  assert.deepEqual(state.captured.Satoris.map((card) => card.id), ["D10", "H10", "C10"]);
});

test("Dehla scoring supports arbitrary lobby team names", () => {
  let state = trick(createDehlaState(["Nawabs", "Patakhas"]), "Nawabs", [ten("S")]);
  state = trick(state, "Nawabs", [plain()]);

  assert.deepEqual(Object.keys(state.captured), ["Nawabs", "Patakhas"]);
  assert.deepEqual(state.captured.Nawabs.map((card) => card.id), ["S10"]);
});
