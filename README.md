Here's a section you can add to your `README.md` to document the new protocol debugging feature:

markdown
## Proxy-Level Debugging

For devices listed in `terminalLists` (i.e., those that forward data to external CRS or GPSPOS servers), the server now writes detailed proxy logs. These logs help diagnose why a device may not be reaching the external servers.

### Log Location and Format

- **Directory:** `proxy_logs/` (created automatically)
- **Naming:** `proxy_<deviceId>_crs.log` and `proxy_<deviceId>_gpspos.log`
- **Each line** contains an ISO timestamp and a descriptive message:
  - Connection attempts, successes, failures, and reconnections
  - Data sent to the external server (hex preview)
  - Data received from the external server (if any)
  - Queue events when the socket is not yet connected

### Example Snippet
[2025-03-11T14:23:45.123Z] Log file opened for crs proxy target 192.168.1.100:9001
[2025-03-11T14:23:45.456Z] Connected to 192.168.1.100:9001 (attempt 0)
[2025-03-11T14:23:45.789Z] Sent 42 bytes: 7e0200002a123456789012345000100000000001020304...
[2025-03-11T14:23:46.012Z] Received 10 bytes: 7e80010005123456789012345000017e
[2025-03-11T14:24:00.123Z] Socket error: ECONNRESET
[2025-03-11T14:24:00.124Z] Scheduling reconnect in 2000ms (attempt 1)

text

### Using the Logs

- If the external server never receives data, check whether a connection was ever established (`Connected to ...`).
- If connections are repeatedly failing, look for `Socket error` lines – they may indicate network issues, wrong host/port, or firewall blocks.
- If data is sent but no response is seen (`Received` lines), the external server may be ignoring the messages or not sending acknowledgements – this is normal for some setups.
- Queue events indicate that data arrived before the socket was ready; if the queue never drains, the connection may be permanently down.

These logs are **only written for devices that are actually proxied** (i.e., appear in `crs` or `gpspos` lists), so there is no performance impact on other devices.


---

## Protocol-Level Debugging

The GPS server includes a configurable protocol debugger that logs raw hex communication and parsed message details for specific devices. This is invaluable for diagnosing communication issues, especially when devices unexpectedly go offline.

### How It Works

For each device you enable debugging on, the server creates a separate log file named `<device_imei>.log` inside the `debug_logs/` folder. Every incoming and outgoing raw message is recorded with a timestamp and direction (`IN`/`OUT`). Additionally, after parsing, a `PARSED` line summarises the message type, command, device ID, and a preview of the data. Protocol‑specific context (location coordinates, alarm type, response details) is also added using custom log entries.

### Enabling Debugging

You can specify which devices to debug using one of two methods:

#### 1. JSON Configuration File (Recommended)

Create a file named `debugDevices.json` in the project root (same directory as `index.js`). The file must contain a JSON array of IMEI strings:

```json
[
  "123456789012345",
  "987654321098765"
]
```

The server reads this file at startup. To add or remove devices, edit the file and restart the server (or implement dynamic reloading – see “Advanced” below).

#### 2. Environment Variable

Set the `DEBUG_DEVICES` environment variable with a comma‑separated list of IMEIs. For example, in your `.env` file:

```
DEBUG_DEVICES=123456789012345,987654321098765
```

If both the JSON file and the environment variable are present, the JSON file takes precedence.

### Log File Location and Format

- **Directory:** `debug_logs/` (created automatically if it doesn’t exist)
- **Filename:** `<device_imei>.log` (e.g., `123456789012345.log`)
- **Each line** starts with an ISO 8601 timestamp followed by one of:
  - `IN:` – raw hex data received from the device
  - `OUT:` – raw hex data sent to the device
  - `PARSED:` – a summary of the parsed message (action, command, protocol, device ID, serial number, data preview)
  - Custom messages (e.g., `LOCATION:`, `ALARM:`, `Sending response:`) that provide additional context

#### Example Log Snippet (JT808)

```
[2025-03-06T10:15:30.123Z] IN: 7e0200002a12345678901234500010000000000102030405060708091011121314151617181920212223242526272829303132333435363738397e
[2025-03-06T10:15:30.456Z] PARSED: action=ping, cmd=0200, device_id=123456789012345, serial=0010, data=0000000102030405… (location data)
[2025-03-06T10:15:30.789Z] LOCATION: lat=40.7128, lng=-74.0060, speed=45.2, time=2025-03-06T10:15:30.000Z
[2025-03-06T10:15:30.912Z] Sending response: cmd=0x8001, seq=0001, result=00, raw=7e80010005123456789012345000010001020000017e
[2025-03-06T10:15:30.913Z] OUT: 7e80010005123456789012345000010001020000017e
```

#### Example Log Snippet (GT06)

```
[2025-03-06T10:16:00.123Z] IN: 78780f1344041787012345678901234500010d0a
[2025-03-06T10:16:00.456Z] PARSED: action=heartbeat, cmd=ping, protocol=0x13, device_id=123456789012345, serial=0001, data=44…
[2025-03-06T10:16:00.789Z] Sending heartbeat response (protocol 0x13, serial 0001)
[2025-03-06T10:16:00.790Z] OUT: 787805130001c38d0d0a
```

### Using the Logs to Diagnose Issues

1. **Identify the time a device went offline** from your main application logs.
2. Open the corresponding `<imei>.log` file and look at the entries just before that time.
3. **Check for a missing response**: If you see an `IN` line for a message that requires an acknowledgement (e.g., a location report) but no corresponding `OUT` line, the server may have failed to reply – investigate adapter logic or network issues.
4. **Look for parsing errors**: A `PARSED` line with `action=noop` or a truncated data preview suggests the adapter rejected the message. Compare the raw hex with the protocol specification.
5. **Observe the last activity**: If the last entry is an `OUT` line and no further `IN` lines appear, the device stopped sending data – possible power loss, network disconnect, or device crash.
6. **Correlate with application logs**: Match timestamps with your main logs to see if any errors or exceptions occurred at that moment.

### Performance Considerations

- Debugging is **only enabled for devices you explicitly list**, so there is no performance impact on other devices.
- Log files are plain text and will grow over time. For long‑running debugging, consider implementing log rotation (e.g., using `logrotate` on Linux, or integrating a library like `winston-daily-rotate-file`).
- The `debug_logs` directory should have appropriate permissions (`700` or `750`) to protect sensitive data (IMEIs, raw hex).

### Disabling Debugging

To stop debugging a device, simply remove its IMEI from the JSON file or environment variable and restart the server. Alternatively, you can enhance the configuration module to watch the JSON file for changes and update the `Set` in real time (see “Advanced” below).




# Moove IoT GPS Adapter

A high‑performance TCP server for handling GPS tracker protocols, designed to forward raw data to external CRS/GPSPOS servers and integrate with the Moove backend API. Built with Node.js and the **EventEmitter** pattern, it supports multiple device protocols through pluggable adapters.

---

## Features

* Supports **GT06** and **JT808** protocols out of the box.
* **Pluggable adapter architecture** – easily add new protocols.
* Forwards raw messages to external **CRS** and **GPSPOS** servers for specific terminals.
* Sends parsed data to **Moove API** endpoints (location, alarm, heartbeat, login).
* **Environment‑based configuration** (development, staging, production).
* Graceful shutdown and robust error handling.
* **PM2 integration** for production deployment.

---

## Supported Protocols

| Protocol | Description | Hardware Examples |
| --- | --- | --- |
| **GT06** | GT06 family (and variants) | GT06N, GT06E, GT06F, GT06H |
| **JT808** | Chinese standard JT808 | Integrated GPS Speed Limiter UT04S |

---

## Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd MooveIotAdaptor

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
GPS_SERVER_PORT_GT06=8001
GPSPOS_SERVER_PORT_UT04S=8002
CRS_SERVER_PORT_UT04S=9001
CRS_SERVER_PORT_GTO6=9002
CRS_SERVER=192.168.1.100
GPSPOS_SERVER=192.168.1.101
GPSPOS_SERVER_PORT_GT06=9003   # if needed

```

---

## Configuration

### Terminal Lists

The server can forward raw data to external CRS and GPSPOS servers for specific terminal IDs. Edit `terminalLists` in `index.js`:

```javascript
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

* **crs**: Devices that should forward to the CRS server.
* **gpspos**: Devices that should forward to the GPSPOS server.

### Environment Variables

| Variable | Description |
| --- | --- |
| **MOOVE_SERVER_BASE_URL** | Base URL for the Moove API. |
| **GPS_SERVER_PORT_GT06** | Port for the GT06 server. |
| **GPSPOS_SERVER_PORT_UT04S** | Port for the UT04S (JT808) server. |
| **CRS_SERVER_PORT_UT04S** | CRS server port for UT04S devices. |
| **CRS_SERVER_PORT_GTO6** | CRS server port for GT06 devices. |
| **GPSPOS_SERVER_PORT_GT06** | GPSPOS server port for GT06 devices. |
| **CRS_SERVER** | IP/hostname of the CRS server. |
| **GPSPOS_SERVER** | IP/hostname of the GPSPOS server. |

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
| --- | --- |
| `pm2 list` | List all running processes |
| `pm2 logs MooveIotAdapter` | Show live logs |
| `pm2 monit` | Launch real‑time monitoring dashboard |
| `pm2 restart MooveIotAdapter` | Restart the process |
| `pm2 stop MooveIotAdapter` | Stop the process |

**Log Rotation:**

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7

```

---

## Architecture

The server is built on three core modules:

1. **server.js (`lib/server`)**: Creates the TCP server, manages connections, and loads the appropriate adapter (GT06 or JT808).
2. **device.js (`lib/device`)**: Represents a connected GPS device. It handles data framing (e.g., `7e` for JT808), emits high-level events, and manages response serial numbers.
3. **Adapters (`adapters/JT808.js`, `adapters/gt06.js`)**: Implements protocol-specific parsing. Defines `parse_data()` to convert raw buffers into structured `msgParts`.

---

## Event Handling

The `device` object emits the following events. Application logic in `index.js` listens to these to build API payloads and forward raw data.

| Event | Description | Emitted By |
| --- | --- | --- |
| **connected** | TCP connection established. | `server.js` |
| **disconnected** | TCP connection closed. | `server.js` |
| **login_request** | Login/authentication request received. | Adapter |
| **heartbeat** | Heartbeat packet received. | Adapter |
| **ping** | Location report (non‑alarm). | Adapter |
| **alarm** | Alarm report (location with alarm flag). | Adapter |

---

## API Integration

The server sends HTTP POST requests to the Moove backend for every significant event. Endpoints are built from `MOOVE_SERVER_BASE_URL`:

* **LOGIN**: `/api/gps/login`
* **HEARTBEAT**: `/api/gps/heartbeat`
* **LOCATION**: `/api/gps/location`
* **ALARM**: `/api/gps/alarm`

---

## Troubleshooting

* **Server does not start**: Check if the port is in use via `netstat -tulpn | grep <PORT>`.
* **No data received**: Verify device IP/Port configuration and server firewall rules.
* **API calls fail**: Ensure `MOOVE_SERVER_BASE_URL` is reachable and check for fetch errors in logs.

---

## License

ISC

Would you like me to generate a sample `myprotocol.js` adapter template for a new protocol?