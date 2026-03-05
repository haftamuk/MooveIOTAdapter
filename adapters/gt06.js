/* Comprehensive GT06 Protocol Adapter with Enhanced Alarm Parsing */
const f = require('../lib/functions');
const logger = require('../lib/logger');

exports.protocol = 'GT06N';
exports.model_name = 'GT06N';
exports.compatible_hardware = ['GT06N', 'GT06', 'GT06E', 'GT06F', 'GT06H'];

var adapter = function (device) {
  if (!(this instanceof adapter)) {
    return new adapter(device);
  }

  this.format = {'start': '78', 'end': '0d0a', 'separator': ''};
  this.device = device;   // DEBUG: now we have device reference
  this.__count = 1;

  /*******************************************
   ENHANCED PACKET PARSING FOR ALL GT06 VARIANTS
   *******************************************/
  this.parse_data = function (data) {
    try {
      var hexData = this.bufferToHexString(data);
      logger.debug(`Raw hex data received: ${hexData}`);

      if (hexData.length < 10) {
        logger.debug('Packet too short');
        return { cmd: 'noop', action: 'noop', device_id: '' };
      }

      var parts = {
        'raw': hexData,
        'start': hexData.substr(0, 4)
      };

      if (parts['start'] !== '7878' && parts['start'] !== '7979') {
        logger.debug(`Invalid start bytes: ${parts['start']}`);
        return { cmd: 'noop', action: 'noop', device_id: '' };
      }

      parts['length'] = parseInt(hexData.substr(4, 2), 16);

      const minExpectedLength = 4 + 2 + (parts['length'] * 2) + 4;
      if (hexData.length < minExpectedLength) {
        logger.debug(`Incomplete packet: ${hexData.length}/${minExpectedLength}`);
        return { cmd: 'noop', action: 'noop', device_id: '' };
      }

      parts['protocol_id'] = hexData.substr(6, 2).toLowerCase();
      logger.debug(`Protocol ID: ${parts['protocol_id']}`);

      const dataStart = 8;
      const dataEnd = 8 + (parts['length'] - 1) * 2;
      parts['data'] = hexData.substring(dataStart, dataStart + (parts['length'] - 1) * 2);

      this.extract_serial_crc(parts);
      this.map_protocol_to_action(parts);

      if (parts['protocol_id'] === '01' && parts['data'].length >= 16) {
        parts['device_id'] = parts['data'].substr(0, 16);
      } else {
        parts['device_id'] = '';
      }

      parts.raw_hex = hexData;

      logger.debug(`Parsed: Protocol=${parts['protocol_id']}, Action=${parts.action}, DataLen=${parts['data'].length}`);
      return parts;
    } catch (error) {
      logger.error('Error parsing data:', error);
      return { cmd: 'noop', action: 'noop', device_id: '' };
    }
  };

  this.extract_serial_crc = function(parts) {
    const data = parts['data'];
    if (data.length >= 8) {
      parts['serial_number'] = data.substr(data.length - 8, 4);
      parts['crc'] = data.substr(data.length - 4, 4);
      parts['data_body'] = data.substring(0, data.length - 8);
    } else {
      parts['data_body'] = data;
    }
    logger.debug(`extract_serial_crc: serial=${parts['serial_number']}, crc=${parts['crc']}`);
  };

  this.map_protocol_to_action = function(parts) {
    const protocolMap = {
      '01': { cmd: 'login_request', action: 'login_request' },
      '10': { cmd: 'ping', action: 'ping' },
      '11': { cmd: 'ping', action: 'ping' },
      '12': { cmd: 'ping', action: 'ping' },
      '13': { cmd: 'heartbeat', action: 'heartbeat' },
      '16': { cmd: 'alarm', action: 'alarm' },
      '17': { cmd: 'lbs_location', action: 'lbs_location' },
      '18': { cmd: 'status', action: 'status' },
      '19': { cmd: 'status', action: 'status' },
      '1a': { cmd: 'alarm', action: 'alarm' },
      '1b': { cmd: 'alarm', action: 'alarm' },
      '1c': { cmd: 'alarm', action: 'alarm' },
      '22': { cmd: 'ping', action: 'ping' },
      '26': { cmd: 'alarm', action: 'alarm' },
      '27': { cmd: 'alarm', action: 'alarm' },
      '28': { cmd: 'ping', action: 'ping' },
      '2a': { cmd: 'alarm', action: 'alarm' },
      '2b': { cmd: 'alarm', action: 'alarm' },
      '2c': { cmd: 'alarm', action: 'alarm' },
      '80': { cmd: 'command_response', action: 'command_response' },
      '81': { cmd: 'command_response', action: 'command_response' },
      'default': { cmd: 'noop', action: 'noop' }
    };
    const mapping = protocolMap[parts['protocol_id']] || protocolMap['default'];
    parts.cmd = mapping.cmd;
    parts.action = mapping.action;
    logger.debug(`map_protocol_to_action: protocol=${parts['protocol_id']} -> cmd=${parts.cmd}, action=${parts.action}`);
  };

  this.bufferToHexString = function (buffer) {
    var str = '';
    for (var i = 0; i < buffer.length; i++) {
      var hex = buffer[i].toString(16);
      str += hex.length === 1 ? '0' + hex : hex;
    }
    return str;
  };

  this.buildResponse = function (protocol, serial) {
    const withoutCRC = '7878' + '05' + protocol + serial;
    const crc = f.crc16(Buffer.from(withoutCRC, 'hex'));
    const response = withoutCRC + crc + '0D0A';
    logger.debug(`buildResponse: protocol=${protocol}, serial=${serial}, response=${response}`);
    return response;
  };

  this.authorize = function (msg_parts) {
    logger.debug(`authorize called for device: ${this.device.getUID()}`);
    const serial = msg_parts.serial_number || '0001';
    const response = this.buildResponse('01', serial);
    // DEBUG: log custom message
    if (this.device && this.device.logDebug) {
      this.device.logDebug(`Sending login response (protocol 0x01, serial ${serial})`);
    }
    this.device.send(Buffer.from(response, 'hex'));
  };

  this.receive_heartbeat = function (msg_parts) {
    logger.debug(`receive_heartbeat called for device: ${this.device.getUID()}`);
    const serial = msg_parts.serial_number || '0001';
    const response = this.buildResponse('13', serial);
    // DEBUG:
    if (this.device && this.device.logDebug) {
      this.device.logDebug(`Sending heartbeat response (protocol 0x13, serial ${serial})`);
    }
    this.device.send(Buffer.from(response, 'hex'));
  };

  this.send_alarm_response = function (msg_parts) {
    logger.debug(`send_alarm_response called for device: ${this.device.getUID()}`);
    const serial = msg_parts.serial_number || '0001';
    const protocol = msg_parts.protocol_id;
    const response = this.buildResponse(protocol, serial);
    // DEBUG:
    if (this.device && this.device.logDebug) {
      this.device.logDebug(`Sending alarm response (protocol 0x${protocol}, serial ${serial})`);
    }
    this.device.send(Buffer.from(response, 'hex'));
  };

  /*******************************************
   ENHANCED LOCATION DATA PARSING
   *******************************************/
  this.get_ping_data = function (msg_parts) {
    logger.debug(`get_ping_data called for device: ${this.device.getUID()}`);
    try {
      var str = msg_parts.data_body || msg_parts.data;
      logger.debug(`Parsing location data, length: ${str.length}`);

      let gpsData;
      if (str.length >= 38) {
        gpsData = this.parse_standard_gps_data(str, msg_parts);
      } else if (str.length >= 20) {
        gpsData = this.parse_compact_gps_data(str, msg_parts);
      } else {
        logger.error(`GPS data too short: ${str.length}`);
        return false;
      }

      // DEBUG: log location details
      if (this.device && this.device.logDebug && gpsData) {
        this.device.logDebug(`LOCATION: lat=${gpsData.latitude}, lng=${gpsData.longitude}, speed=${gpsData.speed}, time=${gpsData.date}`);
      }

      return gpsData;
    } catch (error) {
      logger.error('Error parsing ping data:', error);
      return false;
    }
  };

  this.parse_standard_gps_data = function (str, msg_parts) {
    logger.debug(`parse_standard_gps_data: data=${str}`);
    const dateHex = str.substr(0, 12);
    const year = parseInt(dateHex.substr(0, 2), 16) + 2000;
    const month = parseInt(dateHex.substr(2, 2), 16);
    const day = parseInt(dateHex.substr(4, 2), 16);
    const hour = parseInt(dateHex.substr(6, 2), 16);
    const minute = parseInt(dateHex.substr(8, 2), 16);
    const second = parseInt(dateHex.substr(10, 2), 16);
    // Use UTC to avoid timezone shifts
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

    const satellites = parseInt(str.substr(12, 2), 16);

    const latHex = str.substr(14, 8);
    let latitude = 0;
    if (latHex !== '00000000') {
      latitude = parseInt(latHex, 16) / 1800000;
    }

    const lngHex = str.substr(22, 8);
    let longitude = 0;
    if (lngHex !== '00000000') {
      longitude = parseInt(lngHex, 16) / 1800000;
    }

    const speed = parseInt(str.substr(30, 2), 16);

    const courseHex = str.substr(32, 4);
    let course = parseInt(courseHex, 16);
    if (course > 360) {
      course = course & 0xFF;
      course = (course * 360) / 255;
    }
    course = Math.round(course);

    let statusByte = 0;
    let statusBinary = '00000000';
    if (str.length >= 38) {
      statusByte = parseInt(str.substr(36, 2), 16);
      statusBinary = statusByte.toString(2).padStart(8, '0');
    } else if (str.length >= 30) {
      statusByte = parseInt(str.substr(28, 2), 16);
      statusBinary = statusByte.toString(2).padStart(8, '0');
    }

    const data = {
      device_id: msg_parts.device_id || '',
      date: date.toISOString(),
      timestampDate: date,
      latitude: latitude,
      longitude: longitude,
      speed: speed,
      orientation: course,
      satellites: satellites,
      raw_data: str,
      device_status: {
        power_status: statusBinary[0] === '0' ? 'normal' : 'low',
        gps_status: statusBinary[1] === '0' ? 'valid' : 'invalid',
        charge_status: statusBinary[5] === '0' ? 'not_charging' : 'charging',
        acc_status: statusBinary[6] === '1',
        armed_status: statusBinary[7] === '1',
        oil_cut: statusBinary[0] === '1',
        gps_tracking: statusBinary[1] === '1',
        alarm_bits: statusBinary.substr(2, 3)
      }
    };

    logger.debug('Parsed location:', {
      device: data.device_id,
      lat: data.latitude,
      lng: data.longitude,
      speed: data.speed,
      course: data.orientation,
      time: data.date
    });

    return data;
  };

  this.parse_compact_gps_data = function (str, msg_parts) {
    logger.debug(`parse_compact_gps_data: data=${str}`);
    const date = new Date(); // fallback to current time
    let latitude = 0;
    let longitude = 0;
    let speed = 0;

    if (str.length >= 20) {
      try {
        const latPart = str.substr(0, 8);
        const lngPart = str.substr(8, 8);
        if (latPart !== '00000000' && lngPart !== '00000000') {
          latitude = parseInt(latPart, 16) / 1800000;
          longitude = parseInt(lngPart, 16) / 1800000;
        }
        if (str.length >= 22) {
          speed = parseInt(str.substr(16, 2), 16);
        }
      } catch (e) {
        logger.error('Error parsing compact GPS:', e);
      }
    }

    return {
      device_id: msg_parts.device_id || '',
      date: date.toISOString(),
      timestampDate: date,
      latitude: latitude,
      longitude: longitude,
      speed: speed,
      orientation: 0,
      satellites: 0,
      raw_data: str,
      device_status: {
        power_status: 'normal',
        gps_status: 'valid',
        charge_status: 'not_charging',
        acc_status: false,
        armed_status: true
      }
    };
  };

  /*******************************************
   COMPREHENSIVE ALARM PARSING FOR ALL GT06 VARIANTS
   *******************************************/
  this.receive_alarm = function (msg_parts) {
    logger.debug(`receive_alarm called for device: ${this.device.getUID()}`);
    try {
      var str = msg_parts.data_body || msg_parts.data;
      logger.debug(`Parsing alarm data, protocol: ${msg_parts.protocol_id} length: ${str.length}`);

      const gpsData = this.parse_standard_gps_data(str, msg_parts);
      if (!gpsData) {
        logger.error('Failed to parse GPS data for alarm');
        return false;
      }

      let alarmCode = this.extract_alarm_code(str, msg_parts.protocol_id);
      const alarmType = this.map_alarm_code(alarmCode, msg_parts.protocol_id, str);

      const data = {
        code: alarmType,
        msg: alarmType,
        device_id: msg_parts.device_id || gpsData.device_id,
        date: gpsData.date,
        timestampDate: gpsData.timestampDate,
        latitude: gpsData.latitude,
        longitude: gpsData.longitude,
        speed: gpsData.speed,
        orientation: gpsData.orientation,
        satellites: gpsData.satellites,
        alarm_type: alarmType,
        alarm_code: alarmCode,
        raw_data: str,
        device_status: gpsData.device_status,
        protocol_id: msg_parts.protocol_id
      };

      logger.debug('Parsed alarm:', {
        device: data.device_id,
        alarm: data.alarm_type,
        code: alarmCode,
        lat: data.latitude,
        lng: data.longitude
      });

      // DEBUG: log alarm details
      if (this.device && this.device.logDebug) {
        this.device.logDebug(`ALARM: type=${data.alarm_type}, code=${data.alarm_code}, lat=${data.latitude}, lng=${data.longitude}, time=${data.date}`);
      }

      return data;
    } catch (error) {
      logger.error('Error parsing alarm data:', error);
      return false;
    }
  };

  this.extract_alarm_code = function(str, protocolId) {
    let alarmCode = '01';
    switch(protocolId) {
      case '1a':
        if (str.length >= 4) {
          if (str.length >= 70) alarmCode = str.substr(68, 2);
          else if (str.length >= 56) alarmCode = str.substr(54, 2);
          else if (str.length >= 40) alarmCode = str.substr(38, 2);
          else alarmCode = str.substr(str.length - 4, 2);
        }
        break;
      case '16':
      case '26':
        if (str.length >= 56) alarmCode = str.substr(54, 2);
        if (str.length >= 70) {
          const extendedCode = str.substr(68, 2);
          if (extendedCode !== '00' && extendedCode !== '') alarmCode = extendedCode;
        }
        break;
      case '27':
        if (str.length >= 60) alarmCode = str.substr(58, 2);
        break;
      default:
        if (str.length >= 40) {
          const statusByte = parseInt(str.substr(36, 2), 16);
          const statusBinary = statusByte.toString(2).padStart(8, '0');
          const alarmBits = statusBinary.substr(2, 3);
          switch(alarmBits) {
            case '000': alarmCode = '00'; break;
            case '100': alarmCode = '01'; break;
            case '011': alarmCode = '02'; break;
            case '010': alarmCode = '03'; break;
            case '001': alarmCode = '04'; break;
            default: alarmCode = '00';
          }
        }
    }
    logger.debug(`extract_alarm_code: protocol=${protocolId}, alarmCode=${alarmCode}`);
    return alarmCode.toUpperCase();
  };

  this.map_alarm_code = function(alarmCode, protocolId, rawData) {
    const alarmMap = {
      '00': 'Normal',
      '01': 'SOS Emergency',
      '02': 'Low Battery',
      '03': 'Power Cut',
      '04': 'Shock/Vibration',
      '05': 'Geo-fence In',
      '06': 'Geo-fence Out',
      '07': 'Over Speed Start',
      '08': 'Over Speed End',
      '09': 'Over Speed',
      '0A': 'Enter Sleep Mode',
      '0B': 'Exit Sleep Mode',
      '0C': 'Reserved',
      '0D': 'Door Open',
      '0E': 'Door Close',
      '0F': 'AC On',
      '10': 'AC Off',
      '11': 'Movement Detection',
      '12': 'Enter Area',
      '13': 'Exit Area',
      '14': 'Power On',
      '15': 'Power Off',
      '16': 'GPS First Fix',
      '17': 'GPS Antenna Short',
      '18': 'GPS Antenna Open',
      '19': 'Device Tamper',
      '1A': 'Key Detection',
      '1B': 'Reserved',
      '1C': 'Reserved',
      '1D': 'Reserved',
      '1E': 'Reserved',
      '1F': 'Reserved',
      '20': 'External Power Disconnected',
      '21': 'External Power Connected',
      '22': 'GPS Jamming Detection',
      'FF': 'System Notification 15'
    };

    let alarmType = alarmMap[alarmCode.toUpperCase()];
    if (!alarmType) {
      if (protocolId >= '80' && protocolId <= 'FF') {
        alarmType = `Command Response ${parseInt(alarmCode, 16)}`;
      } else if (parseInt(alarmCode, 16) >= 0x40 && parseInt(alarmCode, 16) <= 0x7F) {
        alarmType = `Custom Alarm ${parseInt(alarmCode, 16) - 0x3F}`;
      } else if (parseInt(alarmCode, 16) >= 0xA0) {
        alarmType = `Device Alert ${parseInt(alarmCode, 16) - 0x9F}`;
      } else {
        alarmType = `Unknown Alarm (${alarmCode})`;
      }
    }

    if (this.is_false_alarm(alarmCode, rawData)) {
      alarmType = `Status Report (${alarmType})`;
    }

    logger.debug(`map_alarm_code: alarmCode=${alarmCode} -> ${alarmType}`);
    return alarmType;
  };

  this.is_false_alarm = function(alarmCode, rawData) {
    if (!rawData || rawData.length < 20) return false;
    const latHex = rawData.substr(14, 8);
    const lngHex = rawData.substr(22, 8);
    if (latHex === '00000000' && lngHex === '00000000') {
      logger.debug('Zero coordinates detected - likely status report');
      return true;
    }
    const statusReportCodes = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09'];
    if (statusReportCodes.includes(alarmCode)) {
      const statusByte = rawData.substr(36, 2);
      if (statusByte === '00' || statusByte === '01') {
        return true;
      }
    }
    return false;
  };

  this.zeroPad = function (nNum, nPad) {
    return ('' + (Math.pow(10, nPad) + nNum)).slice(1);
  };

  this.synchronous_clock = function (msg_parts) {
    logger.debug(`synchronous_clock called (not implemented)`);
  };

  this.run_other = function (cmd, msg_parts) {
    logger.debug(`run_other called with cmd: ${cmd}`);
  };

  this.request_login_to_device = function () {
    logger.debug(`request_login_to_device called (not implemented)`);
  };

  this.set_refresh_time = function (interval, duration) {
    logger.debug(`set_refresh_time called (not implemented)`);
  };
};

exports.adapter = adapter;