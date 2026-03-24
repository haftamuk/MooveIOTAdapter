// Combined GPS Server for UT04S and GT06
const net = require('net');
const fs = require('fs');
const path = require('path');

const environment = process.env.NODE_ENV || 'development';
const envFile = `.env.${environment}`;
require('dotenv').config({ path: path.resolve(__dirname, envFile) });

const logger = require('./lib/logger');
const gps = require('./lib/server');
const { isDeviceInList } = require('./lib/deviceConfig');

// ============================================================================
// Proxy-specific logger (child of main logger)
// ============================================================================
const proxyLogger = logger.child({ module: 'proxy' });

// ============================================================================
// Global Configuration
// ============================================================================

const MOOVE_SERVER_BASE_URL = process.env.MOOVE_SERVER_BASE_URL;

const API_ENDPOINTS = {
  LOCATION: `${MOOVE_SERVER_BASE_URL}/api/gps/location`,
  ALARM: `${MOOVE_SERVER_BASE_URL}/api/gps/alarm`,
  STATUS: `${MOOVE_SERVER_BASE_URL}/api/gps/status`,
  HEARTBEAT: `${MOOVE_SERVER_BASE_URL}/api/gps/heartbeat`,
  LOGIN: `${MOOVE_SERVER_BASE_URL}/api/gps/login`,
};

// ============================================================================
// Robust Proxy Connection Manager with File Logging
// ============================================================================

class ProxyTarget {
  constructor(deviceId, host, port, targetType, debugStream = null) {
    this.deviceId = deviceId;
    this.host = host;
    this.port = port;
    this.targetType = targetType; // 'crs' or 'gpspos'
    this.socket = null;
    this.queue = [];
    this.connecting = false;
    this.retryTimeout = null;
    this.retryCount = 0;
    this.debugStream = debugStream; // external stream (from device)
    if (!this.debugStream) {
      this.openLogFile();
    }
  }

  openLogFile() {
    const logDir = path.join(__dirname, 'proxy_logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, `proxy_${this.deviceId}_${this.targetType}.log`);
    this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
    this.log(`Log file opened for ${this.targetType} proxy target ${this.host}:${this.port}`);
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${message}`;
    if (this.debugStream) {
      this.debugStream.write(formatted + '\n');
    } else if (this.logStream) {
      this.logStream.write(formatted + '\n');
    }
  }

  connect() {
    if (this.connecting || (this.socket && !this.socket.destroyed)) return;
    this.connecting = true;
    this.socket = new net.Socket();

    this.socket.connect(this.port, this.host, () => {
      proxyLogger.info(
        `Proxy connected for device ${this.deviceId} to ${this.host}:${this.port}`
      );
      this.log(`Connected to ${this.host}:${this.port} (attempt ${this.retryCount})`);
      this.connecting = false;
      this.retryCount = 0; // reset on successful connection

      // Flush any queued data
      while (this.queue.length) {
        const data = this.queue.shift();
        this.socket.write(data);
        this.log(`Flushed queued data (${data.length} bytes): ${data.toString('hex')}`);
        proxyLogger.debug(
          `Flushed queued data for device ${this.deviceId} to ${this.host}:${this.port}, queue length now ${this.queue.length}`
        );
      }
    });

    this.socket.on('data', (data) => {
      this.log(`Received ${data.length} bytes: ${data.toString('hex')}`);
      // You can handle responses here if needed, e.g., forward back to device
    });

    this.socket.on('error', (err) => {
      proxyLogger.error(
        `Proxy socket error for device ${this.deviceId} to ${this.host}:${this.port}: ${err.message}`
      );
      this.log(`Socket error: ${err.message}`);
      this.socket.destroy();
      this.socket = null;
      this.connecting = false;
      this.scheduleReconnect();
    });

    this.socket.on('close', () => {
      proxyLogger.debug(
        `Proxy socket closed for device ${this.deviceId} to ${this.host}:${this.port}`
      );
      this.log('Connection closed');
      this.socket = null;
      this.connecting = false;

      // If we still have data to send, reconnect automatically
      if (this.queue.length > 0) {
        proxyLogger.debug(
          `Queue not empty after close for device ${this.deviceId}, scheduling reconnect`
        );
        this.log(`Queue not empty (${this.queue.length} items), scheduling reconnect`);
        this.scheduleReconnect();
      }
    });
  }

  scheduleReconnect() {
    if (this.retryTimeout) clearTimeout(this.retryTimeout);

    // Exponential backoff: 2^retryCount seconds, capped at 60 seconds
    const delay = Math.min(60 * 1000, Math.pow(2, this.retryCount) * 1000);
    this.retryCount++;

    proxyLogger.debug(
      `Scheduling reconnect for device ${this.deviceId} to ${this.host}:${this.port} in ${delay}ms (attempt ${this.retryCount})`
    );
    this.log(`Scheduling reconnect in ${delay}ms (attempt ${this.retryCount})`);

    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      this.connect();
    }, delay);
  }

  send(data) {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(data);
      this.log(`Sent ${data.length} bytes: ${data.toString('hex')}`);
      proxyLogger.debug(
        `Sent data to ${this.host}:${this.port} for device ${this.deviceId}`
      );
    } else {
      this.queue.push(data);
      this.log(`Queued ${data.length} bytes (queue length: ${this.queue.length}): ${data.toString('hex')}`);
      proxyLogger.debug(
        `Queued data for device ${this.deviceId} to ${this.host}:${this.port}, queue length: ${this.queue.length}`
      );
      if (!this.connecting && !this.socket) {
        this.connect();
      }
      // If already connecting, do nothing – data will be sent after connection
    }
  }

  destroy() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.queue = [];
    this.connecting = false;
    if (this.logStream) {
      this.log('Proxy target destroyed');
      this.logStream.end();
      this.logStream = null;
    }
    proxyLogger.debug(
      `Proxy target destroyed for device ${this.deviceId} to ${this.host}:${this.port}`
    );
  }
}

// Map: deviceId -> { crs: ProxyTarget, gpspos: ProxyTarget }
const deviceProxyManagers = new Map();

function getProxyManager(device, targetType, serverType) {
  const deviceId = device.getUID();
  if (!deviceId) return null;

  let managers = deviceProxyManagers.get(deviceId);
  if (!managers) {
    managers = {};
    deviceProxyManagers.set(deviceId, managers);
  }

  if (!managers[targetType]) {
    // Determine host and port based on target type and server type
    const host =
      targetType === 'crs'
        ? process.env.CRS_SERVER
        : process.env.GPSPOS_SERVER;

    let port;
    if (targetType === 'crs') {
      port =
        serverType === 'ut04s'
          ? process.env.CRS_SERVER_PORT_UT04S
          : process.env.CRS_SERVER_PORT_GTO6;
    } else {
      port =
        serverType === 'ut04s'
          ? process.env.GPSPOS_SERVER_PORT_UT04S
          : process.env.GPSPOS_SERVER_PORT_GT06;
    }

    if (!host || !port) {
      proxyLogger.error(
        `Missing configuration for proxy ${targetType} (serverType=${serverType}): host=${host}, port=${port}`
      );
      return null; // Skip this proxy
    }

    const debugStream = device.getDebugStream(); // may be null
    managers[targetType] = new ProxyTarget(deviceId, host, port, targetType, debugStream);
    proxyLogger.info(
      `Created proxy manager for device ${deviceId}, target=${targetType}, serverType=${serverType} -> ${host}:${port}`
    );
  }

  return managers[targetType];
}

function forwardToProxy(device, rawHex, serverType) {
  const deviceId = device.getUID();
  if (!deviceId) return;

  const isCrs = isDeviceInList(serverType, deviceId, 'crs');
  const isGpspos = isDeviceInList(serverType, deviceId, 'gpspos');
  if (!isCrs && !isGpspos) return;

  const buffer = Buffer.from(rawHex, 'hex');

  if (isCrs) {
    const mgr = getProxyManager(device, 'crs', serverType);
    if (mgr) mgr.send(buffer);
  }

  if (isGpspos) {
    const mgr = getProxyManager(device, 'gpspos', serverType);
    if (mgr) mgr.send(buffer);
  }
}

function cleanupProxyManagers(deviceId) {
  const managers = deviceProxyManagers.get(deviceId);
  if (managers) {
    if (managers.crs) managers.crs.destroy();
    if (managers.gpspos) managers.gpspos.destroy();
    deviceProxyManagers.delete(deviceId);
    logger.debug(`Proxy managers cleaned up for device ${deviceId}`);
  }
}

// ============================================================================
// API Helper (unchanged)
// ============================================================================

async function sendToAPI(endpoint, data) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GPS-Server/1.0',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      logger.warn(`API call to ${endpoint} returned ${response.status}`, {
        status: response.status,
        data,
      });
      return null;
    }
    return await response.json();
  } catch (error) {
    logger.error(`API call failed to ${endpoint}: ${error.message}`, { error });
    return null;
  }
}

const baseServerOptions = {
  debug: true,
  maxConnections: 1000,
  connectionTimeout: 30000,
  keepAlive: true,
};

// ============================================================================
// Shared Event Handler (updated to use raw_hex_full for proxy)
// ============================================================================

function setupDeviceHandlers(device, connection, serverType) {
  device.on('connected', () =>
    logger.debug(`Device connected (${serverType})`)
  );
  device.on('disconnected', () => {
    const devId = device.getUID();
    if (devId) {
      cleanupProxyManagers(devId);
      logger.debug(`Device ${devId} disconnected (${serverType})`);
    }
  });

  device.on('new_device_first_time', (device_id, msg_parts) => {
    logger.debug(`New device first time: ${device_id}`, {
      device_id,
      msg_parts,
    });
    forwardToProxy(device, msg_parts.raw_hex_full || msg_parts.raw_hex, serverType);
  });

  device.on('register', (device_id, msg_parts) => {
    device.new_device_register(msg_parts);
    forwardToProxy(device, msg_parts.raw_hex_full || msg_parts.raw_hex, serverType);
    logger.info(`Device registered: ${device_id}`, { device_id });

    const reg = msg_parts.parsed_register || {};
    sendToAPI(API_ENDPOINTS.LOGIN, {
      device_id,
      imei: device_id,
      protocol_version: 'JT808',
      ip_address: connection.remoteAddress,
      timestamp: new Date().toISOString(),
      crs_proxy: isDeviceInList(serverType, device_id, 'crs'),
      terminal_info: reg,
      raw_preview: msg_parts.raw_hex ? msg_parts.raw_hex.substring(0, 50) : '',
    }).catch(() => {});
  });

  device.on('login_request', (device_id, msg_parts) => {
    device.login_authorized(true, msg_parts);
    forwardToProxy(device, msg_parts.raw_hex_full || msg_parts.raw_hex, serverType);
    logger.info(`Login request from ${device_id}`, { device_id });

    const auth = msg_parts.parsed_auth || {};
    sendToAPI(API_ENDPOINTS.LOGIN, {
      device_id,
      imei: device_id,
      protocol_version: serverType === 'ut04s' ? 'JT808' : 'GT06+',
      ip_address: connection.remoteAddress,
      timestamp: new Date().toISOString(),
      crs_proxy: isDeviceInList(serverType, device_id, 'crs'),
      auth_code: auth.authCode || '',
      raw_preview: msg_parts.raw_hex ? msg_parts.raw_hex.substring(0, 50) : '',
    }).catch(() => {});
  });

  device.on('heartbeat', (device_id, msg_parts) => {
    if (serverType === 'ut04s') device.receive_hbt(msg_parts);
    else device.adapter.receive_heartbeat(msg_parts);

    forwardToProxy(device, msg_parts.raw_hex_full || msg_parts.raw_hex, serverType);
    logger.debug(`Heartbeat from ${device_id}`, { device_id });
    sendToAPI(API_ENDPOINTS.HEARTBEAT, {
      device_id,
      online: true,
      timestamp: new Date().toISOString(),
      type: 'heartbeat',
      crs_proxy: isDeviceInList(serverType, device_id, 'crs'),
    }).catch(() => {});
  });

  device.on('logout', (device_id, msg_parts) => {
    device.logout(msg_parts);
    forwardToProxy(device, msg_parts.raw_hex_full || msg_parts.raw_hex, serverType);
    logger.info(`Device logout: ${device_id}`, { device_id });
  });

  device.on('ping', (data, msg_parts) => {
    if (serverType === 'ut04s') device.received_location_report(msg_parts);
    forwardToProxy(device, msg_parts.raw_hex_full || msg_parts.raw_hex, serverType);
    logger.debug(`Location from ${data.device_id}`, {
      device_id: data.device_id,
      latitude: data.latitude,
      longitude: data.longitude,
    });

    let dateObj;
    if (data.date instanceof Date && !isNaN(data.date.getTime())) {
      dateObj = data.date;
    } else if (typeof data.date === 'string') {
      dateObj = new Date(data.date);
      if (isNaN(dateObj.getTime())) dateObj = null;
    } else {
      dateObj = null;
    }

    if (!dateObj) {
      logger.error(
        `Invalid or missing timestamp for device ${data.device_id}, location not saved.`
      );
      return;
    }

    // ----- FUTURE DATE FILTER (GT06 only) -----
    if (serverType === 'gt06') {
      const now = Date.now();
      const futureTolerance = 60 * 10000; // 1 minute
      if (dateObj.getTime() > now + futureTolerance) {
        logger.warn(
          `Discarding GT06 location from ${data.device_id} because timestamp is in the future: ${dateObj.toISOString()}`
        );
        return;
      }
    }

    const payload = {
      device_id: data.device_id,
      latitude: data.latitude,
      longitude: data.longitude,
      speed: data.speed || 0,
      course: data.orientation || data.direction || 0,
      altitude: data.height || data.altitude || 0,
      satellites: data.satellites || 0,
      device_status: data.device_status || {},
      timestamp: dateObj.toISOString(),
      raw_data: msg_parts.raw_hex,
      type: 'location',
      protocol: serverType === 'ut04s' ? 'JT808' : 'GT06N',
      crs_proxy: isDeviceInList(serverType, data.device_id, 'crs'),
    };

    if (serverType !== 'ut04s' && msg_parts.protocol_id) {
      payload.protocol_id = msg_parts.protocol_id;
    }

    sendToAPI(API_ENDPOINTS.LOCATION, payload).catch(() => {});
  });

  device.on('alarm', (alarmData, msg_parts) => {
    if (serverType === 'ut04s') device.received_alarm_report(msg_parts);
    else device.adapter.send_alarm_response(msg_parts);

    forwardToProxy(device, msg_parts.raw_hex_full || msg_parts.raw_hex, serverType);
    logger.warn(`Alarm from ${alarmData.device_id}: ${alarmData.alarm_type}`, {
      alarmData,
    });

    let dateObj;
    if (alarmData.date instanceof Date && !isNaN(alarmData.date.getTime())) {
      dateObj = alarmData.date;
    } else if (typeof alarmData.date === 'string') {
      dateObj = new Date(alarmData.date);
      if (isNaN(dateObj.getTime())) dateObj = null;
    } else {
      dateObj = null;
    }

    if (!dateObj) {
      logger.error(
        `Invalid or missing timestamp for alarm from device ${alarmData.device_id}, alarm not saved.`
      );
      return;
    }

    // ========== FIX: Ensure device_id is always present ==========
    const safeDeviceId = device.getUID(); // guaranteed to be the correct device ID

    const alarmPayload = {
      device_id: safeDeviceId,                     // was alarmData.device_id
      alarm_type: alarmData.alarm_type,
      alarm_code: alarmData.alarm_code,
      latitude: alarmData.latitude,
      longitude: alarmData.longitude,
      speed: alarmData.speed || 0,
      device_status: alarmData.device_status || {},
      raw_data: alarmData.raw_data || msg_parts.raw_hex,
      timestamp: dateObj.toISOString(),
      type: 'alarm',
      protocol: serverType === 'ut04s' ? 'JT808' : 'GT06N',
      crs_proxy: isDeviceInList(serverType, safeDeviceId, 'crs'),
    };
    if (serverType !== 'ut04s' && msg_parts.protocol_id) {
      alarmPayload.protocol_id = msg_parts.protocol_id;
    }
    sendToAPI(API_ENDPOINTS.ALARM, alarmPayload).catch(() => {});

    const locPayload = {
      device_id: safeDeviceId,                     // was alarmData.device_id
      latitude: alarmData.latitude,
      longitude: alarmData.longitude,
      speed: alarmData.speed || 0,
      course: alarmData.orientation || 0,
      altitude: alarmData.height || 0,
      satellites: alarmData.satellites || 0,
      device_status: alarmData.device_status || {},
      timestamp: dateObj.toISOString(),
      raw_data: alarmData.raw_data || msg_parts.raw_hex,
      type: 'AlarmLocation',
      protocol: serverType === 'ut04s' ? 'JT808' : 'GT06N',
      crs_proxy: isDeviceInList(serverType, safeDeviceId, 'crs'),
    };
    if (serverType !== 'ut04s' && msg_parts.protocol_id) {
      locPayload.protocol_id = msg_parts.protocol_id;
    }
    sendToAPI(API_ENDPOINTS.LOCATION, locPayload).catch(() => {});
  });

  device.on('other', (device_id, msg_parts) => {
    device.adapter.run_other(msg_parts.cmd, msg_parts);
    forwardToProxy(device, msg_parts.raw_hex_full || msg_parts.raw_hex, serverType);

    if (
      serverType === 'ut04s' &&
      msg_parts.cmd === '0704' &&
      msg_parts.parsed_batch
    ) {
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
          type: 'BatchLocation',
          protocol: 'JT808',
          batch_upload: true,
          crs_proxy: isDeviceInList(serverType, device_id, 'crs'),
        }).catch(() => {});
      }
    } else if (
      serverType === 'ut04s' &&
      msg_parts.cmd === '0702' &&
      msg_parts.parsed_driver
    ) {
      logger.debug('Driver info received:', msg_parts.parsed_driver);
    } else {
      logger.debug(
        `Unhandled other command for ${serverType}: ${msg_parts.cmd}`,
        { msg_parts }
      );
    }
  });
}

// ============================================================================
// UT04S Server (unchanged)
// ============================================================================

function startUT04SServer() {
  const ut04sOptions = {
    ...baseServerOptions,
    port: process.env.GPS_SERVER_PORT_JT808,
    device_adapter: 'JT808',
  };

  const ut04sServer = gps.server(ut04sOptions, (device, connection) => {
    setupDeviceHandlers(device, connection, 'ut04s');

    connection.on('error', (err) => {
      logger.error(
        `UT04S connection error for device ${device.getUID ? device.getUID() : 'unknown'}: ${err.message}`,
        { error: err }
      );
    });
    connection.on('close', () => {
      logger.debug(
        `UT04S connection closed for device ${device.getUID ? device.getUID() : 'unknown'}`
      );
    });
    connection.on('timeout', () => {
      logger.warn(
        `UT04S connection timeout for device ${device.getUID ? device.getUID() : 'unknown'}`
      );
    });
  });

  ut04sServer.on('error', (err) => {
    logger.error(`UT04S server error: ${err.message}`, { error: err });
  });

  return ut04sServer;
}

// ============================================================================
// GT06 Server (unchanged)
// ============================================================================

function startGT06Server() {
  const gt06Options = {
    ...baseServerOptions,
    port: process.env.GPS_SERVER_PORT_GT06,
    device_adapter: 'GT06',
  };

  const gt06Server = gps.server(gt06Options, (device, connection) => {
    setupDeviceHandlers(device, connection, 'gt06');

    connection.on('error', (err) => {
      logger.error(
        `GT06 connection error for device ${device.getUID ? device.getUID() : 'unknown'}: ${err.message}`,
        { error: err }
      );
    });
    connection.on('close', () => {
      logger.debug(
        `GT06 connection closed for device ${device.getUID ? device.getUID() : 'unknown'}`
      );
    });
    connection.on('timeout', () => {
      logger.warn(
        `GT06 connection timeout for device ${device.getUID ? device.getUID() : 'unknown'}`
      );
    });
  });

  gt06Server.on('error', (err) => {
    logger.error(`GT06 server error: ${err.message}`, { error: err });
  });

  return gt06Server;
}

// ============================================================================
// Start both servers
// ============================================================================
const ut04sServer = startUT04SServer();
const gt06Server = startGT06Server();

logger.info('GPS servers started', {
  ut04s_port: process.env.GPS_SERVER_PORT_JT808,
  gt06_port: process.env.GPS_SERVER_PORT_GT06,
});

// ============================================================================
// Graceful shutdown (unchanged)
// ============================================================================

function gracefulShutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  for (const [devId, managers] of deviceProxyManagers.entries()) {
    if (managers.crs) managers.crs.destroy();
    if (managers.gpspos) managers.gpspos.destroy();
  }
  deviceProxyManagers.clear();

  const closeServer = (server) => {
    if (server && typeof server.close === 'function') server.close(() => {});
    else if (
      server &&
      server.server &&
      typeof server.server.close === 'function'
    )
      server.server.close(() => {});
  };

  closeServer(ut04sServer);
  closeServer(gt06Server);

  setTimeout(() => {
    logger.info('Shutdown complete.');
    process.exit(0);
  }, 3000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err });
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});