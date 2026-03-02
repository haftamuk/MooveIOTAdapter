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