// electionsData.js
// Data-access helpers for elections.json - mirrors resolutions.js's pattern
// so the rest of the election code reads/writes elections the same way
// resolution code reads/writes resolutions.

const { readJSON, writeJSON } = require('./storage');

function getAllElections() {
  return readJSON('elections.json', []) || [];
}

function saveAllElections(list) {
  writeJSON('elections.json', list);
}

function findElection(number) {
  return getAllElections().find((e) => e.number === number) || null;
}

function upsertElection(election) {
  const list = getAllElections();
  const idx = list.findIndex((e) => e.number === election.number);
  if (idx === -1) list.push(election);
  else list[idx] = election;
  saveAllElections(list);
  return election;
}

// Statuses in which an election is still actively progressing.
const ACTIVE_ELECTION_STATUSES = ['Registration', 'Campaign', 'Voting', 'Tied - Awaiting Manual Resolution'];

module.exports = { getAllElections, saveAllElections, findElection, upsertElection, ACTIVE_ELECTION_STATUSES };
