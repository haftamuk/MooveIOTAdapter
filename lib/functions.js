// File : lib/functions.js

/**
 * Pads a string/number with leading characters to a specified length.
 * @param {string|number} input - The input to pad.
 * @param {number} length - Desired total length.
 * @param {string} [string='0'] - Character to pad with.
 * @returns {string} Padded string.
 */
exports.str_pad = function (input, length, string) {
  string = string || '0';
  input = input + '';
  return input.length >= length ? input : new Array(length - input.length + 1).join(string) + input;
};

// CRC-16/CCITT (polynomial 0x1021, init 0xFFFF, no final XOR)
exports.crc16 = function (buffer) {
  let crc = 0xFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= (buffer[i] << 8);
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
    }
  }
  crc = (~crc) & 0xFFFF;
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

/**
 * Unescape a JT808 packet according to the protocol.
 * Replaces 0x7d 0x02 with 0x7e, and 0x7d 0x01 with 0x7d.
 * @param {Buffer} data - The raw data without start/end flags.
 * @returns {Buffer} Unescaped data.
 */
exports.unescapeJT808 = function (data) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x7d && i + 1 < data.length) {
      const next = data[i + 1];
      if (next === 0x02) {
        result.push(0x7e);
        i++; // skip next
      } else if (next === 0x01) {
        result.push(0x7d);
        i++; // skip next
      } else {
        // not a valid escape, keep as is
        result.push(data[i]);
      }
    } else {
      result.push(data[i]);
    }
  }
  return Buffer.from(result);
};

/**
 * Escape a JT808 packet before sending.
 * Replaces 0x7e with 0x7d 0x02, and 0x7d with 0x7d 0x01.
 * @param {Buffer} data - The raw packet (without start/end flags).
 * @returns {Buffer} Escaped packet (ready to be wrapped with 0x7e).
 */
exports.escapeJT808 = function (data) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x7e) {
      result.push(0x7d, 0x02);
    } else if (data[i] === 0x7d) {
      result.push(0x7d, 0x01);
    } else {
      result.push(data[i]);
    }
  }
  return Buffer.from(result);
};