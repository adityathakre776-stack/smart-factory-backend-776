/*
 * ============================================================
 *  NODE_03 — FULL SENSOR DIAGNOSTIC TEST
 *  Tests: MQ2 | MQ135 | Flame | HC-SR04 | MPU6050
 *
 *  HOW TO USE:
 *    1. Flash this sketch to your NODE_03 ESP32
 *    2. Open Serial Monitor at 115200 baud
 *    3. Each sensor is tested one by one
 *    4. Check PASS / FAIL / WARNING for each
 *
 *  NOTE: Do NOT have sender3.ino open at the same time.
 *        This is a standalone test only.
 * ============================================================
 */

#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

// ============ PIN DEFINITIONS (same as sender3) ============
#define SMOKE_PIN   32   // MQ2  AOUT
#define GAS_PIN     33   // MQ135 AOUT
#define FLAME_PIN   26   // Flame sensor DO (LOW = flame)
#define TRIG_PIN    27   // HC-SR04 TRIG
#define ECHO_PIN    25   // HC-SR04 ECHO
#define ADC_MAX     4095.0
#define RL_VALUE    10.0

// ============================================================
Adafruit_MPU6050 mpu;

// ---- helpers -----------------------------------------------
void printDivider(const char* title) {
  Serial.println();
  Serial.println("============================================");
  Serial.printf("  %s\n", title);
  Serial.println("============================================");
}

void pass(const char* msg) {
  Serial.printf("  [PASS] %s\n", msg);
}

void fail(const char* msg) {
  Serial.printf("  [FAIL] %s\n", msg);
}

void warn(const char* msg) {
  Serial.printf("  [WARN] %s\n", msg);
}

void info(const char* msg) {
  Serial.printf("  [INFO] %s\n", msg);
}

// ---- resistance from ADC -----------------------------------
float calcResistance(int adcVal) {
  float voltage = (adcVal / ADC_MAX) * 3.3f;
  if (voltage <= 0.01f) return 999.0f;
  return (3.3f - voltage) * RL_VALUE / voltage;
}

// ============================================================
//  TEST 1 — MQ2 Smoke Sensor
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

  if (avg > 100 && avg < 4000) {
    float R0 = res / 9.83f;   // typical clean-air ratio
    Serial.printf("  Est R0  : %.2f (use this after 60s warm-up)\n", R0);
  }
}

// ============================================================
//  TEST 2 — MQ135 Gas Sensor
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
//  TEST 3 — Flame Sensor
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
//  TEST 4 — HC-SR04 Ultrasonic Distance
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
//  TEST 5 — MPU6050 Accelerometer / Gyroscope
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
  Serial.println();
  Serial.println("  Once all pass, flash sender3.ino for LoRa operation.");
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
  Serial.println("#   NODE_03 SENSOR DIAGNOSTIC TEST v1.0   #");
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
  printSummary();
}

void loop() {
  // Live reading mode — prints all sensors every 2 seconds after test
  int smokeAdc = analogRead(SMOKE_PIN);
  int gasAdc   = analogRead(GAS_PIN);
  int flame    = (digitalRead(FLAME_PIN) == LOW) ? 1 : 0;
  float dist   = readDistanceCm();

  Serial.printf("[LIVE] Smoke:%4d  Gas:%4d  Flame:%d  Dist:", smokeAdc, gasAdc, flame);
  if (dist > 0) Serial.printf("%.1fcm\n", dist);
  else          Serial.println("---");

  delay(2000);
}
