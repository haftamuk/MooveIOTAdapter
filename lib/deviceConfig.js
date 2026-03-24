// lib/deviceConfig.js
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

let config = {
  ut04s: { crs: [], gpspos: [], debug: [] },
  gt06: { crs: [], gpspos: [], debug: [] }
};

function loadConfig() {
  try {
    const configPath = path.join(__dirname, '..', 'terminalList.json');
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const loaded = JSON.parse(data);
      // Validate structure
      if (loaded.ut04s && loaded.gt06) {
        config = loaded;
        logger.info('Loaded terminal list from terminalList.json');
      } else {
        logger.warn('terminalList.json missing required sections (ut04s, gt06)');
      }
    } else {
      logger.warn('terminalList.json not found, using empty lists');
    }
  } catch (err) {
    logger.error('Failed to load terminalList.json', { error: err });
  }
}

// Load on startup
loadConfig();

/**
 * Check if a device is in a specific list for its protocol.
 * @param {string} protocol - 'ut04s' or 'gt06'
 * @param {string} deviceId
 * @param {string} listType - 'crs', 'gpspos', 'debug'
 * @returns {boolean}
 */
function isDeviceInList(protocol, deviceId, listType) {
  const protoConfig = config[protocol];
  if (!protoConfig) return false;
  const list = protoConfig[listType];
  return Array.isArray(list) && list.includes(deviceId);
}

/**
 * Check if a device should have protocol debugging enabled.
 * @param {string} protocol
 * @param {string} deviceId
 * @returns {boolean}
 */
function isDebugDevice(protocol, deviceId) {
  return isDeviceInList(protocol, deviceId, 'debug');
}

module.exports = { isDeviceInList, isDebugDevice };