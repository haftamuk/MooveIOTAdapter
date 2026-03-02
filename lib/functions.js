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