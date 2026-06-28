/*
 * ============================================================
 *  NODE_02 — FULL SENSOR DIAGNOSTIC TEST
 *  Tests: MQ2 | MQ135 | Flame | HC-SR04 | MPU6050 | GPS | LoRa (RadioLib)
 *
 *  HOW TO USE:
 *    1. Flash this sketch to your NODE_02 ESP32
 *    2. Open Serial Monitor at 115200 baud
 *    3. Each sensor is tested one by one
 *    4. Check PASS / FAIL / WARNING for each
 * ============================================================
 *
 *  PIN MAP (same as sender2.ino):
 *    MQ2 AOUT     → GPIO 32
 *    MQ135 AOUT   → GPIO 33
 *    Flame DO     → GPIO 26  (LOW = flame detected)
 *    HC-SR04 TRIG → GPIO 27
 *    HC-SR04 ECHO → GPIO 25
 *    MPU6050 SDA  → GPIO 21
 *    MPU6050 SCL  → GPIO 22
 *    LoRa CS (SS) → GPIO 5
 *    LoRa DIO0    → GPIO 2
 *    LoRa RST     → GPIO 4
 *    GPS RX2      → GPIO 16 (if HAS_GPS = 1)
 *    GPS TX2      → GPIO 17 (if HAS_GPS = 1)
 * ============================================================
 */

#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <RadioLib.h>
#include <SPI.h>

#define HAS_GPS 0
#if HAS_GPS
  #include <TinyGPSPlus.h>
  TinyGPSPlus gps;
  HardwareSerial GPSSerial(2); // RX2=16, TX2=17
#endif

// ============ PIN DEFINITIONS ============
#define SMOKE_PIN     32   // MQ2 AOUT
#define GAS_PIN       33   // MQ135 AOUT
#define FLAME_PIN     26   // Flame digital (LOW = flame)
#define TRIG_PIN      27   // HC-SR04 TRIG
#define ECHO_PIN      25   // HC-SR04 ECHO

#define LORA_CS       5
#define LORA_DIO0     2
#define LORA_RST      4
#define LORA_FREQ     433.0
#define LORA_BW_KHZ   125.0f
#define LORA_SF       11
#define LORA_CR       8
#define LORA_SYNC     0x12
#define LORA_POWER    17
#define LORA_PREAMBLE 8

#define ADC_MAX       4095.0
#define RL_VALUE      10.0

// ============================================================
Adafruit_MPU6050 mpu;
SX1278 radio = new Module(LORA_CS, LORA_DIO0, LORA_RST);

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

// ---- resistance from ADC -----------------------------------
float calcResistance(int adcVal) {
  float voltage = (adcVal / ADC_MAX) * 3.3f;
  if (voltage <= 0.01f) return 999.0f;
  return (3.3f - voltage) * RL_VALUE / voltage;
}

// ============================================================
//  TEST 1 — MQ2 Smoke Sensor (GPIO 32)
// ============================================================
void testMQ2() {
  printDivider("TEST 1: MQ2 Smoke Sensor (GPIO 32)");

  int samples[10];
  int minVal = 4095, maxVal = 0;
  long sum = 0;

  Serial.println("  Reading 10 samples...");
  for (int i = 0; i < 10; i++) {
    samples[i] = analogRead(SMOKE_PIN);
    sum += samples[i];
    if (samples[i] < minVal) minVal = samples[i];
    if (samples[i] > maxVal) maxVal = samples[i];
    Serial.printf("    Sample %2d: %4d  (%.2fV)\n",
                  i + 1, samples[i], (samples[i] / ADC_MAX) * 3.3f);
    delay(100);
  }

  int avg = sum / 10;
  float res = calcResistance(avg);
  Serial.printf("  Avg ADC : %d\n", avg);
  Serial.printf("  Avg V   : %.3fV\n", (avg / ADC_MAX) * 3.3f);
  Serial.printf("  Rs (Ω)  : %.2f\n", res);
  Serial.printf("  Spread  : %d (min=%d max=%d)\n", maxVal - minVal, minVal, maxVal);

  if (avg == 0) {
    fail("ADC reads 0 — MQ2 not connected or VCC missing");
  } else if (avg < 100) {
    fail("ADC very low (<100) — check VCC (needs 5V) and AOUT wire");
  } else if (avg > 4000) {
    warn("ADC near max (>4000) — sensor may still be cold, or fault");
  } else if (maxVal - minVal > 500) {
    warn("Large spread between samples — loose wire or unstable power");
  } else {
    pass("MQ2 responding with stable readings");
  }
}

// ============================================================
//  TEST 2 — MQ135 Gas Sensor (GPIO 33)
// ============================================================
void testMQ135() {
  printDivider("TEST 2: MQ135 Gas Sensor (GPIO 33)");

  int samples[10];
  int minVal = 4095, maxVal = 0;
  long sum = 0;

  Serial.println("  Reading 10 samples...");
  for (int i = 0; i < 10; i++) {
    samples[i] = analogRead(GAS_PIN);
    sum += samples[i];
    if (samples[i] < minVal) minVal = samples[i];
    if (samples[i] > maxVal) maxVal = samples[i];
    Serial.printf("    Sample %2d: %4d  (%.2fV)\n",
                  i + 1, samples[i], (samples[i] / ADC_MAX) * 3.3f);
    delay(100);
  }

  int avg = sum / 10;
  float res = calcResistance(avg);
  Serial.printf("  Avg ADC : %d\n", avg);
  Serial.printf("  Avg V   : %.3fV\n", (avg / ADC_MAX) * 3.3f);
  Serial.printf("  Rs (Ω)  : %.2f\n", res);

  if (avg == 0) {
    fail("ADC reads 0 — MQ135 not connected or VCC missing");
  } else if (avg < 100) {
    fail("ADC very low (<100) — check VCC (needs 5V) and AOUT wire");
  } else if (avg > 4000) {
    warn("ADC near max (>4000) — sensor cold or not fully warmed up");
  } else {
    pass("MQ135 responding with readings");
  }
}

// ============================================================
//  TEST 3 — Flame Sensor (GPIO 26)
// ============================================================
void testFlame() {
  printDivider("TEST 3: Flame Sensor (GPIO 26)");

  Serial.println("  Reading digital output 5 times...");
  int flameCount = 0;
  for (int i = 0; i < 5; i++) {
    int val = digitalRead(FLAME_PIN);
    bool detected = (val == LOW);
    Serial.printf("    Read %d: %s (%s)\n",
                  i + 1,
                  val == LOW ? "LOW" : "HIGH",
                  detected ? "FLAME DETECTED!" : "No flame");
    if (detected) flameCount++;
    delay(200);
  }

  if (flameCount == 5) {
    warn("Flame detected on ALL reads — sensor may be faulty or pointed at light source");
  } else if (flameCount == 0) {
    pass("Flame sensor reading HIGH (no flame) — normal in clean environment");
    info("Point a lighter near sensor briefly to test — should flip to LOW");
  } else {
    warn("Mixed readings — possible interference or flickering light source");
  }
}

// ============================================================
//  TEST 4 — HC-SR04 Ultrasonic (TRIG=27, ECHO=25)
// ============================================================
float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long dur = pulseIn(ECHO_PIN, HIGH, 30000UL);
  if (dur == 0) return -1.0f;
  float d = dur * 0.01715f;
  return (d < 2.0f || d > 400.0f) ? -1.0f : d;
}

void testHCSR04() {
  printDivider("TEST 4: HC-SR04 Ultrasonic (TRIG=27, ECHO=25)");

  Serial.println("  Taking 5 distance readings...");
  int validCount = 0;
  float sum = 0;

  for (int i = 0; i < 5; i++) {
    float d = readDistanceCm();
    if (d > 0) {
      Serial.printf("    Read %d: %.1f cm\n", i + 1, d);
      sum += d;
      validCount++;
    } else {
      Serial.printf("    Read %d: TIMEOUT (no echo — out of range or not connected)\n", i + 1);
    }
    delay(300);
  }

  if (validCount == 0) {
    fail("No valid readings — check VCC(5V), GND, TRIG(27), ECHO(25) wiring");
  } else if (validCount < 3) {
    warn("Some reads timed out — object may be too close/far, or loose wire");
    Serial.printf("  Valid reads: %d/5  Avg: %.1f cm\n", validCount, sum / validCount);
  } else {
    pass("HC-SR04 returning valid distances");
    Serial.printf("  Valid reads: %d/5  Avg: %.1f cm\n", validCount, sum / validCount);
  }
}

// ============================================================
//  TEST 5 — MPU6050 Accelerometer / Gyroscope (SDA=21, SCL=22)
// ============================================================
void testMPU6050() {
  printDivider("TEST 5: MPU6050 IMU (SDA=21, SCL=22)");

  // I2C scan first
  Serial.println("  Scanning I2C bus...");
  bool found0x68 = false, found0x69 = false;
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("    Found I2C device at 0x%02X\n", addr);
      if (addr == 0x68) found0x68 = true;
      if (addr == 0x69) found0x69 = true;
    }
  }

  if (!found0x68 && !found0x69) {
    fail("No I2C device found — check SDA(21), SCL(22), VCC(3.3V), GND");
    fail("MPU6050 AD0=GND → 0x68  |  AD0=VCC → 0x69");
    return;
  }

  if (found0x68) pass("MPU6050 found at 0x68 (AD0 = GND)");
  if (found0x69) pass("MPU6050 found at 0x69 (AD0 = VCC)");

  // Try to init
  if (!mpu.begin()) {
    fail("mpu.begin() failed — device found on I2C but init failed");
    return;
  }

  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  pass("MPU6050 initialized OK");

  Serial.println("  Reading 5 accelerometer samples...");
  for (int i = 0; i < 5; i++) {
    sensors_event_t a, g, t;
    mpu.getEvent(&a, &g, &t);
    float mag = sqrtf(a.acceleration.x * a.acceleration.x +
                      a.acceleration.y * a.acceleration.y +
                      a.acceleration.z * a.acceleration.z);
    Serial.printf("    [%d] ax=%.2f ay=%.2f az=%.2f  |mag|=%.2f  temp=%.1f°C\n",
                  i + 1,
                  a.acceleration.x, a.acceleration.y, a.acceleration.z,
                  mag, t.temperature);
    delay(200);
  }

  // Sanity check — stationary magnitude should be ~9.8 m/s²
  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);
  float mag = sqrtf(a.acceleration.x * a.acceleration.x +
                    a.acceleration.y * a.acceleration.y +
                    a.acceleration.z * a.acceleration.z);
  if (mag < 5.0f || mag > 15.0f) {
    warn("Magnitude far from 9.8 m/s² — check if sensor is flat and stable");
  } else {
    pass("Acceleration magnitude looks realistic (close to 9.8 m/s² gravity)");
  }
}

// ============================================================
//  TEST 6 — GPS Module (RX2=16, TX2=17)
// ============================================================
void testGPS() {
  printDivider("TEST 6: GPS Module (RX2=16, TX2=17)");

#if !HAS_GPS
  info("GPS testing is disabled in config. Set HAS_GPS to 1 to test GPS.");
  return;
#else
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
#endif
}

// ============================================================
//  TEST 7 — LoRa SX1278 (SS=5, DIO0=2, RST=4)
// ============================================================
void testLoRa() {
  printDivider("TEST 7: LoRa SX1278 (SS=5, DIO0=2, RST=4)");
  Serial.println("  Note: Uses RadioLib (same as sender2.ino)");

  int state = radio.begin(LORA_FREQ, LORA_BW_KHZ, LORA_SF, LORA_CR,
                          LORA_SYNC, LORA_POWER, LORA_PREAMBLE);

  if (state != RADIOLIB_ERR_NONE) {
    fail("radio.begin() failed — check wiring:");
    Serial.printf("  Error code: %d\n", state);
    fail("  SS (CS) → GPIO 5  |  DIO0 → GPIO 2  |  RST → GPIO 4");
    fail("  SCK → GPIO 18     |  MOSI → GPIO 23  |  MISO → GPIO 19");
    fail("  VCC → 3.3V (NOT 5V!)  |  GND → GND");
    return;
  }

  pass("LoRa SX1278 initialized at 433 MHz");
  pass("LoRa configured: SF11 BW125 CR8 Sync=0x12 PWR=17dBm");

  // Send a test packet
  Serial.println("  Sending test packet...");
  String txPayload = "{\"node_id\":\"NODE_02\",\"test\":true}";
  int txState = radio.transmit(txPayload);
  if (txState == RADIOLIB_ERR_NONE) {
    pass("Test packet transmitted successfully");
  } else {
    fail("radio.transmit() failed — TX error");
    Serial.printf("  Error code: %d\n", txState);
    return;
  }

  // Listen for 2s for any response/ACK
  Serial.println("  Listening for any LoRa packet/ACK (2s)...");
  String rxPayload;
  int rxState = radio.receive(rxPayload, 2000);
  if (rxState == RADIOLIB_ERR_NONE) {
    Serial.printf("  Received response: \"%s\"\n", rxPayload.c_str());
    pass("Successfully received LoRa signal!");
  } else if (rxState == RADIOLIB_ERR_RX_TIMEOUT) {
    info("Receive timeout (no gateway or node nearby to reply — expected)");
  } else {
    warn("LoRa receive error occurred");
    Serial.printf("  Error code: %d\n", rxState);
  }
}

// ============================================================
//  SUMMARY
// ============================================================
void printSummary() {
  printDivider("SENSOR TEST COMPLETE");
  Serial.println("  Re-check any [FAIL] items above.");
  Serial.println("  [WARN] items are worth investigating.");
  Serial.println("  [PASS] items are working correctly.");
  Serial.println();
  Serial.println("  Common fixes:");
  Serial.println("   MQ2/MQ135  — need 5V VCC, not 3.3V");
  Serial.println("   HC-SR04    — needs 5V VCC; ECHO is 5V tolerant on GPIO25");
  Serial.println("   MPU6050    — needs 3.3V VCC; AD0 pin → GND for addr 0x68");
  Serial.println("   Flame      — 3.3V VCC; DO goes LOW when flame detected");
  Serial.println("   LoRa SX1278— needs 3.3V VCC (highly sensitive to current drops)");
  Serial.println();
  Serial.println("  Once all pass, flash sender2.ino for normal LoRa operation.");
  Serial.println("============================================");
}

// ============================================================
//  SETUP & LOOP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("############################################");
  Serial.println("#   NODE_02 SENSOR DIAGNOSTIC TEST v1.0   #");
  Serial.println("############################################");
  Serial.println("  Starting tests in 2 seconds...");
  delay(2000);

  // Pin modes
  pinMode(SMOKE_PIN, INPUT);
  pinMode(GAS_PIN,   INPUT);
  pinMode(FLAME_PIN, INPUT);
  pinMode(TRIG_PIN,  OUTPUT);
  pinMode(ECHO_PIN,  INPUT);
  digitalWrite(TRIG_PIN, LOW);

  Wire.begin();
#if HAS_GPS
  GPSSerial.begin(9600, SERIAL_8N1, 16, 17);
#endif
  SPI.begin();

  // Run all tests
  testMQ2();
  delay(500);
  testMQ135();
  delay(500);
  testFlame();
  delay(500);
  testHCSR04();
  delay(500);
  testMPU6050();
  delay(500);
  testGPS();
  delay(500);
  testLoRa();
  delay(500);
  printSummary();
}

void loop() {
  // Live reading mode — prints all sensors every 2 seconds after diagnostic
  int smokeAdc = analogRead(SMOKE_PIN);
  int gasAdc   = analogRead(GAS_PIN);
  int flame    = (digitalRead(FLAME_PIN) == LOW) ? 1 : 0;
  float dist   = readDistanceCm();
  
  float ax = 0, ay = 0, az = 0;
  sensors_event_t a, g, t;
  float mag = 0;
  if (mpu.getEvent(&a, &g, &t)) {
    ax = a.acceleration.x;
    ay = a.acceleration.y;
    az = a.acceleration.z;
    mag = sqrtf(ax*ax + ay*ay + az*az);
  }

  Serial.printf("[LIVE] Smoke:%4d  Gas:%4d  Flame:%d  Vib:%.2f  Dist:", smokeAdc, gasAdc, flame, mag);
  if (dist > 0) Serial.printf("%.1fcm\n", dist);
  else          Serial.println("---");

  delay(2000);
}
