// File: lib/server.js
const util = require('util');
const EventEmitter = require('events').EventEmitter;
const net = require('net');
const extend = require('node.extend');
const Device = require('./device');
const logger = require('./logger'); // <-- added

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
      logger.info("Using adapter: " + adapterName);
      const adapterFile = this.availableAdapters[adapterName];
      this.setAdapter(require(adapterFile));
    } else {
      this.setAdapter(this.opts.device_adapter);
    }

    _this.emit('before_init');
    if (typeof cb === 'function') cb();
    _this.emit('init');

    logger.info('\n=================================================');
    logger.info(`GPS LISTENER running at port ${_this.opts.port}`);
    logger.info(`EXPECTING DEVICE MODEL: ${_this.getAdapter().model_name}`);
    logger.info('=================================================\n');
  };

  this.do_log = function (msg, from) {
    if (this.getDebug() === false) return false;
    from = from || 'SERVER';
    logger.info(`#${from}: ${msg}`);
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
        logger.error(`Socket error for device ${connection.device ? connection.device.getUID() : 'unknown'}: ${err.message}`, { error: err });
      });

      connection.on('close', () => {
        logger.debug(`Connection closed for device ${connection.device ? connection.device.getUID() : 'unknown'}`);
      });

      connection.on('timeout', () => {
        logger.warn(`Connection timeout for device ${connection.device ? connection.device.getUID() : 'unknown'}`);
      });

      callback(device, connection);
      device.emit('connected');
    });

    _this.server.on('error', (err) => {
      logger.error(`Server error: ${err.message}`, { error: err });
    });

    _this.server.listen(_this.opts.port, () => {
      logger.info('server bound');
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