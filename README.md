# Moove IoT GPS Adapter

A high‑performance TCP server for handling GPS tracker protocols, designed to forward raw data to external CRS/GPSPOS servers and integrate with the Moove backend API. Built with Node.js and the EventEmitter pattern, it supports multiple device protocols through pluggable adapters.

---

## Features

- Supports **GT06** and **JT808** protocols out of the box.
- Pluggable adapter architecture – easily add new protocols.
- Forwards raw messages to external CRS and GPSPOS servers for specific terminals.
- Sends parsed data to Moove API endpoints (location, alarm, heartbeat, login).
- Environment‑based configuration (development, staging, production).
- Graceful shutdown and robust error handling.
- PM2 integration for production deployment.

---

## Supported Protocols

| Protocol | Description                 | Hardware examples                    |
|----------|-----------------------------|--------------------------------------|
| GT06     | GT06 family (and variants)  | GT06N, GT06E, GT06F, GT06H           |
| JT808    | Chinese standard JT808      | Integrated GPS Speed Limiter UT04S   |

---

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd MooveIotAdaptor

2. **Install dependencies**

``` bash
npm install
``` 
3. **Create environment files**
The server uses dotenv with environment‑specific files. Create the following files in the project root:

.env.development

.env.staging

.env.production

Example .env.development:

```  ini
MOOVE_SERVER_BASE_URL=http://localhost:3000
GPS_SERVER_PORT_GT06=8001
GPSPOS_SERVER_PORT_UT04S=8002
CRS_SERVER_PORT_UT04S=9001
CRS_SERVER_PORT_GTO6=9002
CRS_SERVER=192.168.1.100
GPSPOS_SERVER=192.168.1.101
GPSPOS_SERVER_PORT_GT06=9003   # if needed
``` 

# Configuration
Terminal Lists
The server can forward raw data to external CRS and GPSPOS servers for specific terminal IDs. Edit terminalLists in index.js:

```  javascript
const terminalLists = {
  ut04s: {
    crs: ['020201228393', '020201232938'],
    gpspos: ['020201206555', '020201205789', ...]
  },
  gt06: {
    crs: ['0868720063451946', '0868720063452100', ...],
    gpspos: []   // none by default
  }
};
``` 

crs – devices that should forward to the CRS server.

gpspos – devices that should forward to the GPSPOS server.

# Environment Variables
Variable	Description
MOOVE_SERVER_BASE_URL	Base URL for the Moove API.
GPS_SERVER_PORT_GT06	Port for the GT06 server.
GPSPOS_SERVER_PORT_UT04S	Port for the UT04S (JT808) server.
CRS_SERVER_PORT_UT04S	CRS server port for UT04S devices.
CRS_SERVER_PORT_GTO6	CRS server port for GT06 devices.
GPSPOS_SERVER_PORT_GT06	GPSPOS server port for GT06 devices.
CRS_SERVER	IP/hostname of the CRS server.
GPSPOS_SERVER	IP/hostname of the GPSPOS server.

# Running the Server
## Using npm scripts

```  bash
# Development
npm run start:dev

# Staging
npm run start:staging

# Production
npm run start:prod
``` 

## Using PM2 (recommended for production)
Start with the appropriate environment:

```  bash
# Development
pm2 start ecosystem.config.js --env development

# Staging
pm2 start ecosystem.config.js --env staging

# Production
pm2 start ecosystem.config.js --env production
``` 

# Useful PM2 commands
Command	Description
pm2 list	List all running processes
pm2 logs MooveIotAdapter	Show live logs
pm2 logs MooveIotAdapter --lines 100	Show last 100 log lines
pm2 monit	Launch real‑time monitoring dashboard
pm2 restart MooveIotAdapter	Restart the process
pm2 stop MooveIotAdapter	Stop the process
pm2 delete MooveIotAdapter	Remove from PM2’s list
pm2 reload all	Reload all processes

## Auto‑start on system boot

``` bash
pm2 startup
# follow the instructions (may require sudo)
pm2 save
``` 

## Log rotation
Install and configure pm2-logrotate:

```  bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
``` 

# Architecture
The server is built on three core modules:

1. server.js (lib/server)
Creates a TCP server for a given port.

Manages connections and device instances.

Loads the appropriate adapter (GT06 or JT808) based on configuration.

2. device.js (lib/device)
Represents a connected GPS device.

Accumulates incoming data, splits by protocol framing (7e for JT808, 7878/7979 for GT06), and delegates parsing to the adapter.

Emits high‑level events (login_request, ping, alarm, etc.) for the application to handle.

Maintains response serial numbers and handles sending data back to the device.

3. Adapters (adapters/JT808.js, adapters/gt06.js)
Implement protocol‑specific parsing and response generation.

Define parse_data() to convert raw buffers into a structured msgParts object with at least device_id, cmd, action, and data.

Provide methods like authorize(), get_ping_data(), receive_alarm(), etc., which are called by device.js.

# Event Handling
The device object (available in the server callback) emits the following events. Your application logic in index.js listens to these events and reacts accordingly (e.g., calling APIs, forwarding data).

Event	Description	Emitted by
connected	Device has connected (TCP connection established).	server.js (after callback)
disconnected	Device disconnected (TCP connection closed).	server.js (on 'end' event)
new_device_first_time	Device seen for the first time (adapter may emit this).	Adapter (optional)
register	Registration message received (JT808 0x0100).	Adapter (action='register')
login_request	Login/authentication request received.	Adapter (action='login_request')
heartbeat	Heartbeat packet received.	Adapter (action='heartbeat')
logout	Logout message received.	Adapter (action='logout')
ping	Location report (non‑alarm).	Adapter (action='ping')
alarm	Alarm report (location with alarm flag).	Adapter (action='alarm')
other	Any other command not covered above (e.g., batch upload, driver info).	Adapter (action='other')
In index.js, a shared handler (setupDeviceHandlers) attaches to these events, builds API payloads, and forwards raw data via forwardToProxy().

# API Integration
The server sends HTTP POST requests to the Moove backend for every significant event. Endpoints are built from MOOVE_SERVER_BASE_URL:

Endpoint	URL	Used for
LOGIN	/api/gps/login	Registration and login requests
HEARTBEAT	/api/gps/heartbeat	Heartbeat packets
LOCATION	/api/gps/location	Regular location reports
ALARM	/api/gps/alarm	Alarm reports
STATUS	/api/gps/status	(reserved, not currently used)
Each request includes device identification, parsed data, and a crs_proxy flag indicating whether the device is in the CRS list.


# Adding a New Protocol
Create a new adapter file in lib/adapters/ (e.g., myprotocol.js).

Implement the required methods:

parse_data(data) – return { device_id, cmd, action, data, raw_hex }.

authorize(serial, msgParts) – send login response.

get_ping_data(msgParts) – return location object.

receive_alarm(msgParts) – return alarm object.

(Optional) run_other(cmd, msgParts) – handle non‑standard commands.

Export the adapter with exports.adapter = adapter.

Register the adapter in server.js under availableAdapters.

Add a server instance in index.js (similar to startGT06Server or startUT04SServer).

Update terminal lists if proxy forwarding is required.

The device‑agnostic code (device.js, server.js) will automatically use your new adapter.

# Troubleshooting
Server does not start – port in use
Check if another process is using the configured port:

```  bash
netstat -tulpn | grep <PORT>
``` 

Change the port in the corresponding .env file.

## No data received
Verify that devices are configured with the correct IP and port.

Check firewall rules on the server.

Enable debug mode (debug: true in server options) to see raw hex logs.

## API calls fail
Ensure MOOVE_SERVER_BASE_URL is correct and reachable.

Check network connectivity and firewall outbound rules.

Look at the server logs for fetch errors.

## Proxy forwarding not working
Confirm the device ID is listed in terminalLists for the correct server type.

Verify CRS_SERVER and GPSPOS_SERVER environment variables.

Check that the target proxy servers are running and reachable.

## Empty event handlers
All required empty handlers (connection.on('error'), server.on('error'), etc.) are present to prevent crashes. If you see unexpected crashes, check the Node.js error stack.

# License
ISC

# Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.