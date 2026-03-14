function createLedger() {
  return {
    task: {
      plan: [],
      todos: [],
      facts: [],
      notes: []
    },
    progress: {
      turns: 0,
      maxTurnsReached: false,
      stallDetected: false,
      done: false
    }
  };
}

function addUnique(list, value) {
  const v = String(value || "").trim();
  if (!v) return false;
  if (list.includes(v)) return false;
  list.push(v);
  return true;
}

module.exports = { createLedger, addUnique };
