// File: UT04SAdapter/node_modules/gps-tracking/lib/device.js
const util = require('util');
const EventEmitter = require('events').EventEmitter;
const logger = require('./logger'); // <-- added

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

  /****************************************
   RECEIVING DATA FROM THE DEVICE
   ****************************************/
  this.on('data', function (data) {
    const hexData = data.toString('hex');
    logger.debug(`Raw data from ${_this.getUID() || 'unknown'}: ${hexData}`);
    _this.buffer += hexData;

    let startIdx = _this.buffer.indexOf('7e');
    while (startIdx !== -1) {
      const endIdx = _this.buffer.indexOf('7e', startIdx + 2);
      if (endIdx === -1) break; // incomplete message

      const msgHex = _this.buffer.substring(startIdx, endIdx + 2);
      const msgParts = _this.adapter.parse_data(Buffer.from(msgHex, 'hex'));

      if (msgParts === false) {
        _this.do_log('Invalid message discarded: ' + msgHex);
      } else {
        if (_this.getUID() === false && typeof msgParts.device_id === 'undefined') {
          throw new Error('The adapter doesn\'t return the device_id and is not defined');
        }
        if (typeof msgParts.cmd === 'undefined') {
          throw new Error('The adapter doesn\'t return the command (cmd) parameter');
        }
        if (_this.getUID() === false) {
          _this.setUID(msgParts.device_id);
        }
        _this.make_action(msgParts.action, msgParts);
      }

      // Remove processed message from buffer
      _this.buffer = _this.buffer.substring(endIdx + 2);
      startIdx = _this.buffer.indexOf('7e');
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
    _this.emit('new_device_first_time', this.getUID(), msgParts);
  };

  /****************************************
   HEARTBEAT DATA RECEIVED
   ****************************************/
  this.hbt = function (msgParts) {
    _this.emit('hbt', this.getUID(), msgParts);
  };

  /****************************************
   REGISTER TERMINAL
   ****************************************/
  this.register = function (msgParts) {
    _this.emit('register', this.getUID(), msgParts);
  };

  /****************************************
   LOGIN & LOGOUT
   ****************************************/
  this.login_request = function (msgParts) {
    _this.emit('login_request', this.getUID(), msgParts);
  };

  this.logout = function (msgParts) {
    _this.emit('logout', this.getUID(), msgParts);
  };

  /****************************************
   RECEIVING GPS POSITION FROM THE DEVICE
   ****************************************/
  this.ping = function (msgParts) {
    const gpsData = this.adapter.get_ping_data(msgParts);
    if (gpsData === false) {
      _this.do_log('GPS Data can\'t be parsed. Discarding packet...');
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
    const alarmData = _this.adapter.receive_alarm(msgParts);
    logger.warn(`${this.getUID()} ALARM RECEIVED`);
    _this.emit('alarm', alarmData, msgParts);
  };

  this.receive_first_time = function (msgParts) {
    let serial = (parseInt(this.first_time_response_serial, 16) + 1).toString(16);
    serial = _this.padSerial(serial);
    this.first_time_response_serial = serial;
    this.adapter.first_time(this.first_time_response_serial, msgParts);
    logger.debug(`Device ${_this.getUID()} First time connection. Welcome!`);
  };

  this.receive_hbt = function (msgParts) {
    let serial = (parseInt(this.hbt_response_serial, 16) + 1).toString(16);
    serial = _this.padSerial(serial);
    this.hbt_response_serial = serial;
    this.adapter.hbt(this.hbt_response_serial, msgParts);
    logger.debug(`Device ${_this.getUID()} HBT received!`);
  };

  this.new_device_register = function (msgParts) {
    let serial = (parseInt(this.register_response_serial, 16) + 1).toString(16);
    serial = _this.padSerial(serial);
    this.register_response_serial = serial;
    this.adapter.register(this.register_response_serial, msgParts);
    logger.debug(`Device ${_this.getUID()} has been REGISTERED. Welcome!`);
  };

  this.login_authorized = function (val, msgParts) {
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
    let serial = (parseInt(this.logout_response_serial, 16) + 1).toString(16);
    serial = _this.padSerial(serial);
    this.logout_response_serial = serial;
    this.loged = false;
    this.adapter.logout(this.logout_response_serial, msg_parts);
    logger.info(`Device ${_this.getUID()} logged out`);
  };

  this.received_location_report = function (msgParts) {
    let serial = (parseInt(this.ping_response_serial, 16) + 1).toString(16);
    serial = _this.padSerial(serial);
    this.ping_response_serial = serial;
    this.adapter.location_report(this.ping_response_serial, msgParts);
    logger.debug(`Device ${_this.getUID()} Location report received!`);
  };

  this.received_alarm_report = function (msgParts) {
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
    _this.adapter.set_refresh_time(interval, duration);
  };

  /**
   * Sends data to the device.
   * @param {Buffer|string} msg - Message to send (as Buffer or hex string).
   */
  this.send = function (msg) {
    this.emit('send_data', msg);
    this.connection.write(msg.toString("hex"), "hex");
  };

  this.do_log = function (msg) {
    // from is probably device ID or SERVER; use logger.info
    logger.info(`[${_this.getUID() || 'SERVER'}] ${msg}`);
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
    // Optional: create a child logger for this device
    // this.logger = logger.child({ deviceId: uid });
  };
}

module.exports = Device;