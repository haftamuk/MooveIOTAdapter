// File: UT04SAdapter/node_modules/gps-tracking/lib/device.js

const { createServer } = require('net');

util = require('util');
EventEmitter = require('events').EventEmitter;
util.inherits(Device, EventEmitter);

function Device(adapter, connection, gpsServer) {
  /* Inherits EventEmitter class */
  EventEmitter.call(this);

  var _this = this;

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

  // Buffer for accumulating partial data
  this.buffer = ''; // hex string buffer

  init();
  /* init */
  function init() {

  }

  /****************************************
   RECEIVING DATA FROM THE DEVICE
   ****************************************/
  this.on('data', function (data) {
    var hexData = data.toString('hex');
    _this.buffer += hexData;

    var startIdx = _this.buffer.indexOf('7e');
    while (startIdx !== -1) {
      var endIdx = _this.buffer.indexOf('7e', startIdx + 2);
      if (endIdx === -1) break; // incomplete message, wait for more data

      var msgHex = _this.buffer.substring(startIdx, endIdx + 2); // include start and end
      var msgParts = _this.adapter.parse_data(Buffer.from(msgHex, 'hex'));

      if (msgParts === false) {
        _this.do_log('Invalid message discarded: ' + msgHex);
      } else {
        if (_this.getUID() === false && typeof (msgParts.device_id) === 'undefined') {
          throw 'The adapter doesn\'t return the device_id and is not defined';
        }
        if (typeof (msgParts.cmd) === 'undefined') {
          throw 'The adapter doesn\'t return the command (cmd) parameter';
        }
        if (_this.getUID() === false) {
          _this.setUID(msgParts.device_id);
        }
        _this.make_action(msgParts.action, msgParts);
      }

      // remove processed message from buffer
      _this.buffer = _this.buffer.substring(endIdx + 2);
      startIdx = _this.buffer.indexOf('7e');
    }
  });

  this.make_action = function (action, msgParts) {
    //If we're not loged
    // if (action !== 'login_request' && !_this.loged) {
    //   _this.adapter.request_login_to_device();
    //   _this.do_log(_this.getUID() + ' is trying to \'' + action + '\' but it isn\'t loged. Action wasn\'t executed');
    //   return false;
    // }
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    console.log("~~~~~~~ DEVICE.JS ACTION BASED ON PARSED DATA ~~~~~~~~~~~~~~")
    console.log(action);
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")

    switch (action) {
      case 'new_device_first_time':
        _this.new_device_first_time(msgParts);
        break;
      case 'hbt':
        _this.hbt(msgParts);
        break;
      case 'register':
        _this.register(msgParts);
        break;
      case 'login_request':
        _this.login_request(msgParts);
        break;
      case 'logout':
        _this.logout(msgParts);
        break;
      case 'ping':
        _this.ping(msgParts);
        break;
      case 'alarm':
        _this.receive_alarm(msgParts);
        break;
      case 'other':
        _this.adapter.run_other(msgParts.cmd, msgParts);
        break;
    }
  };
  /****************************************
   FIRST TIME EVER DEVICE DETECTED
 ****************************************/
  this.new_device_first_time = function (msgParts) {
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    console.log("~~~~~~~ DEVICE.JS EMIT new_device_first_time ~~~~~~~~~~~~~~")
    console.log(msgParts);
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    _this.emit('new_device_first_time', this.getUID(), msgParts);
  };


  /****************************************
 HEARTBEAT DATA RECIEVED
 ****************************************/
  this.hbt = function (msgParts) {
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    console.log("~~~~~~~ DEVICE.JS EMIT HEARTBEAT ~~~~~~~~~~~~~~")
    console.log(msgParts);
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    _this.emit('hbt', this.getUID(), msgParts);
  };

  /****************************************
     REGISTER TERMINAL
   ****************************************/
  this.register = function (msgParts) {
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    console.log("~~~~~~~ DEVICE.JS EMIT register ~~~~~~~~~~~~~~")
    console.log(msgParts);
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    _this.emit('register', this.getUID(), msgParts);
  };

  /****************************************
  LOGIN & LOGOUT
  ****************************************/
  this.login_request = function (msgParts) {
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    console.log("~~~~~~~ DEVICE.JS EMIT login_request ~~~~~~~~~~~~~~")
    _this.do_log('I\'m requesting to be loged.');
    _this.do_log('PARSED CONTENT : ');
    console.log(msgParts);
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    _this.emit('login_request', this.getUID(), msgParts);
  };



  /****************************************
   LOGOUT TERMINAL
 ****************************************/
  this.logout = function (msgParts) {
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    console.log("~~~~~~~ DEVICE.JS EMIT logout ~~~~~~~~~~~~~~")
    console.log(msgParts);
    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
    _this.emit('logout', this.getUID(), msgParts);
  };

  /****************************************
   RECEIVING GPS POSITION FROM THE DEVICE
   ****************************************/
  this.ping = function (msgParts) {
    var gpsData = this.adapter.get_ping_data(msgParts);
    if (gpsData === false) {
      //Something bad happened
      _this.do_log('GPS Data can\'t be parsed. Discarding packet...');
      return false;
    }

    /* Needs:
     latitude, longitude, time
     Optionals:
     orientation, speed, mileage, etc */

    _this.do_log('Position received ( ' + gpsData.latitude + ',' + gpsData.longitude + ' )');
    gpsData.from_cmd = msgParts.cmd;
    gpsData.device_id = _this.getUID();

    this.do_log("PING Requested");
    _this.emit('ping', gpsData, msgParts);

  };


  /****************************************
   RECEIVING ALARM
   ****************************************/
  this.receive_alarm = function (msgParts) {
    //We pass the message parts to the adapter and they have to say wich type of alarm it is.
    var alarmData = _this.adapter.receive_alarm(msgParts);
    /* Alarm data must return an object with at least:
     alarm_type: object with this format:
     {'code':'sos_alarm','msg':'SOS Alarm activated by the driver'}
     */
    console.log(this.getUID(), "ALARM RECIEVED");

    _this.emit('alarm', alarmData, msgParts);
  };



  this.receive_first_time = function (msgParts) {
    let serial = (parseInt(this.first_time_response_serial, 16) + 1).toString(16);
    switch (serial.length) {
      case 1:
        this.first_time_response_serial = "000" + serial;
        break;
      case 2:
        this.first_time_response_serial = "00" + serial;
        break;
      case 3:
        this.first_time_response_serial = "0" + serial;
        break;
      case 4:
        this.first_time_response_serial = serial;
        break;
      default:
        break;
    }

    this.adapter.first_time(this.first_time_response_serial, msgParts);
    this.do_log('Device ' + _this.getUID() + ' First time connection. Welcome!');
  };

  this.receive_hbt = function (msgParts) {
    let serial = (parseInt(this.hbt_response_serial, 16) + 1).toString(16);
    switch (serial.length) {
      case 1:
        this.hbt_response_serial = "000" + serial;
        break;
      case 2:
        this.hbt_response_serial = "00" + serial;
        break;
      case 3:
        this.hbt_response_serial = "0" + serial;
        break;
      case 4:
        this.hbt_response_serial = serial;
        break;
      default:
        break;
    }

    this.adapter.hbt(this.hbt_response_serial, msgParts);
    this.do_log('Device ' + _this.getUID() + ' HBT received!');
  };

  this.new_device_register = function (msgParts) {
    let serial = (parseInt(this.register_response_serial, 16) + 1).toString(16);
    switch (serial.length) {
      case 1:
        this.register_response_serial = "000" + serial;
        break;
      case 2:
        this.register_response_serial = "00" + serial;
        break;
      case 3:
        this.register_response_serial = "0" + serial;
        break;
      case 4:
        this.register_response_serial = serial;
        break;
      default:
        break;
    }

    this.adapter.register(this.register_response_serial, msgParts);
    this.do_log('Device ' + _this.getUID() + ' has been REGISTERED. Welcome!');
  };

  this.login_authorized = function (val, msgParts) {
    if (val) {
      let serial = (parseInt(this.authorize_response_serial, 16) + 1).toString(16);
      switch (serial.length) {
        case 1:
          this.authorize_response_serial = "000" + serial;
          break;
        case 2:
          this.authorize_response_serial = "00" + serial;
          break;
        case 3:
          this.authorize_response_serial = "0" + serial;
          break;
        case 4:
          this.authorize_response_serial = serial;
          break;
        default:
          break;
      }


      this.adapter.authorize(this.authorize_response_serial, msgParts);

      this.do_log('Device ' + _this.getUID() + ' has been authorized. Welcome!');
      this.loged = true;

    } else {
      this.do_log('Device ' + _this.getUID() + ' not authorized. Login request rejected');
    }
  };

  this.logout = function (msg_parts) {
    let serial = (parseInt(this.logout_response_serial, 16) + 1).toString(16);
    switch (serial.length) {
      case 1:
        this.logout_response_serial = "000" + serial;
        break;
      case 2:
        this.logout_response_serial = "00" + serial;
        break;
      case 3:
        this.logout_response_serial = "0" + serial;
        break;
      case 4:
        this.logout_response_serial = serial;
        break;
      default:
        break;
    }
    this.loged = false;
    this.adapter.logout(this.logout_response_serial, msg_parts);
  };

  this.received_location_report = function (msgParts) {
    let serial = (parseInt(this.ping_response_serial, 16) + 1).toString(16);
    switch (serial.length) {
      case 1:
        this.ping_response_serial = "000" + serial;
        break;
      case 2:
        this.ping_response_serial = "00" + serial;
        break;
      case 3:
        this.ping_response_serial = "0" + serial;
        break;
      case 4:
        this.ping_response_serial = serial;
        break;
      default:
        break;
    }
    this.adapter.location_report(this.ping_response_serial, msgParts);
    this.do_log('Device ' + _this.getUID() + ' LOCATION REPORT RECEIVED');
  };

  this.received_alarm_report = function (msgParts) {
        let serial = (parseInt(this.alarm_response_serial, 16) + 1).toString(16);
    switch (serial.length) {
      case 1:
        this.alarm_response_serial = "000" + serial;
        break;
      case 2:
        this.alarm_response_serial = "00" + serial;
        break;
      case 3:
        this.alarm_response_serial = "0" + serial;
        break;
      case 4:
        this.alarm_response_serial = serial;
        break;
      default:
        break;
    }
    this.adapter.alarm_report(this.alarm_response_serial, msgParts);
    this.do_log('Device ' + _this.getUID() + ' ALARM REPORT RECIEVED!');
  };





  /****************************************
   SET REFRESH TIME
   ****************************************/
  this.set_refresh_time = function (interval, duration) {
    _this.adapter.set_refresh_time(interval, duration);
  };

  /* adding methods to the adapter */
  this.adapter.get_device = function () {
    return device;
  };

  this.send = function (msg) {
    this.emit('send_data', msg);
    this.connection.write(msg.toString("hex"), "hex");
    this.do_log('Sending to IP: ' + this.ip + ' and Port : ' + this.port);

    this.do_log('Sending to ' + _this.getUID() + ': ' + msg);
  };

  this.do_log = function (msg) {
    _this.server.do_log(msg, _this.getUID());
  };

  /****************************************
   SOME SETTERS & GETTERS
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
  };

}

module.exports = Device;