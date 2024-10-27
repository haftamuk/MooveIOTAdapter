const net = require("net");

var gps = require("gps-tracking");

var options = {
  debug: true, //We don't want to debug info automatically. We are going to log everything manually so you can check what happens everywhere
  port: 8800,
  device_adapter: "GT06",
};

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
    console.log("UT04S RAW DATA EMITTED : " + bufferToHexString(data));
    console.log("======================================");

    console.log("Connection Obj: " + Object.toString(connection));
  });
});
