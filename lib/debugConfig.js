// lib/debugConfig.js
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

let debugDevices = new Set();

/**
 * Load the list of device IDs for which protocol debugging is enabled.
 * Priority: JSON file in project root → environment variable.
 */
function loadDebugDevices() {
  try {
    // 1. Try JSON file
    const configPath = path.join(__dirname, '..', 'debugDevices.json');
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const list = JSON.parse(data);
      // Ensure it's an array
      if (Array.isArray(list)) {
        debugDevices = new Set(list);
        logger.info(`Loaded debug devices from file: ${Array.from(debugDevices).join(', ')}`);
      } else {
        logger.warn('debugDevices.json does not contain an array');
      }
      return;
    }

    // 2. Fallback to environment variable
    const envList = process.env.DEBUG_DEVICES;
    if (envList) {
      const list = envList.split(',').map(s => s.trim());
      debugDevices = new Set(list);
      logger.info(`Loaded debug devices from environment: ${Array.from(debugDevices).join(', ')}`);
    }
  } catch (err) {
    logger.error('Failed to load debug devices', { error: err });
  }
}

/**
 * Check if a device ID should be debugged.
 * @param {string} uid - Device identifier (IMEI)
 * @returns {boolean}
 */
function isDebugDevice(uid) {
  return debugDevices.has(uid);
}

// Load once at startup
loadDebugDevices();

module.exports = { isDebugDevice };