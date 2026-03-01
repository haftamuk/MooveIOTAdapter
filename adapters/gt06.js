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
      '82': { cmd: 'command_response', action: 'command_response' },
      '83': { cmd: 'command_response', action: 'command_response' },
      '84': { cmd: 'command_response', action: 'command_response' },
      '85': { cmd: 'command_response', action: 'command_response' },
      '86': { cmd: 'command_response', action: 'command_response' },
      '87': { cmd: 'command_response', action: 'command_response' },
      '88': { cmd: 'command_response', action: 'command_response' },
      '89': { cmd: 'command_response', action: 'command_response' },
      '8a': { cmd: 'command_response', action: 'command_response' },
      '8b': { cmd: 'command_response', action: 'command_response' },
      '8c': { cmd: 'command_response', action: 'command_response' },
      '8d': { cmd: 'command_response', action: 'command_response' },
      '8e': { cmd: 'command_response', action: 'command_response' },
      '8f': { cmd: 'command_response', action: 'command_response' },
      '90': { cmd: 'command_response', action: 'command_response' },
      '91': { cmd: 'command_response', action: 'command_response' },
      '92': { cmd: 'command_response', action: 'command_response' },
      '93': { cmd: 'command_response', action: 'command_response' },
      '94': { cmd: 'command_response', action: 'command_response' },
      '95': { cmd: 'command_response', action: 'command_response' },
      '96': { cmd: 'command_response', action: 'command_response' },
      '97': { cmd: 'command_response', action: 'command_response' },
      '98': { cmd: 'command_response', action: 'command_response' },
      '99': { cmd: 'command_response', action: 'command_response' },
      '9a': { cmd: 'command_response', action: 'command_response' },
      '9b': { cmd: 'command_response', action: 'command_response' },
      '9c': { cmd: 'command_response', action: 'command_response' },
      '9d': { cmd: 'command_response', action: 'command_response' },
      '9e': { cmd: 'command_response', action: 'command_response' },
      '9f': { cmd: 'command_response', action: 'command_response' },
      'a0': { cmd: 'command_response', action: 'command_response' },
      'a1': { cmd: 'command_response', action: 'command_response' },
      'a2': { cmd: 'command_response', action: 'command_response' },
      'a3': { cmd: 'command_response', action: 'command_response' },
      'a4': { cmd: 'command_response', action: 'command_response' },
      'a5': { cmd: 'command_response', action: 'command_response' },
      'a6': { cmd: 'command_response', action: 'command_response' },
      'a7': { cmd: 'command_response', action: 'command_response' },
      'a8': { cmd: 'command_response', action: 'command_response' },
      'a9': { cmd: 'command_response', action: 'command_response' },
      'aa': { cmd: 'command_response', action: 'command_response' },
      'ab': { cmd: 'command_response', action: 'command_response' },
      'ac': { cmd: 'command_response', action: 'command_response' },
      'ad': { cmd: 'command_response', action: 'command_response' },
      'ae': { cmd: 'command_response', action: 'command_response' },
      'af': { cmd: 'command_response', action: 'command_response' },
      'b0': { cmd: 'command_response', action: 'command_response' },
      'b1': { cmd: 'command_response', action: 'command_response' },
      'b2': { cmd: 'command_response', action: 'command_response' },
      'b3': { cmd: 'command_response', action: 'command_response' },
      'b4': { cmd: 'command_response', action: 'command_response' },
      'b5': { cmd: 'command_response', action: 'command_response' },
      'b6': { cmd: 'command_response', action: 'command_response' },
      'b7': { cmd: 'command_response', action: 'command_response' },
      'b8': { cmd: 'command_response', action: 'command_response' },
      'b9': { cmd: 'command_response', action: 'command_response' },
      'ba': { cmd: 'command_response', action: 'command_response' },
      'bb': { cmd: 'command_response', action: 'command_response' },
      'bc': { cmd: 'command_response', action: 'command_response' },
      'bd': { cmd: 'command_response', action: 'command_response' },
      'be': { cmd: 'command_response', action: 'command_response' },
      'bf': { cmd: 'command_response', action: 'command_response' },
      'c0': { cmd: 'command_response', action: 'command_response' },
      'c1': { cmd: 'command_response', action: 'command_response' },
      'c2': { cmd: 'command_response', action: 'command_response' },
      'c3': { cmd: 'command_response', action: 'command_response' },
      'c4': { cmd: 'command_response', action: 'command_response' },
      'c5': { cmd: 'command_response', action: 'command_response' },
      'c6': { cmd: 'command_response', action: 'command_response' },
      'c7': { cmd: 'command_response', action: 'command_response' },
      'c8': { cmd: 'command_response', action: 'command_response' },
      'c9': { cmd: 'command_response', action: 'command_response' },
      'ca': { cmd: 'command_response', action: 'command_response' },
      'cb': { cmd: 'command_response', action: 'command_response' },
      'cc': { cmd: 'command_response', action: 'command_response' },
      'cd': { cmd: 'command_response', action: 'command_response' },
      'ce': { cmd: 'command_response', action: 'command_response' },
      'cf': { cmd: 'command_response', action: 'command_response' },
      'd0': { cmd: 'command_response', action: 'command_response' },
      'd1': { cmd: 'command_response', action: 'command_response' },
      'd2': { cmd: 'command_response', action: 'command_response' },
      'd3': { cmd: 'command_response', action: 'command_response' },
      'd4': { cmd: 'command_response', action: 'command_response' },
      'd5': { cmd: 'command_response', action: 'command_response' },
      'd6': { cmd: 'command_response', action: 'command_response' },
      'd7': { cmd: 'command_response', action: 'command_response' },
      'd8': { cmd: 'command_response', action: 'command_response' },
      'd9': { cmd: 'command_response', action: 'command_response' },
      'da': { cmd: 'command_response', action: 'command_response' },
      'db': { cmd: 'command_response', action: 'command_response' },
      'dc': { cmd: 'command_response', action: 'command_response' },
      'dd': { cmd: 'command_response', action: 'command_response' },
      'de': { cmd: 'command_response', action: 'command_response' },
      'df': { cmd: 'command_response', action: 'command_response' },
      'e0': { cmd: 'command_response', action: 'command_response' },
      'e1': { cmd: 'command_response', action: 'command_response' },
      'e2': { cmd: 'command_response', action: 'command_response' },
      'e3': { cmd: 'command_response', action: 'command_response' },
      'e4': { cmd: 'command_response', action: 'command_response' },
      'e5': { cmd: 'command_response', action: 'command_response' },
      'e6': { cmd: 'command_response', action: 'command_response' },
      'e7': { cmd: 'command_response', action: 'command_response' },
      'e8': { cmd: 'command_response', action: 'command_response' },
      'e9': { cmd: 'command_response', action: 'command_response' },
      'ea': { cmd: 'command_response', action: 'command_response' },
      'eb': { cmd: 'command_response', action: 'command_response' },
      'ec': { cmd: 'command_response', action: 'command_response' },
      'ed': { cmd: 'command_response', action: 'command_response' },
      'ee': { cmd: 'command_response', action: 'command_response' },
      'ef': { cmd: 'command_response', action: 'command_response' },
      'f0': { cmd: 'command_response', action: 'command_response' },
      'f1': { cmd: 'command_response', action: 'command_response' },
      'f2': { cmd: 'command_response', action: 'command_response' },
      'f3': { cmd: 'command_response', action: 'command_response' },
      'f4': { cmd: 'command_response', action: 'command_response' },
      'f5': { cmd: 'command_response', action: 'command_response' },
      'f6': { cmd: 'command_response', action: 'command_response' },
      'f7': { cmd: 'command_response', action: 'command_response' },
      'f8': { cmd: 'command_response', action: 'command_response' },
      'f9': { cmd: 'command_response', action: 'command_response' },
      'fa': { cmd: 'command_response', action: 'command_response' },
      'fb': { cmd: 'command_response', action: 'command_response' },
      'fc': { cmd: 'command_response', action: 'command_response' },
      'fd': { cmd: 'command_response', action: 'command_response' },
      'fe': { cmd: 'command_response', action: 'command_response' },
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
      '23': 'Reserved',
      '24': 'Reserved',
      '25': 'Reserved',
      '26': 'Reserved',
      '27': 'Reserved',
      '28': 'Reserved',
      '29': 'Reserved',
      '2A': 'Reserved',
      '2B': 'Reserved',
      '2C': 'Reserved',
      '2D': 'Reserved',
      '2E': 'Reserved',
      '2F': 'Reserved',
      '30': 'Tow Alarm',
      '31': 'Reserved',
      '32': 'Reserved',
      '33': 'Reserved',
      '34': 'Reserved',
      '35': 'Reserved',
      '36': 'Reserved',
      '37': 'Reserved',
      '38': 'Reserved',
      '39': 'Reserved',
      '3A': 'Reserved',
      '3B': 'Reserved',
      '3C': 'Reserved',
      '3D': 'Reserved',
      '3E': 'Reserved',
      '3F': 'Reserved',
      
      // Custom/Manufacturer Specific Alarms (from your data)
      '40': 'Custom Alarm 1',
      '41': 'Custom Alarm 2',
      '42': 'Custom Alarm 3',
      '43': 'Custom Alarm 4',
      '44': 'Custom Alarm 5',
      '45': 'Custom Alarm 6',
      '46': 'Temperature Alert',
      '47': 'Humidity Alert',
      '48': 'Reserved',
      '49': 'Custom Alarm 9',
      '4A': 'Reserved',
      '4B': 'Reserved',
      '4C': 'Custom Alarm 12',
      '4D': 'Custom Alarm 13',
      '4E': 'Custom Alarm 14',
      '4F': 'Custom Alarm 15',
      '50': 'Vibration Alert',
      '51': 'Custom Alarm 17',
      '52': 'Custom Alarm 18',
      '53': 'Custom Alarm 19',
      '54': 'Custom Alarm 20',
      '55': 'Reserved',
      '56': 'Reserved',
      '57': 'Reserved',
      '58': 'Custom Alarm 24',
      '59': 'Reserved',
      '5A': 'Custom Alarm 26',
      '5B': 'Reserved',
      '5C': 'Reserved',
      '5D': 'Reserved',
      '5E': 'Reserved',
      '5F': 'Reserved',
      
      // Additional observed codes from your data
      '61': 'Device Status Update',
      '63': 'Periodic Report',
      '66': 'GSM Signal Status',
      '6B': 'Battery Status',
      '6D': 'Device Wake-up',
      '71': 'GPS Status Report',
      '72': 'Movement Status',
      '75': 'Device Configuration',
      '78': 'Heartbeat',
      '7E': 'Extended Status',
      
      // High-range codes (often device-specific)
      '80': 'Command Response 1',
      '84': 'Command Response 5',
      '87': 'Command Response 8',
      '8C': 'Command Response 13',
      '8F': 'Command Response 16',
      '90': 'Command Response 17',
      '94': 'Command Response 21',
      '95': 'Command Response 22',
      '9A': 'Command Response 27',
      '9B': 'Command Response 28',
      '9D': 'Command Response 30',
      '9F': 'Command Response 32',
      'A1': 'Device Alert 1',
      'A2': 'Device Alert 2',
      'A6': 'Device Alert 6',
      'A7': 'Device Alert 7',
      'A8': 'Device Alert 8',
      'AA': 'Device Alert 10',
      'AC': 'Device Alert 12',
      'AD': 'Device Alert 13',
      'BF': 'Device Status Broadcast',
      'C0': 'System Command 1',
      'C1': 'System Command 2',
      'C4': 'System Command 5',
      'C5': 'System Command 6',
      'C6': 'System Command 7',
      'CE': 'System Command 15',
      'D0': 'Extended Command 1',
      'D1': 'Extended Command 2',
      'D3': 'Extended Command 4',
      'D5': 'Extended Command 6',
      'D8': 'Extended Command 9',
      'DA': 'Extended Command 11',
      'E3': 'Device Notification 3',
      'EC': 'Device Notification 12',
      'F2': 'System Notification 2',
      'F3': 'System Notification 3',
      'F4': 'System Notification 4',
      'F6': 'System Notification 6',
      'F7': 'System Notification 7',
      'F8': 'System Notification 8',
      'FB': 'System Notification 11',
      'FC': 'System Notification 12',
      'FD': 'System Notification 13',
      'FE': 'System Notification 14',
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