// Combined GPS Server for UT04S and GT06
const net = require("net");
const fs = require("fs");
const path = require("path");

// Determine which env file to load based on NODE_ENV (default to 'development')
const environment = process.env.NODE_ENV || 'development';
const envFile = `.env.${environment}`;
require('dotenv').config({
  path: path.resolve(__dirname, envFile)
});

const gps = require('./lib/server');

// ============================================================================
// Global Configuration
// ============================================================================

/**
 * Moove server base URL and API endpoints derived from environment variables.
 * @constant {string} MOOVE_SERVER_BASE_URL
 * @constant {Object} API_ENDPOINTS
 */
const MOOVE_SERVER_BASE_URL = process.env.MOOVE_SERVER_BASE_URL;

const API_ENDPOINTS = {
  LOCATION: `${MOOVE_SERVER_BASE_URL}/api/gps/location`,
  ALARM: `${MOOVE_SERVER_BASE_URL}/api/gps/alarm`,
  STATUS: `${MOOVE_SERVER_BASE_URL}/api/gps/status`,
  HEARTBEAT: `${MOOVE_SERVER_BASE_URL}/api/gps/heartbeat`,
  LOGIN: `${MOOVE_SERVER_BASE_URL}/api/gps/login`
};

/**
 * Terminal lists for each server type.
 * @constant {Object} terminalLists
 */
const terminalLists = {
  ut04s: {
    crs: [
      '020201228393',
      '020201232938'
    ],
    gpspos: [
      '020201206555',
      '020201205789',
      '020201223132',
      '020201263620',
      '020201292186',
      '020201294976',
      '020201291753',
      '020201228351'
    ]
  },
  gt06: {
    crs: [
      "0868720063451946",
      "0868720063452100",
      "0868720062933829",
      "0864943047255027",
      "0358657103600172",
      "0358657103608399",
      "0358657103600453",
      "0358657105060953",
      "0358657104462051",
      "0868720061903625",
      "0868720061906289",
      "0868720061905174",
      "0868720061898619",
      "0358657104517136",
      "0358657103861956",
      "0358657104813964"
    ],
    gpspos: []
  }
};

/**
 * Checks if a device ID belongs to a given terminal list.
 * @param {string} deviceId - The device identifier.
 * @param {string[]} list - Array of terminal IDs to check against.
 * @returns {boolean} True if the device ID is in the list.
 */
function isTerminalInList(deviceId, list) {
  return list.includes(deviceId);
}

/**
 * Map to hold proxy sockets per device ID: { deviceId: { crs: Socket, gpspos: Socket } }
 */
const deviceProxySockets = new Map();

/**
 * Cleans up proxy sockets for a given device.
 * @param {string} deviceId - Device identifier.
 */
function cleanupProxySockets(deviceId) {
  const sockets = deviceProxySockets.get(deviceId);
  if (sockets) {
    if (sockets.crs) sockets.crs.destroy();
    if (sockets.gpspos) sockets.gpspos.destroy();
    deviceProxySockets.delete(deviceId);
  }
}

/**
 * Forwards raw hex data to external servers (CRS and/or GPSPOS) for a given device.
 * @param {string} deviceId - Device identifier.
 * @param {string} rawHex - Raw message in hex.
 * @param {string} serverType - Either 'ut04s' or 'gt06'.
 */
function forwardToProxy(deviceId, rawHex, serverType) {
  const lists = terminalLists[serverType];
  if (!lists) return;

  const isCrs = isTerminalInList(deviceId, lists.crs);
  const isGpspos = isTerminalInList(deviceId, lists.gpspos);

  if (!isCrs && !isGpspos) return;

  let sockets = deviceProxySockets.get(deviceId);
  if (!sockets) {
    sockets = { crs: null, gpspos: null };
    deviceProxySockets.set(deviceId, sockets);
  }

  const buffer = Buffer.from(rawHex, 'hex');

  // Forward to CRS server if needed
  if (isCrs) {
    const crsPort = serverType === 'ut04s'
      ? process.env.CRS_SERVER_PORT_UT04S
      : process.env.CRS_SERVER_PORT_GTO6;

    if (!sockets.crs || sockets.crs.destroyed) {
      sockets.crs = new net.Socket();
      sockets.crs.connect(crsPort, process.env.CRS_SERVER, () => {});
      sockets.crs.on('error', () => {
        if (sockets.crs) sockets.crs.destroy();
        sockets.crs = null;
        setTimeout(() => {
          if (deviceProxySockets.has(deviceId)) {
            forwardToProxy(deviceId, rawHex, serverType);
          }
        }, 5000);
      });
    }
    if (sockets.crs && !sockets.crs.destroyed) {
      sockets.crs.write(buffer);
    }
  }

  // Forward to GPSPOS server if needed
  if (isGpspos) {
    const gpsposPort = serverType === 'ut04s'
      ? process.env.GPSPOS_SERVER_PORT_UT04S
      : process.env.GPSPOS_SERVER_PORT_GT06;

    if (!sockets.gpspos || sockets.gpspos.destroyed) {
      sockets.gpspos = new net.Socket();
      sockets.gpspos.connect(gpsposPort, process.env.GPSPOS_SERVER, () => {});
      sockets.gpspos.on('error', () => {
        if (sockets.gpspos) sockets.gpspos.destroy();
        sockets.gpspos = null;
        setTimeout(() => {
          if (deviceProxySockets.has(deviceId)) {
            forwardToProxy(deviceId, rawHex, serverType);
          }
        }, 5000);
      });
    }
    if (sockets.gpspos && !sockets.gpspos.destroyed) {
      sockets.gpspos.write(buffer);
    }
  }
}

/**
 * Sends data to a specified API endpoint.
 * @param {string} endpoint - Full URL of the API endpoint.
 * @param {Object} data - Payload to send.
 * @returns {Promise<Object|null>} Parsed JSON response or null on failure.
 */
async function sendToAPI(endpoint, data) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "GPS-Server/1.0"
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    return null;
  }
}

/**
 * Base server options that can be extended per server.
 * @constant {Object} baseServerOptions
 */
const baseServerOptions = {
  debug: true,
  maxConnections: 1000,
  connectionTimeout: 30000,
  keepAlive: true
};

// ============================================================================
// Shared Event Handler
// ============================================================================

/**
 * Sets up all event handlers for a device.
 * @param {Device} device - The device instance.
 * @param {net.Socket} connection - The TCP socket.
 * @param {string} serverType - 'ut04s' or 'gt06'.
 */
function setupDeviceHandlers(device, connection, serverType) {
  device.on('connected', () => {
    // Empty handler per requirement
  });

  device.on('disconnected', () => {
    const devId = device.getUID();
    if (devId) cleanupProxySockets(devId);
  });

  device.on('new_device_first_time', (device_id, msg_parts) => {
    forwardToProxy(device_id, msg_parts.raw_hex, serverType);
    // Optionally log or handle
  });

  device.on('register', (device_id, msg_parts) => {
    device.new_device_register(msg_parts);
    forwardToProxy(device_id, msg_parts.raw_hex, serverType);

    const reg = msg_parts.parsed_register || {};
    sendToAPI(API_ENDPOINTS.LOGIN, {
      device_id,
      imei: device_id,
      protocol_version: 'JT808',
      ip_address: connection.remoteAddress,
      timestamp: new Date().toISOString(),
      crs_proxy: isTerminalInList(device_id, terminalLists[serverType].crs),
      terminal_info: reg,
      raw_preview: msg_parts.raw_hex ? msg_parts.raw_hex.substring(0, 50) : '',
    }).catch(() => {});
  });

  device.on('login_request', (device_id, msg_parts) => {
    device.login_authorized(true, msg_parts);
    forwardToProxy(device_id, msg_parts.raw_hex, serverType);

    const auth = msg_parts.parsed_auth || {};
    sendToAPI(API_ENDPOINTS.LOGIN, {
      device_id,
      imei: device_id,
      protocol_version: serverType === 'ut04s' ? 'JT808' : 'GT06+',
      ip_address: connection.remoteAddress,
      timestamp: new Date().toISOString(),
      crs_proxy: isTerminalInList(device_id, terminalLists[serverType].crs),
      auth_code: auth.authCode || '',
      raw_preview: msg_parts.raw_hex ? msg_parts.raw_hex.substring(0, 50) : '',
    }).catch(() => {});
  });

  device.on('heartbeat', (device_id, msg_parts) => {
    if (serverType === 'ut04s') {
      device.receive_hbt(msg_parts);
    }
    forwardToProxy(device_id, msg_parts.raw_hex, serverType);
    sendToAPI(API_ENDPOINTS.HEARTBEAT, {
      device_id,
      online: true,
      timestamp: new Date().toISOString(),
      type: 'heartbeat',
      crs_proxy: isTerminalInList(device_id, terminalLists[serverType].crs)
    }).catch(() => {});
  });

  device.on('logout', (device_id, msg_parts) => {
    device.logout(msg_parts);
    forwardToProxy(device_id, msg_parts.raw_hex, serverType);
    // No API call for logout
  });

  device.on('ping', (data, msg_parts) => {
    if (serverType === 'ut04s') {
      device.received_location_report(msg_parts);
    }
    forwardToProxy(data.device_id, msg_parts.raw_hex, serverType);

    const payload = {
      device_id: data.device_id,
      latitude: data.latitude,
      longitude: data.longitude,
      speed: data.speed || 0,
      course: data.orientation || data.direction || 0,
      altitude: data.height || data.altitude || 0,
      satellites: data.satellites || 0,
      device_status: data.device_status || {
        alarm_flag: data.alarm_mask,
        status_flags: data.status,
        battery: data.battery,
        gsm_signal: data.gsm_signal
      },
      timestamp: data.date instanceof Date ? data.date.toISOString() : new Date().toISOString(),
      raw_data: msg_parts.raw_hex,
      type: 'location',
      protocol: serverType === 'ut04s' ? 'JT808' : msg_parts.protocol_id || 'GT06',
      crs_proxy: isTerminalInList(data.device_id, terminalLists[serverType].crs)
    };
    sendToAPI(API_ENDPOINTS.LOCATION, payload).catch(() => {});
  });

  device.on('alarm', (alarmData, msg_parts) => {
    if (serverType === 'ut04s') {
      device.received_alarm_report(msg_parts);
    }
    forwardToProxy(alarmData.device_id, msg_parts.raw_hex, serverType);

    const alarmPayload = {
      device_id: alarmData.device_id,
      alarm_type: alarmData.alarm_type,
      alarm_code: alarmData.alarm_code,
      latitude: alarmData.latitude,
      longitude: alarmData.longitude,
      speed: alarmData.speed || 0,
      device_status: alarmData.device_status || {},
      raw_data: alarmData.raw_data || msg_parts.raw_hex,
      timestamp: alarmData.date instanceof Date ? alarmData.date.toISOString() : new Date().toISOString(),
      type: 'alarm',
      protocol: serverType === 'ut04s' ? 'JT808' : msg_parts.protocol_id || 'GT06',
      crs_proxy: isTerminalInList(alarmData.device_id, terminalLists[serverType].crs)
    };
    sendToAPI(API_ENDPOINTS.ALARM, alarmPayload).catch(() => {});

    // Also send location for alarm events
    const locPayload = {
      device_id: alarmData.device_id,
      latitude: alarmData.latitude,
      longitude: alarmData.longitude,
      speed: alarmData.speed || 0,
      course: alarmData.orientation || 0,
      altitude: alarmData.height || 0,
      satellites: alarmData.satellites || 0,
      device_status: alarmData.device_status || {},
      timestamp: alarmData.date instanceof Date ? alarmData.date.toISOString() : new Date().toISOString(),
      raw_data: alarmData.raw_data || msg_parts.raw_hex,
      type: 'location',
      protocol: serverType === 'ut04s' ? 'JT808' : msg_parts.protocol_id || 'GT06',
      crs_proxy: isTerminalInList(alarmData.device_id, terminalLists[serverType].crs)
    };
    sendToAPI(API_ENDPOINTS.LOCATION, locPayload).catch(() => {});
  });

  device.on('other', (device_id, msg_parts) => {
    // Let adapter handle protocol-specific logic (responses, etc.)
    device.adapter.run_other(msg_parts.cmd, msg_parts);
    forwardToProxy(device_id, msg_parts.raw_hex, serverType);

    // Handle JT808 batch location (0x0704)
    if (serverType === 'ut04s' && msg_parts.cmd === '0704' && msg_parts.parsed_batch) {
      for (const loc of msg_parts.parsed_batch) {
        sendToAPI(API_ENDPOINTS.LOCATION, {
          device_id,
          latitude: loc.latitude,
          longitude: loc.longitude,
          speed: loc.speed,
          course: loc.direction,
          altitude: loc.altitude,
          satellites: loc.additional_info.satellites || 0,
          timestamp: loc.timestamp.toISOString(),
          raw_data: loc.raw_data || '',
          type: 'location',
          protocol: 'JT808',
          batch_upload: true,
          crs_proxy: isTerminalInList(device_id, terminalLists[serverType].crs)
        }).catch(() => {});
      }
    }
    // Handle JT808 driver info (0x0702)
    else if (serverType === 'ut04s' && msg_parts.cmd === '0702' && msg_parts.parsed_driver) {
      console.log('Driver info received:', msg_parts.parsed_driver);
    }
    // For GT06, other commands (like lbs_location, status) are just forwarded and logged
    else {
      console.log(`Unhandled other command for ${serverType}:`, msg_parts.cmd, msg_parts.original_action);
    }
  });
}

// ============================================================================
// UT04S Server
// ============================================================================

/**
 * Starts the UT04S GPS server (JT808 protocol).
 * @returns {Object} The created server instance.
 */
function startUT04SServer() {
  const ut04sOptions = {
    ...baseServerOptions,
    port: process.env.GPSPOS_SERVER_PORT_UT04S,
    device_adapter: 'JT808',
  };

  const ut04sServer = gps.server(ut04sOptions, (device, connection) => {
    setupDeviceHandlers(device, connection, 'ut04s');

    // Additional empty handlers per requirement
    connection.on('error', () => {});
    connection.on('close', () => {});
    connection.on('timeout', () => {}); // added missing timeout handler
  });

  ut04sServer.on('error', () => {}); // empty handler

  return ut04sServer;
}

// ============================================================================
// GT06 Server
// ============================================================================

/**
 * Starts the GT06 GPS server.
 * @returns {Object} The created server instance.
 */
function startGT06Server() {
  const gt06Options = {
    ...baseServerOptions,
    port: process.env.GPS_SERVER_PORT_GT06,
    device_adapter: "GT06",
  };

  const gt06Server = gps.server(gt06Options, (device, connection) => {
    setupDeviceHandlers(device, connection, 'gt06');

    connection.on('error', () => {});
    connection.on('close', () => {});
    connection.on('timeout', () => {});
  });

  gt06Server.on('error', () => {});

  return gt06Server;
}

// ============================================================================
// Start both servers
// ============================================================================
const ut04sServer = startUT04SServer();
const gt06Server = startGT06Server();

// ============================================================================
// Graceful shutdown
// ============================================================================

/**
 * Performs a graceful shutdown of both servers.
 * @param {string} signal - The signal that triggered the shutdown.
 */
function gracefulShutdown(signal) {
  const closeServer = (server) => {
    if (server && typeof server.close === 'function') {
      server.close(() => {});
    } else if (server && server.server && typeof server.server.close === 'function') {
      server.server.close(() => {});
    }
  };

  closeServer(ut04sServer);
  closeServer(gt06Server);

  setTimeout(() => {
    process.exit(0);
  }, 3000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Global error handlers (empty per requirement)
process.on('uncaughtException', (err) => {});
process.on('unhandledRejection', (reason, promise) => {});