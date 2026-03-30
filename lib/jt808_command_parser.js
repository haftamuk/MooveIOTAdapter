// lib/jt808_command_parser.js
const jt808Adapter = require('../adapters/JT808');

// Mock device needed by the adapter – it only needs a logDebug method
const mockDevice = { logDebug: () => {} };
const adapterInstance = jt808Adapter.adapter(mockDevice);

/**
 * Attempts to parse a JT808 packet from a raw buffer.
 * @param {Buffer} buffer - Raw data from the server (including start/end markers)
 * @returns {Object|null} - Parsed info or null if parsing fails
 */
function parseJT808Packet(buffer) {
  try {
    const parts = adapterInstance.parse_data(buffer);
    if (parts === false || parts.incomplete) {
      return null;
    }
    const cmd = parts.cmd;      // e.g., '8103'
    const bodyHex = parts.data || '';
    const interpretation = interpretJT808Command(cmd, bodyHex);
    return {
      cmd,
      bodyHex,
      interpretation,
    };
  } catch (err) {
    // Parsing failed – return null so caller can fallback to raw hex
    return null;
  }
}

/**
 * Maps a command ID to a human‑readable description and adds details from the body.
 * @param {string} cmd - 4‑character hex command ID
 * @param {string} bodyHex - Body part of the message (hex string)
 * @returns {string} - Interpretation string
 */
function interpretJT808Command(cmd, bodyHex) {
  const commandNames = {
    '8103': 'Set Terminal Parameters',
    '8104': 'Query Terminal Parameters',
    '8105': 'Terminal Control',
    '8106': 'Query Specified Terminal Parameters',
    '8107': 'Query Terminal Attribute',
    '8108': 'Send Down Terminal Update Packet',
    '8201': 'Location Information Query',
    '8202': 'Temporary Location Tracking Control',
    '8300': 'Send Text Information',
    '8301': 'Event Setting',
    '8302': 'Question Sends Down',
    '8303': 'Information On‑demand Menu Setting',
    '8304': 'Information Service',
    '8400': 'Call Back',
    '8401': 'Phone Book Setting',
    '8500': 'Vehicle Control',
    '8600': 'Set Circle Area',
    '8601': 'Delete Circle Area',
    '8602': 'Set Rectangle Area',
    '8603': 'Delete Rectangle Area',
    '8604': 'Set Polygon Area',
    '8605': 'Delete Polygon Area',
    '8606': 'Set Route',
    '8607': 'Delete Route',
    '8700': 'Driving Record Data Collect Command',
    '8701': 'Driving Record Parameter Send Down Command',
    '8800': 'Multimedia Data Upload Response',
    '8801': 'Camera Immediately Taken Command',
    '8802': 'Retrieve of Store Multimedia Data',
    '8803': 'Store Multimedia Data Upload Command',
    '8804': 'Sound Record Start Command',
    '8805': 'Single Storage Multimedia Data Retrieval Uploads Command',
    '8900': 'Data Downlink Pass‑through',
    '8A00': 'The RSA Public Key of Platform',
  };

  const name = commandNames[cmd] || `Unknown Command (0x${cmd})`;
  let details = '';

  switch (cmd) {
    case '8103': // Set Terminal Parameters
      details = parseSetParameters(bodyHex);
      break;
    case '8105': // Terminal Control
      details = parseTerminalControl(bodyHex);
      break;
    case '8300': // Send Text Information
      details = parseTextInfo(bodyHex);
      break;
    case '8400': // Call Back
      details = parseCallBack(bodyHex);
      break;
    // Additional commands can be added here as needed
  }

  return `${name}${details ? ': ' + details : ''}`;
}

/**
 * Parse the body of a Set Terminal Parameters command (0x8103).
 * Body format: [parameter count (1 byte)] + for each param: [ID (4)][len (1)][value (len)]
 * @param {string} bodyHex
 * @returns {string} - Human‑readable summary
 */
function parseSetParameters(bodyHex) {
  if (!bodyHex || bodyHex.length < 2) return 'empty body';
  const count = parseInt(bodyHex.substr(0, 2), 16);
  let offset = 2;
  const params = [];
  for (let i = 0; i < count; i++) {
    if (offset + 8 > bodyHex.length) break;
    const id = bodyHex.substr(offset, 8);
    const len = parseInt(bodyHex.substr(offset + 8, 2), 16);
    if (offset + 10 + len * 2 > bodyHex.length) break;
    const valueHex = bodyHex.substr(offset + 10, len * 2);
    params.push({ id, len, valueHex });
    offset += 10 + len * 2;
  }

  // Interpret interesting parameters
  const interesting = {
    '0055': 'Max speed (km/h)',
    '0056': 'Overspeed duration (s)',
    '0057': 'Continuous driving time limit (s)',
    '0058': 'Accumulated driving time (s)',
    '0059': 'Minimum rest time (s)',
    '005A': 'Max parking time (s)',
    '0020': 'Position reporting strategy',
    '0021': 'Position reporting scheme',
    '0080': 'Vehicle odometer (1/10 km)',
    '0083': 'License plate',
  };

  const found = [];
  for (const p of params) {
    const desc = interesting[p.id] || `param 0x${p.id}`;
    let value = p.valueHex;
    // Try to convert to number or string depending on length
    if (p.len === 1) value = parseInt(p.valueHex, 16);
    else if (p.len === 2) value = parseInt(p.valueHex, 16);
    else if (p.len === 4) value = parseInt(p.valueHex, 16);
    else if (p.id === '0083' && p.len > 0) {
      // License plate – try to decode as GBK
      try {
        const buf = Buffer.from(p.valueHex, 'hex');
        value = buf.toString('utf8'); // approximate, may need iconv-lite for GBK
      } catch (e) { /* keep hex */ }
    }
    found.push(`${desc}=${value}`);
  }
  return found.join(', ');
}

/**
 * Parse the body of a Terminal Control command (0x8105).
 * Body format: [command byte] + [optional command parameters]
 * @param {string} bodyHex
 * @returns {string}
 */
function parseTerminalControl(bodyHex) {
  if (!bodyHex || bodyHex.length < 2) return 'empty body';
  const cmdCode = parseInt(bodyHex.substr(0, 2), 16);
  const cmdNames = {
    1: 'Wireless upgrade',
    2: 'Connect to specified server',
    3: 'Power off',
    4: 'Reset',
    5: 'Factory reset',
    6: 'Turn off data communication',
    7: 'Close all wireless communication',
  };
  const name = cmdNames[cmdCode] || `Unknown control (${cmdCode})`;
  let details = '';
  if (cmdCode === 2 && bodyHex.length > 2) {
    // Connect to specified server: parameters separated by semicolons
    const paramHex = bodyHex.substr(2);
    const paramBuf = Buffer.from(paramHex, 'hex');
    const paramStr = paramBuf.toString('ascii');
    details = `: ${paramStr}`;
  } else if (cmdCode === 1 && bodyHex.length > 2) {
    details = `: upgrade packet info (hex: ${bodyHex.substr(2)})`;
  }
  return name + details;
}

/**
 * Parse the body of a Send Text Information command (0x8300).
 * Body format: [sign byte] + [text string (GBK)]
 * @param {string} bodyHex
 * @returns {string}
 */
function parseTextInfo(bodyHex) {
  if (!bodyHex || bodyHex.length < 2) return 'empty body';
  const signByte = parseInt(bodyHex.substr(0, 2), 16);
  const textHex = bodyHex.substr(2);
  let text = '';
  try {
    const buf = Buffer.from(textHex, 'hex');
    text = buf.toString('utf8'); // approximate
  } catch (e) { text = `hex: ${textHex}`; }
  return `sign=0x${signByte.toString(16)} text="${text}"`;
}

/**
 * Parse the body of a Call Back command (0x8400).
 * Body format: [sign byte] + [phone number string]
 * @param {string} bodyHex
 * @returns {string}
 */
function parseCallBack(bodyHex) {
  if (!bodyHex || bodyHex.length < 2) return 'empty body';
  const signByte = parseInt(bodyHex.substr(0, 2), 16);
  const phoneHex = bodyHex.substr(2);
  let phone = '';
  try {
    const buf = Buffer.from(phoneHex, 'hex');
    phone = buf.toString('ascii');
  } catch (e) { phone = `hex: ${phoneHex}`; }
  const type = signByte === 0 ? 'ordinary' : 'monitoring';
  return `${type} call to ${phone}`;
}

module.exports = { parseJT808Packet };