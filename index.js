// File: UT04SAdapter/index.js
import net from "net";

import gps from "gps-tracking";

var options = {
  debug: true,
  port: 8800,
  device_adapter: "UT04S",
};

const crsTerminals = [
  "020201228393"
];


var server = gps.server(options, function (device, connection) {
  // #######################################################################################################################
  // ################################################# CRS ONLY ############################################################
  // #######################################################################################################################
  let client = new net.Socket();
  let is_proxy_CRS_device = false;
  try {
    client.connect(22422, "193.193.165.165", function () {
      console.log(
        "=========================================================================="
      );
      console.log("CRS- Connected "); // acknowledge socket connection
      console.log(
        "=========================================================================="
      );

      console.log("CRS - CONNECTED.");
    });
    console.log("CRS - DEVICE Connected "); // acknowledge socket connection
  } catch (error) {
    console.log("CRS - ERROR : " + error.message);
    console.log(
      "=========================================================================="
    );
    console.log("CRS - ERROR : " + error.message);
    console.log(
      "=========================================================================="
    );
  }

  client.on("error", (err) => {
    console.log("CRS - Error Connecting : " + err.message);
    console.log("CRS - Error Connecting : " + err.message);
  });
  
  console.log("========================================");
  console.log("UT04S ADAPTER INITIALIZED");
  console.log("Listening on port:", options.port);
  console.log("========================================");
  
  // 1. Device Connected Event
  device.on("connected", function (data) {
    console.log("========================================");
    console.log("DEVICE CONNECTED");
    console.log("Remote IP:", connection.remoteAddress);
    console.log("========================================");
    is_proxy_CRS_device = crsTerminals.includes(device.getUID());

    return data;
  });

  // 2. Device Disconnected Event
  device.on("disconnected", function () {
    console.log("========================================");
    console.log("DEVICE DISCONNECTED");
    console.log("Device ID:", device.getUID());
    console.log("========================================");
    is_proxy_CRS_device = crsTerminals.includes(device.getUID());

  });

  // 3. Terminal Registration (0x0100)
  device.on("register", function (device_id, msg_parts) {
    console.log("========================================");
    console.log("TERMINAL REGISTRATION");
    console.log("Device ID:", device_id);
    console.log("========================================");
    
    // Registration response handled by adapter
    this.new_device_register(msg_parts);
    is_proxy_CRS_device = crsTerminals.includes(device_id);

  });

  // 4. Terminal Authentication/Login (0x0102)
  device.on("login_request", function (device_id, msg_parts) {
    console.log("========================================");
    console.log("TERMINAL AUTHENTICATION");
    console.log("Device ID:", device_id);
    console.log("========================================");
    
    // Authentication handled by adapter
    this.login_authorized(true, msg_parts);
    is_proxy_CRS_device = crsTerminals.includes(device_id);

  });

  // 5. Terminal Heartbeat (0x0002)
  device.on("hbt", function (device_id, msg_parts) {
    console.log("========================================");
    console.log("HEARTBEAT RECEIVED");
    console.log("Device ID:", device_id);
    console.log("Sequence:", msg_parts.cmd_serial_no);
    console.log("========================================");
    
    // Heartbeat handled by adapter
    this.receive_hbt(msg_parts);
    is_proxy_CRS_device = crsTerminals.includes(device_id);

  });

  // 6. Terminal Logout (0x0003)
  device.on("logout", function (device_id, msg_parts) {
    console.log("========================================");
    console.log("TERMINAL LOGOUT");
    console.log("Device ID:", device_id);
    console.log("========================================");
    
    this.logout(msg_parts);
    is_proxy_CRS_device = crsTerminals.includes(device_id);

  });

  // 7. Location Information Report (0x0200 without alarm)
  device.on("ping", function (data, msg_parts) {
    console.log("========================================");
    console.log("LOCATION REPORT");
    console.log("Device ID:", data.device_id);
    console.log("Position:", data.latitude, ",", data.longitude);
    console.log("Speed:", data.speed, "km/h");
    console.log("Time:", data.date);
    console.log("========================================");
    
    // Location report handled by adapter
    this.received_location_report(msg_parts);
    is_proxy_CRS_device = crsTerminals.includes(data.device_id);

  });

  // 8. Alarm Report (0x0200 with alarm flag)
  device.on("alarm", function (alarmData, msgParts) {
    console.log("========================================");
    console.log("ALARM REPORT");
    console.log("Device ID:", alarmData.device_id);
    console.log("Alarm Type:", alarmData.alarm_type);
    console.log("Position:", alarmData.latitude, ",", alarmData.longitude);
    console.log("========================================");
    
    // Alarm report handled by adapter
    this.received_alarm_report(msgParts);
    is_proxy_CRS_device = crsTerminals.includes(alarmData.device_id);

  });

  // 9. Other Commands
  device.on("other", function (device_id, msg_parts) {
    console.log("========================================");
    console.log("OTHER COMMAND");
    console.log("Device ID:", device_id);
    console.log("Command:", msg_parts.cmd);
    console.log("========================================");
    
    // Handle other commands via adapter
    device.adapter.run_other(msg_parts.cmd, msg_parts);
    is_proxy_CRS_device = crsTerminals.includes(device_id);
    
  });

  // 10. Batch Location Upload
  device.on("batch_location", function (device_id, msg_parts) {
    console.log("========================================");
    console.log("BATCH LOCATION UPLOAD");
    console.log("Device ID:", device_id);
    console.log("========================================");
    
    // Batch location handled by adapter
    device.adapter.batch_location("0001", msg_parts);
    is_proxy_CRS_device = crsTerminals.includes(device_id);

  });

  // 11. Driver Information
  device.on("driver_info", function (device_id, msg_parts) {
    console.log("========================================");
    console.log("DRIVER INFORMATION");
    console.log("Device ID:", device_id);
    console.log("========================================");
    
    // Driver info handled by adapter
    device.adapter.driver_info("0001", msg_parts);
    is_proxy_CRS_device = crsTerminals.includes(device_id);

  });

  //Also, you can listen on the native connection object
  connection.on("data", function (data) {
    if (is_proxy_CRS_device) {
    console.log("========================================");
    console.log("RAW DATA FROM DEVICE");
    console.log("Hex:", data.toString("hex"));
    console.log("========================================");
    client.write(data)
        ? console.log(
            "UT04S - Data Written to CRS server : " + data.toString("hex")
          )
        : console.log(
            "UT04S - NOT Written to CRS server : " + data.toString("hex")
          );
    } else {
    console.log("========================================");
    console.log("RAW DATA FROM DEVICE");
    console.log("Hex:", data.toString("hex"));
    console.log("========================================");
    }
  });


  // Connection error handling
  connection.on("error", function (err) {
    console.error("========================================");
    console.error("CONNECTION ERROR");
    console.error("Error:", err.message);
    console.error("========================================");
  });

  // Connection close handling
  connection.on("close", function () {
    console.log("========================================");
    console.log("CONNECTION CLOSED");
    console.log("Device:", device.getUID());
    console.log("========================================");
  });
});

// Handle server errors
server.on('error', function (err) {
  console.error("SERVER ERROR:", err);
});

// Handle process termination
process.on('SIGINT', function() {
  console.log("\nGracefully shutting down from SIGINT (Ctrl-C)");
  process.exit(0);
});

module.exports = server;