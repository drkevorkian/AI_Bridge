'use strict';

/**
 * Compatibility entry point.
 *
 * Round 4 removed A's independent durable rollover state machine. Durable
 * rollover truth now belongs to the canonical backend RolloverCoordinator.
 */
module.exports = require('./thread-rollover-orchestrator.js');
