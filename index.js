// File: UT04SAdapter/index.js
const net = require('net');
const gps = require('gps-tracking');

const options = {
  debug: true,
  port: 8800,
  device_adapter: 'UT04S',
};

// Lists of terminals that should be proxied to external servers
const crsTerminals = [
  '020201228393',
  '020201232938'
];

const gpsposTerminals = [
  '020201206555',
  '020201205789',
  '020201223132',
  '020201263620',
  '020201292186',
  '020201294976',
  '020201291753',
  '020201228351'
];

// Map to hold proxy sockets per device ID: { deviceId: { crs: Socket, gpspos: Socket } }
const deviceProxySockets = new Map();

/**
 * Forward raw data to external servers for a given device.
 * @param {string} deviceId - 12‑character device ID (hex string)
 * @param {string} rawHex - Raw message in hex (from msg_parts.raw_hex)
 */
function forwardToProxy(deviceId, rawHex) {
  const isCrs = crsTerminals.includes(deviceId);
  const isGpspos = gpsposTerminals.includes(deviceId);

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
      sockets.crs.connect(22422, '193.193.165.165', () => {
        console.log(`[${deviceId}] CRS proxy connected`);
      });
      sockets.crs.on('error', (err) => {
        console.error(`[${deviceId}] CRS proxy error:`, err.message);
        // Destroy and schedule reconnect after 5 seconds
        sockets.crs.destroy();
        sockets.crs = null;
        setTimeout(() => {
          // Attempt to reconnect only if this device is still active
          if (deviceProxySockets.has(deviceId)) {
            forwardToProxy(deviceId, rawHex); // re‑trigger connection
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
      sockets.gpspos.connect(8800, 'www.gpspos.net', () => {
        console.log(`[${deviceId}] GPSPOS proxy connected`);
      });
      sockets.gpspos.on('error', (err) => {
        console.error(`[${deviceId}] GPSPOS proxy error:`, err.message);
        sockets.gpspos.destroy();
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

// Create and start the GPS tracking server
const server = gps.server(options, (device, connection) => {
  console.log('========================================');
  console.log('UT04S ADAPTER INITIALIZED');
  console.log('Listening on port:', options.port);
  console.log('========================================');

  // ----------------------------------------------------------------------
  // Device connected
  // ----------------------------------------------------------------------
  device.on('connected', () => {
    console.log('========================================');
    console.log('DEVICE CONNECTED');
    console.log('Remote IP:', connection.remoteAddress);
    console.log('========================================');
  });

  // ----------------------------------------------------------------------
  // Device disconnected – clean up proxy sockets
  // ----------------------------------------------------------------------
  device.on('disconnected', () => {
    const devId = device.getUID();
    console.log('========================================');
    console.log('DEVICE DISCONNECTED');
    console.log('Device ID:', devId);
    console.log('========================================');

    const sockets = deviceProxySockets.get(devId);
    if (sockets) {
      if (sockets.crs) sockets.crs.destroy();
      if (sockets.gpspos) sockets.gpspos.destroy();
      deviceProxySockets.delete(devId);
    }
  });

  // ----------------------------------------------------------------------
  // Terminal registration (0x0100)
  // ----------------------------------------------------------------------
  device.on('register', (device_id, msg_parts) => {
    console.log('========================================');
    console.log('TERMINAL REGISTRATION');
    console.log('Device ID:', device_id);
    console.log('========================================');

    device.new_device_register(msg_parts);
    forwardToProxy(device_id, msg_parts.raw_hex);
  });

  // ----------------------------------------------------------------------
  // Terminal authentication / login (0x0102)
  // ----------------------------------------------------------------------
  device.on('login_request', (device_id, msg_parts) => {
    console.log('========================================');
    console.log('TERMINAL AUTHENTICATION');
    console.log('Device ID:', device_id);
    console.log('========================================');

    device.login_authorized(true, msg_parts);
    forwardToProxy(device_id, msg_parts.raw_hex);
  });

  // ----------------------------------------------------------------------
  // Heartbeat (0x0002)
  // ----------------------------------------------------------------------
  device.on('hbt', (device_id, msg_parts) => {
    console.log('========================================');
    console.log('HEARTBEAT RECEIVED');
    console.log('Device ID:', device_id);
    console.log('Sequence:', msg_parts.cmd_serial_no);
    console.log('========================================');

    device.receive_hbt(msg_parts);
    forwardToProxy(device_id, msg_parts.raw_hex);
  });

  // ----------------------------------------------------------------------
  // Terminal logout (0x0003)
  // ----------------------------------------------------------------------
  device.on('logout', (device_id, msg_parts) => {
    console.log('========================================');
    console.log('TERMINAL LOGOUT');
    console.log('Device ID:', device_id);
    console.log('========================================');

    device.logout(msg_parts);
    forwardToProxy(device_id, msg_parts.raw_hex);
  });

  // ----------------------------------------------------------------------
  // Location report (0x0200 without alarm)
  // ----------------------------------------------------------------------
  device.on('ping', (data, msg_parts) => {
    console.log('========================================');
    console.log('LOCATION REPORT');
    console.log('Device ID:', data.device_id);
    console.log('Position:', data.latitude, ',', data.longitude);
    console.log('Speed:', data.speed, 'km/h');
    console.log('Time:', data.date);
    console.log('========================================');

    device.received_location_report(msg_parts);
    forwardToProxy(data.device_id, msg_parts.raw_hex);
  });

  // ----------------------------------------------------------------------
  // Alarm report (0x0200 with alarm flag)
  // ----------------------------------------------------------------------
  device.on('alarm', (alarmData, msg_parts) => {
    console.log('========================================');
    console.log('ALARM REPORT');
    console.log('Device ID:', alarmData.device_id);
    console.log('Alarm Type:', alarmData.alarm_type);
    console.log('Position:', alarmData.latitude, ',', alarmData.longitude);
    console.log('========================================');

    device.received_alarm_report(msg_parts);
    forwardToProxy(alarmData.device_id, msg_parts.raw_hex);
  });

  // ----------------------------------------------------------------------
  // Other commands (0x0107, 0x0704, 0x0702, etc.)
  // ----------------------------------------------------------------------
  device.on('other', (device_id, msg_parts) => {
    console.log('========================================');
    console.log('OTHER COMMAND');
    console.log('Device ID:', device_id);
    console.log('Command:', msg_parts.cmd);
    console.log('========================================');

    device.adapter.run_other(msg_parts.cmd, msg_parts);
    forwardToProxy(device_id, msg_parts.raw_hex);
  });

  // ----------------------------------------------------------------------
  // Optional: log raw data that is not forwarded (e.g., debugging)
  // ----------------------------------------------------------------------
  connection.on('data', (data) => {
    // This runs for *every* packet; we already forward inside the handlers.
    // Here we can simply log the raw data if debug is enabled.
    console.log('========================================');
    console.log('RAW DATA FROM DEVICE');
    console.log('Hex:', data.toString('hex'));
    console.log('========================================');
  });

  // ----------------------------------------------------------------------
  // Connection error handling
  // ----------------------------------------------------------------------
  connection.on('error', (err) => {
    console.error('========================================');
    console.error('CONNECTION ERROR');
    console.error('Error:', err.message);
    console.error('========================================');
  });

  // ----------------------------------------------------------------------
  // Connection close (already handled by device.disconnected)
  // ----------------------------------------------------------------------
  connection.on('close', () => {
    console.log('========================================');
    console.log('CONNECTION CLOSED');
    console.log('Device:', device.getUID());
    console.log('========================================');
  });
});

// ------------------------------------------------------------------------
// Server error handling
// ------------------------------------------------------------------------
server.on('error', (err) => {
  console.error('SERVER ERROR:', err);
});

// ------------------------------------------------------------------------
// Graceful shutdown on SIGINT (Ctrl-C)
// ------------------------------------------------------------------------
process.on('SIGINT', () => {
  console.log('\nGracefully shutting down from SIGINT (Ctrl-C)');
  // Close all proxy sockets
  for (const [devId, sockets] of deviceProxySockets.entries()) {
    if (sockets.crs) sockets.crs.destroy();
    if (sockets.gpspos) sockets.gpspos.destroy();
  }
  deviceProxySockets.clear();
  process.exit(0);
});