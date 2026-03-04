A step-by-step guide to install and run the `jtt808-simulator` from GitHub. This is a powerful Java-based tool for simulating JT/T808 protocol devices, perfect for testing your server .

Here is a comprehensive guide to get you started.

### 📋 Prerequisites

Before you begin, please ensure your system meets the following requirements:

| Requirement | Version/Details | Purpose |
| :--- | :--- | :--- |
| **Java JDK** | 1.8 or higher | Required to run the simulator . |
| **Maven** | 3.x | Used to compile and build the project from source . |
| **Git** | Latest version | To clone the project repository from GitHub. |
| **Internet Connection** | Stable connection | Needed for cloning the repo and downloading dependencies. |

### 🚀 Step-by-Step Installation Guide

Follow these steps to get the simulator up and running.

#### Step 1: Clone the Repository
First, you need to download the project source code from GitHub. Open your terminal or command prompt and run the following command:

```bash
git clone https://github.com/ruffjs/jtt808-simulator.git
```

This will create a new folder named `jtt808-simulator` containing all the project files .

#### Step 2: Navigate to the Project Directory
Change your current directory to the newly cloned project folder:

```bash
cd jtt808-simulator
```

#### Step 3: Build the Project with Maven
The project uses Maven for dependency management and building. To compile the code and create an executable JAR file, run:

```bash
mvn clean package
```

This command will download all necessary dependencies and compile the project. The first time you run this, it might take a little longer.

#### Step 4: Run the Simulator
Once the build is successful, you can find the generated JAR file in the `target` directory. Navigate into it and run the JAR file using the `java -jar` command:

```bash
cd target
java -jar jtt808-simulator-*.jar

or 

java --add-opens java.base/java.lang=ALL-UNNAMED -jar jtt808-simulator-*.jar

```

The simulator is built with SpringBoot and uses an embedded H2 file database, so it requires no additional database setup .

### ⚙️ Configuring and Using the Simulator

After starting the simulator, you can access its web interface to configure and control the simulated devices.

#### 1. Access the Web Interface
Open your web browser and go to:
```
http://localhost:8080
```
This is the main dashboard for the simulator .

#### 2. Create a Line (Route)
Before simulating a moving vehicle, you must define a route for it to follow.
- Navigate to the **"Line Management"** (线路管理) section.
- Create a new line by setting a starting point and an end point on the map.
- You can configure the minimum and maximum driving speed for this route.
- Optionally, add stop points.
    > **Important Note:** The simulator uses the **Baidu Maps API** for route planning and coordinates. Be aware of the coordinate system differences between Baidu Maps and your own server's maps .

#### 3. Create a Trip Task
With a line created, you can now define a specific vehicle and trip.
- Go to the **"Trip Tasks"** (行程任务) section.
- Select the line you just created.
- Fill in the vehicle information:
    - **License Plate Number** (车牌号)
    - **Terminal ID** (终端ID)
    - **SIM Card Number** (SIM卡号)
    - **Target Server IP and Port**: This is the most critical part—enter the IP address and port of your own JT808 server that you want to test.
- Save the new task .

#### 4. Start the Simulation
- Find your newly created task in the list.
- Click the **"Start"** button.
- The simulated terminal will now:
    1.  Connect to your JT808 server.
    2.  Automatically perform the registration and authentication process.
    3.  Begin reporting location information at a regular interval (the project currently uses a **5-second interval**) .

### 🔧 Advanced Features and Development

The `jtt808-simulator` also includes features for more in-depth testing and customization.

- **Real-time Monitoring**: You can monitor the simulated vehicle's trajectory in real-time on a map within the web interface .
- **Protocol Interaction Logs**: A built-in logging feature records all messages exchanged between the simulated terminal and your server. This is invaluable for debugging .
- **Concurrency and Stress Testing**: The project is designed with **Netty** for connection management, aiming to support a large number of concurrent connections (targeting 100,000 vehicles online), which is useful for stress testing your server .
- **Extending the Simulator**: For developers, the project provides an API to create custom behaviors.
    - You can inherit from the `AbstractDriveTask` class to implement your own terminal logic .
    - The `@Listen` annotation allows you to define specific actions when certain events occur, such as receiving a particular message from the server.
        ```java
        // Example: Listen for the 0x8801 camera capture command 
        @Listen(when = EventEnum.message\_received, attachment = "8801")
        public void onCameraCaptureCommand(JTT808Message msg) {
            // Your custom logic here
        }
        ```

### 📝 Important Notes
- **Protocol Version**: Currently, the simulator supports the **JT/T 808 2013** version. Support for the 2019 version is under development .
- **Community Support**: If you encounter issues, you can join the developer community on QQ at group **808432702** .

By following these steps, you will have a powerful JT808 device simulator running, ready to test your server's protocol parsing and logic. Good luck with your development



Excellent question! Running the `jtt808-simulator` without a Baidu API key is a common challenge. Since the simulator's built-in route planning relies on the Baidu Maps API , your approach of manually providing converted coordinates is the perfect solution.

Here is a complete, step-by-step guide to create and import your own route data, bypassing the need for the API key.

### 🎯 The Core Strategy
The `jtt808-simulator` stores all its data, including the routes you see in the "Line Management" section, in an embedded H2 database file . Our goal is to bypass the web interface's API call and insert our own route coordinates directly into this database. The route will consist of a series of latitude and longitude points.

### 📝 Step-by-Step Implementation Guide

Follow these steps to create a route from Google Maps coordinates and use it in your simulator.

#### Step 1: Gather and Convert Your Coordinates

First, you need to define the path your simulated vehicle will follow.

1.  **Collect Coordinates from Google Maps:**
    *   Go to Google Maps in your browser.
    *   Right-click on a starting point along your desired route and select the coordinates (e.g., `40.7128, -74.0060`). This copies them to your clipboard.
    *   Continue along your intended path, right-clicking and copying coordinates at key turning points. The more points you collect, the smoother your vehicle's path will be. Aim for at least 5-10 points for a simple route.
    *   Paste these coordinates into a text file for now. You'll have a list like this:
        ```
        40.7128, -74.0060  (Start)
        40.7150, -74.0120
        40.7200, -74.0180
        40.7250, -74.0220  (End)
        ```

2.  **Convert Coordinates from Google (WGS-84) to Baidu (BD-09):**
    This is the most critical step. The simulator's internal logic and map display use the **Baidu coordinate system (BD-09)** . If you insert raw Google Maps coordinates (which are in the global WGS-84 standard), the plotted points on the simulator's interface will be in the wrong location .
    *   You can use the `coord-convert` library you mentioned, or a similar tool. Here's a conceptual example using Python with the `coord-convert` library:
        ```python
        # Example Python script using the coord-convert library
        from coord_convert.transform import wgs2gcj, gcj2bd

        # Google Maps coordinates (WGS-84)
        google_coords = [
            (40.7128, -74.0060),
            (40.7150, -74.0120),
            # ... add all your coordinates
        ]

        print("Longitude,Latitude") # H2 might expect this order
        for lat, lng in google_coords:
            # Step 1: WGS-84 -> GCJ-02 (required for China)
            gcj_lng, gcj_lat = wgs2gcj(lng, lat)
            # Step 2: GCJ-02 -> BD-09
            bd_lng, bd_lat = gcj2bd(gcj_lng, gcj_lat)
            print(f"{bd_lng},{bd_lat}")
        ```
    *   Run this script to generate a new list of your coordinates, now converted to the Baidu system. Save this converted list, as we will use it in the next step.

#### Step 2: Locate and Access the Simulator's Database

The simulator uses an H2 database file to store its information .

1.  **Find the Database File:**
    *   After running the simulator at least once, an H2 database file is created. Look for a file named `jtt808-simulator.mv.db` (or a similar `.db` file) in the same directory as your `jtt808-simulator-*.jar` file (likely the `target` directory).

2.  **Connect to the Database using H2 Console:**
    *   Download the H2 Database Engine from its official website.
    *   Run the H2 Console (usually by executing `h2/bin/h2.sh` or `h2/bin/h2.bat`).
    *   In the console login page, set the **JDBC URL** to point to your file, for example: `jdbc:h2:/full/path/to/your/jtt808-simulator.mv.db`. Use `sa` as the username and leave the password blank (unless you've set one).

#### Step 3: Populate the Route Data

This step requires you to insert records into the database. The exact table and column names are best discovered by inspecting the database yourself after creating one route via the UI (if you managed to do so once) or by examining the source code. However, based on the project's structure, here are the most likely tables and a guided approach.

**Scenario A: You have a working API key and can create one route normally.**
This is the easiest path for discovery.
1.  Use the web interface (`http://localhost:8080`) to create **one simple test route** using your API key.
2.  While connected to the H2 database, run `SHOW TABLES;` to see all tables.
3.  Browse the data in likely tables such as `LINE` (for route name, speed limits, etc.) and `LINE_POINT` (for the sequence of coordinates). Note the exact table and column names.
4.  Delete that test route from the UI. Now, use the `INSERT` statements you've reverse-engineered to add your own route with the converted coordinates.

**Scenario B: You cannot create any route via the UI.**
You'll need to infer the schema from the source code, which is more complex.
1.  Look for files in the `src/main/resources/mybatis/mapper/` directory of the project source code. Files like `LineMapper.xml` and `LinePointMapper.xml` will show you the exact table structure and SQL queries used to insert data.
2.  From these XML files, you can see the table names (e.g., `line`, `line_point`) and their columns (e.g., `id`, `name`, `min_speed`, `max_speed` for `line`; `line_id`, `lng`, `lat`, `sequence` for `line_point`).
3.  You can then construct your own `INSERT` statements. For example:
    ```sql
    -- Insert into the LINE table (you need to generate a unique ID)
    INSERT INTO LINE (ID, NAME, MIN_SPEED, MAX_SPEED, CREATED_AT) 
    VALUES (100, 'My Custom Route from Google', 30, 60, NOW());
    
    -- Insert points with the correct sequence order
    INSERT INTO LINE_POINT (ID, LINE_ID, LNG, LAT, SEQUENCE) 
    VALUES (1001, 100, 116.403981, 39.915051, 1); -- Use your converted BD-09 coordinates
    INSERT INTO LINE_POINT (ID, LINE_ID, LNG, LAT, SEQUENCE) 
    VALUES (1002, 100, 116.414981, 39.925051, 2);
    -- ... add all your points
    ```

#### Step 4: Verify and Use Your Route

1.  After inserting the data, stop the simulator if it's running and restart it with `java --add-opens java.base/java.lang=ALL-UNNAMED -jar jtt808-simulator-*.jar`.
2.  Navigate to the `http://localhost:8080` web interface.
3.  Go to the **"Line Management"** section. Your new route, "My Custom Route from Google", should now appear in the list.
4.  Proceed to create a **"Trip Task"** using this custom line. The simulator will now use the sequence of points you provided to generate the vehicle's location reports, completely bypassing the Baidu API.

### 🔍 Important Considerations

*   **Database Schema is Key:** The success of this method hinges on correctly identifying the database tables and their columns. Taking the time to explore the H2 database after a test run (Scenario A) is the most reliable way to get this right.
*   **Coordinate Order:** Be very careful with the order of latitude and longitude. The example `INSERT` assumes `LNG, LAT`. The Python conversion example prints them in that order. Always verify against the database schema.
*   **Sequence Matters:** The `SEQUENCE` (or `ORDER`) column for the points is critical. The simulator will report locations by interpolating between these points in the order you define.

This approach gives you full control over the simulated path. If you get stuck identifying the exact database schema, feel free to run the discovery steps and share what you find, and I can help you formulate the correct `INSERT` statements.




No problem! It's common that the H2 console accepts only the default `sa` user, and the tables aren't created until the application runs. Let's adapt the guide to your situation.

You have two ways to get the tables created:

1. **Let the application create them automatically** (preferred)  
2. **Manually run the schema script** (if the app fails to create them)

I'll give you both paths, but first we need to ensure you're connecting to the **correct database file**.

---

## 🔍 Step 0: Locate the database file

When you run the simulator from the `target` folder, it creates a file named `simulator.mv.db` in that same folder (according to `spring.datasource.url = jdbc:h2:./simulator`).  
Make sure you are in the `target` directory when starting the app and when using the H2 console.

---

## 🏃 Path A: Let the application create the tables (recommended)

### A1. Start the simulator at least once

```bash
cd /path/to/your/jtt808-simulator/target
java --add-opens java.base/java.lang=ALL-UNNAMED -jar jtt808-simulator-*.jar
```

Wait until you see logs that the app has started (you'll see something like `Started SimulatorApp`).  
This will automatically create the `simulator.mv.db` file and all tables (`X_ROUTE`, `X_ROUTE_POINT`, etc.) because `spring.datasource.schema=classpath:schema.sql` tells Spring to run that script on startup.

You can now stop the app (Ctrl+C) – we just needed the database structure.

### A2. Connect to the H2 console

Start the simulator again (the console is embedded in the app, so the app must be running to access `/h2db`).  

```bash
java --add-opens java.base/java.lang=ALL-UNNAMED -jar jtt808-simulator-*.jar
```

Then open your browser to **http://localhost:8888/h2db** (the port is 8888, as per `server.port=8888` in `application.properties`).

Now use these credentials:
- **JDBC URL**: `jdbc:h2:./simulator`  (make sure you are still in the `target` directory when the app runs; the path is relative)
- **User Name**: `sa`
- **Password**: (leave empty)

Click **Connect**. You should now see all the tables listed in the left panel (`X_ROUTE`, `X_ROUTE_POINT`, …).

> **Why `sa` works?** H2 Console allows any valid user; the app uses `h2db` internally, but the console can connect with the default `sa` account as long as the database file is accessible.

If you don't see the tables, proceed to Path B.

---

## 🛠️ Path B: Manually create the tables (if they are missing)

If the tables are not present even after running the app, or you prefer full control, you can execute the `schema.sql` manually in the H2 console.

### B1. Connect to the H2 console

Follow **A2** to connect, using `sa` with empty password.

### B2. Copy and run the full schema

In the H2 console, paste the entire content of your `schema.sql` file into the SQL editor and click **Run**. This will create all the tables.

Here is the content you provided – you can copy it directly:

```sql
/* 模拟器相关表 */
CREATE TABLE if not exists `x_route` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT 'id',
  `name` varchar(100) DEFAULT NULL COMMENT 'name',
  `minSpeed` int(11) DEFAULT NULL COMMENT 'minSpeed（公里每小时）',
  `maxSpeed` int(11) DEFAULT NULL COMMENT 'maxSpeed',
  `mileages` int(11) DEFAULT NULL COMMENT '里程（公里）',
  `fingerPrint` varchar(100) DEFAULT NULL COMMENT '线路指纹',
  PRIMARY KEY (`id`)
) COMMENT='线路';

CREATE TABLE if not exists `x_route_point` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `routeId` bigint(20) DEFAULT NULL,
  `longitude` double DEFAULT NULL,
  `latitude` double DEFAULT NULL,
  PRIMARY KEY (`id`)
) COMMENT='线路轨迹点';

create index if not exists idx_route_id on x_route_point(routeId);

CREATE TABLE if not exists `x_schedule_task` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `routeId` bigint(20) DEFAULT NULL COMMENT '线路ID',
  `driverId` bigint(20) DEFAULT NULL COMMENT '驾驶员ID',
  `vehicleId` bigint(20) DEFAULT NULL COMMENT '车辆ID',
  `fromTime` varchar(20) DEFAULT NULL COMMENT '行程的开始时间的最早时间',
  `endTime` varchar(20) DEFAULT NULL COMMENT '行程的开始时间的最晚时间',
  `ratio` int(11) DEFAULT NULL COMMENT '概率，',
  `daysInterval` int(11) DEFAULT NULL COMMENT '每隔几天运行一次',
  `driveCount` int(11) DEFAULT NULL COMMENT '行驶次数计数',
  `lastDriveTime` datetime DEFAULT NULL COMMENT '最后行驶开始时间',
  `runCount` int(11) DEFAULT NULL COMMENT '运行次数',
  PRIMARY KEY (`id`)
) COMMENT='线路行程计划任务';

create index if not exists idx_schedule_route_id on x_schedule_task(routeId);
create index if not exists idx_schedule_driver_id on x_schedule_task(driverId);
create index if not exists idx_schedule_vehicle_id on x_schedule_task(vehicleId);

CREATE TABLE if not exists `x_stay_point` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `routeid` bigint(20) DEFAULT NULL,
  `longitude` double DEFAULT NULL,
  `latitude` double DEFAULT NULL,
  `minTime` int(11) DEFAULT NULL,
  `maxTime` int(11) DEFAULT NULL,
  `ratio` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) COMMENT='线路停留点';

create index if not exists idx_stay_point_route_id on x_stay_point(routeId);

CREATE TABLE if not exists `x_trouble_segment` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `routeId` bigint(20) DEFAULT NULL,
  `startIndex` int(11) DEFAULT NULL,
  `endIndex` int(11) DEFAULT NULL,
  `eventCode` varchar(20) DEFAULT NULL,
  `ratio` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) COMMENT='线路问题路段';

create index if not exists idx_trouble_segment_route_id on x_trouble_segment(routeId);
```

After running this, you should see all the tables.

---

## 📝 Step 3: Insert your custom route data

Now with the tables ready, follow the same data insertion steps from the previous guide.

### 3.1 Insert a route into `X_ROUTE`

```sql
INSERT INTO X_ROUTE (NAME, MIN_SPEED, MAX_SPEED, MILEAGES, FINGER_PRINT) 
VALUES ('My Custom Route from Google', 30, 60, 15, NULL);
```

Get the generated ID (e.g., `100`) by running:

```sql
SELECT MAX(ID) FROM X_ROUTE;
```

### 3.2 Insert route points (using your converted Baidu coordinates)

```sql
-- point 1
INSERT INTO X_ROUTE_POINT (ROUTE_ID, LONGITUDE, LATITUDE) 
VALUES (100, 116.403981, 39.915051);

-- point 2
INSERT INTO X_ROUTE_POINT (ROUTE_ID, LONGITUDE, LATITUDE) 
VALUES (100, 116.414981, 39.925051);

-- ... continue for all points
```

> **Important**: Insert points in the order you want the vehicle to travel. The simulator will use the auto‑increment `ID` to determine the sequence.

---

## 🚗 Step 4: Create a trip task

You'll need at least one **driver** and one **vehicle** in the corresponding tables. If those tables are empty, you can insert a simple driver and vehicle via SQL or through the web UI if those sections work (they may not require the Baidu key).

### 4.1 Insert a driver (if the `driver` table exists)

Check the exact table name – it might be `DRIVER` or `X_DRIVER`. Look in the database for tables like `DRIVER`, `VEHICLE`.  
If they exist, insert a record:

```sql
INSERT INTO DRIVER (NAME, PHONE) VALUES ('John Doe', '13800138000');
INSERT INTO VEHICLE (VIN, PLATE) VALUES ('TESTVIN123', '京A12345');
```

If these tables are missing, you might need to create them using the schema from `data.sql` or the mapper files, but they are likely present if you used Path A. If not, let me know and I'll help you extract their definitions.

### 4.2 Create a schedule task

```sql
INSERT INTO X_SCHEDULE_TASK 
    (ROUTE_ID, DRIVER_ID, VEHICLE_ID, FROM_TIME, END_TIME, RATIO, DAYS_INTERVAL, DRIVE_COUNT, RUN_COUNT)
VALUES 
    (100, 1, 1, '08:00', '18:00', 100, 1, 0, 0);
```

Now restart the simulator and go to **http://localhost:8888**. You should see your route under "Line Management" and the task under "Trip Tasks". You can start the simulation and watch the vehicle follow your custom path.

---

## ✅ Summary of key points for your situation

- **Use `sa` with empty password** for the H2 console.
- **Ensure you're in the `target` directory** when running the app and when connecting with `jdbc:h2:./simulator`.
- **If tables aren't created automatically**, manually run the `schema.sql` script provided above.
- **Insert routes and points in the correct order** – the `ID` of `X_ROUTE_POINT` determines the sequence.

If you encounter any missing tables (like `DRIVER` or `VEHICLE`), check the actual table names in your database or provide their mapper files so we can get the exact schema. But with the tables we have, you should be able to create a route and see it on the map.

The logs from your server show that the SIM number `013800123456` is being used as the **device identifier**, which is exactly correct for JT/T808. The terminal ID in JT/T808 is typically the SIM card number (or an ID derived from it), so your server is handling it properly.

The main issue is the **connection timeout** 30 seconds after registration. This indicates that after the registration exchange, no further messages were received by the server, causing it to close the connection. Let’s diagnose why.

---

## 🔍 Step 1: Understanding the registration flow

In JT/T808:
1. Terminal sends **0x0100 (registration)**.
2. Server replies with **0x8100 (registration response)**.
   - If result code = `0x00` (success), the response **must include an authentication code**.
   - The terminal then sends **0x0102 (authentication)** with that code.
   - After successful authentication, the terminal can start sending location (0x0200) or heartbeats (0x0002).

If result code is `0x01` (already registered), the server may or may not send an auth code – the spec says no auth code for non‑zero results. The terminal should then proceed directly to authentication (using a previously stored auth code) or start sending location? This is implementation‑dependent.

---

## 📦 Step 2: Examine the server’s registration response

Your server sent:

```
7E8001000501380012345600010001010000CC7E
```

Let’s break it down:

| Bytes | Meaning               | Value (hex)           | Interpretation |
|-------|-----------------------|-----------------------|----------------|
| 7E    | Start flag            |                       |                |
| 8001  | Message ID            | 0x8001                | Platform general response |
| 0005  | Message body length   | 5 bytes               |                |
| 01    | Terminal ID (first byte) | 0x01               | Part of 6‑byte terminal ID |
| 3800123456 | remaining 5 bytes of terminal ID | BCD: `013800123456` | Same as device ID |
| 0001  | Reply serial number   | 0x0001                | Matches registration’s serial |
| 00    | Result byte           | 0x00                  | **Success?** Wait, it's `00`, not `01`! Let's re‑check: the log says "0001010000" after the terminal ID and serial. Actually the log shows: "...00010001010000...". Let's parse carefully: "00010001010000" – after terminal ID we have "0001" (serial), then "0001"? Hmm. Let's rewrite the hex string with grouping:

`7E 8001 0005 01 3800123456 0001 0001 010000 CC 7E`

- `01 3800123456` = terminal ID (6 bytes)
- `0001` = reply serial number (2 bytes)
- Next `0001`? That would be part of the result? Actually the result is 1 byte. So after serial, the next byte is `00` (result). Then the remaining `010000` would be extra bytes.

That means:
- reply serial = `0x0001`
- result = `0x00` (success)
- extra bytes = `0x010000` (3 bytes)

For result = `0x00`, the spec says an **authentication code** follows. The auth code is a variable‑length string, often 4 bytes or more. The extra bytes `01 00 00` could be an auth code of 3 bytes (but auth codes are usually at least 4 bytes). This is ambiguous.

If the server intended result = `0x01` (already registered), the first byte after serial should be `0x01` and then no auth code. But here the first byte after serial is `0x00`, which means success, and the following three bytes are part of the auth code. So the server is sending an auth code of length 3 (or more, but the packet length is only 5 bytes total body, so auth code would be only 3 bytes). That is unusual and might confuse the simulator.

---

## 🧪 Step 3: What the simulator expects

The simulator (especially `ut04s.js`) likely follows the typical flow: after receiving a successful registration response (result=0), it extracts the auth code and sends an **authentication message (0x0102)**. If the auth code is missing or malformed, it might not send authentication, or it might hang.

In your case, the simulator registered, got a response, and then did nothing for 30 seconds, after which the server timed out. That suggests the simulator did **not** send authentication. Why?

- Possibly because it didn't recognize the auth code (3 bytes instead of typical 4+).
- Or because the simulator's code expects the auth code to be a specific length or format.

---

## ✅ Step 4: Recommended fixes

### Fix 1: Adjust your server’s registration response
If your server is using result = `0x00` (success), it **must** send a proper authentication code, and the total body length must match. A typical auth code is 4 bytes (e.g., `12345678` in ASCII or BCD). For example:
- Body: terminal ID (6 bytes) + reply serial (2 bytes) + result (1 byte) + auth code (4 bytes) = 13 bytes total.
- Then the message length field would be `000D` (13).

Your current packet has body length `0005` (5 bytes), but if you include a 3‑byte auth code, total would be 6+2+1+3 = 12 bytes, but you only declared 5 bytes in the length field – this is inconsistent. The simulator might parse based on the length field, and since you declared only 5 bytes, it may not read the auth code at all, leading to missing authentication.

**Check your server’s packet construction.** Make sure:
- The message length field correctly reflects the body size.
- If result = 0x00, include an auth code of reasonable length (at least 4 bytes).
- The total packet length (excluding start/end flags) matches the sum of all fields.

### Fix 2: Configure the simulator to expect a different flow
If your server intentionally uses result = `0x01` (already registered) and does not send an auth code, then the simulator must be told to proceed without authentication. Most simulators, however, expect the standard flow. You might need to modify the simulator’s script (`ut04s.js`) to handle result = 0x01 gracefully.

But the simpler fix is to align your server with the standard flow.

### Fix 3: Enable more logging in the simulator
Check if the simulator logs anything after receiving the registration response. If you have access to the simulator’s console, you might see an error about missing or invalid auth code. This would confirm the issue.

---

## 📝 Summary

- The SIM number being used as device ID is **normal and correct**.
- The timeout is caused by the simulator not sending authentication after registration.
- The likely culprit is an **improper registration response** from your server (mismatched length, missing auth code, or ambiguous result byte).
- Fix your server’s 0x8100 response to match the JT/T808 spec, and the connection should stay alive.

