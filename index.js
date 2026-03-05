// Combined GPS Server for UT04S and GT06
const net = require("net");
const fs = require("fs");
const path = require("path");

const environment = process.env.NODE_ENV || 'development';
const envFile = `.env.${environment}`;
require('dotenv').config({ path: path.resolve(__dirname, envFile) });

const logger = require('./lib/logger');
const gps = require('./lib/server');

// ============================================================================
// Global Configuration
// ============================================================================

const MOOVE_SERVER_BASE_URL = process.env.MOOVE_SERVER_BASE_URL;

const API_ENDPOINTS = {
  LOCATION: `${MOOVE_SERVER_BASE_URL}/api/gps/location`,
  ALARM: `${MOOVE_SERVER_BASE_URL}/api/gps/alarm`,
  STATUS: `${MOOVE_SERVER_BASE_URL}/api/gps/status`,
  HEARTBEAT: `${MOOVE_SERVER_BASE_URL}/api/gps/heartbeat`,
  LOGIN: `${MOOVE_SERVER_BASE_URL}/api/gps/login`
};

const terminalLists = {
  ut04s: {
    crs: ['020201232938', '020201228393'],
    gpspos: ['020201232938', '020201228393', '020201292186', '020201228351', '020201205789', '020201223132', '020201294976', '020201206555', '020201291753', '020201263620']
  },
  gt06: {
    crs: ["0868720063451946", "0868720063452100", "0868720062933829", "0864943047255027", "0358657103600172", "0358657103608399", "0358657103600453", "0358657105060953", "0358657104462051", "0868720061903625", "0868720061906289", "0868720061905174", "0868720061898619", "0358657104517136", "0358657103861956", "0358657104813964"],
    gpspos: ["0868720063451946", "0358657104813964"]
  }
};

function isTerminalInList(deviceId, list) {
  return list.includes(deviceId);
}

const deviceProxySockets = new Map();

function cleanupProxySockets(deviceId) {
  const sockets = deviceProxySockets.get(deviceId);
  if (sockets) {
    if (sockets.crs) sockets.crs.destroy();
    if (sockets.gpspos) sockets.gpspos.destroy();
    deviceProxySockets.delete(deviceId);
    logger.debug(`Proxy sockets cleaned up for device ${deviceId}`);
  }
}

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

  if (isCrs) {
    const crsPort = serverType === 'ut04s' ? process.env.CRS_SERVER_PORT_UT04S : process.env.CRS_SERVER_PORT_GTO6;
    if (!sockets.crs || sockets.crs.destroyed) {
      sockets.crs = new net.Socket();
      sockets.crs.connect(crsPort, process.env.CRS_SERVER, () => {
        logger.debug(`CRS proxy connected for device ${deviceId}`);
      });
      sockets.crs.on('error', (err) => {
        logger.error(`CRS proxy error for device ${deviceId}: ${err.message}`, { error: err });
        if (sockets.crs) sockets.crs.destroy();
        sockets.crs = null;
        setTimeout(() => {
          if (deviceProxySockets.has(deviceId)) forwardToProxy(deviceId, rawHex, serverType);
        }, 5000);
      });
    }
    if (sockets.crs && !sockets.crs.destroyed) sockets.crs.write(buffer);
  }

  if (isGpspos) {
    const gpsposPort = serverType === 'ut04s' ? process.env.GPSPOS_SERVER_PORT_UT04S : process.env.GPSPOS_SERVER_PORT_GT06;
    if (!sockets.gpspos || sockets.gpspos.destroyed) {
      sockets.gpspos = new net.Socket();
      sockets.gpspos.connect(gpsposPort, process.env.GPSPOS_SERVER, () => {
        logger.debug(`GPSPOS proxy connected for device ${deviceId}`);
      });
      sockets.gpspos.on('error', (err) => {
        logger.error(`GPSPOS proxy error for device ${deviceId}: ${err.message}`, { error: err });
        if (sockets.gpspos) sockets.gpspos.destroy();
        sockets.gpspos = null;
        setTimeout(() => {
          if (deviceProxySockets.has(deviceId)) forwardToProxy(deviceId, rawHex, serverType);
        }, 5000);
      });
    }
    if (sockets.gpspos && !sockets.gpspos.destroyed) sockets.gpspos.write(buffer);
  }
}

async function sendToAPI(endpoint, data) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "GPS-Server/1.0" },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      logger.warn(`API call to ${endpoint} returned ${response.status}`, { status: response.status, data });
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
  keepAlive: true
};

// ============================================================================
// Shared Event Handler
// ============================================================================

function setupDeviceHandlers(device, connection, serverType) {
  device.on('connected', () => logger.debug(`Device connected (${serverType})`));
  device.on('disconnected', () => {
    const devId = device.getUID();
    if (devId) {
      cleanupProxySockets(devId);
      logger.debug(`Device ${devId} disconnected (${serverType})`);
    }
  });

  device.on('new_device_first_time', (device_id, msg_parts) => {
    logger.debug(`New device first time: ${device_id}`, { device_id, msg_parts });
    forwardToProxy(device_id, msg_parts.raw_hex, serverType);
  });

  device.on('register', (device_id, msg_parts) => {
    device.new_device_register(msg_parts);
    forwardToProxy(device_id, msg_parts.raw_hex, serverType);
    logger.info(`Device registered: ${device_id}`, { device_id });

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
    logger.info(`Login request from ${device_id}`, { device_id });

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
    if (serverType === 'ut04s') device.receive_hbt(msg_parts);
    else device.adapter.receive_heartbeat(msg_parts);

    forwardToProxy(device_id, msg_parts.raw_hex, serverType);
    logger.debug(`Heartbeat from ${device_id}`, { device_id });
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
    logger.info(`Device logout: ${device_id}`, { device_id });
  });

  device.on('ping', (data, msg_parts) => {
    if (serverType === 'ut04s') device.received_location_report(msg_parts);
    forwardToProxy(data.device_id, msg_parts.raw_hex, serverType);
    logger.debug(`Location from ${data.device_id}`, {
      device_id: data.device_id,
      latitude: data.latitude,
      longitude: data.longitude
    });

    // Build payload with correct protocol fields
    const payload = {
      device_id: data.device_id,
      latitude: data.latitude,
      longitude: data.longitude,
      speed: data.speed || 0,
      course: data.orientation || data.direction || 0,
      altitude: data.height || data.altitude || 0,
      satellites: data.satellites || 0,
      device_status: data.device_status || {},
      timestamp: data.date instanceof Date ? data.date.toISOString() : new Date().toISOString(),
      raw_data: msg_parts.raw_hex,
      type: 'location',
      // Set protocol name
      protocol: serverType === 'ut04s' ? 'JT808' : 'GT06N',
      crs_proxy: isTerminalInList(data.device_id, terminalLists[serverType].crs)
    };

    // For GT06, include the numeric protocol_id if it exists
    if (serverType !== 'ut04s' && msg_parts.protocol_id) {
      payload.protocol_id = msg_parts.protocol_id;
    }

    sendToAPI(API_ENDPOINTS.LOCATION, payload).catch(() => {});
  });

  device.on('alarm', (alarmData, msg_parts) => {
    if (serverType === 'ut04s') device.received_alarm_report(msg_parts);
    else device.adapter.send_alarm_response(msg_parts);

    forwardToProxy(alarmData.device_id, msg_parts.raw_hex, serverType);
    logger.warn(`Alarm from ${alarmData.device_id}: ${alarmData.alarm_type}`, { alarmData });

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
      protocol: serverType === 'ut04s' ? 'JT808' : 'GT06N',
      crs_proxy: isTerminalInList(alarmData.device_id, terminalLists[serverType].crs)
    };
    if (serverType !== 'ut04s' && msg_parts.protocol_id) {
      alarmPayload.protocol_id = msg_parts.protocol_id;
    }
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
      protocol: serverType === 'ut04s' ? 'JT808' : 'GT06N',
      crs_proxy: isTerminalInList(alarmData.device_id, terminalLists[serverType].crs)
    };
    if (serverType !== 'ut04s' && msg_parts.protocol_id) {
      locPayload.protocol_id = msg_parts.protocol_id;
    }
    sendToAPI(API_ENDPOINTS.LOCATION, locPayload).catch(() => {});
  });

  device.on('other', (device_id, msg_parts) => {
    device.adapter.run_other(msg_parts.cmd, msg_parts);
    forwardToProxy(device_id, msg_parts.raw_hex, serverType);

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
    } else if (serverType === 'ut04s' && msg_parts.cmd === '0702' && msg_parts.parsed_driver) {
      logger.debug('Driver info received:', msg_parts.parsed_driver);
    } else {
      logger.debug(`Unhandled other command for ${serverType}: ${msg_parts.cmd}`, { msg_parts });
    }
  });
}

// ============================================================================
// UT04S Server
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
      logger.error(`UT04S connection error for device ${device.getUID ? device.getUID() : 'unknown'}: ${err.message}`, { error: err });
    });
    connection.on('close', () => {
      logger.debug(`UT04S connection closed for device ${device.getUID ? device.getUID() : 'unknown'}`);
    });
    connection.on('timeout', () => {
      logger.warn(`UT04S connection timeout for device ${device.getUID ? device.getUID() : 'unknown'}`);
    });
  });

  ut04sServer.on('error', (err) => {
    logger.error(`UT04S server error: ${err.message}`, { error: err });
  });

  return ut04sServer;
}

// ============================================================================
// GT06 Server
// ============================================================================

function startGT06Server() {
  const gt06Options = {
    ...baseServerOptions,
    port: process.env.GPS_SERVER_PORT_GT06,
    device_adapter: "GT06",
  };

  const gt06Server = gps.server(gt06Options, (device, connection) => {
    setupDeviceHandlers(device, connection, 'gt06');

    connection.on('error', (err) => {
      logger.error(`GT06 connection error for device ${device.getUID ? device.getUID() : 'unknown'}: ${err.message}`, { error: err });
    });
    connection.on('close', () => {
      logger.debug(`GT06 connection closed for device ${device.getUID ? device.getUID() : 'unknown'}`);
    });
    connection.on('timeout', () => {
      logger.warn(`GT06 connection timeout for device ${device.getUID ? device.getUID() : 'unknown'}`);
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
  gt06_port: process.env.GPS_SERVER_PORT_GT06
});

// ============================================================================
// Graceful shutdown
// ============================================================================

function gracefulShutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  const closeServer = (server) => {
    if (server && typeof server.close === 'function') server.close(() => {});
    else if (server && server.server && typeof server.server.close === 'function') server.server.close(() => {});
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