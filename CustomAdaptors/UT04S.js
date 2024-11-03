/* */
f = require("../functions");

exports.protocol = "JT808";
exports.model_name = "UT04S";
exports.compatible_hardware = ["Integrated GPS Speed Limiter UT04S/unigiard"];

var adapter = function (device) {
  if (!(this instanceof adapter)) return new adapter(device);

  this.format = {
    start: "7e",
    end: "7e",
    separator: "",
  };
  this.device = device;

  /*******************************************
	PARSE THE INCOMING STRING FROM THE DECIVE 
	You must return an object with a least: device_id, cmd and type.
	return device_id: The device_id
	return cmd: command from the device.
	return type: login_request, ping, etc. 
	*******************************************/
  this.parse_data = function (data) {
    data = data.toString("hex");
    // var cmd_start = data.indexOf("B"); //al the incomming messages has a cmd starting with 'B'
    // if(cmd_start > 13)throw "Device ID is longer than 12 chars!";
    var parts = {
      start: data.substr(0, 2),
      cmd: data.substring(2, 6), // mandatory, Command ID
      packet_length: data.substring(6, 10), //message property, including packet length
      device_id: data.substring(10, 22), //mandatory, Device ID
      cmd_serial_no: data.substr(22, 26), //mandatory , command serial number
      data: data.substring(26, data.length - 4),
      cksm: data.substring(data.length - 4, data.length - 2),
      finish: data.substr(data.length - 2),
    };
    switch (parts.cmd) {
      case "0100":
        parts.action = "register";
        break;
      case "0102":
        parts.action = "login_request";
        break;
      case "0200":
        parts.action = "ping";
        break;
      default:
        parts.action = "other";
    }

    return parts;
  };
  this.authorize = function () {
    this.send_comand("AP05");
  };
  this.run_other = function (cmd, msg_parts) {
    switch (cmd) {
      case "0100": //Handshake
        this.device.send(this.format_data(this.device.uid + "AP01HSO"));
        break;
    }
  };

  this.request_login_to_device = function () {
    //@TODO: Implement this.
  };

  this.receive_alarm = function (msg_parts) {
    //@TODO: implement this

    //Maybe we can save the gps data too.
    //gps_data = msg_parts.data.substr(1);
    alarm_code = msg_parts.data.substr(0, 1);
    alarm = false;
    switch (alarm_code.toString()) {
      case "0":
        alarm = { code: "power_off", msg: "Vehicle Power Off" };
        break;
      case "1":
        alarm = { code: "accident", msg: "The vehicle suffers an acciden" };
        break;
      case "2":
        alarm = { code: "sos", msg: "Driver sends a S.O.S." };
        break;
      case "3":
        alarm = {
          code: "alarming",
          msg: "The alarm of the vehicle is activated",
        };
        break;
      case "4":
        alarm = {
          code: "low_speed",
          msg: "Vehicle is below the min speed setted",
        };
        break;
      case "5":
        alarm = {
          code: "overspeed",
          msg: "Vehicle is over the max speed setted",
        };
        break;
      case "6":
        alarm = { code: "gep_fence", msg: "Out of geo fence" };
        break;
    }
    this.send_comand("AS01", alarm_code.toString());
    return alarm;
  };

  this.get_ping_data = function (msg_parts) {
    var str = msg_parts.data;
    var data = {
      alarm_mask: str.substr(0, 8),
      status: str.substr(8, 16),
      latitude: parseInt(str.substr(16, 24), 16),
      longitude: parseInt(str.substr(24, 32), 16),
      height: parseInt(str.substr(24, 32), 16),
      speed: parseInt(str.substr(36, 40), 16),
      direction: str.substr(40, 44),
      time: str.substr(44, 56),
      orientation: "",
      io_state: "",
      mile_post: "",
      mile_data: "",
      date: str.substr(44, 56),
      availability: "",
    };
    var datetime =
      "20" +
      data.date.substr(0, 2) +
      "/" +
      data.date.substr(2, 2) +
      "/" +
      data.date.substr(4, 2);
    datetime +=
      " " +
      data.time.substr(0, 2) +
      ":" +
      data.time.substr(2, 2) +
      ":" +
      data.time.substr(4, 2);
    data.datetime = new Date(datetime);
    res = {
      latitude: data.latitude,
      longitude: data.longitude,
      time: new Date(data.date + " " + data.time),
      speed: data.speed,
      orientation: data.orientation,
      mileage: data.mile_data,
    };
    return res;
  };

  /* SET REFRESH TIME */
  this.set_refresh_time = function (interval, duration) {
    //XXXXYYZZ
    //XXXX Hex interval for each message in seconds
    //YYZZ Total time for feedback
    //YY Hex hours
    //ZZ Hex minutes
    var hours = parseInt(duration / 3600);
    var minutes = parseInt((duration - hours * 3600) / 60);
    var time =
      f.str_pad(interval.toString(16), 4, "0") +
      f.str_pad(hours.toString(16), 2, "0") +
      f.str_pad(minutes.toString(16), 2, "0");
    this.send_comand("AR00", time);
  };

  /* INTERNAL FUNCTIONS */

  this.send_comand = function (cmd, data) {
    var msg = [this.device.uid, cmd, data];
    this.device.send(this.format_data(msg));
  };
  this.format_data = function (params) {
    /* FORMAT THE DATA TO BE SENT */
    var str = this.format.start;
    if (typeof params == "string") {
      str += params;
    } else if (params instanceof Array) {
      str += params.join(this.format.separator);
    } else {
      throw "The parameters to send to the device has to be a string or an array";
    }
    str += this.format.end;
    return str;
  };
};
exports.adapter = adapter;
