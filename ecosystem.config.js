// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'MooveIotAdapter',                // process name in PM2
      script: './index.js',               // entry point
      instances: 1,                        // number of instances (1 for TCP server)
      exec_mode: 'fork',                   // fork mode (not cluster for TCP)
      watch: false,                         // disable watch in production
      max_memory_restart: '300M',           // optional memory limit
      env: {
        NODE_ENV: 'development',             // default environment
      },
      env_staging: {
        NODE_ENV: 'staging',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: './logs/pm2-error.log',   // error log file
      out_file: './logs/pm2-out.log',       // output log file
      log_file: './logs/pm2-combined.log',  // combined log file
      time: true,                            // add timestamps to logs
    },
  ],
};