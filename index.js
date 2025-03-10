import net from "net";

import gps from "gps-tracking";
// import BinaryStream from "@jsprismarine/jsbinaryutils";
// import { isUint16Array, isUint32Array, isUint8Array } from "util/types";
// import BitConverter from "bit-converter";

var options = {
  debug: true, //We don't want to debug info automatically. We are going to log everything manually so you can check what happens everywhere
  port: 8800,
  device_adapter: "UT04S",
};

const crsTerminals = [
  "020201228393"
];

/***
 * https://stackoverflow.com/questions/38931866/convert-gps-position-from-double-value
 */

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

  device.on("connected", function (data) {
    console.log("I'm a new ut04s device connected");
    return data;
  });
  device.on("new_device_first_time", function (device_id, msg_parts) {
    console.log("NEW DEVICE EVER DETECTED: " + device_id);

    this.receive_first_time(msg_parts);
  });

  device.on("hbt", function (device_id, msg_parts) {
    console.log("HEARTBEAT RECEIVED: " + device_id);

    this.receive_hbt(msg_parts);
  });

  device.on("register", function (device_id, msg_parts) {
    console.log("TERMINAL TRYING TO REGISTER: " + device_id);

    this.new_device_register(msg_parts);
  });
  device.on("login_request", function (device_id, msg_parts) {
    is_proxy_CRS_device = crsTerminals.includes(device_id);

    console.log(
      "Hey! I want to start transmiting my position. Please accept me. My name is " +
        device_id
    );

    this.login_authorized(true, msg_parts);

    console.log("Ok, " + device_id + ", you're accepted!");
  });
  device.on("logout", function (device_id, msg_parts) {
    console.log("TERMINAL TRYING TO LOGOUT: " + device_id);
    this.logout(msg_parts);
  });

  device.on("ping", function (data, msg_parts) {
    //this = device
    console.log(
      "I'm here: " +
        data.latitude +
        ", " +
        data.longitude +
        " (" +
        this.getUID() +
        ")"
    );
    this.received_location_report(msg_parts);

    /**
     * #######################################################################
     * ########## SENDING LOCATION INFORMATION TO SERVER ######################
     * {
     *   alarm_mask: '00000000',
     *   status: '00000002',
     *   latitude: 13.486583,
     *   longitude: 39.4528,
     *   height: 7,
     *   speed: 16,
     *   direction: 0,
     *   date: 2024-11-15T21:47:35.000Z,
     *   orientation: '',
     *   io_state: '',
     *   mile_post: '',
     *   mile_data: '',
     *   availability: ''
     * }
     * #######################################################################
     */
    fetch(`http://78.47.144.132:3000/api/GPSLocationFeed`, {
      method: "POST",
      mode: "cors",
      body: JSON.stringify({ data: data }),
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
    })
      .then((response) => {
        console.log("MooveLocation Returned RAW response : ");
        console.log(response);
        return response.json();
      })
      .then((data) => {
        console.log("MooveLocation Returned FORMATTED Data : ");
        console.log(data);
      })
      .catch((err) => {
        console.log("ERROR SENDING TO MOOVE LOCATION PLATFORM");
        console.log(err);
        console.log("data OBJECT");
        console.log(data);
        console.log("JSON.stringify(data)");
        console.log(JSON.stringify(data));
      });
    /**
     * #######################################################################
     */

    //Look what informations the device sends to you (maybe velocity, gas level, etc)
    //console.log(data);
    return data;
  });

  device.on("alarm", function (alarmData, msgParts) {
    //this = device
    console.log("TODO- ALARM PARSING");
    //Look what informations the device sends to you (maybe velocity, gas level, etc)
    //console.log(data);
    this.received_alarm_report(msgParts);

    return msgParts;
  });

  //Also, you can listen on the native connection object
  connection.on("data", function (data) {
    if (is_proxy_CRS_device) {
      //echo raw data package
      console.log("=================================");
      console.log(
        "UT04S CRS - RAW DATA emitted : IMEI - " + bufferToHexString(data)
      );
      console.log("==================================================");
      client.write(data)
        ? console.log(
            "UT04S - Data Written to CRS server : " + bufferToHexString(data)
          )
        : console.log(
            "UT04S - NOT Written to CRS server : " + bufferToHexString(data)
          );
      console.log("=================================");
    } else {
      //echo raw data package
      console.log("========================================");
      console.log("UT04S RAW DATA HEX : " + data.toString("hex"));

      console.log("===========================================");
    }
  });
});
