// config.js
// Central tunables for MEMORY DRIFT: RECALL.exe
// Adjust these to rebalance pacing without touching game logic.

const CONFIG = {
  STORAGE_KEY: "mdr_recall_session_v1",

  ARCHIVE_ID: "A0712.MDR",
  INTERFACE_VERSION: "DIGITAL ARCHIVE INTERFACE v2.4.7",
  PLAYER_ID: "GUEST_038",

  CONFIDENCE_START: 35,
  DRIFT_START: 5,

  MAX_SINGLE_WEIGHT: 0.75,
  WEIGHT_STEP: 0.08,

  // Range of confidence gained per CONFIRM MEMORY action [min, max]
  CONFIRM_CONFIDENCE_GAIN: [8, 15],
  // Range of hidden drift gained per CONFIRM MEMORY action [min, max]
  CONFIRM_DRIFT_GAIN: [5, 12],

  // Range of hidden drift gained per re-open (recall) of a file [min, max]
  RECALL_DRIFT_GAIN: [2, 6],

  // Probability that re-opening a file re-rolls its displayed content
  RECALL_MUTATION_CHANCE: 0.55,

  // Confirmations required before recovery can complete
  CONFIRMS_TO_COMPLETE: 3,

  // Delta applied to confidence when conflict evidence is KEPT
  CONFLICT_KEEP_CONFIDENCE_DELTA: -21,
  CONFLICT_KEEP_DRIFT_GAIN: 6,

  // Delta applied to confidence when conflict evidence is DELETED
  CONFLICT_DELETE_CONFIDENCE_DELTA: 5,
  CONFLICT_DELETE_DRIFT_GAIN: 12,

  // Chance a deleted conflict file resurfaces on the desktop later
  CONFLICT_RESURFACE_CHANCE: 0.45,

  FINAL_CONFIDENCE_DISPLAY: 98
};
