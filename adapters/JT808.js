// File: UT04SAdapter/node_modules/gps-tracking/lib/adapters/JT808.js
const f = require('../lib/functions');
const logger = require('../lib/logger'); // <-- added

exports.protocol = 'JT808';
exports.model_name = 'JT808';
exports.compatible_hardware = ['Integrated GPS Speed Limiter UT04S/unigiard'];

const adapter = function (device) {
  if (!(this instanceof adapter)) return new adapter(device);

  this.format = {
    start: '7e',
    end: '7e',
    separator: '',
  };
  this.device = device;
  this.otherSerial = 1;

  const converter = {
    '0': '0000', '1': '0001', '2': '0010', '3': '0011',
    '4': '0100', '5': '0101', '6': '0110', '7': '0111',
    '8': '1000', '9': '1001', 'a': '1010', 'b': '1011',
    'c': '1100', 'd': '1101', 'e': '1110', 'f': '1111'
  };

  function hex2bin(hex) {
    hex = hex.replace('0x', '').toLowerCase();
    let out = '';
    for (const c of hex) out += converter[c];
    return out;
  }

  function parseBCDTimestamp(bcdTime) {
    if (bcdTime.length !== 12) return new Date();
    const year = '20' + bcdTime.substring(0, 2);
    const month = bcdTime.substring(2, 4);
    const day = bcdTime.substring(4, 6);
    const hour = bcdTime.substring(6, 8);
    const minute = bcdTime.substring(8, 10);
    const second = bcdTime.substring(10, 12);
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  }

  // ------------------------------------------------------------------------
  // Parse incoming data (called by the library)
  // ------------------------------------------------------------------------
  this.parse_data = function (data) {
    data = data.toString('hex');

    if (data.length < 26) {
      logger.error('Message too short:', data);
      return false;
    }

    const parts = {
      start: data.substring(0, 2),
      cmd: data.substring(2, 6),
      packet_length: data.substring(6, 10),
      device_id: data.substring(10, 22),
      cmd_serial_no: data.substring(22, 26),
      data: data.substring(26, data.length - 4),
      cksm: data.substring(data.length - 4, data.length - 2),
      finish: data.substring(data.length - 2),
      raw_hex: data
    };

    // Determine action based on command
    switch (parts.cmd) {
      case '0100': parts.action = 'register'; break;
      case '0002': parts.action = 'heartbeat'; break;          // changed from 'hbt'
      case '0102': parts.action = 'login_request'; break;
      case '0003': parts.action = 'logout'; break;
      case '0200':
        const alarmFlag = parts.data.substring(0, 8);
        parts.action = (parseInt(alarmFlag, 16) !== 0) ? 'alarm' : 'ping';
        break;
      case '0704': parts.action = 'batch_location'; break;
      case '0702': parts.action = 'driver_info'; break;
      case '0800': parts.action = 'multimedia_event'; break;
      case '0801': parts.action = 'multimedia_data'; break;
      default: parts.action = 'other';
    }

    logger.debug('========================================');
    logger.debug('UT04S.JS PARSED DATA');
    logger.debug(`Command: ${parts.cmd} Action: ${parts.action}`);
    logger.debug(`Device ID: ${parts.device_id}`);
    logger.debug(`Sequence: ${parts.cmd_serial_no}`);
    logger.debug(`Data length: ${parts.data.length / 2} bytes`);
    logger.debug('========================================');

    return parts;
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
    const core = '8001' + '0005' + msgParts.device_id + message_serial_number + msgParts.cmd_serial_no + msgParts.cmd + result;
    const checksum = this.calcChecksum(core);
    const response = msgParts.start + core + checksum + msgParts.finish;
    logger.debug('========================================');
    logger.debug('UT04S.JS SENDING RESPONSE TO DEVICE');
    logger.debug(`Response: ${response.toUpperCase()}`);
    logger.debug('========================================');
    this.device.send(Buffer.from(response, 'hex'));
  };

  this.getNextOtherSerial = function () {
    const serial = this.otherSerial.toString(16).padStart(4, '0').toUpperCase();
    this.otherSerial = (this.otherSerial + 1) & 0xFFFF;
    return serial;
  };

  this.first_time = function (message_serial_number, msgParts) {
    logger.debug(`First time connection for device: ${msgParts.device_id}`);
    this.send_response('8001', msgParts, message_serial_number, '00');
  };

  // Heartbeat handler
  this.hbt = async function (message_serial_number, msgParts) {
    this.send_response('8001', msgParts, message_serial_number, '00');
  };

  this.register = async function (message_serial_number, msgParts) {
    try {
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

      this.send_response('8100', msgParts, message_serial_number, '00');
    } catch (error) {
      logger.error('Registration parsing failed:', error);
      this.send_response('8100', msgParts, message_serial_number, '01');
    }
  };

  this.authorize = async function (message_serial_number, msgParts) {
    try {
      const authCode = Buffer.from(msgParts.data, 'hex').toString();
      msgParts.parsed_auth = { authCode };
      this.send_response('8001', msgParts, message_serial_number, '00');
    } catch (error) {
      logger.error('Authentication parsing failed:', error);
      this.send_response('8001', msgParts, message_serial_number, '01');
    }
  };

  this.logout = async function (message_serial_number, msgParts) {
    logger.info(`Device logout: ${msgParts.device_id}`);
    this.send_response('8001', msgParts, message_serial_number, '00');
  };

  this.parse_location_data = function (dataStr) {
    if (!dataStr || dataStr.length < 56) {
      logger.error('Location data too short:', dataStr);
      return null;
    }

    const alarmFlag = parseInt(dataStr.substring(0, 8), 16);
    const status = parseInt(dataStr.substring(8, 16), 16);
    const latitude = parseInt(dataStr.substring(16, 24), 16) / 1000000;
    const longitude = parseInt(dataStr.substring(24, 32), 16) / 1000000;
    const altitude = parseInt(dataStr.substring(32, 36), 16);
    const speed = parseInt(dataStr.substring(36, 40), 16) / 10;
    const direction = parseInt(dataStr.substring(40, 44), 16);
    const timestamp = parseBCDTimestamp(dataStr.substring(44, 56));

    const additionalInfo = {};
    let remaining = dataStr.substring(56);
    while (remaining.length >= 4) {
      const infoId = remaining.substring(0, 2);
      const infoLen = parseInt(remaining.substring(2, 4), 16) * 2;
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

    return {
      alarm_flag: alarmFlag,
      status: status,
      latitude: latitude,
      longitude: longitude,
      altitude: altitude,
      speed: speed,
      direction: direction,
      timestamp: timestamp,
      additional_info: additionalInfo
    };
  };

  this.location_report = async function (message_serial_number, msgParts) {
    try {
      const loc = this.parse_location_data(msgParts.data);
      if (!loc) throw new Error('Failed to parse location data');
      msgParts.parsed_location = loc;
      this.send_response('8001', msgParts, message_serial_number, '00');
    } catch (error) {
      logger.error('Location report parsing failed:', error);
      this.send_response('8001', msgParts, message_serial_number, '00');
    }
  };

  this.alarm_report = async function (message_serial_number, msgParts) {
    try {
      const loc = this.parse_location_data(msgParts.data);
      if (!loc) throw new Error('Failed to parse alarm data');
      const alarmType = this.get_alarm_type(loc.alarm_flag);
      msgParts.parsed_alarm = { loc, alarmType };
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
    const loc = this.parse_location_data(msg_parts.data);
    if (!loc) {
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
      date: loc.timestamp,
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
    const loc = this.parse_location_data(msg_parts.data);
    const alarmType = this.get_alarm_type(loc.alarm_flag);
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
      this.send_response('8001', msgParts, message_serial_number, '00');
    } catch (error) {
      logger.error('Batch location parsing failed:', error);
      this.send_response('8001', msgParts, message_serial_number, '00');
    }
  };

  this.driver_info = async function (message_serial_number, msgParts) {
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
    logger.debug(`Running other command: ${cmd}`);
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
    logger.debug('Requesting login from device');
  };

  this.set_refresh_time = function (interval, duration) {
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