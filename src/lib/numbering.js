// numbering.js
// Generates the next official number for a resolution or election (e.g.
// UNGA/2026/001 or ELEC/2026/001), based on whatever format the admin
// configured. Both share the same counters.json file - since each series
// has its own prefix, they never collide.

const { readJSON, writeJSON } = require('./storage');

function nextNumber(numberingConfig) {
  const counters = readJSON('counters.json', {}) || {};
  const { prefix, format, resetYearly } = numberingConfig;
  const year = new Date().getFullYear();
  const key = resetYearly ? `${prefix}-${year}` : `${prefix}`;

  const seq = (counters[key] || 0) + 1;
  counters[key] = seq;
  writeJSON('counters.json', counters);

  const padded = String(seq).padStart(3, '0');
  return format
    .replace('{prefix}', prefix)
    .replace('{year}', String(year))
    .replace('{seq}', padded);
}

function nextResolutionNumber(config) {
  return nextNumber(config.resolutionNumbering);
}

function nextElectionNumber(config) {
  return nextNumber(config.elections.numbering);
}

module.exports = { nextNumber, nextResolutionNumber, nextElectionNumber };
