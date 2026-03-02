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
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}