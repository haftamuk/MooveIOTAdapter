// File: lib/device.js
const util = require('util');
const EventEmitter = require('events').EventEmitter;
const logger = require('./logger');
const fs = require('fs');                 // DEBUG: added
const path = require('path');              // DEBUG: added
const { isDebugDevice } = require('./debugConfig'); // DEBUG: added

util.inherits(Device, EventEmitter);

/**
 * Represents a connected GPS device.
 * @class Device
 * @param {Object} adapter - The protocol adapter instance.
 * @param {net.Socket} connection - The TCP socket connection.
 * @param {Server} gpsServer - The parent GPS server.
 */
function Device(adapter, connection, gpsServer) {
  EventEmitter.call(this);

  const _this = this;

  this.connection = connection;
  this.server = gpsServer;
  this.adapter = adapter.adapter(this);

  // Read protocol start and end markers from the adapter
  this.startMarker = this.adapter.format?.start || '7e';
  this.endMarker   = this.adapter.format?.end   || '7e';
  logger.debug(`Device using start marker: ${this.startMarker}, end marker: ${this.endMarker}`);

  this.uid = false;
  this.ip = connection.ip;
  this.port = connection.port;
  this.name = false;
  this.loged = false;
  this.first_time_response_serial = "0000";
  this.hbt_response_serial = "0000";
  this.register_response_serial = "0000";
  this.authorize_response_serial = "0000";
  this.logout_response_serial = "0000";
  this.ping_response_serial = "0000";
  this.alarm_response_serial = "0000";
  this.other_response_serial = "0000";

  // Buffer for accumulating partial data (hex string)
  this.buffer = '';

  // DEBUG: properties for protocol logging
  this.debugEnabled = true;
  this.debugStream = null;

  // DEBUG: method to open a debug log file for this device
  this.openDebugLog = function (uid) {
    const logDir = path.join(__dirname, '..', 'debug_logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, `${uid}.log`);
    this.debugStream = fs.createWriteStream(logFile, { flags: 'a' });
    this.debugEnabled = true;
    logger.debug(`Protocol debug logging enabled for device ${uid} -> ${logFile}`);
  };

  // DEBUG: method to close the debug log file
  this.closeDebugLog = function () {
    if (this.debugStream) {
      this.debugStream.end();
      this.debugStream = null;
      this.debugEnabled = false;
    }
  };

  // DEBUG: helper to write a custom debug message
  this.logDebug = function (message) {
    if (this.debugEnabled && this.debugStream) {
      const timestamp = new Date().toISOString();
      this.debugStream.write(`[${timestamp}] ${message}\n`);
    }
  };

  /****************************************
   RECEIVING DATA FROM THE DEVICE
   ****************************************/
  this.on('data', function (data) {
    const hexData = data.toString('hex');
    logger.debug(`Raw data from ${_this.getUID() || 'unknown'}: ${hexData}`);
    _this.buffer += hexData;

    // Use the adapter's start and end markers to split messages
    const startMarker = _this.startMarker;
    const endMarker   = _this.endMarker;

    let startIdx = _this.buffer.indexOf(startMarker);
    while (startIdx !== -1) {
      // For protocols where start and end are the same (e.g., JT808), we need to find the next occurrence after the current one.
      // For different markers, we search for the end marker after the start.
      let endIdx;
      if (startMarker === endMarker) {
        // Same marker: find the next occurrence after this start
        endIdx = _this.buffer.indexOf(endMarker, startIdx + startMarker.length);
      } else {
        // Different markers: find the end marker anywhere after the start
        endIdx = _this.buffer.indexOf(endMarker, startIdx + startMarker.length);
      }

      if (endIdx === -1) break; // incomplete message

      const msgHex = _this.buffer.substring(startIdx, endIdx + endMarker.length);
      logger.debug(`Extracted message: ${msgHex}`);

      // DEBUG: log incoming raw hex if debugging enabled
      if (_this.debugEnabled && _this.debugStream) {
        const timestamp = new Date().toISOString();
        _this.debugStream.write(`[${timestamp}] IN: ${msgHex}\n`);
      }

      const msgParts = _this.adapter.parse_data(Buffer.from(msgHex, 'hex'));

      if (msgParts === false) {
        logger.warn(`Invalid message discarded: ${msgHex}`);
      } else {
        if (_this.getUID() === false && typeof msgParts.device_id === 'undefined') {
          throw new Error('The adapter doesn\'t return the device_id and is not defined');
        }
        if (typeof msgParts.cmd === 'undefined') {
          throw new Error('The adapter doesn\'t return the command (cmd) parameter');
        }
        if (_this.getUID() === false) {
          _this.setUID(msgParts.device_id);
          logger.debug(`Device UID set to: ${msgParts.device_id}`);
        }

        // DEBUG: write a parsed summary line
        if (_this.debugEnabled && _this.debugStream) {
          const timestamp = new Date().toISOString();
          let summary = `[${timestamp}] PARSED: action=${msgParts.action}, cmd=${msgParts.cmd}`;
          if (msgParts.protocol_id) summary += `, protocol=0x${msgParts.protocol_id}`;
          if (msgParts.device_id) summary += `, device_id=${msgParts.device_id}`;
          if (msgParts.serial_number) summary += `, serial=${msgParts.serial_number}`;
          if (msgParts.data_body) {
            const preview = msgParts.data_body.length > 20 ? msgParts.data_body.substr(0,20)+'…' : msgParts.data_body;
            summary += `, data=${preview}`;
          }
          // Indicate location/alarm data
          if (msgParts.action === 'ping' || msgParts.action === 'alarm') {
            summary += ` (location data)`;
          }
          _this.debugStream.write(summary + '\n');
        }

        _this.make_action(msgParts.action, msgParts);
      }

      // Remove processed message from buffer
      _this.buffer = _this.buffer.substring(endIdx + endMarker.length);
      startIdx = _this.buffer.indexOf(startMarker);
    }
  });

  /**
   * Routes the parsed message to the appropriate handler based on action.
   * @param {string} action - The action name from the adapter.
   * @param {Object} msgParts - Parsed message parts.
   */
  this.make_action = function (action, msgParts) {
    logger.debug(`Device ${this.getUID() || 'unknown'} action: ${action}`);
    switch (action) {
      case 'new_device_first_time':
        _this.new_device_first_time(msgParts);
        break;
      case 'heartbeat':
        _this.emit('heartbeat', this.getUID(), msgParts);
        break;
      case 'register':
        _this.emit('register', this.getUID(), msgParts);
        break;
      case 'login_request':
        _this.emit('login_request', this.getUID(), msgParts);
        break;
      case 'logout':
        _this.emit('logout', this.getUID(), msgParts);
        break;
      case 'ping':
        _this.ping(msgParts);
        break;
      case 'alarm':
        _this.receive_alarm(msgParts);
        break;
      default:
        // For any unrecognised action, emit as 'other' with original action attached
        msgParts.original_action = action;
        _this.emit('other', this.getUID(), msgParts);
    }
  };

  /****************************************
   FIRST TIME EVER DEVICE DETECTED
   ****************************************/
  this.new_device_first_time = function (msgParts) {
    logger.debug(`new_device_first_time called for device: ${this.getUID()}`);
    _this.emit('new_device_first_time', this.getUID(), msgParts);
  };

  /****************************************
   HEARTBEAT DATA RECEIVED
   ****************************************/
  this.hbt = function (msgParts) {
    logger.debug(`hbt called for device: ${this.getUID()}`);
    _this.emit('hbt', this.getUID(), msgParts);
  };

  /****************************************
   REGISTER TERMINAL
   ****************************************/
  this.register = function (msgParts) {
    logger.debug(`register called for device: ${this.getUID()}`);
    _this.emit('register', this.getUID(), msgParts);
  };

  /****************************************
   LOGIN & LOGOUT
   ****************************************/
  this.login_request = function (msgParts) {
    logger.debug(`login_request called for device: ${this.getUID()}`);
    _this.emit('login_request', this.getUID(), msgParts);
  };

  this.logout = function (msgParts) {
    logger.debug(`logout called for device: ${this.getUID()}`);
    _this.emit('logout', this.getUID(), msgParts);
  };

  /****************************************
   RECEIVING GPS POSITION FROM THE DEVICE
   ****************************************/
  this.ping = function (msgParts) {
    logger.debug(`ping called for device: ${this.getUID()}`);
    const gpsData = this.adapter.get_ping_data(msgParts);
    if (gpsData === false) {
      logger.warn(`GPS Data can't be parsed. Discarding packet...`);
      return false;
    }
    gpsData.from_cmd = msgParts.cmd;
    gpsData.device_id = _this.getUID();
    _this.emit('ping', gpsData, msgParts);
  };

  /****************************************
   RECEIVING ALARM
   ****************************************/
  this.receive_alarm = function (msgParts) {
    logger.debug(`receive_alarm called for device: ${this.getUID()}`);
    const alarmData = _this.adapter.receive_alarm(msgParts);
    logger.warn(`${this.getUID()} ALARM RECEIVED`);
    _this.emit('alarm', alarmData, msgParts);
  };

  this.receive_first_time = function (msgParts) {
    logger.debug(`receive_first_time called for device: ${this.getUID()}`);
    let serial = (parseInt(this.first_time_response_serial, 16) + 1).toString(16);
    serial = _this.padSerial(serial);
    this.first_time_response_serial = serial;
    this.adapter.first_time(this.first_time_response_serial, msgParts);
    logger.debug(`Device ${_this.getUID()} First time connection. Welcome!`);
  };

  this.receive_hbt = function (msgParts) {
    logger.debug(`receive_hbt called for device: ${this.getUID()}`);
    let serial = (parseInt(this.hbt_response_serial, 16) + 1).toString(16);
    serial = _this.padSerial(serial);
    this.hbt_response_serial = serial;
    this.adapter.hbt(this.hbt_response_serial, msgParts);
    logger.debug(`Device ${_this.getUID()} HBT received!`);
  };

  this.new_device_register = function (msgParts) {
    logger.debug(`new_device_register called for device: ${this.getUID()}`);
    let serial = (parseInt(this.register_response_serial, 16) + 1).toString(16);
    serial = _this.padSerial(serial);
    this.register_response_serial = serial;
    this.adapter.register(this.register_response_serial, msgParts);
    logger.debug(`Device ${_this.getUID()} has been REGISTERED. Welcome!`);
  };

  this.login_authorized = function (val, msgParts) {
    logger.debug(`login_authorized called for device: ${this.getUID()}, authorized: ${val}`);
    if (val) {
      let serial = (parseInt(this.authorize_response_serial, 16) + 1).toString(16);
      serial = _this.padSerial(serial);
      this.authorize_response_serial = serial;
      this.adapter.authorize(this.authorize_response_serial, msgParts);
      logger.debug(`Device ${_this.getUID()} has been authorized. Welcome!`);
      this.loged = true;
    } else {
      logger.warn(`Device ${_this.getUID()} not authorized. Login request rejected`);
    }
  };

  this.logout = function (msg_parts) {
    logger.debug(`logout called for device: ${this.getUID()}`);
    let serial = (parseInt(this.logout_response_serial, 16) + 1).toString(16);
    serial = _this.padSerial(serial);
    this.logout_response_serial = serial;
    this.loged = false;
    this.adapter.logout(this.logout_response_serial, msg_parts);
    logger.info(`Device ${_this.getUID()} logged out`);
  };

  this.received_location_report = function (msgParts) {
    logger.debug(`received_location_report called for device: ${this.getUID()}`);
    let serial = (parseInt(this.ping_response_serial, 16) + 1).toString(16);
    serial = _this.padSerial(serial);
    this.ping_response_serial = serial;
    this.adapter.location_report(this.ping_response_serial, msgParts);
    logger.debug(`Device ${_this.getUID()} Location report received!`);
  };

  this.received_alarm_report = function (msgParts) {
    logger.debug(`received_alarm_report called for device: ${this.getUID()}`);
    let serial = (parseInt(this.alarm_response_serial, 16) + 1).toString(16);
    serial = _this.padSerial(serial);
    this.alarm_response_serial = serial;
    this.adapter.alarm_report(this.alarm_response_serial, msgParts);
    logger.warn(`Device ${_this.getUID()} Alarm report received!`);
  };

  /**
   * Pads a serial number to 4 hex digits.
   * @param {string} serial - The serial number as hex string.
   * @returns {string} Padded serial (4 digits).
   */
  this.padSerial = function (serial) {
    switch (serial.length) {
      case 1: return "000" + serial;
      case 2: return "00" + serial;
      case 3: return "0" + serial;
      case 4: return serial;
      default: return serial;
    }
  };

  /****************************************
   SET REFRESH TIME
   ****************************************/
  this.set_refresh_time = function (interval, duration) {
    logger.debug(`set_refresh_time called for device: ${this.getUID()}`);
    _this.adapter.set_refresh_time(interval, duration);
  };

  /**
   * Sends data to the device.
   * @param {Buffer|string} msg - Message to send (as Buffer or hex string).
   */
  this.send = function (msg) {
    logger.debug(`send called for device: ${this.getUID()}, message length: ${msg.length}`);
    // DEBUG: log outgoing raw hex if debugging is enabled
    if (this.debugEnabled && this.debugStream) {
      const timestamp = new Date().toISOString();
      const hexMsg = msg.toString('hex');
      this.debugStream.write(`[${timestamp}] OUT: ${hexMsg}\n`);
    }
    this.emit('send_data', msg);
    this.connection.write(msg.toString("hex"), "hex");
  };

  /****************************************
   SETTERS & GETTERS
   ****************************************/
  this.getName = function () {
    return this.name;
  };

  this.setName = function (name) {
    this.name = name;
  };

  this.getUID = function () {
    return this.uid;
  };

  this.setUID = function (uid) {
    this.uid = uid;
    logger.debug(`Device UID set to: ${uid}`);
    // DEBUG: Enable protocol debug if this device is in the debug list
    if (isDebugDevice(uid)) {
      this.openDebugLog(uid);
    }
  };

  // DEBUG: automatically close log when device disconnects
  this.on('disconnected', () => {
    this.closeDebugLog();
  });
}

module.exports = Device;