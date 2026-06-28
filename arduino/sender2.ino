/*
 * ============================================================
 *  Smart Factory — LoRa Sender NODE_02
 *  Structure:  sender3.ino (working base)
 *  Sensors:    Raw ADC from continuous_reading.ino (no PPM)
 *  Anti-stuck: radio.standby() after every receive()
 *              + ESP32 hardware watchdog (15 s auto-reset)
 * ============================================================
 *
 *  PIN CONNECTIONS (ESP32):
 *    MQ2  AOUT  → GPIO 32   (Analog, raw ADC 0-4095)
 *    MQ135 AOUT → GPIO 33   (Analog, raw ADC 0-4095)
 *    Flame  DO  → GPIO 26   (LOW = flame detected)
 *    HC-SR04 TRIG → GPIO 27 | ECHO → GPIO 25
 *    MPU6050 SDA → GPIO 21  | SCL  → GPIO 22  (I2C)
 *    SX1278  CS  → GPIO 5   | DIO0 → GPIO 2   | RST → GPIO 4
 *    GPS     RX2 → GPIO 16  | TX2  → GPIO 17  (set HAS_GPS 1)
 * ============================================================
 */

#include <ArduinoJson.h>
#include <Wire.h>
#include <RadioLib.h>
#include <SPI.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <esp_task_wdt.h>          // ESP32 hardware watchdog

#define HAS_GPS 0
#if HAS_GPS
  #include <TinyGPSPlus.h>
  TinyGPSPlus gps;
  HardwareSerial GPSSerial(2);
#endif

// ================= CONFIG =================
#define NODE_ID       "NODE_02"
#define GATEWAY_ID    "GATEWAY_01"

#define SMOKE_PIN     32   // MQ2  AOUT
#define GAS_PIN       33   // MQ135 AOUT
#define FLAME_PIN     26   // Flame DO (LOW = flame)
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

#define ADC_MAX            4095.0
#define ACK_TIMEOUT_MS     800
#define MAX_RETRIES        3
#define TX_INTERVAL_MS     2000
#define WDT_TIMEOUT_SEC    15     // watchdog: auto-reset if stuck >15 s

// ================= GLOBALS =================
SX1278 radio = new Module(LORA_CS, LORA_DIO0, LORA_RST);
Adafruit_MPU6050 mpu;

bool  loraOk = false;
bool  mpuOk  = false;

unsigned long seq          = 0;
unsigned long lastTxAt     = 0;
bool hasPendingPayload     = false;
String pendingPayload      = "";
unsigned long pendingSeq   = 0;
int pendingRetries         = 0;

unsigned long ackedTotal   = 0;
unsigned long droppedTotal = 0;
unsigned long ackTimeouts  = 0;
unsigned long txAttempts   = 0;

float lastValidDistanceCm  = 0.0;

// ================= SENSOR HELPERS =================

// ADC raw → voltage (ESP32 3.3V ref)
float adcToVoltage(int adcVal) {
  return (adcVal / ADC_MAX) * 3.3f;
}

// HC-SR04 single reading
float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long dur = pulseIn(ECHO_PIN, HIGH, 30000UL);  // 30 ms timeout
  if (dur == 0) return -1.0f;
  float d = dur * 0.01715f;
  return (d < 2.0f || d > 400.0f) ? -1.0f : d;
}

// Averaged distance — fallback to last valid value if all reads timeout
float readStableDistance() {
  float sum = 0; int cnt = 0;
  for (int i = 0; i < 5; i++) {
    float d = readDistanceCm();
    if (d > 0) { sum += d; cnt++; }
    delay(20);
  }
  if (cnt > 0) lastValidDistanceCm = sum / cnt;
  return lastValidDistanceCm;
}

// MPU6050 accel magnitude + raw axes
float readVibMagnitude(float &ax_out, float &ay_out, float &az_out) {
  if (!mpuOk) { ax_out = ay_out = az_out = 0; return 0; }
  sensors_event_t a, g, t;
  if (!mpu.getEvent(&a, &g, &t)) { ax_out = ay_out = az_out = 0; return 0; }
  ax_out = a.acceleration.x;
  ay_out = a.acceleration.y;
  az_out = a.acceleration.z;
  return sqrtf(ax_out*ax_out + ay_out*ay_out + az_out*az_out);
}

// ================= LORA ACK/TX =================
// Uses blocking radio.receive() — reliable on SX127x.
// radio.standby() BEFORE tx and AFTER receive prevents the radio from
// getting stuck in RX mode and causing 100+ second hangs.
// The ESP32 watchdog (WDT_TIMEOUT_SEC) auto-resets if anything hangs anyway.
bool sendWithAck(const String& payload, int &retryCount) {
  retryCount = 0;
  for (int attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    txAttempts++;
    String txPayload = payload;  // transmit() needs non-const String&

    radio.standby();   // always start from known idle state
    delay(2);

    int txState = radio.transmit(txPayload);
    if (txState != RADIOLIB_ERR_NONE) {
      Serial.printf("[NODE_02] TX fail code=%d\n", txState);
      radio.standby();
      delay(200);
      continue;
    }

    String ack;
    int rxState = radio.receive(ack, ACK_TIMEOUT_MS);
    radio.standby();   // CRITICAL: force idle after receive() — prevents stuck RX

    if (rxState == RADIOLIB_ERR_NONE && ack.startsWith("ACK:")) {
      // Strip trailing non-printable FIFO noise
      for (int i = 0; i < (int)ack.length(); i++) {
        if (!(ack[i] >= 32 && ack[i] <= 126)) { ack = ack.substring(0, i); break; }
      }
      Serial.printf("[NODE_02] ACK OK (attempt %d): %s\n", attempt+1, ack.c_str());
      ackedTotal++;
      return true;
    }

    ackTimeouts++;
    retryCount = attempt + 1;
    Serial.printf("[NODE_02] ACK timeout attempt %d/%d\n", attempt+1, MAX_RETRIES+1);
    delay(200 + attempt * 100);
  }
  droppedTotal++;
  return false;
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== NODE_02 STARTING ===");

  // ---- Watchdog: auto-reset if loop() hangs for >15 s ----
  // ESP32 Arduino core v3.x uses esp_task_wdt_config_t struct
  esp_task_wdt_config_t wdt_cfg = {
    .timeout_ms    = WDT_TIMEOUT_SEC * 1000,
    .idle_core_mask = 0,
    .trigger_panic  = true    // hard reset on timeout
  };
  esp_task_wdt_reconfigure(&wdt_cfg);   // reconfigure (already inited by IDF)
  esp_task_wdt_add(NULL);               // watch the main Arduino task
  Serial.printf("[NODE_02] Watchdog armed: %d s\n", WDT_TIMEOUT_SEC);

  Wire.begin(21, 22);   // SDA=21, SCL=22

  pinMode(SMOKE_PIN, INPUT);
  pinMode(GAS_PIN,   INPUT);
  pinMode(FLAME_PIN, INPUT);
  pinMode(TRIG_PIN,  OUTPUT);
  pinMode(ECHO_PIN,  INPUT);
  digitalWrite(TRIG_PIN, LOW);

  if (mpu.begin()) {
    mpuOk = true;
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    Serial.println("[NODE_02] MPU6050 OK");
  } else {
    Serial.println("[NODE_02] MPU6050 not found — vib=0");
  }

#if HAS_GPS
  GPSSerial.begin(9600, SERIAL_8N1, 16, 17);
  Serial.println("[NODE_02] GPS serial started");
#endif

  SPI.begin();
  int state = radio.begin(LORA_FREQ, LORA_BW_KHZ, LORA_SF, LORA_CR,
                          LORA_SYNC, LORA_POWER, LORA_PREAMBLE);
  if (state == RADIOLIB_ERR_NONE) {
    loraOk = true;
    Serial.println("[NODE_02] LoRa SX1278 OK @ 433 MHz");
  } else {
    Serial.printf("[NODE_02] LoRa FAIL code=%d\n", state);
  }

  for (int i = 0; i < 3; i++) { readStableDistance(); delay(50); }

  Serial.println("[NODE_02] Sensor: RAW ADC (no PPM) — same as continuous_reading.ino");
  Serial.println("[NODE_02] Ready — transmitting every 2 s");
  Serial.println("--------------------------------------------------------------------");
}

// ================= LOOP =================
void loop() {
  esp_task_wdt_reset();   // feed watchdog at top of every loop — proves we're not stuck

#if HAS_GPS
  while (GPSSerial.available()) gps.encode(GPSSerial.read());
#endif

  // ---- Retry pending unACKed packet first ----
  if (hasPendingPayload && loraOk) {
    Serial.printf("[NODE_02] Retrying pending seq=%lu\n", pendingSeq);
    int rc = 0;
    if (sendWithAck(pendingPayload, rc)) {
      Serial.println("[NODE_02] Pending packet ACKed");
      hasPendingPayload = false;
      pendingPayload    = "";
      pendingRetries    = 0;
      pendingSeq        = 0;
    } else {
      pendingRetries++;
      if (pendingRetries >= 5) {
        Serial.println("[NODE_02] Dropping stale packet after 5 retries");
        hasPendingPayload = false;
        pendingRetries    = 0;
      }
    }
    return;
  }

  if (millis() - lastTxAt < TX_INTERVAL_MS) { delay(50); return; }
  lastTxAt = millis();
  seq++;

  // ---- READ ALL SENSORS (continuous_reading.ino style) ----
  int   smokeRaw = analogRead(SMOKE_PIN);    // MQ2  raw ADC 0–4095
  int   gasRaw   = analogRead(GAS_PIN);       // MQ135 raw ADC 0–4095
  float smokeV   = adcToVoltage(smokeRaw);
  float gasV     = adcToVoltage(gasRaw);
  int   flame    = (digitalRead(FLAME_PIN) == LOW) ? 1 : 0;
  float distCm   = readStableDistance();
  float ax = 0, ay = 0, az = 0;
  float vib      = readVibMagnitude(ax, ay, az);
  vib            = roundf(vib * 100) / 100.0f;
  float accelMag = sqrtf(ax*ax + ay*ay + az*az);

  // Anomaly: raw ADC thresholds (smoke >2000 ADC, gas >1800 ADC)
  bool anomaly = (vib > 9.5f) || (flame == 1) || (smokeRaw > 2000) || (gasRaw > 1800);

#if HAS_GPS
  float lat = gps.location.isValid() ? gps.location.lat() : 0.0f;
  float lon = gps.location.isValid() ? gps.location.lng() : 0.0f;
#else
  float lat = 0.0f, lon = 0.0f;
#endif

  // ---- SERIAL — same format as continuous_reading.ino ----
  Serial.printf("[%lu ms] MQ2: %4d (%.2fV) | MQ135: %4d (%.2fV) | Flame: %s | Dist: ",
                millis(), smokeRaw, smokeV, gasRaw, gasV,
                flame ? "YES (FLAME!)" : "NO          ");
  if (distCm > 0) Serial.printf("%5.1f cm | ", distCm);
  else            Serial.print("  --- cm | ");
  Serial.printf("Accel Mag: %5.2f m/s^2 (X:%5.2f Y:%5.2f Z:%5.2f)\n",
                accelMag, ax, ay, az);

  // ---- BUILD JSON PAYLOAD (keep ≤250 bytes for SX1278) ----
  StaticJsonDocument<256> doc;
  doc["node_id"]    = NODE_ID;
  doc["gateway_id"] = GATEWAY_ID;
  doc["seq"]        = seq;
  doc["ts"]         = millis();
  doc["smoke"]      = smokeRaw;
  doc["gas"]        = gasRaw;
  doc["flame"]      = flame;
  doc["dist"]       = (distCm <= 0) ? 0 : (int)distCm;
  doc["vib"]        = vib;
  doc["ax"]         = roundf(ax * 100) / 100.0f;
  doc["ay"]         = roundf(ay * 100) / 100.0f;
  doc["az"]         = roundf(az * 100) / 100.0f;
  doc["lat"]        = lat;
  doc["lon"]        = lon;
  doc["anomaly"]    = anomaly ? 1 : 0;
  doc["retx"]       = false;
  doc["retx_seq"]   = 0;

  String payload;
  serializeJson(doc, payload);

  Serial.printf("[NODE_02] TX (%u B): %s\n", payload.length(), payload.c_str());
  Serial.printf("[NODE_02] Stats: acked=%lu dropped=%lu timeouts=%lu attempts=%lu\n",
                ackedTotal, droppedTotal, ackTimeouts, txAttempts);

  if (payload.length() > 250) {
    Serial.println("[NODE_02] ERROR: payload too large — skipping TX");
    return;
  }

  if (loraOk) {
    int retryCount = 0;
    bool delivered = sendWithAck(payload, retryCount);
    if (!delivered) {
      doc["retx"]     = true;
      doc["retx_seq"] = seq;
      String retryPayload;
      serializeJson(doc, retryPayload);
      hasPendingPayload = true;
      pendingPayload    = retryPayload;
      pendingSeq        = seq;
      pendingRetries    = 0;
      Serial.printf("[NODE_02] TX failed — queued for retry seq=%lu\n", seq);
    } else {
      Serial.printf("[NODE_02] Delivered seq=%lu\n", seq);
    }
  }
}
