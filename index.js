import net from "net";

import gps from "gps-tracking";
import BinaryStream from "@jsprismarine/jsbinaryutils";

var options = {
  debug: true, //We don't want to debug info automatically. We are going to log everything manually so you can check what happens everywhere
  port: 8800,
  device_adapter: "GT06",
};

const MSG_UPLOAD_POSITION = 0x0008;
const MSG_UPLOAD_POSITION_NEW = 0x0032;
const MSG_CONTROL = 0x0002;
const MSG_CONTROL_RESPONSE = 0x8009;
const MSG_ALARM = 0x0003;
const MSG_SHAKE_HAND = 0x0000;
const MSG_SHAKE_HAND_RESPONSE = 0x8000;
const MSG_IMAGE_SIZE = 0x0200;
const MSG_IMAGE_PACKET = 0x0201;

/**
 * packetLen
 * Message_Head
 * Message_body
 *
 * 7e010000390202081740490688000000003131313131544d4b4a2d41303100000000000000000000000038313734303439000000000000000000000000000000000000000000d37e
 * 7e
 * 01
 * 02
 * 00
 * 06
 * 02
 * 02
 * 08
 * 17404907f5020208174049f77e
 *
 */
var server = gps.server(options, function (device, connection) {
  function bufferToHexString(buffer) {
    var str = "";
    for (var i = 0; i < buffer.length; i++) {
      if (buffer[i] < 16) {
        str += "0";
      }
      str += buffer[i].toString(16);
    }
    return str;
  }

  //Also, you can listen on the native connection object
  connection.on("data", function (data) {
    //echo raw data package
    console.log("======================================");
    console.log("UT04S RAW DATA EMITTED HEX : " + data.toString("hex"));
    console.log("UT04S RAW DATA EMITTED UTF8 : " + data.toString("utf8"));

    console.log("size of a buffer (in bytes) : " + data.length);
    let packetLen = new Uint16Array(data, 0);

    let cmd = new Uint16Array(data, 2);

    console.log("packetLen : ");
    console.log(packetLen);

    console.log("cmd : ");
    console.log(cmd);

    console.log("======================================");

    // console.log("Connection Obj: " + Object.toString(connection));
  });
});
