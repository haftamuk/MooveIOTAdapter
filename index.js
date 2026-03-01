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

console.log(`Loaded environment: ${environment} from ${envFile}`);


// Import the whole module object
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
 * UT04S uses crs and gpspos; GT06 only uses crs.
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
        gpspos: [
    ]
  }
};

/**
 * Checks if a device ID belongs to a given terminal list.
 * @param {string} deviceId - The device identifier (12‑character hex string).
 * @param {string[]} list - Array of terminal IDs to check against.
 * @returns {boolean} True if the device ID is in the list.
 */
function isTerminalInList(deviceId, list) {
  return list.includes(deviceId);
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
// UT04S Server Configuration and Logic
// ============================================================================

/**
 * Starts the UT04S GPS server.
 * Listens for UT04S protocol messages, processes them, and forwards raw data
 * to external CRS and GPSPOS servers for specific terminals.
 * @returns {Object} The created server instance.
 */
function startUT04SServer() {
  const ut04sOptions = {
    ...baseServerOptions,
    port: process.env.GPSPOS_SERVER_PORT_UT04S,
    device_adapter: 'JT808',
  };

  // Map to hold proxy sockets per device ID: { deviceId: { crs: Socket, gpspos: Socket } }
  const deviceProxySockets = new Map();

  /**
   * Forwards raw hex data to external servers (CRS and/or GPSPOS) for a given device.
   * @param {string} deviceId - 12‑character device ID (hex string).
   * @param {string} rawHex - Raw message in hex (from msg_parts.raw_hex).
   */
  function forwardToProxy(deviceId, rawHex) {
    const isCrs = isTerminalInList(deviceId, terminalLists.ut04s.crs);
    const isGpspos = isTerminalInList(deviceId, terminalLists.ut04s.gpspos);

    if (!isCrs && !isGpspos) return;

    // Get or create socket objects for this device
    let sockets = deviceProxySockets.get(deviceId);
    if (!sockets) {
      sockets = { crs: null, gpspos: null };
      deviceProxySockets.set(deviceId, sockets);
    }

    const buffer = Buffer.from(rawHex, 'hex');

    // Forward to CRS server if needed
    if (isCrs) {
      if (!sockets.crs || sockets.crs.destroyed) {
        sockets.crs = new net.Socket();
        sockets.crs.connect(process.env.CRS_SERVER_PORT_UT04S, process.env.CRS_SERVER, () => {});
        sockets.crs.on('error', () => {
          if (sockets.crs) sockets.crs.destroy();
          sockets.crs = null;
          setTimeout(() => {
            if (deviceProxySockets.has(deviceId)) {
              forwardToProxy(deviceId, rawHex);
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
      if (!sockets.gpspos || sockets.gpspos.destroyed) {
        sockets.gpspos = new net.Socket();
        sockets.gpspos.connect(process.env.GPSPOS_SERVER_PORT_UT04S, process.env.GPSPOS_SERVER, () => {});
        sockets.gpspos.on('error', () => {
          if (sockets.gpspos) sockets.gpspos.destroy();
          sockets.gpspos = null;
          setTimeout(() => {
            if (deviceProxySockets.has(deviceId)) {
              forwardToProxy(deviceId, rawHex);
            }
          }, 5000);
        });
      }
      if (sockets.gpspos && !sockets.gpspos.destroyed) {
        sockets.gpspos.write(buffer);
      }
    }
  }

  // Create and start the UT04S server
  const ut04sServer = gps.server(ut04sOptions, (device, connection) => {
    // Device connected
    device.on('connected', () => {});

    // Device disconnected – clean up proxy sockets
    device.on('disconnected', () => {
      const devId = device.getUID();
      const sockets = deviceProxySockets.get(devId);
      if (sockets) {
        if (sockets.crs) sockets.crs.destroy();
        if (sockets.gpspos) sockets.gpspos.destroy();
        deviceProxySockets.delete(devId);
      }
    });

    // Terminal registration (0x0100)
    device.on('register', (device_id, msg_parts) => {
      device.new_device_register(msg_parts);
      forwardToProxy(device_id, msg_parts.raw_hex);
    });

    // Terminal authentication / login (0x0102)
    device.on('login_request', (device_id, msg_parts) => {
      device.login_authorized(true, msg_parts);
      forwardToProxy(device_id, msg_parts.raw_hex);
    });

    // Heartbeat (0x0002)
    device.on('hbt', (device_id, msg_parts) => {
      device.receive_hbt(msg_parts);
      forwardToProxy(device_id, msg_parts.raw_hex);
    });

    // Terminal logout (0x0003)
    device.on('logout', (device_id, msg_parts) => {
      device.logout(msg_parts);
      forwardToProxy(device_id, msg_parts.raw_hex);
    });

    // Location report (0x0200 without alarm)
    device.on('ping', (data, msg_parts) => {
      device.received_location_report(msg_parts);
      forwardToProxy(data.device_id, msg_parts.raw_hex);
    });

    // Alarm report (0x0200 with alarm flag)
    device.on('alarm', (alarmData, msg_parts) => {
      device.received_alarm_report(msg_parts);
      forwardToProxy(alarmData.device_id, msg_parts.raw_hex);
    });

    // Other commands (0x0107, 0x0704, 0x0702, etc.)
    device.on('other', (device_id, msg_parts) => {
      device.adapter.run_other(msg_parts.cmd, msg_parts);
      forwardToProxy(device_id, msg_parts.raw_hex);
    });

    // Optional: log raw data that is not forwarded (removed)
    connection.on('data', (data) => {});

    // Connection error handling
    connection.on('error', (err) => {});

    // Connection close (already handled by device.disconnected)
    connection.on('close', () => {});
  });

  ut04sServer.on('error', (err) => {});

  return ut04sServer;
}

// ============================================================================
// GT06 Server Configuration and Logic
// ============================================================================

/**
 * Queue for limiting concurrent API requests.
 */
class RequestQueue {
  /**
   * Creates a request queue.
   * @param {number} maxConcurrent - Maximum number of concurrent requests.
   */
  constructor(maxConcurrent = 5) {
    this.queue = [];
    this.active = 0;
    this.maxConcurrent = maxConcurrent;
    this.totalProcessed = 0;
    this.totalErrors = 0;
  }

  /**
   * Adds a request function to the queue.
   * @param {Function} requestFn - Async function that performs the request.
   * @param {string} description - Description for logging (now unused).
   * @returns {Promise<any>} Resolves with the request result.
   */
  async add(requestFn, description = 'request') {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject, description });
      this.process();
    });
  }

  async process() {
    if (this.active >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.active++;
    const { requestFn, resolve, reject } = this.queue.shift();

    try {
      const result = await requestFn();
      this.totalProcessed++;
      resolve(result);
    } catch (error) {
      this.totalErrors++;
      reject(error);
    } finally {
      this.active--;
      this.process();
    }
  }

  /**
   * Returns current queue statistics.
   * @returns {Object} Stats object.
   */
  getStats() {
    return {
      active: this.active,
      queued: this.queue.length,
      totalProcessed: this.totalProcessed,
      totalErrors: this.totalErrors
    };
  }
}

const requestQueue = new RequestQueue(3);

/**
 * Creates a TCP client connection to the CRS proxy server.
 * @returns {net.Socket|null} The connected socket, or null on failure.
 */
function createCrsConnection() {
  if (!process.env.CRS_SERVER || !process.env.CRS_SERVER_PORT_GTO6) {
    return null;
  }

  try {
    const client = new net.Socket();

    client.setTimeout(30000);
    client.setKeepAlive(true, 10000);

    client.on('connect', () => {});
    client.on('error', () => {});
    client.on('timeout', () => { client.destroy(); });
    client.on('close', () => {});
    client.on('end', () => {});

    client.connect(process.env.CRS_SERVER_PORT_GTO6, process.env.CRS_SERVER, () => {});

    return client;
  } catch (error) {
    return null;
  }
}

/**
 * Sends data to a specified API endpoint via the request queue.
 * @param {string} endpoint - Full URL of the API endpoint.
 * @param {Object} data - Payload to send.
 * @param {string} description - Description for the queue (unused in logging now).
 * @returns {Promise<Object|null>} Parsed JSON response or null on failure.
 */
async function sendToAPI(endpoint, data, description = 'API request') {
  return requestQueue.add(async () => {
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
  }, description);
}

/**
 * Starts the GT06 GPS server.
 * Listens for GT06 protocol messages, processes them, and forwards data
 * to the Moove API and optionally to the CRS proxy.
 * @returns {Object} The created server instance.
 */
function startGT06Server() {
  const gt06Options = {
    ...baseServerOptions,
    port: process.env.GPS_SERVER_PORT_GT06,
    device_adapter: "GT06",
  };

  const crsTerminals = terminalLists.gt06.crs;

  // Create and start the GT06 server
  const gt06Server = gps.server(gt06Options, function (device, connection) {
    let crsClient = null;
    let is_proxy_CRS_device = false;
    let deviceId = null;
    let connectionStartTime = Date.now();
    let packetsReceived = 0;

    connection.on('error', () => {});
    connection.on('close', () => {
      if (crsClient) {
        try { crsClient.destroy(); } catch (e) { /* ignore */ }
      }
    });
    connection.on('timeout', () => {});

    device.on("login_request", function (device_id, msg_parts) {
      packetsReceived++;
      deviceId = device_id;

      let analysis = {};
      if (msg_parts.analysis && Object.keys(msg_parts.analysis).length > 0) {
        analysis = msg_parts.analysis;
      } else {
        analysis = {
          protocolNumber: msg_parts.protocol_id || 'unknown',
          packetType: 'Login',
          brands: ['GT06 Family'],
          protocols: ['GT06']
        };
      }

      this.login_authorized(true);
      is_proxy_CRS_device = isTerminalInList(device_id, crsTerminals);

      if (is_proxy_CRS_device && !crsClient) {
        crsClient = createCrsConnection();
      }

      sendToAPI(API_ENDPOINTS.LOGIN, {
        device_id: device_id,
        imei: device_id,
        protocol_version: "GT06+",
        ip_address: connection.remoteAddress,
        timestamp: new Date().toISOString(),
        crs_proxy: is_proxy_CRS_device,
        brand_info: analysis.brands || [],
        protocol_info: analysis.protocols || [],
        packet_type: analysis.packetType,
        protocol_number: analysis.protocolNumber,
        raw_preview: msg_parts.raw ? msg_parts.raw.substring(0, 50) : '',
        analysis: analysis
      }, `Login for ${device_id}`).catch(() => {});
    });

    device.on("ping", function (data, msg_parts) {
      packetsReceived++;
      if (!data.device_id) {
        return;
      }

      deviceId = data.device_id;
      is_proxy_CRS_device = isTerminalInList(data.device_id, crsTerminals);

      sendToAPI(API_ENDPOINTS.LOCATION, {
        device_id: data.device_id,
        latitude: data.latitude,
        longitude: data.longitude,
        speed: data.speed || 0,
        course: data.orientation || 0,
        satellites: data.satellites || 0,
        raw_data: data.raw_data || '',
        timestamp: data.date || new Date().toISOString(),
        type: 'location',
        protocol: msg_parts.protocol_id,
        crs_proxy: is_proxy_CRS_device
      }, `Location for ${data.device_id}`).catch(() => {});
    });

    device.on("alarm", function (alarm_code, alarm_data, msg_parts) {
      packetsReceived++;
      if (!alarm_data.device_id) {
        return;
      }

      deviceId = alarm_data.device_id;
      is_proxy_CRS_device = isTerminalInList(alarm_data.device_id, crsTerminals);

      sendToAPI(API_ENDPOINTS.ALARM, {
        device_id: alarm_data.device_id,
        alarm_type: alarm_data.alarm_type,
        alarm_code: alarm_data.alarm_code || alarm_code,
        latitude: alarm_data.latitude,
        longitude: alarm_data.longitude,
        speed: alarm_data.speed || 0,
        parsed_details: alarm_data.parsed_details || {},
        raw_data: alarm_data.raw_data || '',
        timestamp: alarm_data.date || new Date().toISOString(),
        type: 'alarm',
        protocol: msg_parts.protocol_id,
        crs_proxy: is_proxy_CRS_device
      }, `Alarm for ${alarm_data.device_id}`).catch(() => {});
    });

    device.on("heartbeat", function (data, msg_parts) {
      packetsReceived++;
      const devId = data.device_id || device.getUID();
      if (!devId) return;

      is_proxy_CRS_device = isTerminalInList(devId, crsTerminals);

      sendToAPI(API_ENDPOINTS.HEARTBEAT, {
        device_id: devId,
        online: true,
        timestamp: new Date().toISOString(),
        type: 'heartbeat',
        crs_proxy: is_proxy_CRS_device
      }, `Heartbeat for ${devId}`).catch(() => {});
    });

    device.on("connected", function () {});
    device.on("disconnected", function () {
      if (crsClient) {
        try { crsClient.destroy(); } catch (e) { /* ignore */ }
      }
    });

    // Handle incoming data for CRS proxying
    connection.on("data", function (data) {
      if (is_proxy_CRS_device && crsClient) {
        try {
          if (crsClient.writable) {
            crsClient.write(data);
          } else {
            crsClient.destroy();
            crsClient = createCrsConnection();
          }
        } catch (error) {
          // ignore
        }
      }
    });
  });

  gt06Server.on("error", function (err) {});

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
  // Close UT04S server
  if (ut04sServer && typeof ut04sServer.close === 'function') {
    ut04sServer.close(() => {});
  } else if (ut04sServer && ut04sServer.server && typeof ut04sServer.server.close === 'function') {
    ut04sServer.server.close(() => {});
  }

  // Close GT06 server
  if (gt06Server && typeof gt06Server.close === 'function') {
    gt06Server.close(() => {});
  } else if (gt06Server && gt06Server.server && typeof gt06Server.server.close === 'function') {
    gt06Server.server.close(() => {});
  }

  // Allow time for cleanup then exit
  setTimeout(() => {
    process.exit(0);
  }, 3000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Global error handlers
process.on('uncaughtException', (err) => {});
process.on('unhandledRejection', (reason, promise) => {});