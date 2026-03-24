# Moove IoT GPS Adapter

A high‑performance TCP server for handling GPS tracker protocols, designed to forward raw data to external CRS/GPSPOS servers and integrate with the Moove backend API. Built with Node.js and the **EventEmitter** pattern, it supports multiple device protocols through pluggable adapters.

---

## Features

* Supports **GT06** and **JT808** protocols out of the box.
* **Pluggable adapter architecture** – easily add new protocols.
* Forwards raw messages to external **CRS** and **GPSPOS** servers for specific terminals.
* Sends parsed data to **Moove API** endpoints (location, alarm, heartbeat, login).
* **Unified per‑device debugging** – all inbound/outbound data and proxy interactions are logged in a single file per IMEI.
* **Centralised configuration** for terminal lists (CRS, GPSPOS, debug) via `terminalList.json`.
* **Robust proxy connection manager** with queuing and exponential backoff reconnection.
* Environment‑based configuration (development, staging, production).
* Graceful shutdown and comprehensive error handling.
* **PM2 integration** for production deployment.

---

## Supported Protocols

| Protocol | Description | Hardware Examples |
|----------|-------------|-------------------|
| **GT06** | GT06 family (and variants) | GT06N, GT06E, GT06F, GT06H |
| **JT808** | Chinese standard JT808 | Integrated GPS Speed Limiter UT04S |

---

## Architecture Overview

```
Device (TCP) ──> Server (lib/server.js)
                     │
                     ▼
                 Device (lib/device.js)
                     │
                     ├─► Adapter (JT808.js / gt06.js)
                     │       └─► Parses raw data → emits events
                     │
                     ├─► Event handlers (index.js)
                     │       ├─► Send to API (Moove)
                     │       └─► Forward raw to proxy servers (if terminal in list)
                     │
                     └─► Proxy Manager (ProxyTarget)
                             ├─► Connection to CRS / GPSPOS
                             ├─► Queueing & reconnection
                             └─► Logging (to per‑device debug file or separate proxy log)
```

---

## Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd MooveIotAdapter
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create environment files

The server uses `dotenv` with environment‑specific files. Create the following files in the project root:

* `.env.development`
* `.env.staging`
* `.env.production`

**Example `.env.development`:**

```ini
MOOVE_SERVER_BASE_URL=http://localhost:3000
GPS_SERVER_PORT_JT808=8001
GPS_SERVER_PORT_GT06=8002
GPSPOS_SERVER_PORT_UT04S=8003
CRS_SERVER_PORT_UT04S=9001
CRS_SERVER_PORT_GTO6=9002
GPSPOS_SERVER_PORT_GT06=9003
CRS_SERVER=192.168.1.100
GPSPOS_SERVER=192.168.1.101

# Optional: log level (debug, info, warn, error)
LOG_LEVEL=debug
```

### 4. Configure terminal lists and debug devices

Create a file named `terminalList.json` in the project root with the following structure:

```json
{
  "ut04s": {
    "crs": ["020201232938", "020201228393"],
    "gpspos": ["020201232938", "020201228393", "020201292186", "020201228351", "020201205789", "020201223132", "020201294976", "020201206555", "020201291753", "020201263620"],
    "debug": ["020201232938", "020201228393"]
  },
  "gt06": {
    "crs": ["0868720063451946", "0868720063452100", "0868720062933829", "0864943047255027", "0358657103600172", "0358657103608399", "0358657103600453", "0358657105060953", "0358657104462051", "0868720061903625", "0868720061906289", "0868720061905174", "0868720061898619", "0358657104517136", "0358657103861956", "0358657104813964"],
    "gpspos": ["0868720063451946", "0358657104813964", "0864943048638536"],
    "debug": ["0868720063451946", "0358657104813964"]
  }
}
```

- `crs`: Devices whose raw data should be forwarded to the CRS server.
- `gpspos`: Devices whose raw data should be forwarded to the GPSPOS server.
- `debug`: Devices for which detailed per‑device logging is enabled (all data in/out, proxy communication, parsed summaries).

If a device is in `debug`, its log file will appear in `debug_logs/<imei>.log` and contain all traffic and proxy activity.

---

## Running the Server

### Using npm scripts

```bash
# Development
npm run start:dev

# Staging
npm run start:staging

# Production
npm run start:prod
```

### Using PM2 (Recommended for Production)

Install PM2 globally if not already:

```bash
npm install -g pm2
```

Start with the appropriate environment:

```bash
# Development
pm2 start ecosystem.config.js --env development

# Staging
pm2 start ecosystem.config.js --env staging

# Production
pm2 start ecosystem.config.js --env production
```

**Useful PM2 commands:**

| Command | Description |
|---------|-------------|
| `pm2 list` | List all running processes |
| `pm2 logs MooveIotAdapter` | Show live logs |
| `pm2 monit` | Launch real‑time monitoring dashboard |
| `pm2 restart MooveIotAdapter` | Restart the process |
| `pm2 stop MooveIotAdapter` | Stop the process |

**Log rotation (optional):**

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## Logging

The server produces three types of logs:

### 1. General application logs (console / PM2)

- Written to console (and captured by PM2).
- Controlled by `LOG_LEVEL` environment variable.
- Contain info, warnings, errors, and debug messages for the whole application.

### 2. Per‑device debug logs (`debug_logs/<imei>.log`)

- **Only created for devices listed in the `debug` array** in `terminalList.json`.
- Each line includes a timestamp and one of:
  - `IN:` – raw hex data received from the device.
  - `OUT:` – raw hex data sent to the device.
  - `PARSED:` – summary of the parsed message (action, command, device ID, serial, data preview).
  - Custom lines like `LOCATION:`, `ALARM:`, `Sending response:`, etc.
  - **Proxy communication** – if the device is also in `crs` or `gpspos`, every sent/received proxy message is logged here, including the direction and hex content.
- This is the single source of truth for debugging a specific device.

**Example snippet:**

```
[2025-03-24T10:15:30.123Z] IN: 7e0200002a123456789012345000100000000001020304...
[2025-03-24T10:15:30.456Z] PARSED: action=ping, cmd=0200, device_id=123456789012345, serial=0010, data=0000000102030405… (location data)
[2025-03-24T10:15:30.789Z] LOCATION: lat=40.7128, lng=-74.0060, speed=45.2, time=2025-03-24T10:15:30.000Z
[2025-03-24T10:15:30.912Z] Sending response: cmd=0x8001, seq=0001, result=00, raw=7e80010005123456789012345000010001020000017e
[2025-03-24T10:15:30.913Z] OUT: 7e80010005123456789012345000010001020000017e
[2025-03-24T10:15:31.123Z] Sent 42 bytes to CRS: 7e0200002a123456789012345000100000000001020304...
[2025-03-24T10:15:31.456Z] Received 10 bytes from CRS: 7e80010005123456789012345000017e
```

### 3. Proxy logs (`proxy_logs/proxy_<imei>_<type>.log`)

- **Only created for devices that are in `crs` or `gpspos` but NOT in `debug`**.
- Contain similar proxy communication details (sent/received) but without the device‑side traffic.
- Useful for diagnosing proxy issues without flooding the main logs.

---

## API Integration

The server sends HTTP POST requests to the Moove backend for every significant event. Endpoints are built from `MOOVE_SERVER_BASE_URL`:

| Endpoint | Purpose |
|----------|---------|
| `/api/gps/login` | Device registration and login (JT808 registration, login, GT06 login) |
| `/api/gps/heartbeat` | Heartbeat packets |
| `/api/gps/location` | Location reports (normal and alarm‑related locations) |
| `/api/gps/alarm` | Alarm‑specific reports |

Each payload includes device ID, timestamp, location data (if applicable), and a `crs_proxy` flag indicating whether the device is also forwarding to CRS.

---

## Configuration Reference

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MOOVE_SERVER_BASE_URL` | Base URL of the Moove API (e.g., `http://api.moove.com`) |
| `GPS_SERVER_PORT_JT808` | Port for the JT808 (UT04S) server |
| `GPS_SERVER_PORT_GT06` | Port for the GT06 server |
| `CRS_SERVER` | IP or hostname of the CRS server |
| `GPSPOS_SERVER` | IP or hostname of the GPSPOS server |
| `CRS_SERVER_PORT_UT04S` | CRS server port for UT04S devices |
| `CRS_SERVER_PORT_GTO6` | CRS server port for GT06 devices |
| `GPSPOS_SERVER_PORT_UT04S` | GPSPOS server port for UT04S devices |
| `GPSPOS_SERVER_PORT_GT06` | GPSPOS server port for GT06 devices |
| `LOG_LEVEL` | Winston log level: `debug`, `info`, `warn`, `error` (default based on NODE_ENV) |
| `NODE_ENV` | Environment: `development`, `staging`, `production` |

### `terminalList.json`

Controls which devices are forwarded to CRS/GPSPOS and which are debugged.

- **`ut04s` / `gt06`** – Protocol section.
- **`crs`** – Array of device IDs that forward raw data to the CRS server.
- **`gpspos`** – Array of device IDs that forward raw data to the GPSPOS server.
- **`debug`** – Array of device IDs for which per‑device debug logs are enabled.

---

## Troubleshooting

### Server does not start

- Check if the ports are already in use: `netstat -tulpn | grep <PORT>`.
- Verify that the environment variables are set correctly (e.g., `GPS_SERVER_PORT_JT808`).
- Ensure `terminalList.json` is valid JSON.

### No data received from devices

- Confirm that the devices are configured to connect to the correct IP and port.
- Check firewall rules on the server.
- Look for `IN:` lines in the debug logs (if device is in debug) to see if raw data arrives.

### Proxy forwarding fails

- Verify that `CRS_SERVER` / `GPSPOS_SERVER` and port variables are correct.
- Check the proxy logs (`proxy_logs/` or debug logs) for connection errors or sent data.
- Ensure the external servers are reachable from the adapter server.

### API calls fail

- Ensure `MOOVE_SERVER_BASE_URL` is reachable and the API endpoints are correct.
- Check the logs for fetch errors and HTTP status codes.

### Debug logs not appearing

- Confirm the device ID is listed in the `debug` array of the correct protocol section.
- The logs are written to `debug_logs/<imei>.log` – ensure the directory is writable.
- Restart the server after changing `terminalList.json`.

---

## Development & Extending

### Adding a new protocol adapter

1. Create a new file in `lib/adapters/` (e.g., `myprotocol.js`).
2. Export an object with:
   - `protocol` (string, e.g., `'MyProto'`)
   - `model_name` (string)
   - `compatible_hardware` (array)
   - `adapter` function that returns an instance with required methods:
     - `parse_data(buffer)` → returns an object with `cmd`, `action`, `device_id`, etc.
     - `authorize(serial, msgParts)`
     - `receive_heartbeat(msgParts)`
     - `get_ping_data(msgParts)` → returns location data
     - `receive_alarm(msgParts)` → returns alarm data
     - `run_other(cmd, msgParts)` – handle unsolicited commands
3. Register the adapter in `lib/server.js` under `availableAdapters`.
4. Pass the adapter name in server options (e.g., `device_adapter: 'MyProto'`).

### Modifying the parser

- Each adapter defines how raw hex is transformed into `msgParts`. The `parse_data` method is the entry point.
- Ensure `msgParts.device_id` is set to the device identifier (IMEI).
- Use `msgParts.action` to indicate the type of message (`login_request`, `heartbeat`, `ping`, `alarm`, `other`).

### Customising proxy behaviour

- The proxy manager (`ProxyTarget` in `index.js`) handles connections to external servers.
- You can extend it to support authentication, custom headers, or different retry strategies.

---

## License

ISC

---

**For any questions or contributions, please contact the maintainers.**