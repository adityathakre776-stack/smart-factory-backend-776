/*
 * ============================================================
 *  NODE_01 — FULL SENSOR DIAGNOSTIC TEST
 *  Tests: MQ1 | MQ2 | Flame (DO+AO) | HC-SR04 | MPU6050 | GPS | LoRa
 *
 *  Libraries needed:
 *    - MPU6050 by Electronic Cats (not Adafruit)
 *    - LoRa by Sandeep Mistry
 *    - TinyGPSPlus
 *
 *  HOW TO USE:
 *    1. Flash this sketch to your NODE_01 ESP32
 *    2. Open Serial Monitor at 115200 baud
 *    3. Each sensor is tested one by one
 *    4. Check PASS / FAIL / WARNING for each
 * ============================================================
 *
 *  PIN MAP:
 *    MQ1 AOUT     → GPIO 34
 *    MQ2 AOUT     → GPIO 35
 *    Flame DO     → GPIO 33
 *    Flame AO     → GPIO 32
 *    HC-SR04 TRIG → GPIO 25
 *    HC-SR04 ECHO → GPIO 27
 *    MPU6050 SDA  → GPIO 21
 *    MPU6050 SCL  → GPIO 22
 *    GPS TX       → GPIO 16 (ESP32 RX2)
 *    GPS RX       → GPIO 17 (ESP32 TX2)
 *    LoRa SS      → GPIO 5
 *    LoRa RST     → GPIO 14
 *    LoRa DIO0    → GPIO 26
 *    LoRa SCK     → GPIO 18
 *    LoRa MOSI    → GPIO 23
 *    LoRa MISO    → GPIO 19
 * ============================================================
 */

#include <Wire.h>
#include <MPU6050.h>
#include <SPI.h>
#include <LoRa.h>
#include <TinyGPS++.h>

// ============ PIN DEFINITIONS ============
#define MQ1_PIN     34   // MQ gas/smoke 1 AOUT
#define MQ2_PIN     35   // MQ gas/smoke 2 AOUT
#define FLAME_DO    33   // Flame sensor digital  (LOW = flame)
#define FLAME_AO    32   // Flame sensor analog
#define TRIG_PIN    25   // HC-SR04 trigger
#define ECHO_PIN    27   // HC-SR04 echo
#define LORA_SS      5
#define LORA_RST    14
#define LORA_DIO0   26

// ============================================================
MPU6050 mpu;
TinyGPSPlus gps;
HardwareSerial GPSSerial(2);   // UART2: RX=16, TX=17

// ---- print helpers -----------------------------------------
void printDivider(const char* title) {
  Serial.println();
  Serial.println("============================================");
  Serial.printf("  %s\n", title);
  Serial.println("============================================");
}
void pass(const char* msg) { Serial.printf("  [PASS] %s\n", msg); }
void fail(const char* msg) { Serial.printf("  [FAIL] %s\n", msg); }
void warn(const char* msg) { Serial.printf("  [WARN] %s\n", msg); }
void info(const char* msg) { Serial.printf("  [INFO] %s\n", msg); }

// ============================================================
//  TEST 1 — MQ1 Sensor (GPIO 34)
// ============================================================
void testMQ1() {
  printDivider("TEST 1: MQ Sensor 1 (GPIO 34)");

  long sum = 0;
  int minVal = 4095, maxVal = 0;
  Serial.println("  Reading 10 samples...");
  for (int i = 0; i < 10; i++) {
    int v = analogRead(MQ1_PIN);
    sum += v;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
    Serial.printf("    Sample %2d: %4d  (%.2fV)\n", i+1, v, (v/4095.0)*3.3f);
    delay(100);
  }
  int avg = sum / 10;
  Serial.printf("  Avg ADC : %d  Spread: %d\n", avg, maxVal - minVal);

  if (avg == 0)
    fail("ADC=0 — MQ1 not connected or VCC missing");
  else if (avg >= 4090)
    fail("ADC=4095 (floating) — AOUT wire not connected to GPIO 34");
  else if (avg < 100)
    warn("ADC very low — sensor may be cold or VCC is 3.3V (needs 5V)");
  else if (maxVal - minVal > 600)
    warn("Large spread — loose wire or unstable power supply");
  else
    pass("MQ1 responding with stable readings");
}

// ============================================================
//  TEST 2 — MQ2 Sensor (GPIO 35)
// ============================================================
void testMQ2() {
  printDivider("TEST 2: MQ Sensor 2 (GPIO 35)");

  long sum = 0;
  int minVal = 4095, maxVal = 0;
  Serial.println("  Reading 10 samples...");
  for (int i = 0; i < 10; i++) {
    int v = analogRead(MQ2_PIN);
    sum += v;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
    Serial.printf("    Sample %2d: %4d  (%.2fV)\n", i+1, v, (v/4095.0)*3.3f);
    delay(100);
  }
  int avg = sum / 10;
  Serial.printf("  Avg ADC : %d  Spread: %d\n", avg, maxVal - minVal);

  if (avg == 0)
    fail("ADC=0 — MQ2 not connected or VCC missing");
  else if (avg >= 4090)
    fail("ADC=4095 (floating) — AOUT wire not connected to GPIO 35");
  else if (avg < 100)
    warn("ADC very low — sensor may be cold or VCC is 3.3V (needs 5V)");
  else if (maxVal - minVal > 600)
    warn("Large spread — loose wire or unstable power supply");
  else
    pass("MQ2 responding with stable readings");
}

// ============================================================
//  TEST 3 — Flame Sensor (DO=33, AO=32)
// ============================================================
void testFlame() {
  printDivider("TEST 3: Flame Sensor (DO=33, AO=32)");

  Serial.println("  Reading digital + analog 5 times...");
  int flameCount = 0;
  long aoSum = 0;

  for (int i = 0; i < 5; i++) {
    int dVal = digitalRead(FLAME_DO);
    int aVal = analogRead(FLAME_AO);
    aoSum += aVal;
    bool detected = (dVal == LOW);
    if (detected) flameCount++;
    Serial.printf("    Read %d: DO=%s  AO=%4d (%.2fV)  %s\n",
                  i+1,
                  dVal == LOW ? "LOW " : "HIGH",
                  aVal, (aVal / 4095.0f) * 3.3f,
                  detected ? "FLAME!" : "No flame");
    delay(200);
  }

  int avgAo = aoSum / 5;
  Serial.printf("  AO avg: %d\n", avgAo);

  if (avgAo >= 4090)
    fail("AO=4095 (floating) — check AO wire to GPIO 32");
  else if (avgAo == 0)
    fail("AO=0 — check VCC (3.3V) and GND of flame sensor");
  else
    pass("Flame sensor analog output connected");

  if (flameCount == 5)
    warn("DO=LOW always — check if strong light source is near sensor");
  else if (flameCount == 0)
    pass("DO=HIGH (no flame) — correct in normal environment");
  else
    warn("DO flickering — check for light interference");

  info("Test: briefly hold a lighter near sensor — DO should go LOW");
}

// ============================================================
//  TEST 4 — HC-SR04 Ultrasonic (TRIG=25, ECHO=27)
// ============================================================
void testHCSR04() {
  printDivider("TEST 4: HC-SR04 Ultrasonic (TRIG=25, ECHO=27)");

  Serial.println("  Taking 5 distance readings...");
  int validCount = 0;
  float sum = 0;

  for (int i = 0; i < 5; i++) {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    long dur = pulseIn(ECHO_PIN, HIGH, 30000UL);
    float d = (dur == 0) ? -1.0f : dur * 0.01715f;

    if (d > 2.0f && d < 400.0f) {
      Serial.printf("    Read %d: %.1f cm\n", i+1, d);
      sum += d;
      validCount++;
    } else {
      Serial.printf("    Read %d: TIMEOUT (no object in range 2-400cm)\n", i+1);
    }
    delay(300);
  }

  if (validCount == 0)
    fail("No valid reads — check VCC(5V), GND, TRIG(25), ECHO(27)");
  else if (validCount < 3)
    warn(("Only " + String(validCount) + "/5 valid — loose wire or object out of range").c_str());
  else {
    pass("HC-SR04 returning valid distances");
    Serial.printf("  Valid: %d/5  Avg: %.1f cm\n", validCount, sum/validCount);
  }
}

// ============================================================
//  TEST 5 — MPU6050 (SDA=21, SCL=22)
// ============================================================
void testMPU6050() {
  printDivider("TEST 5: MPU6050 IMU (SDA=21, SCL=22)");

  // I2C scan
  Serial.println("  Scanning I2C bus...");
  bool found = false;
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("    I2C device found at 0x%02X\n", addr);
      if (addr == 0x68 || addr == 0x69) found = true;
    }
  }

  if (!found) {
    fail("No I2C device at 0x68/0x69 — check SDA(21), SCL(22), VCC(3.3V), GND");
    fail("AD0 pin → GND = addr 0x68  |  AD0 → VCC = addr 0x69");
    return;
  }

  mpu.initialize();
  if (!mpu.testConnection()) {
    fail("MPU6050 found on I2C but testConnection() failed");
    return;
  }
  pass("MPU6050 connected and initialized");

  Serial.println("  Reading 5 motion samples...");
  for (int i = 0; i < 5; i++) {
    int16_t ax, ay, az, gx, gy, gz;
    mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);
    // Convert raw to m/s² (±8g range: 1g = 4096 LSB)
    float axG = ax / 4096.0f;
    float ayG = ay / 4096.0f;
    float azG = az / 4096.0f;
    float mag = sqrtf(axG*axG + ayG*ayG + azG*azG);
    Serial.printf("    [%d] ax=%.2fg ay=%.2fg az=%.2fg  |mag|=%.2fg\n",
                  i+1, axG, ayG, azG, mag);
    delay(200);
  }

  int16_t ax, ay, az, gx, gy, gz;
  mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);
  float mag = sqrtf(ax*ax + ay*ay + az*az) / 4096.0f;
  if (mag < 0.5f || mag > 2.0f)
    warn("Magnitude far from 1g — sensor may be tilted or poorly mounted");
  else
    pass("Acceleration magnitude looks realistic (~1g gravity)");
}

// ============================================================
//  TEST 6 — GPS Module (RX2=16, TX2=17)
// ============================================================
void testGPS() {
  printDivider("TEST 6: GPS Module (RX2=16, TX2=17)");

  Serial.println("  Listening for GPS NMEA data for 5 seconds...");
  unsigned long start = millis();
  int byteCount = 0;
  int sentenceCount = 0;

  while (millis() - start < 5000) {
    while (GPSSerial.available()) {
      char c = GPSSerial.read();
      gps.encode(c);
      byteCount++;
      if (c == '\n') sentenceCount++;
    }
  }

  Serial.printf("  Bytes received : %d\n", byteCount);
  Serial.printf("  NMEA sentences : %d\n", sentenceCount);

  if (byteCount == 0) {
    fail("No data from GPS — check TX(16) and VCC(3.3V) connections");
    fail("GPS module TX pin → ESP32 GPIO 16 (RX2)");
    return;
  }

  pass("GPS NMEA data is being received");

  if (gps.location.isValid()) {
    pass("GPS has a fix!");
    Serial.printf("  Lat : %.6f\n", gps.location.lat());
    Serial.printf("  Lon : %.6f\n", gps.location.lng());
    Serial.printf("  Sats: %d\n", gps.satellites.value());
  } else {
    warn("GPS connected but no fix yet — needs clear sky view (1-3 min cold start)");
    Serial.printf("  Satellites seen: %d\n", gps.satellites.value());
    info("Take the GPS outdoors or near a window for satellite fix");
  }
}

// ============================================================
//  TEST 7 — LoRa SX1278 / RA-02 (SS=5, RST=14, DIO0=26)
// ============================================================
void testLoRa() {
  printDivider("TEST 7: LoRa RA-02 (SS=5, RST=14, DIO0=26)");
  Serial.println("  Note: Uses LoRa library (not RadioLib)");

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(433E6)) {
    fail("LoRa.begin() failed — check wiring:");
    fail("  SS→GPIO5  RST→GPIO14  DIO0→GPIO26");
    fail("  SCK→GPIO18  MOSI→GPIO23  MISO→GPIO19");
    fail("  VCC→3.3V (NOT 5V!)  GND→GND");
    return;
  }

  pass("LoRa initialized at 433 MHz");

  // Configure to match sender3 / gateway settings
  LoRa.setSpreadingFactor(11);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(8);
  LoRa.setSyncWord(0x12);
  LoRa.setTxPower(17);
  pass("LoRa configured: SF11 BW125 CR8 Sync=0x12 PWR=17dBm");

  // Send a test packet
  Serial.println("  Sending test packet...");
  LoRa.beginPacket();
  LoRa.print("{\"node\":\"NODE_01\",\"test\":true}");
  if (LoRa.endPacket()) {
    pass("Test packet transmitted successfully");
  } else {
    fail("endPacket() failed — TX error");
  }

  // Listen for 2s for any response
  Serial.println("  Listening for any LoRa packet (2s)...");
  unsigned long listenStart = millis();
  bool gotPacket = false;
  while (millis() - listenStart < 2000) {
    int pktSize = LoRa.parsePacket();
    if (pktSize > 0) {
      String rx = "";
      while (LoRa.available()) rx += (char)LoRa.read();
      Serial.printf("  Received: \"%s\"  RSSI=%d dBm\n", rx.c_str(), LoRa.packetRssi());
      gotPacket = true;
      break;
    }
  }
  if (!gotPacket)
    info("No packet received (no gateway/node nearby — expected)");
}

// ============================================================
//  SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("###########################################");
  Serial.println("#  NODE_01 SENSOR DIAGNOSTIC TEST v1.0  #");
  Serial.println("###########################################");
  Serial.println("  Starting in 2 seconds...");
  delay(2000);

  // Pin modes
  pinMode(FLAME_DO, INPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  Wire.begin(21, 22);
  GPSSerial.begin(9600, SERIAL_8N1, 16, 17);
  SPI.begin();

  // Run all tests
  testMQ1();       delay(400);
  testMQ2();       delay(400);
  testFlame();     delay(400);
  testHCSR04();    delay(400);
  testMPU6050();   delay(400);
  testGPS();       delay(400);
  testLoRa();      delay(400);

  // Summary
  printDivider("ALL TESTS COMPLETE");
  Serial.println("  Fix any [FAIL] items above, then flash sender1.ino");
  Serial.println("  Switching to LIVE mode (updates every 2s)...");
  Serial.println("============================================");
}

// ============================================================
//  LOOP — Live reading mode
// ============================================================
void loop() {
  // Feed GPS
  while (GPSSerial.available()) gps.encode(GPSSerial.read());

  // Read all sensors
  int mq1   = analogRead(MQ1_PIN);
  int mq2   = analogRead(MQ2_PIN);
  int flDo  = digitalRead(FLAME_DO);
  int flAo  = analogRead(FLAME_AO);

  // Ultrasonic
  digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long dur  = pulseIn(ECHO_PIN, HIGH, 30000UL);
  float d   = (dur == 0) ? -1.0f : dur * 0.01715f;

  // MPU6050
  int16_t ax, ay, az, gx, gy, gz;
  mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);
  float mag = sqrtf(ax*ax + ay*ay + az*az) / 4096.0f;

  // GPS
  String gpsStr = "No fix";
  if (gps.location.isValid())
    gpsStr = "Lat=" + String(gps.location.lat(), 5) +
             " Lon=" + String(gps.location.lng(), 5);

  // Print live line
  Serial.printf("[LIVE] MQ1:%4d MQ2:%4d Flame:%s(%4d) Dist:",
                mq1, mq2,
                (flDo == LOW ? "YES" : "no "), flAo);
  if (d > 0) Serial.printf("%.1fcm", d);
  else        Serial.print("---");
  Serial.printf(" Vib:%.2fg GPS:%s\n", mag, gpsStr.c_str());

  delay(2000);
}
