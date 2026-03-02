// File: lib/server.js
const util = require('util');
const EventEmitter = require('events').EventEmitter;
const net = require('net');
const extend = require('node.extend');
const Device = require('./device');

util.inherits(Server, EventEmitter);

/**
 * GPS Tracking Server
 * @class Server
 * @param {Object} opts - Server options.
 * @param {number} opts.port - Listening port.
 * @param {string|Object} opts.device_adapter - Adapter name or object.
 * @param {boolean} [opts.debug=false] - Enable debug logging.
 * @param {number} [opts.maxConnections=1000] - Max concurrent connections.
 * @param {number} [opts.connectionTimeout=30000] - Timeout in ms.
 * @param {boolean} [opts.keepAlive=true] - TCP keep-alive.
 * @param {Function} callback - Called per connection with (device, connection).
 */
function Server(opts, callback) {
  if (!(this instanceof Server)) {
    return new Server(opts, callback);
  }

  EventEmitter.call(this);

  const defaults = {
    debug: false,
    port: 8080,
    device_adapter: false,
    maxConnections: 1000,
    connectionTimeout: 30000,
    keepAlive: true
  };

  this.opts = extend(defaults, opts);
  const _this = this;
  this.devices = [];
  this.server = false;

  // Available adapters (only those actually used)
  this.availableAdapters = {
    JT808: '../adapters/JT808',
    GT06: '../adapters/gt06'
  };

  /**
   * Sets the device adapter.
   * @param {Object} adapter - Adapter object with adapter() method.
   */
  this.setAdapter = function (adapter) {
    if (typeof adapter.adapter !== 'function') {
      throw new Error('The adapter needs an adapter() method to start an instance of it');
    }
    this.device_adapter = adapter;
  };

  this.getAdapter = function () {
    return this.device_adapter;
  };

  /**
   * Initializes the server.
   * @param {Function} cb - Callback after init.
   */
  this.init = function (cb) {
    _this.setDebug(this.opts.debug);

    if (_this.opts.device_adapter === false) {
      throw new Error('The app didn\'t set the device_adapter to use.');
    }

    if (typeof _this.opts.device_adapter === 'string') {
      const adapterName = _this.opts.device_adapter;
      if (typeof this.availableAdapters[adapterName] === 'undefined') {
        throw new Error('The class adapter for ' + adapterName + ' doesn\'t exist');
      }
      console.log("Using adapter: " + adapterName);
      const adapterFile = this.availableAdapters[adapterName];
      this.setAdapter(require(adapterFile));
    } else {
      this.setAdapter(this.opts.device_adapter);
    }

    _this.emit('before_init');
    if (typeof cb === 'function') cb();
    _this.emit('init');

    console.log('\n=================================================');
    console.log('GPS LISTENER running at port ' + _this.opts.port);
    console.log('EXPECTING DEVICE MODEL: ' + _this.getAdapter().model_name);
    console.log('=================================================\n');
  };

  this.do_log = function (msg, from) {
    if (this.getDebug() === false) return false;
    from = from || 'SERVER';
    console.log('#' + from + ': ' + msg);
  };

  this.setDebug = function (val) {
    this.debug = (val === true);
  };

  this.getDebug = function () {
    return this.debug;
  };

  // Initialize and start server
  this.init(function () {
    _this.server = net.createServer(function (connection) {
      // Set socket options
      connection.setTimeout(_this.opts.connectionTimeout);
      connection.setKeepAlive(_this.opts.keepAlive);

      const device = new Device(_this.getAdapter(), connection, _this);
      connection.device = device;
      _this.devices.push(connection);

      connection.on('data', function (data) {
        device.emit('data', data);
      });

      connection.on('end', function () {
        _this.devices.splice(_this.devices.indexOf(connection), 1);
        device.emit('disconnected');
      });

      connection.on('error', (err) => {
        // Empty handler per requirement
      });

      connection.on('close', () => {
        // Empty handler
      });

      connection.on('timeout', () => {
        // Empty handler
      });

      callback(device, connection);
      device.emit('connected');
    });

    _this.server.on('error', (err) => {
      // Empty handler per requirement
    });

    _this.server.listen(_this.opts.port, () => {
      console.log('server bound');
    });
  });

  /**
   * Finds a device by its UID.
   * @param {string} deviceId - Device identifier.
   * @returns {Device|false} Device object or false if not found.
   */
  this.find_device = function (deviceId) {
    for (const conn of this.devices) {
      if (conn.device.uid === deviceId) {
        return conn.device;
      }
    }
    return false;
  };

  /**
   * Sends a message to a specific device.
   * @param {string} deviceId - Target device ID.
   * @param {Buffer|string} msg - Message to send.
   */
  this.send_to = function (deviceId, msg) {
    const dev = this.find_device(deviceId);
    if (dev) dev.send(msg);
  };

  return this;
}

exports.server = Server;
exports.version = require('../package').version;