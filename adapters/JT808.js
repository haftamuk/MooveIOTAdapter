// File: lib/adapters/JT808.js
const f = require('../lib/functions');
const logger = require('../lib/logger');

exports.protocol = 'JT808';
exports.model_name = 'JT808';
exports.compatible_hardware = ['UT04S'];

const adapter = function (device) {
  if (!(this instanceof adapter)) return new adapter(device);

  this.format = {
    start: '7e',
    end: '7e',
    separator: '',
  };
  this.device = device;
  this.otherSerial = 1;

  // Cache for sub‑package reassembly: key = deviceId_msgSerial, value = { total, received: [] }
  this.subpackageCache = new Map();

  // ------------------------------------------------------------------------
  // Helper: parse BCD timestamp (YYMMDDhhmmss) to Date (GMT+8 adjusted)
  // ------------------------------------------------------------------------
  function parseBCDTimestamp(bcdHex) {
    if (bcdHex.length !== 12) return new Date(0); // invalid
    const year = parseInt(bcdHex.substring(0, 2), 16) + 2000;
    const month = parseInt(bcdHex.substring(2, 4), 16) - 1; // 0‑11
    const day = parseInt(bcdHex.substring(4, 6), 16);
    const hour = parseInt(bcdHex.substring(6, 8), 16);
    const minute = parseInt(bcdHex.substring(8, 10), 16);
    const second = parseInt(bcdHex.substring(10, 12), 16);

    // Convert GMT+8 to UTC by subtracting 8 hours
    let utcHour = hour - 8;
    let utcDay = day;
    let utcMonth = month;
    let utcYear = year;

    if (utcHour < 0) {
      utcHour += 24;
      utcDay -= 1;
      if (utcDay < 1) {
        // move to previous month – simplified: assume not crossing year boundary
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        utcDay = prevMonthLastDay;
        utcMonth -= 1;
        if (utcMonth < 0) {
          utcMonth = 11;
          utcYear -= 1;
        }
      }
    }

    return new Date(Date.UTC(utcYear, utcMonth, utcDay, utcHour, minute, second));
  }

  // ------------------------------------------------------------------------
  // Calculate XOR checksum of a buffer (excluding the checksum byte itself)
  // ------------------------------------------------------------------------
  function calculateChecksum(buf) {
    let xor = 0;
    for (let i = 0; i < buf.length; i++) {
      xor ^= buf[i];
    }
    return xor;
  }

  // ------------------------------------------------------------------------
  // Parse incoming data (called by device.js with unescaped buffer)
  // ------------------------------------------------------------------------
  this.parse_data = function (data) {
    // data is a Buffer of the unescaped inner packet (without start/end markers)
    const hex = data.toString('hex').toUpperCase();
    logger.debug(`JT808 parse_data: unescaped hex=${hex}`);

    if (data.length < 13) { // minimum header length
      logger.error('Message too short:', hex);
      return false;
    }

    // Extract header fields
    const msgId = data.readUInt16BE(0).toString(16).padStart(4, '0').toUpperCase();
    const attr = data.readUInt16BE(2);
    const bodyLen = attr & 0x3FF;                     // bits 0‑9
    const encryption = (attr >> 10) & 0x07;            // bits 10‑12
    const subpackage = (attr >> 13) & 0x01;            // bit 13
    // bits 14‑15 reserved

    // Terminal phone number (BCD[6])
    const phoneBcd = data.slice(4, 10).toString('hex').toUpperCase();
    // Pad with leading zeros to 12 digits if needed
    const device_id = phoneBcd.padStart(12, '0');

    const msgSerialNo = data.readUInt16BE(10).toString(16).padStart(4, '0').toUpperCase();

    let headerLen = 12; // msgId(2)+attr(2)+phone(6)+serial(2) = 12 bytes
    let totalPackages = 1;
    let packageNo = 1;
    let bodyStart = 12;

    if (subpackage) {
      headerLen += 4; // total packages (2) + package no (2)
      if (data.length < headerLen) {
        logger.error('Header too short for subpackage info');
        return false;
      }
      totalPackages = data.readUInt16BE(12);
      packageNo = data.readUInt16BE(14);
      bodyStart = 16;
    }

    // Validate total length (header + body + checksum)
    if (data.length !== headerLen + bodyLen + 1) {
      logger.error(`Length mismatch: expected ${headerLen + bodyLen + 1}, got ${data.length}`);
      return false;
    }

    // Verify checksum
    const receivedChecksum = data[data.length - 1];
    const computedChecksum = calculateChecksum(data.slice(0, data.length - 1));
    if (receivedChecksum !== computedChecksum) {
      logger.error(`Checksum mismatch: received 0x${receivedChecksum.toString(16)}, computed 0x${computedChecksum.toString(16)}`);
      return false;
    }

    const body = data.slice(bodyStart, bodyStart + bodyLen).toString('hex').toUpperCase();

    // Build parts object
    const parts = {
      start: '7e', // not really used
      cmd: msgId,
      packet_length: attr.toString(16).padStart(4, '0'), // for compatibility
      device_id: device_id,
      cmd_serial_no: msgSerialNo,
      data: body,
      raw_hex: hex,
      // additional parsed fields
      msgId,
      attr,
      bodyLen,
      encryption,
      subpackage,
      totalPackages,
      packageNo,
      msgSerialNo,
    };

    // Determine action based on command
    switch (msgId) {
      case '0100': parts.action = 'register'; break;
      case '0002': parts.action = 'heartbeat'; break;
      case '0102': parts.action = 'login_request'; break;
      case '0003': parts.action = 'logout'; break;
      case '0200':
        const alarmFlag = body.substring(0, 8);
        parts.action = (parseInt(alarmFlag, 16) !== 0) ? 'alarm' : 'ping';
        break;
      case '0704': parts.action = 'batch_location'; break;
      case '0702': parts.action = 'driver_info'; break;
      case '0800': parts.action = 'multimedia_event'; break;
      case '0801': parts.action = 'multimedia_data'; break;
      default: parts.action = 'other';
    }

    logger.debug('========================================');
    logger.debug('JT808.JS PARSED DATA');
    logger.debug(`Command: ${parts.cmd} Action: ${parts.action}`);
    logger.debug(`Device ID: ${parts.device_id}`);
    logger.debug(`Sequence: ${parts.cmd_serial_no}`);
    logger.debug(`Subpackage: ${subpackage ? 'yes' : 'no'} (${packageNo}/${totalPackages})`);
    logger.debug(`Data length: ${bodyLen} bytes`);
    logger.debug('========================================');

    // If subpackaged, attempt reassembly
    if (subpackage && totalPackages > 1) {
      return this.handleSubpackage(parts);
    }

    return parts;
  };

  // ------------------------------------------------------------------------
  // Sub‑package reassembly
  // ------------------------------------------------------------------------
  this.handleSubpackage = function (parts) {
    const key = `${parts.device_id}_${parts.msgSerialNo}`;
    const { totalPackages, packageNo, data: bodyHex } = parts;

    let entry = this.subpackageCache.get(key);
    if (!entry) {
      entry = {
        total: totalPackages,
        received: new Array(totalPackages).fill(null),
        firstParts: parts, // store header info
        createdAt: Date.now()
      };
      this.subpackageCache.set(key, entry);
    }

    // Store this package (index 0‑based)
    entry.received[packageNo - 1] = bodyHex;

    // Check if all received
    if (entry.received.every(p => p !== null)) {
      // Reassemble body
      const fullBody = entry.received.join('');
      const reassembledParts = { ...entry.firstParts };
      reassembledParts.data = fullBody;
      reassembledParts.bodyLen = fullBody.length / 2; // in bytes
      reassembledParts.subpackage = false; // mark as reassembled
      reassembledParts.reassembled = true;

      // Clean up cache
      this.subpackageCache.delete(key);

      logger.debug(`Subpackage reassembly complete for key ${key}`);
      return reassembledParts;
    }

    // Not yet complete – return a placeholder (the original parts will be ignored)
    // The device.js will ignore actions for incomplete subpackages.
    return { incomplete: true, key, packageNo, totalPackages };
  };

  // ------------------------------------------------------------------------
  // Checksum calculation (XOR of all bytes except start/end)
  // ------------------------------------------------------------------------
  this.calcChecksum = (packet) => {
    const bytes = packet.match(/.{1,2}/g);
    let xor = 0;
    for (let i = 0; i < bytes.length; i++) {
      xor ^= parseInt(bytes[i], 16);
    }
    return xor.toString(16).padStart(2, '0').toUpperCase();
  };

  // ------------------------------------------------------------------------
  // Send a general response (0x8001) to the device
  // ------------------------------------------------------------------------
  this.send_response = function (responseCmd, msgParts, message_serial_number, result = '00') {
    // Build core: msgId(8001) + attr(0005) + phone + serial + replySerial + replyMsgId + result
    const replySerial = msgParts.cmd_serial_no; // the serial number of the message we are responding to
    const core = '8001' + '0005' + msgParts.device_id + message_serial_number + replySerial + msgParts.cmd + result;
    const checksum = this.calcChecksum(core);
    const response = core + checksum; // without start/end markers
    logger.debug('========================================');
    logger.debug('JT808.JS SENDING RESPONSE TO DEVICE');
    logger.debug(`Response core: ${response}`);
    logger.debug('========================================');
    if (this.device && this.device.logDebug) {
      this.device.logDebug(`Sending response: cmd=0x${responseCmd}, seq=${message_serial_number}, result=${result}, raw=${response}`);
    }
    // device.send will add markers and escape
    this.device.send(Buffer.from(response, 'hex'));
  };

  this.getNextOtherSerial = function () {
    const serial = this.otherSerial.toString(16).padStart(4, '0').toUpperCase();
    this.otherSerial = (this.otherSerial + 1) & 0xFFFF;
    logger.debug(`getNextOtherSerial: ${serial}`);
    return serial;
  };

  this.first_time = function (message_serial_number, msgParts) {
    logger.debug(`first_time called for device: ${this.device.getUID()}`);
    this.send_response('8001', msgParts, message_serial_number, '00');
  };

  // Heartbeat handler
  this.hbt = async function (message_serial_number, msgParts) {
    logger.debug(`hbt called for device: ${this.device.getUID()}`);
    this.send_response('8001', msgParts, message_serial_number, '00');
  };

  this.register = async function (responseSerial, msgParts) {
    logger.debug(`register called for device: ${this.device.getUID()}`);
    try {
        // Parse registration data (optional, kept for logging)
        const provinceId = parseInt(msgParts.data.substring(0, 4), 16);
        const cityId = parseInt(msgParts.data.substring(4, 8), 16);
        const manufacturerId = msgParts.data.substring(8, 18);
        const terminalType = msgParts.data.substring(18, 58);
        const terminalId = msgParts.data.substring(58, 72);
        const plateColor = parseInt(msgParts.data.substring(72, 74), 16);
        const vinOrPlate = Buffer.from(msgParts.data.substring(74), 'hex').toString();

        msgParts.parsed_register = {
            provinceId, cityId, manufacturerId, terminalType, terminalId, plateColor, vinOrPlate
        };
        logger.debug(`register parsed: provinceId=${provinceId}, cityId=${cityId}, terminalId=${terminalId}`);

        // Success – result = 0x00
        const result = 0x00;
        // Authentication code (4 bytes, e.g., "1234" in ASCII)
        const authCode = Buffer.from("1234", 'ascii');
        const authCodeHex = authCode.toString('hex').toUpperCase();

        // Request serial from the original registration message
        const requestSerial = msgParts.cmd_serial_no; // e.g., "0001"

        // Body length = reply serial (2) + result (1) + auth code length
        const bodyLength = (2 + 1 + authCode.length).toString(16).padStart(4, '0').toUpperCase();

        // Body: reply serial + result + auth code
        const body = requestSerial + result.toString(16).padStart(2, '0').toUpperCase() + authCodeHex;

        // Header: message ID (8100) + bodyLength + terminal ID + response serial
        const header = '8100' + bodyLength + msgParts.device_id + responseSerial;

        // Full core (without start/stop and checksum)
        const core = header + body;

        const checksum = this.calcChecksum(core);
        const response = core + checksum; // device.send will add markers and escape
        logger.debug('========================================');
        logger.debug(`Register response core: ${response}`);
        logger.debug('========================================');
        if (this.device && this.device.logDebug) {
          this.device.logDebug(`Sending register response (8100) with auth code`);
        }
        this.device.send(Buffer.from(response, 'hex'));

    } catch (error) {
        logger.error('Registration parsing failed:', error);
        // Failure response – result != 0, no auth code
        const result = 0x01; // or any appropriate error code
        const bodyLength = '0003'; // reply serial (2) + result (1)
        const body = msgParts.cmd_serial_no + result.toString(16).padStart(2, '0').toUpperCase();
        const header = '8100' + bodyLength + msgParts.device_id + responseSerial;
        const core = header + body;
        const checksum = this.calcChecksum(core);
        const response = core + checksum;
        if (this.device && this.device.logDebug) {
          this.device.logDebug(`Sending register response (8100) with error result`);
        }
        this.device.send(Buffer.from(response, 'hex'));
    }
  };

  this.authorize = async function (message_serial_number, msgParts) {
    logger.debug(`authorize called for device: ${this.device.getUID()}`);
    try {
      const authCode = Buffer.from(msgParts.data, 'hex').toString();
      msgParts.parsed_auth = { authCode };
      logger.debug(`authorize authCode=${authCode}`);
      this.send_response('8001', msgParts, message_serial_number, '00');
    } catch (error) {
      logger.error('Authentication parsing failed:', error);
      this.send_response('8001', msgParts, message_serial_number, '01');
    }
  };

  this.logout = async function (message_serial_number, msgParts) {
    logger.info(`logout called for device: ${msgParts.device_id}`);
    this.send_response('8001', msgParts, message_serial_number, '00');
  };

  // ------------------------------------------------------------------------
  // Location data parsing (with GMT+8 correction)
  // ------------------------------------------------------------------------
  this.parse_location_data = function (dataStr) {
    logger.debug(`parse_location_data: ${dataStr}`);
    if (!dataStr || dataStr.length < 56) {
        logger.error('Location data too short:', dataStr);
        return null;
    }

    const alarmFlag = parseInt(dataStr.substring(0, 8), 16);
    const status = parseInt(dataStr.substring(8, 16), 16);
    const latitude = parseInt(dataStr.substring(16, 24), 16) / 1000000;
    const longitude = parseInt(dataStr.substring(24, 32), 16) / 1000000;
    const altitude = parseInt(dataStr.substring(32, 36), 16);
    const speed = parseInt(dataStr.substring(36, 40), 16) / 10; // km/h
    const direction = parseInt(dataStr.substring(40, 44), 16);
    const timestamp = parseBCDTimestamp(dataStr.substring(44, 56));

    const additionalInfo = {};
    let remaining = dataStr.substring(56);
    while (remaining.length >= 4) {
        const infoId = remaining.substring(0, 2);
        const infoLen = parseInt(remaining.substring(2, 4), 16) * 2; // length in hex chars
        if (remaining.length < 4 + infoLen) break;
        const infoVal = remaining.substring(4, 4 + infoLen);

        switch (infoId) {
            case '01': additionalInfo.mileage = parseInt(infoVal, 16) / 10; break;
            case '02': additionalInfo.fuel = parseInt(infoVal, 16) / 10; break;
            case '03': additionalInfo.driving_speed = parseInt(infoVal, 16) / 10; break;
            case '25': additionalInfo.vehicle_signals = parseInt(infoVal, 16); break;
            case '30': additionalInfo.gsm_signal = parseInt(infoVal, 16); break;
            case '31': additionalInfo.satellites = parseInt(infoVal, 16); break;
            case '38': additionalInfo.battery_percentage = parseInt(infoVal, 16); break;
            case '2a': additionalInfo.io_status = parseInt(infoVal, 16); break;
            case '2b': additionalInfo.analog_data = parseInt(infoVal, 16); break;
            default: additionalInfo[infoId] = infoVal;
        }
        remaining = remaining.substring(4 + infoLen);
    }

    logger.debug(`parse_location_data: lat=${latitude}, lng=${longitude}, speed=${speed}`);
    return {
        alarm_flag: alarmFlag,
        status: status,
        latitude: latitude,
        longitude: longitude,
        altitude: altitude,
        speed: speed,
        direction: direction,
        timestamp: timestamp,               // Date object (correct UTC)
        additional_info: additionalInfo
    };
  };

  this.location_report = async function (message_serial_number, msgParts) {
    logger.debug(`location_report called for device: ${this.device.getUID()}`);
    try {
      const loc = this.parse_location_data(msgParts.data);
      if (!loc) throw new Error('Failed to parse location data');
      msgParts.parsed_location = loc;
      if (this.device && this.device.logDebug) {
        this.device.logDebug(`LOCATION: lat=${loc.latitude}, lng=${loc.longitude}, speed=${loc.speed}, time=${loc.timestamp.toISOString()}`);
      }
      this.send_response('8001', msgParts, message_serial_number, '00');
    } catch (error) {
      logger.error('Location report parsing failed:', error);
      this.send_response('8001', msgParts, message_serial_number, '00');
    }
  };

  this.alarm_report = async function (message_serial_number, msgParts) {
    logger.debug(`alarm_report called for device: ${this.device.getUID()}`);
    try {
      const loc = this.parse_location_data(msgParts.data);
      if (!loc) throw new Error('Failed to parse alarm data');
      const alarmType = this.get_alarm_type(loc.alarm_flag);
      msgParts.parsed_alarm = { loc, alarmType };
      if (this.device && this.device.logDebug) {
        this.device.logDebug(`ALARM: type=${alarmType}, flag=${loc.alarm_flag.toString(16)}, lat=${loc.latitude}, lng=${loc.longitude}, time=${loc.timestamp.toISOString()}`);
      }
      this.send_response('8001', msgParts, message_serial_number, '00');
    } catch (error) {
      logger.error('Alarm report parsing failed:', error);
      this.send_response('8001', msgParts, message_serial_number, '00');
    }
  };

  this.get_alarm_type = function (alarmFlag) {
    const alarmTypes = {
      0x00000001: 'Emergency',
      0x00000002: 'OverSpeed',
      0x00000004: 'FatigueDriving',
      0x00000008: 'DangerWarning',
      0x00000010: 'GNSSFailure',
      0x00000020: 'GNSSAntennaOpen',
      0x00000040: 'GNSSAntennaShort',
      0x00000080: 'PowerLow',
      0x00000100: 'PowerCut',
      0x00000200: 'DisplayFailure',
      0x00000400: 'TTSFailure',
      0x00000800: 'CameraFailure',
      0x00001000: 'ICCardFailure',
      0x00002000: 'OverSpeedWarning',
      0x00004000: 'FatigueWarning',
      0x00040000: 'TimeoutParking',
      0x00080000: 'EnterExitArea',
      0x00100000: 'EnterExitRoute',
      0x00200000: 'RouteTimeInsufficient',
      0x00400000: 'OffRoute',
      0x00800000: 'VSSFailure',
      0x01000000: 'FuelAbnormal',
      0x02000000: 'TheftAlarm',
      0x04000000: 'IllegalIgnition',
      0x08000000: 'IllegalDisplacement',
      0x10000000: 'CollisionWarning',
      0x20000000: 'RolloverWarning',
      0x40000000: 'IllegalDoorOpen'
    };
    for (const [flag, type] of Object.entries(alarmTypes)) {
      if (alarmFlag & parseInt(flag)) return type;
    }
    return 'UnknownAlarm';
  };

  this.get_ping_data = function (msg_parts) {
    logger.debug(`get_ping_data called for device: ${this.device.getUID()}`);
    const loc = this.parse_location_data(msg_parts.data);
    if (!loc) {
      logger.warn('get_ping_data: location parsing failed, returning zeros');
      return {
        latitude: 0, longitude: 0, device_id: msg_parts.device_id,
        date: new Date(), speed: 0, orientation: 0
      };
    }
    return {
      alarm_mask: loc.alarm_flag.toString(16).padStart(8, '0'),
      status: loc.status.toString(16).padStart(8, '0'),
      latitude: loc.latitude,
      longitude: loc.longitude,
      height: loc.altitude,
      speed: loc.speed,
      direction: loc.direction,
      date: loc.timestamp, // Date object (UTC)
      orientation: loc.direction.toString(),
      io_state: loc.additional_info.io_status ? loc.additional_info.io_status.toString(16) : '',
      mile_data: loc.additional_info.mileage || '',
      device_id: msg_parts.device_id,
      satellites: loc.additional_info.satellites || 0,
      battery: loc.additional_info.battery_percentage,
      gsm_signal: loc.additional_info.gsm_signal
    };
  };

  this.receive_alarm = function (msg_parts) {
    logger.debug(`receive_alarm called for device: ${this.device.getUID()}`);
    const loc = this.parse_location_data(msg_parts.data);
    const alarmType = this.get_alarm_type(loc.alarm_flag);
    logger.debug(`receive_alarm: alarmType=${alarmType}, flag=${loc.alarm_flag}`);
    return {
      device_id: msg_parts.device_id,
      alarm_type: alarmType,
      alarm_code: loc.alarm_flag,
      latitude: loc.latitude,
      longitude: loc.longitude,
      speed: loc.speed,
      device_status: {
        alarm_flag: loc.alarm_flag,
        status_flags: loc.status,
        battery: loc.additional_info.battery_percentage,
        gsm_signal: loc.additional_info.gsm_signal
      },
      raw_data: msg_parts.raw_hex
    };
  };

  this.batch_location = async function (message_serial_number, msgParts) {
    logger.debug(`batch_location called for device: ${this.device.getUID()}`);
    try {
      const numItems = parseInt(msgParts.data.substring(0, 4), 16);
      const locationType = parseInt(msgParts.data.substring(4, 6), 16);
      logger.debug(`Batch location upload: ${numItems} items, type: ${locationType}`);

      let offset = 6;
      const locations = [];
      for (let i = 0; i < numItems; i++) {
        const itemLen = parseInt(msgParts.data.substring(offset, offset + 4), 16) * 2;
        const itemData = msgParts.data.substring(offset + 4, offset + 4 + itemLen);
        const loc = this.parse_location_data(itemData);
        if (loc) {
          locations.push({
            ...loc,
            raw_data: itemData
          });
        }
        offset += 4 + itemLen;
      }

      msgParts.parsed_batch = locations;
      logger.debug(`batch_location: parsed ${locations.length} locations`);
      if (this.device && this.device.logDebug) {
        this.device.logDebug(`Batch location: ${locations.length} items`);
      }
      this.send_response('8001', msgParts, message_serial_number, '00');
    } catch (error) {
      logger.error('Batch location parsing failed:', error);
      this.send_response('8001', msgParts, message_serial_number, '00');
    }
  };

  this.driver_info = async function (message_serial_number, msgParts) {
    logger.debug(`driver_info called for device: ${this.device.getUID()}`);
    try {
      const status = parseInt(msgParts.data.substring(0, 2), 16);
      const time = parseBCDTimestamp(msgParts.data.substring(2, 14));
      const readResult = parseInt(msgParts.data.substring(14, 16), 16);

      const driverInfo = {
        device_id: msgParts.device_id,
        status: status === 0x01 ? 'ON_DUTY' : 'OFF_DUTY',
        time: time.toISOString(),
        read_result: readResult,
        raw_data: msgParts.data
      };

      if (readResult === 0x00) {
        const nameLen = parseInt(msgParts.data.substring(16, 18), 16);
        const nameHex = msgParts.data.substring(18, 18 + nameLen * 2);
        driverInfo.driver_name = Buffer.from(nameHex, 'hex').toString('utf8');

        const certHex = msgParts.data.substring(18 + nameLen * 2, 58 + nameLen * 2);
        driverInfo.certificate_code = Buffer.from(certHex, 'hex').toString('utf8');

        const orgLen = parseInt(msgParts.data.substring(58 + nameLen * 2, 60 + nameLen * 2), 16);
        const orgHex = msgParts.data.substring(60 + nameLen * 2, 60 + nameLen * 2 + orgLen * 2);
        driverInfo.issuing_org = Buffer.from(orgHex, 'hex').toString('utf8');

        const validityHex = msgParts.data.substring(60 + nameLen * 2 + orgLen * 2, 68 + nameLen * 2 + orgLen * 2);
        driverInfo.validity = validityHex;
      }

      msgParts.parsed_driver = driverInfo;
      logger.debug('Driver info received:', driverInfo);
      this.send_response('8001', msgParts, message_serial_number, '00');
    } catch (error) {
      logger.error('Driver info parsing failed:', error);
      this.send_response('8001', msgParts, message_serial_number, '00');
    }
  };

  this.run_other = function (cmd, msg_parts) {
    logger.debug(`run_other called for device: ${this.device.getUID()}, cmd=${cmd}`);
    const serial = this.getNextOtherSerial();

    switch (cmd) {
      case '0704':
        this.batch_location(serial, msg_parts);
        break;
      case '0702':
        this.driver_info(serial, msg_parts);
        break;
      case '0107':
        this.send_response('8001', msg_parts, serial, '00');
        break;
      case '0800':
      case '0801':
        logger.debug('Multimedia data received – not implemented');
        this.send_response('8001', msg_parts, serial, '03');
        break;
      default:
        logger.debug(`Unknown command: ${cmd}`);
        this.send_response('8001', msg_parts, serial, '03');
    }
  };

  this.request_login_to_device = function () {
    logger.debug(`request_login_to_device called (not implemented)`);
  };

  this.set_refresh_time = function (interval, duration) {
    logger.debug(`set_refresh_time called (not implemented)`);
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration - hours * 3600) / 60);
    const time =
      f.str_pad(interval.toString(16), 4, '0') +
      f.str_pad(hours.toString(16), 2, '0') +
      f.str_pad(minutes.toString(16), 2, '0');
    this.send_comand('AR00', time);
  };
};

exports.adapter = adapter;