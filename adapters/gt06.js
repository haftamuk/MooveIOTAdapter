/* Comprehensive GT06 Protocol Adapter with Enhanced Alarm Parsing */
const f = require('../lib/functions');

exports.protocol = 'GT06N';
exports.model_name = 'GT06N';
exports.compatible_hardware = ['GT06N', 'GT06', 'GT06E', 'GT06F', 'GT06H'];

var adapter = function (device) {
  if (!(this instanceof adapter)) {
    return new adapter(device);
  }

  this.format = {'start': '(', 'end': ')', 'separator': ''};
  this.device = device;
  this.__count = 1;

  /*******************************************
   ENHANCED PACKET PARSING FOR ALL GT06 VARIANTS
   *******************************************/
  this.parse_data = function (data) {
    try {
      var hexData = this.bufferToHexString(data);
      console.log('Raw hex data received:', hexData);
      
      // Check minimum length
      if (hexData.length < 10) {
        console.log('Packet too short');
        return { cmd: 'noop', action: 'noop', device_id: '' };
      }

      var parts = {
        'raw': hexData,
        'start': hexData.substr(0, 4)
      };

      // Check for valid start bytes (GT06 uses 7878 or 7979)
      if (parts['start'] !== '7878' && parts['start'] !== '7979') {
        console.log('Invalid start bytes:', parts['start']);
        return { cmd: 'noop', action: 'noop', device_id: '' };
      }

      // Parse packet length
      parts['length'] = parseInt(hexData.substr(4, 2), 16);
      
      // Check for complete packet
      const minExpectedLength = 4 + 2 + (parts['length'] * 2) + 4;
      if (hexData.length < minExpectedLength) {
        console.log(`Incomplete packet: ${hexData.length}/${minExpectedLength}`);
        return { cmd: 'noop', action: 'noop', device_id: '' };
      }

      // Extract protocol ID
      parts['protocol_id'] = hexData.substr(6, 2).toLowerCase();
      console.log('Protocol ID:', parts['protocol_id']);
      
      // Extract data section
      const dataStart = 8; // After start(4) + length(2) + protocol(2)
      const dataEnd = 8 + (parts['length'] - 1) * 2; // Length includes protocol byte
      parts['data'] = hexData.substring(dataStart, dataStart + (parts['length'] - 1) * 2);
      
      // Extract serial number and CRC (if present in data)
      this.extract_serial_crc(parts);
      
      // Map protocol IDs to actions with enhanced detection
      this.map_protocol_to_action(parts);

      // Extract device ID for login packets
      if (parts['protocol_id'] === '01' && parts['data'].length >= 16) {
        parts['device_id'] = parts['data'].substr(0, 16);
      } else {
        parts['device_id'] = '';
      }

      console.log(`Parsed: Protocol=${parts['protocol_id']}, Action=${parts.action}, DataLen=${parts['data'].length}`);
      return parts;
    } catch (error) {
      console.error('Error parsing data:', error);
      return { cmd: 'noop', action: 'noop', device_id: '' };
    }
  };

  this.extract_serial_crc = function(parts) {
    const data = parts['data'];
    if (data.length >= 4) {
      // Last 4 hex digits are usually serial number (2 bytes) and CRC (2 bytes)
      parts['serial_number'] = data.substr(data.length - 4, 2);
      parts['crc'] = data.substr(data.length - 2, 2);
      parts['data_body'] = data.substring(0, data.length - 4);
    } else {
      parts['data_body'] = data;
    }
  };

  this.map_protocol_to_action = function(parts) {
    const protocolMap = {
      '01': { cmd: 'login_request', action: 'login_request' },
      '10': { cmd: 'ping', action: 'ping' }, // GPS data
      '11': { cmd: 'ping', action: 'ping' }, // GPS data
      '12': { cmd: 'ping', action: 'ping' }, // Location data
      '13': { cmd: 'heartbeat', action: 'heartbeat' },
      '16': { cmd: 'alarm', action: 'alarm' }, // Standard alarm
      '17': { cmd: 'lbs_location', action: 'lbs_location' },
      '18': { cmd: 'status', action: 'status' },
      '19': { cmd: 'status', action: 'status' }, // Extended status
      '1a': { cmd: 'alarm', action: 'alarm' }, // Query address (used as alarm by some brands)
      '1b': { cmd: 'alarm', action: 'alarm' }, // Extended alarm
      '1c': { cmd: 'alarm', action: 'alarm' }, // Custom alarm
      '22': { cmd: 'ping', action: 'ping' }, // GPS with address
      '26': { cmd: 'alarm', action: 'alarm' }, // Alarm with address
      '27': { cmd: 'alarm', action: 'alarm' }, // Extended alarm with status
      '28': { cmd: 'ping', action: 'ping' }, // Multi-location data
      '2a': { cmd: 'alarm', action: 'alarm' }, // Custom alarm 2
      '2b': { cmd: 'alarm', action: 'alarm' }, // Custom alarm 3
      '2c': { cmd: 'alarm', action: 'alarm' }, // Custom alarm 4
      '80': { cmd: 'command_response', action: 'command_response' },
      '81': { cmd: 'command_response', action: 'command_response' },
      // ... (many more command_response mappings omitted for brevity, same as original)
      'ff': { cmd: 'command_response', action: 'command_response' },
      'default': { cmd: 'noop', action: 'noop' }
    };

    const mapping = protocolMap[parts['protocol_id']] || protocolMap['default'];
    parts.cmd = mapping.cmd;
    parts.action = mapping.action;
  };

  this.bufferToHexString = function (buffer) {
    var str = '';
    for (var i = 0; i < buffer.length; i++) {
      var hex = buffer[i].toString(16);
      str += hex.length === 1 ? '0' + hex : hex;
    }
    return str;
  };

  this.authorize = function () {
    // Login response: 7878 05 01 0001 D9DC 0D0A
    var response = '787805010001D9DC0D0A';
    console.log('Sending login response:', response);
    this.device.send(Buffer.from(response, 'hex'));
  };
  
  this.receive_heartbeat = function (msg_parts) {
    // Heartbeat response: 7878 05 13 0001 D9DC 0D0A
    var response = '787805130001D9DC0D0A';
    console.log('Sending heartbeat response:', response);
    this.device.send(Buffer.from(response, 'hex'));
  };

  /*******************************************
   ENHANCED LOCATION DATA PARSING
   *******************************************/
  this.get_ping_data = function (msg_parts) {
    try {
      var str = msg_parts.data_body || msg_parts.data;
      console.log('Parsing location data, length:', str.length);
      
      // Different GPS data formats based on protocol
      if (str.length >= 38) {
        // Standard GPS format (protocol 0x12, 0x22, 0x10, 0x11, 0x16, 0x26, 0x1A, etc.)
        return this.parse_standard_gps_data(str, msg_parts);
      } else if (str.length >= 20) {
        // Compact GPS format (some devices)
        return this.parse_compact_gps_data(str, msg_parts);
      } else {
        console.error('GPS data too short:', str.length);
        return false;
      }
    } catch (error) {
      console.error('Error parsing ping data:', error);
      return false;
    }
  };

  this.parse_standard_gps_data = function (str, msg_parts) {
    // Parse date: 6 bytes (12 hex chars) - YYMMDDHHMMSS
    const dateHex = str.substr(0, 12);
    const year = parseInt(dateHex.substr(0, 2), 16) + 2000;
    const month = parseInt(dateHex.substr(2, 2), 16);
    const day = parseInt(dateHex.substr(4, 2), 16);
    const hour = parseInt(dateHex.substr(6, 2), 16);
    const minute = parseInt(dateHex.substr(8, 2), 16);
    const second = parseInt(dateHex.substr(10, 2), 16);
    const date = new Date(year, month - 1, day, hour, minute, second);
    
    // Parse satellites (1 byte)
    const satellites = parseInt(str.substr(12, 2), 16);
    
    // Parse latitude (4 bytes = 8 hex chars)
    const latHex = str.substr(14, 8);
    let latitude = 0;
    if (latHex !== '00000000') {
      latitude = parseInt(latHex, 16) / 1800000;
    }
    
    // Parse longitude (4 bytes = 8 hex chars)
    const lngHex = str.substr(22, 8);
    let longitude = 0;
    if (lngHex !== '00000000') {
      longitude = parseInt(lngHex, 16) / 1800000;
    }
    
    // Parse speed (1 byte)
    const speed = parseInt(str.substr(30, 2), 16);
    
    // Parse course/heading (2 bytes = 4 hex chars)
    const courseHex = str.substr(32, 4);
    let course = parseInt(courseHex, 16);
    
    // Fix course: if it's > 360, it might be including status bits
    if (course > 360) {
      course = course & 0xFF;
      course = (course * 360) / 255;
    }
    course = Math.round(course);
    
    // Parse status byte (position varies by protocol)
    let statusByte = 0;
    let statusBinary = '00000000';
    
    // Try different positions for status byte
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
        oil_cut: statusBinary[0] === '1', // Bit 7: 1=oil/electricity disconnected
        gps_tracking: statusBinary[1] === '1', // Bit 6: 1=GPS tracking on
        alarm_bits: statusBinary.substr(2, 3) // Bits 3-5: alarm type in binary
      }
    };
    
    console.log('Parsed location:', {
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
    // Compact format for some devices
    const date = new Date();
    
    // Try to extract coordinates from compact format
    let latitude = 0;
    let longitude = 0;
    let speed = 0;
    
    if (str.length >= 20) {
      // Try to parse as compact coordinates
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
        console.error('Error parsing compact GPS:', e);
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
    try {
      var str = msg_parts.data_body || msg_parts.data;
      console.log('Parsing alarm data, protocol:', msg_parts.protocol_id, 'length:', str.length);
      
      // Parse basic GPS data (common to all alarms)
      const gpsData = this.parse_standard_gps_data(str, msg_parts);
      if (!gpsData) {
        console.error('Failed to parse GPS data for alarm');
        return false;
      }
      
      // Extract alarm code based on protocol and data structure
      let alarmCode = this.extract_alarm_code(str, msg_parts.protocol_id);
      
      // Enhanced alarm type mapping based on real device data
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
      
      console.log('Parsed alarm:', {
        device: data.device_id,
        alarm: data.alarm_type,
        code: alarmCode,
        lat: data.latitude,
        lng: data.longitude
      });
      
      return data;
    } catch (error) {
      console.error('Error parsing alarm data:', error);
      console.error('Data:', msg_parts.data);
      return false;
    }
  };

  this.extract_alarm_code = function(str, protocolId) {
    let alarmCode = '01'; // Default to SOS
    
    // Different extraction methods based on protocol
    switch(protocolId) {
      case '1a': // Query address protocol (commonly used for alarms)
        if (str.length >= 4) {
          // For 0x1A, alarm code is often in the language/extension field
          // Try multiple positions based on observed data patterns
          if (str.length >= 70) {
            // Extended format
            alarmCode = str.substr(68, 2);
          } else if (str.length >= 56) {
            // Medium format
            alarmCode = str.substr(54, 2);
          } else if (str.length >= 40) {
            // Compact format
            alarmCode = str.substr(38, 2);
          } else {
            // Last 4 hex chars often contain alarm info
            alarmCode = str.substr(str.length - 4, 2);
          }
        }
        break;
        
      case '16': // Standard alarm
      case '26': // Alarm with address
        if (str.length >= 56) {
          // Standard position for basic alarms
          alarmCode = str.substr(54, 2);
        }
        if (str.length >= 70) {
          // Extended alarm packets
          const extendedCode = str.substr(68, 2);
          if (extendedCode !== '00' && extendedCode !== '') {
            alarmCode = extendedCode;
          }
        }
        break;
        
      case '27': // Extended alarm with status
        if (str.length >= 60) {
          alarmCode = str.substr(58, 2);
        }
        break;
        
      default:
        // Try to find alarm code in common positions
        if (str.length >= 40) {
          // Check status byte extension (bits 3-5 for alarm type)
          const statusByte = parseInt(str.substr(36, 2), 16);
          const statusBinary = statusByte.toString(2).padStart(8, '0');
          const alarmBits = statusBinary.substr(2, 3);
          
          // Convert 3-bit alarm code to hex
          switch(alarmBits) {
            case '000': alarmCode = '00'; break; // Normal
            case '100': alarmCode = '01'; break; // SOS
            case '011': alarmCode = '02'; break; // Low Battery
            case '010': alarmCode = '03'; break; // Power Cut
            case '001': alarmCode = '04'; break; // Shock
            default: alarmCode = '00';
          }
        }
    }
    
    return alarmCode.toUpperCase();
  };

  this.map_alarm_code = function(alarmCode, protocolId, rawData) {
    // Comprehensive alarm mapping based on GT06 protocol and observed device data
    const alarmMap = {
      // Standard GT06 Protocol Alarms
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
      
      // Extended Alarms (Protocol 0x1A specific)
      '20': 'External Power Disconnected',
      '21': 'External Power Connected',
      '22': 'GPS Jamming Detection',
      // ... (rest of mapping unchanged, omitted for brevity)
      'FF': 'System Notification 15'
    };
    
    let alarmType = alarmMap[alarmCode.toUpperCase()];
    
    if (!alarmType) {
      // Try to determine if it's a status/command response
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
    
    // Check if this might be a false alarm (repeated patterns, zero coordinates, etc.)
    if (this.is_false_alarm(alarmCode, rawData)) {
      alarmType = `Status Report (${alarmType})`;
    }
    
    return alarmType;
  };

  this.is_false_alarm = function(alarmCode, rawData) {
    // Detect false alarms based on patterns
    if (!rawData || rawData.length < 20) return false;
    
    // Check for zero coordinates (common in false alarms)
    const latHex = rawData.substr(14, 8);
    const lngHex = rawData.substr(22, 8);
    
    if (latHex === '00000000' && lngHex === '00000000') {
      console.log('Zero coordinates detected - likely status report');
      return true;
    }
    
    // Check for repeated alarm codes in status reports
    const statusReportCodes = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09'];
    if (statusReportCodes.includes(alarmCode)) {
      // Check if this is part of regular status reporting
      const statusByte = rawData.substr(36, 2);
      if (statusByte === '00' || statusByte === '01') {
        return true;
      }
    }
    
    return false;
  };

  // Other methods remain the same
  this.zeroPad = function (nNum, nPad) {
    return ('' + (Math.pow(10, nPad) + nNum)).slice(1);
  };
  
  this.synchronous_clock = function (msg_parts) {
    // Not implemented
  };
  
  this.run_other = function (cmd, msg_parts) {
    console.log('run_other called with cmd:', cmd);
  };

  this.request_login_to_device = function () {
    // Not implemented
  };

  this.set_refresh_time = function (interval, duration) {
    // Not implemented
  };
};

exports.adapter = adapter;