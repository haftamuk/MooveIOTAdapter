// lib/gt06_command_parser.js
const gt06Adapter = require('../adapters/gt06');

// Mock device – the GT06 adapter only uses it for logging (which we mock)
const mockDevice = {
  logDebug: () => {},
  getUID: () => 'mock',
};
const adapterInstance = gt06Adapter.adapter(mockDevice);

/**
 * Attempts to parse a GT06 packet from a raw buffer.
 * @param {Buffer} buffer - Raw data from the server (including start/end markers)
 * @returns {Object|null} - Parsed info or null if parsing fails
 */
function parseGT06Packet(buffer) {
  try {
    const parts = adapterInstance.parse_data(buffer);
    if (parts === false || parts.cmd === 'noop') {
      return null;
    }

    const protocol = parts.protocol_id;  // e.g., '80', '81'
    const dataBody = parts.data_body || '';
    const length = parts.length;         // length byte

    // Classification: typical server response is length 5 (protocol + serial + CRC)
    const isResponse = (length === 5);
    const type = isResponse ? 'response' : 'command';

    // Command name based on protocol
    const commandNames = {
      '80': 'Send Command',
      '81': 'Send Command (Alt)',
      // Add more known protocol IDs as needed
    };
    const commandName = commandNames[protocol] || `Protocol 0x${protocol}`;

    // Interpretation
    let interpretation = '';
    if (type === 'command') {
      if (protocol === '80' || protocol === '81') {
        // Try to decode data body as ASCII (common for GT06 commands)
        try {
          const ascii = Buffer.from(dataBody, 'hex').toString('ascii');
          interpretation = `Command data: "${ascii}"`;
        } catch (e) {
          interpretation = `Command data (hex): ${dataBody}`;
        }
      } else {
        interpretation = `Protocol 0x${protocol}, data: ${dataBody}`;
      }
    }

    return {
      type,
      commandName,
      interpretation,
      protocol,
      dataBody,
    };
  } catch (err) {
    // Parsing failed – return null so caller can fallback to raw hex
    return null;
  }
}

module.exports = { parseGT06Packet };