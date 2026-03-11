// lib/logger.js
const winston = require('winston');
const { combine, timestamp, printf, colorize, json, errors } = winston.format;

// Determine log level based on NODE_ENV and optional LOG_LEVEL override
const environment = process.env.NODE_ENV || 'development';
let logLevel = process.env.LOG_LEVEL;

if (!logLevel) {
  switch (environment) {
    case 'production':
      logLevel = 'warn';
      break;
    case 'staging':
      logLevel = 'info';
      break;
    case 'development':
    default:
      logLevel = 'debug';
  }
}

// Custom format for development: colorful and human-readable
const devFormat = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0 && metadata.stack) {
      msg += `\n${metadata.stack}`;
    } else if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

// Production format: JSON for machine parsing
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

// Choose format based on environment
const format = environment === 'production' ? prodFormat : devFormat;

// Create the Winston logger
const logger = winston.createLogger({
  level: logLevel,
  format,
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
  exitOnError: false, // do not exit on handled exceptions
});

// Stream for Morgan or other HTTP logging (optional)
logger.stream = {
  write: (message) => logger.info(message.trim()),
};

// REMOVED the faulty custom `child` definition.
// Winston's logger already has a built‑in `child` method, so we can use it directly.

module.exports = logger;