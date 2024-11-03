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

/***
 * https://stackoverflow.com/questions/38931866/convert-gps-position-from-double-value
 */

var server = gps.server(options, function (device, connection) {
  device.on("connected", function (data) {
    console.log("I'm a new ut04s device connected");
    return data;
  });

  device.on("login_request", function (device_id, msg_parts) {
    console.log(
      "Hey! I want to start transmiting my position. Please accept me. My name is " +
        device_id
    );

    this.login_authorized(true, msg_parts);

    console.log("Ok, " + device_id + ", you're accepted!");
  });

  device.on("ping", function (data) {
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

    //Look what informations the device sends to you (maybe velocity, gas level, etc)
    //console.log(data);
    return data;
  });

  //Also, you can listen on the native connection object
  connection.on("data", function (data) {
    //echo raw data package
    console.log("======================================");
    console.log("UT04S RAW DATA HEX : " + data.toString("hex"));

  });
});
