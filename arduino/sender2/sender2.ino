/*
 * ============================================================
 *  Smart Factory — LoRa Sender NODE_02
 *  Board  : ESP32 DevKit
 *  Radio  : SX1278 @ 433 MHz
 *
 *  PIN CONNECTIONS:
 *  ┌──────────────┬──────────┬──────────────────┐
 *  │ Component    │ Pin      │ ESP32 GPIO        │
 *  ├──────────────┼──────────┼──────────────────┤
 *  │ MQ2  Smoke   │ AOUT     │ GPIO 34 (analog)  │
 *  │ MQ135 Gas    │ AOUT     │ GPIO 35 (analog)  │
 *  │ Flame Sensor │ DO       │ GPIO 33 (digital) │
 *  │ Flame Sensor │ AO       │ GPIO 32 (analog)  │
 *  │ HC-SR04      │ TRIG     │ GPIO 25           │
 *  │ HC-SR04      │ ECHO     │ GPIO 27           │
 *  │ MPU6050      │ SDA      │ GPIO 21           │
 *  │ MPU6050      │ SCL      │ GPIO 22           │
 *  │ MPU6050      │ VCC      │ 3.3V              │
 *  │ MPU6050      │ GND      │ GND               │
 *  │ MPU6050      │ AD0      │ GND (addr=0x68)   │
 *  │ SX1278 LoRa  │ NSS/CS   │ GPIO 5            │
 *  │ SX1278 LoRa  │ DIO0     │ GPIO 26           │
 *  │ SX1278 LoRa  │ RST      │ GPIO 14           │
 *  │ SX1278 LoRa  │ SCK      │ GPIO 18           │
 *  │ SX1278 LoRa  │ MISO     │ GPIO 19           │
 *  │ SX1278 LoRa  │ MOSI     │ GPIO 23           │
 *  │ SX1278 LoRa  │ VCC      │ 3.3V              │
 *  └──────────────┴──────────┴──────────────────┘
 *
 *  TX STAGGER: NODE_02 = 667 ms offset
 *  NODE_01=0ms | NODE_02=667ms | NODE_03=1333ms
 *  → with SF7 (~300ms air time), 667ms gap = no collision
 * ============================================================
 */

#include <ArduinoJson.h>
#include <Wire.h>
#include <RadioLib.h>
#include <SPI.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <esp_task_wdt.h>

#define HAS_GPS 0
#if HAS_GPS
  #include <TinyGPSPlus.h>
  TinyGPSPlus gps;
  HardwareSerial GPSSerial(2);
#endif

// ================= NODE CONFIG =================
#define NODE_ID        "NODE_02"
#define GATEWAY_ID     "GATEWAY_01"

#define TX_STAGGER_MS  667UL      // NODE_02 waits 667ms before first TX
#define TX_INTERVAL_MS 2000UL     // 2 s between packets

// ================= SENSOR PINS =================
#define SMOKE_PIN    34    // MQ2   AOUT → GPIO 34 (INPUT-ONLY ADC)
#define GAS_PIN      35    // MQ135 AOUT → GPIO 35 (INPUT-ONLY ADC)
#define FLAME_PIN    33    // Flame DO   → GPIO 33 (LOW = flame)
#define TRIG_PIN     25    // HC-SR04 TRIG
#define ECHO_PIN     27    // HC-SR04 ECHO

// ================= LORA PINS =================
#define LORA_SS      5
#define LORA_DIO0    26
#define LORA_RST     14
// SPI: SCK=18, MISO=19, MOSI=23

// ================= LORA RF CONFIG =================
// SF7 = ~300ms air time → safe with 667ms stagger between 3 nodes
// ALL nodes + gateway MUST use identical settings
#define LORA_FREQ      433.0
#define LORA_BW_KHZ    125.0f
#define LORA_SF        7        // SF7: fast, ~300ms air time for factory use
#define LORA_CR        5        // 4/5
#define LORA_SYNC      0x12
#define LORA_POWER     17
#define LORA_PREAMBLE  8

// ================= RELIABILITY =================
#define ACK_TIMEOUT_MS  800UL
#define MAX_RETRIES     3
#define WDT_TIMEOUT_SEC 30   // 30s — safe for radio.transmit() blocking

// ================= ANOMALY THRESHOLDS =================
// MQ2 in clean air during warm-up reads 2800-3400 (12-bit ADC).
// Set smoke threshold above warm-up baseline to avoid false positives.
#define SMOKE_THR   3500    // MQ2  raw ADC  (>3500 = real smoke)
#define GAS_THR     1800    // MQ135 raw ADC
#define VIB_THR     2.5f    // m/s² deviation from gravity

// ================= GLOBALS =================
SX1278 radio = new Module(LORA_SS, LORA_DIO0, LORA_RST);
Adafruit_MPU6050 mpu;

bool loraOk     = false;
bool mpuOk      = false;
bool mpuRawMode = false;  // true when clone chip bypasses Adafruit library

uint32_t      seq         = 0;
unsigned long lastTxAt    = 0;
bool          staggerDone = false;

// TX counters
unsigned long txOk   = 0;
unsigned long txFail = 0;

float lastValidDistCm = 0.0f;

// Gravity baseline for dynamic vibration calculation
#define GRAVITY_MS2  9.81f

// ================= HC-SR04 =================
float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long dur = pulseIn(ECHO_PIN, HIGH, 30000UL);
  if (dur == 0) return -1.0f;
  float d = dur * 0.01715f;
  return (d < 2.0f || d > 400.0f) ? -1.0f : d;
}

float readStableDistance() {
  esp_task_wdt_reset();          // feed WDT before blocking HC-SR04 reads
  float sum = 0; int cnt = 0;
  for (int i = 0; i < 5; i++) {
    float d = readDistanceCm();
    if (d > 0) { sum += d; cnt++; }
    delay(20);
  }
  if (cnt > 0) lastValidDistCm = sum / cnt;
  return lastValidDistCm;
}

// ================= I2C BUS SCANNER =================
void i2cScan() {
  Serial.println("[NODE_02] --- I2C Bus Scan ---");
  uint8_t found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("[NODE_02]   Device at 0x%02X", addr);
      if (addr == 0x68) Serial.print(" <- MPU6050 (AD0=GND)");
      if (addr == 0x69) Serial.print(" <- MPU6050 (AD0=VCC)");
      Serial.println();
      found++;
    }
  }
  if (found == 0) {
    Serial.println("[NODE_02]   NO I2C devices found!");
    Serial.println("[NODE_02]   CHECK: SDA->GPIO21  SCL->GPIO22  VCC->3.3V  GND->GND  AD0->GND");
  }
  Serial.println("[NODE_02] --- Scan done ---");
}

// ================= MPU6050 CLONE-SAFE INIT =================
// Handles genuine chips AND clones with non-standard WHO_AM_I.
bool mpuWakeAndInit(uint8_t addr = 0x68) {
  Wire.setClock(100000);   // 100 kHz — some clones fail at 400 kHz
  delay(10);

  // Read WHO_AM_I (reg 0x75) for diagnostics
  Wire.beginTransmission(addr);
  Wire.write(0x75);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)addr, (uint8_t)1);
  uint8_t whoami = Wire.available() ? Wire.read() : 0xFF;
  Serial.printf("[NODE_02] MPU6050 WHO_AM_I=0x%02X ", whoami);
  if      (whoami == 0x68) Serial.println("(genuine)");
  else if (whoami == 0x70) Serial.println("(MPU6050C variant)");
  else if (whoami == 0x98) Serial.println("(clone — forcing wake)");
  else                     Serial.println("(unknown clone — forcing wake)");

  // Manually clear SLEEP bit — PWR_MGMT_1 (reg 0x6B) = 0x00
  Wire.beginTransmission(addr);
  Wire.write(0x6B);
  Wire.write(0x00);
  Wire.endTransmission();
  delay(100);

  // Try Adafruit library first (works on genuine + compatible chips)
  if (mpu.begin(addr, &Wire)) {
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    Serial.println("[NODE_02] MPU6050 OK via Adafruit library");
    return true;
  }

  // Fallback: clone chip rejected by library — configure registers manually.
  // ACCEL_CONFIG (0x1C) = 0x10 → ±8g (4096 LSB/g) — MUST match raw scale below
  Wire.beginTransmission(addr);
  Wire.write(0x1C);
  Wire.write(0x10);   // AFS_SEL=2 → ±8g
  Wire.endTransmission();
  delay(10);

  // CONFIG (0x1A) = 0x04 → 21 Hz DLPF (matches MPU6050_BAND_21_HZ)
  Wire.beginTransmission(addr);
  Wire.write(0x1A);
  Wire.write(0x04);
  Wire.endTransmission();
  delay(10);

  Serial.println("[NODE_02] Raw mode: ACCEL_CONFIG=±8g  DLPF=21Hz");

  // Verify chip is streaming data by reading 6 accel bytes
  Wire.beginTransmission(addr);
  Wire.write(0x3B);
  uint8_t err = Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)addr, (uint8_t)6);
  if (err == 0 && Wire.available() == 6) {
    Serial.println("[NODE_02] Clone MPU alive — using raw I2C reads");
    mpuRawMode = true;
    return true;
  }
  return false;
}

// ================= MPU6050 =================
// Supports Adafruit library path AND raw I2C path for clone chips.
// IMPORTANT: re-applies ACCEL_CONFIG on every raw read because physical
// vibration can cause a power glitch that resets the chip to ±2g default,
// making the ±8g scale give 4× wrong readings permanently.
#define MPU_ADDR 0x68
float readVibMagnitude(float &ax_out, float &ay_out, float &az_out) {
  if (!mpuOk) { ax_out = ay_out = az_out = 0; return 0; }

  if (mpuRawMode) {
    // Re-apply PWR_MGMT_1=0x00 (wake) — survives chip power-glitch reset
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x6B); Wire.write(0x00);
    Wire.endTransmission();

    // Re-apply ACCEL_CONFIG=0x10 (±8g) — CRITICAL: chip resets to ±2g (0x00)
    // after a brown-out. Without this, scale is 4× wrong → vib stuck at ~31.
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x1C); Wire.write(0x10);
    Wire.endTransmission();

    // Read ACCEL_XOUT_H..ACCEL_ZOUT_L (registers 0x3B–0x40)
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x3B);
    if (Wire.endTransmission(false) != 0) { ax_out = ay_out = az_out = 0; return 0; }
    Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)6);
    if (Wire.available() < 6)             { ax_out = ay_out = az_out = 0; return 0; }
    int16_t rawX = (Wire.read() << 8) | Wire.read();
    int16_t rawY = (Wire.read() << 8) | Wire.read();
    int16_t rawZ = (Wire.read() << 8) | Wire.read();
    // ±8g → 4096 LSB/g (matches ACCEL_CONFIG=0x10 written above)
    const float scale = 9.81f / 4096.0f;
    ax_out = rawX * scale;
    ay_out = rawY * scale;
    az_out = rawZ * scale;
  } else {
    sensors_event_t a, g, t;
    if (!mpu.getEvent(&a, &g, &t)) { ax_out = ay_out = az_out = 0; return 0; }
    ax_out = a.acceleration.x;
    ay_out = a.acceleration.y;
    az_out = a.acceleration.z;
  }

  float total = sqrtf(ax_out*ax_out + ay_out*ay_out + az_out*az_out);
  return fabsf(total - GRAVITY_MS2);
}

// ================= LORA TX =================
// Fire-and-forget TX — gateway always in RX, never sends ACK
bool transmitPayload(const String& payload) {
  radio.standby(); delay(2);
  esp_task_wdt_reset();          // feed WDT before blocking radio.transmit()
  String txStr = payload;        // RadioLib needs non-const String&
  int state = radio.transmit(txStr);
  esp_task_wdt_reset();          // feed WDT after TX completes
  radio.standby();
  return (state == RADIOLIB_ERR_NONE);
}

// ================= MPU6050 AUTO-RETRY =================
unsigned long lastMpuRetryMs = 0;

void tryInitMpu() {
  if (millis() - lastMpuRetryMs < 5000UL) return;  // throttle to every 5 s
  lastMpuRetryMs = millis();
  Serial.println("[NODE_02] *** MPU6050 auto-retry ***");
  i2cScan();
  Wire.end();
  delay(50);
  Wire.begin(21, 22);
  delay(50);
  if (mpuWakeAndInit()) {
    mpuOk = true;
    Serial.println("[NODE_02] MPU6050 recovered!");
  } else {
    Serial.println("[NODE_02] MPU6050 still not responding — vib will report 0");
  }
}

// ================= LORA AUTO-RETRY =================
unsigned long lastLoraRetryMs = 0;

void tryInitLora() {
  if (millis() - lastLoraRetryMs < 10000UL) return;
  lastLoraRetryMs = millis();
  Serial.println("[NODE_02] *** LoRa auto-retry ***");
  Serial.println("[NODE_02]   SS=GPIO5  DIO0=GPIO26  RST=GPIO14");
  Serial.println("[NODE_02]   SCK=18  MISO=19  MOSI=23  VCC=3.3V");

  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(LORA_SS, LOW);
  SPI.transfer(0x42);
  uint8_t ver = SPI.transfer(0x00);
  digitalWrite(LORA_SS, HIGH);
  SPI.endTransaction();
  Serial.printf("[NODE_02] SPI reg 0x42 = 0x%02X", ver);
  if      (ver == 0x12) Serial.println(" <- SX1278 FOUND");
  else if (ver == 0x00) Serial.println(" <- 0x00: swap MOSI/MISO wires!");
  else if (ver == 0xFF) Serial.println(" <- 0xFF: MISO floating");
  else                  Serial.printf(" <- unexpected 0x%02X\n", ver);

  digitalWrite(LORA_RST, LOW); delay(15);
  digitalWrite(LORA_RST, HIGH); delay(100);

  int state = radio.begin(LORA_FREQ, LORA_BW_KHZ, LORA_SF, LORA_CR,
                          LORA_SYNC, LORA_POWER, LORA_PREAMBLE);
  if (state == RADIOLIB_ERR_NONE) {
    loraOk = true;
    radio.standby();
    Serial.println("[NODE_02] LoRa recovered!");
  } else {
    Serial.printf("[NODE_02] Still failing code=%d\n", state);
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== NODE_02 STARTING ===");
  Serial.println("[NODE_02] Pins: MQ2=34 MQ135=35 FLAME=33 TRIG=25 ECHO=27");
  Serial.println("[NODE_02]       MPU SDA=21 SCL=22  LoRa SS=5 DIO0=26 RST=14");

  // Watchdog
  esp_task_wdt_config_t wdt_cfg = {
    .timeout_ms    = WDT_TIMEOUT_SEC * 1000,
    .idle_core_mask = 0,
    .trigger_panic  = true
  };
  esp_task_wdt_reconfigure(&wdt_cfg);
  esp_task_wdt_add(NULL);
  Serial.printf("[NODE_02] Watchdog armed: %d s\n", WDT_TIMEOUT_SEC);

  Wire.begin(21, 22);

  // GPIO 34/35 are INPUT-ONLY on ESP32 — no pinMode() needed, just analogRead()
  pinMode(FLAME_PIN, INPUT_PULLUP);  // LOW = flame detected
  pinMode(TRIG_PIN,  OUTPUT);
  pinMode(ECHO_PIN,  INPUT);
  digitalWrite(TRIG_PIN, LOW);

  // MPU6050 — I2C scan + clone-safe wake init
  Serial.println("[NODE_02] Initialising MPU6050 (SDA=21 SCL=22)...");
  i2cScan();
  if (mpuWakeAndInit()) {
    mpuOk = true;
    Serial.println("[NODE_02] MPU6050 OK");
  } else {
    Serial.println("[NODE_02] *** MPU6050 INIT FAILED — will auto-retry every 5s ***");
  }

#if HAS_GPS
  GPSSerial.begin(9600, SERIAL_8N1, 16, 17);
  Serial.println("[NODE_02] GPS started");
#endif

  // SX1278 LoRa — hardware reset + SPI init
  pinMode(LORA_RST, OUTPUT);
  digitalWrite(LORA_RST, LOW);  delay(15);
  digitalWrite(LORA_RST, HIGH); delay(100);
  Serial.println("[NODE_02] SX1278 hardware reset done");

  SPI.begin(18, 19, 23);   // SCK, MISO, MOSI — NO CS here
  pinMode(LORA_SS, OUTPUT);
  digitalWrite(LORA_SS, HIGH);
  delay(20);

  // SPI diagnostic
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(LORA_SS, LOW);
  SPI.transfer(0x42);
  uint8_t ver = SPI.transfer(0x00);
  digitalWrite(LORA_SS, HIGH);
  SPI.endTransaction();
  Serial.printf("[NODE_02] SPI reg 0x42 = 0x%02X", ver);
  if      (ver == 0x12) Serial.println(" <- SX1278 FOUND");
  else if (ver == 0x00) Serial.println(" <- 0x00: swap MOSI/MISO!");
  else if (ver == 0xFF) Serial.println(" <- 0xFF: check MISO + 3.3V");
  else                  Serial.printf(" <- unexpected 0x%02X\n", ver);

  // Init radio (3 retries)
  int state = RADIOLIB_ERR_UNKNOWN;
  for (int attempt = 1; attempt <= 3 && state != RADIOLIB_ERR_NONE; attempt++) {
    state = radio.begin(LORA_FREQ, LORA_BW_KHZ, LORA_SF, LORA_CR,
                        LORA_SYNC, LORA_POWER, LORA_PREAMBLE);
    Serial.printf("[NODE_02] radio.begin() attempt %d code=%d\n", attempt, state);
    if (state != RADIOLIB_ERR_NONE) delay(300);
  }

  if (state == RADIOLIB_ERR_NONE) {
    loraOk = true;
    Serial.println("[NODE_02] SX1278 LoRa OK @ 433 MHz SF7 BW125 CR4/5");
  } else {
    Serial.printf("[NODE_02] LoRa FAILED code=%d — check wiring!\n", state);
  }
  radio.standby();

  for (int i = 0; i < 3; i++) { readStableDistance(); delay(50); }

  Serial.printf("[NODE_02] TX stagger: %lu ms\n", TX_STAGGER_MS);
  Serial.println("[NODE_02] Ready — transmitting every 2 s");
  Serial.println("====================================================");
}

// ================= LOOP =================
void loop() {
  esp_task_wdt_reset();

#if HAS_GPS
  while (GPSSerial.available()) gps.encode(GPSSerial.read());
#endif

  unsigned long now = millis();
  if (!staggerDone) {
    if (now < TX_STAGGER_MS) { delay(20); return; }
    staggerDone = true;
    lastTxAt = now;
  }

  if (now - lastTxAt < TX_INTERVAL_MS) { delay(20); return; }

  // Auto-retry MPU6050 if wiring was loose at boot
  if (!mpuOk) { tryInitMpu(); }

  // Auto-retry LoRa if init failed
  if (!loraOk) { tryInitLora(); delay(20); return; }

  lastTxAt = now;
  seq++;

  // ---- READ SENSORS ----
  int   smokeRaw = analogRead(SMOKE_PIN);
  int   gasRaw   = analogRead(GAS_PIN);
  int   flame    = (digitalRead(FLAME_PIN) == LOW) ? 1 : 0;
  float distCm   = readStableDistance();
  float ax = 0, ay = 0, az = 0;
  float vib      = readVibMagnitude(ax, ay, az);
  vib            = roundf(vib * 100) / 100.0f;

#if HAS_GPS
  float lat = gps.location.isValid() ? gps.location.lat() : 0.0f;
  float lon = gps.location.isValid() ? gps.location.lng() : 0.0f;
#else
  float lat = 0.0f, lon = 0.0f;
#endif

  // ---- ANOMALY DETECTION — per-sensor flags ----
  bool aSmoke = (smokeRaw > SMOKE_THR);
  bool aGas   = (gasRaw   > GAS_THR);
  bool aFlame = (flame == 1);
  bool aVib   = (vib > VIB_THR);
  bool anomaly = aSmoke || aGas || aFlame || aVib;

  // Build reason string so it's always clear WHICH sensor triggered
  char reason[32] = "OK";
  if (anomaly) {
    strcpy(reason, "ANOMALY[");
    if (aSmoke) strcat(reason, "SMOKE ");
    if (aGas)   strcat(reason, "GAS ");
    if (aFlame) strcat(reason, "FLAME ");
    if (aVib)   strcat(reason, "VIB ");
    reason[strlen(reason)-1] = ']';  // replace trailing space with ]
  }

  Serial.printf("[NODE_02] seq=%-4lu | smoke=%4d gas=%4d flame=%d dist=%5.1f vib=%.2f %s\n",
                (unsigned long)seq, smokeRaw, gasRaw, flame, distCm, vib, reason);

  // ---- BUILD JSON PAYLOAD (<=250 bytes) ----
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

  String payload;
  serializeJson(doc, payload);

  if (payload.length() > 250) {
    Serial.println("[NODE_02] ERROR: payload too large");
    return;
  }

  Serial.printf("[NODE_02] TX %u bytes...", payload.length());
  bool ok = transmitPayload(payload);
  if (ok) { txOk++;   Serial.printf(" OK  seq=%lu ok=%lu\n",  (unsigned long)seq, txOk);  }
  else     { txFail++; Serial.printf(" FAIL seq=%lu fail=%lu\n",(unsigned long)seq, txFail); }

  Serial.println("----------------------------------------------------");
}
