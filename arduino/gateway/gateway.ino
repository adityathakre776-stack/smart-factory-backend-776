/*
 * ============================================================
 *  Smart Factory — LoRa GATEWAY (Pure RX + WiFi POST)
 *  Board  : ESP32 DevKit  (dedicated gateway — NOT a sender)
 *  Radio  : SX1278 @ 433 MHz
 *
 *  PIN CONNECTIONS (SX1278 ↔ ESP32):
 *    NSS/CS → GPIO 5    DIO0 → GPIO 2  (INTERRUPT — MUST wire!)
 *    RST    → GPIO 4    SCK  → GPIO 18
 *    MISO   → GPIO 19   MOSI → GPIO 23
 *    VCC=3.3V  GND=GND
 *
 *  HOW MULTI-NODE WORKS:
 *   - Gateway NEVER transmits — always stays in RX mode.
 *   - DIO0 interrupt fires when any node packet lands in FIFO.
 *   - processPacket() reads + re-arms startReceive() immediately.
 *   - Senders fire-and-forget (no ACK needed).
 *   - Stagger: NODE_01=0ms | NODE_02=667ms | NODE_03=1333ms
 *     SF7 airtime ~300ms → 667ms gap = collision-free.
 *
 *  WiFi:
 *   - Connects to PC hotspot (SSID/password below).
 *   - POSTs enriched JSON directly to Flask /api/data.
 *   - Every 8 s broadcasts node status to /api/node-status-push.
 *   - GW_JSON:{...} printed on Serial for debug / fallback.
 *
 *  Node offline: declared OFFLINE after 15 s with no packet.
 *  Status report: printed every 8 s (Serial + HTTP POST).
 *
 *  ► BEFORE UPLOAD: set ssid, password, serverBase below.
 *    Find PC IP: run  ipconfig  → Mobile Hotspot adapter IPv4.
 *    Flask must run: python dashboard_app.py
 *  BAUD: 115200
 * ============================================================
 */

#include <RadioLib.h>
#include <SPI.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <HTTPClient.h>

// ===== I²C LCD (16×2, PCF8574 backpack) =====
// SDA → GPIO 21   SCL → GPIO 22   VCC → 5V   GND → GND
// Change 0x27 → 0x3F if display stays blank (use I2C scanner to confirm)
#define LCD_ADDR  0x27
LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);
unsigned long lastLcdMs = 0;

// =====================================================================
//  ► EDIT THESE BEFORE UPLOADING
// =====================================================================
const char* ssid      = "LAPTOP-5LJI46P9 1083";   // PC hotspot SSID
const char* password  = "12345678";               // hotspot password
const char* serverBase = "http://172.20.10.2:5000";
// =====================================================================

// Derived endpoints
#define DATA_URL   (String(serverBase) + "/api/data")

// ===== LoRa pins =====
#define LORA_CS    5
#define LORA_DIO0  2
#define LORA_RST   4
#define LORA_SCK   18
#define LORA_MISO  19
#define LORA_MOSI  23

// ===== LoRa RF settings — MUST match all 3 sender nodes =====
#define LORA_FREQ      433.0
#define LORA_BW_KHZ    125.0f
#define LORA_SF        7
#define LORA_CR        5       // 4/5
#define LORA_SYNC      0x12
#define LORA_POWER     17
#define LORA_PREAMBLE  8

#define GATEWAY_ID    "GATEWAY_01"
#define OFFLINE_MS    15000UL  // declare node offline after 15 s silence
#define STATUS_PERIOD 8000UL   // print + POST gateway status every 8 s

// ===== Known nodes =====
#define NUM_NODES 3
const char* KNOWN_NODES[NUM_NODES] = {"NODE_01", "NODE_02", "NODE_03"};

struct NodeInfo {
  char          id[16];
  unsigned long lastSeenMs;
  unsigned long rxCount;
  unsigned long dupCount;
  bool          everSeen;
};
NodeInfo nodes[NUM_NODES];

void initNodes() {
  for (int i = 0; i < NUM_NODES; i++) {
    strncpy(nodes[i].id, KNOWN_NODES[i], 15);
    nodes[i].lastSeenMs = 0;
    nodes[i].rxCount    = 0;
    nodes[i].dupCount   = 0;
    nodes[i].everSeen   = false;
  }
}

int findNode(const char* nodeId) {
  for (int i = 0; i < NUM_NODES; i++)
    if (!strcmp(nodes[i].id, nodeId)) return i;
  return -1;
}

// ===== Duplicate detection =====
#define DUP_SLOTS  32
#define DUP_TTL_MS 6000UL
struct DupEntry { char nodeId[16]; uint32_t seq; unsigned long seenAtMs; };
DupEntry dupTable[DUP_SLOTS];
int dupHead = 0;

bool checkAndMarkDup(const char* nodeId, uint32_t seq) {
  unsigned long now = millis();
  for (int i = 0; i < DUP_SLOTS; i++) {
    if (!dupTable[i].seenAtMs) continue;
    if ((now - dupTable[i].seenAtMs) > DUP_TTL_MS) { dupTable[i].seenAtMs = 0; continue; }
    if (!strcmp(dupTable[i].nodeId, nodeId) && dupTable[i].seq == seq) return true;
  }
  strncpy(dupTable[dupHead].nodeId, nodeId, 15);
  dupTable[dupHead].seq = seq;
  dupTable[dupHead].seenAtMs = now;
  dupHead = (dupHead + 1) % DUP_SLOTS;
  return false;
}

// ===== Radio =====
SX1278 radio = new Module(LORA_CS, LORA_DIO0, LORA_RST);
volatile bool packetFlag = false;
void IRAM_ATTR onDio0() { packetFlag = true; }

// ===== RSSI → distance estimate =====
float estimateDist(float rssi, float snr) {
  float adj = rssi - constrain(-snr * 0.9f, 0.0f, 10.0f);
  return constrain(powf(10.0f, (-54.0f - adj) / 21.0f), 0.5f, 800.0f);
}

// ===== WiFi maintain (non-blocking, retries every 15 s) =====
unsigned long lastWifiRetryMs = 0;
void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiRetryMs < 15000UL) return;
  lastWifiRetryMs = millis();
  Serial.println("[GW] WiFi lost — reconnecting...");
  WiFi.disconnect();
  WiFi.begin(ssid, password);
}

// ===== HTTP POST helper (3 s timeout — never blocks LoRa long) =====
int httpPost(const String& url, const String& payload) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(3000);
  int code = http.POST(payload);
  http.end();
  return code;
}

// ===== Process received LoRa packet =====
void processPacket() {
  String raw;
  int state = radio.readData(raw);

  // Re-arm RX immediately — NEVER transmit, always listen
  radio.startReceive();

  if (state != RADIOLIB_ERR_NONE || raw.length() == 0) {
    Serial.printf("[GW] RX error code=%d\n", state);
    return;
  }

  float rssi    = radio.getRSSI();
  float snr     = radio.getSNR();
  float distEst = estimateDist(rssi, snr);

  // Extract JSON from raw LoRa payload
  int s = raw.indexOf('{'), e = raw.lastIndexOf('}');
  if (s < 0 || e <= s) {
    Serial.printf("[GW] No JSON in packet (len=%d)\n", raw.length());
    return;
  }
  String jsonStr = raw.substring(s, e + 1);

  StaticJsonDocument<512> rx;
  if (deserializeJson(rx, jsonStr)) {
    Serial.println("[GW] JSON parse error");
    return;
  }

  const char* nodeId = rx["node_id"] | "UNKNOWN";
  uint32_t    seq    = rx["seq"]     | 0;

  // Update node tracking
  int idx = findNode(nodeId);
  if (idx < 0) {
    Serial.printf("[GW] Unknown node: %s (ignored)\n", nodeId);
    return;
  }
  nodes[idx].lastSeenMs = millis();
  nodes[idx].rxCount++;
  nodes[idx].everSeen = true;

  // Duplicate suppression
  if (checkAndMarkDup(nodeId, seq)) {
    nodes[idx].dupCount++;
    Serial.printf("[GW] DUP suppressed seq=%u from %s\n", seq, nodeId);
    return;
  }

  Serial.printf("[GW] RX %-10s seq=%-5u RSSI=%.1f SNR=%.1f dist=%.1fm\n",
                nodeId, seq, rssi, snr, distEst);

  // ===== Build enriched JSON for dashboard =====
  StaticJsonDocument<768> fwd;
  fwd["gateway_id"]  = GATEWAY_ID;
  fwd["node_id"]     = nodeId;
  fwd["packet_seq"]  = seq;
  fwd["ts"]          = rx["ts"]    | 0UL;
  fwd["smoke"]       = rx["smoke"] | 0;
  fwd["gas"]         = rx["gas"]   | 0;
  fwd["flame"]       = rx["flame"] | 0;
  fwd["distance"]    = rx["dist"]  | 0;   // Flask uses "distance"
  fwd["vib"]         = rx["vib"]   | 0.0f;
  fwd["ax"]          = rx["ax"]    | 0.0f;
  fwd["ay"]          = rx["ay"]    | 0.0f;
  fwd["az"]          = rx["az"]    | 0.0f;
  fwd["lat"]         = rx["lat"]   | 0.0f;
  fwd["lon"]         = rx["lon"]   | 0.0f;
  fwd["anomaly"]     = (rx["anomaly"] | 0) == 1;
  fwd["gateway_rssi"]                = roundf(rssi    * 10) / 10.0f;
  fwd["gateway_snr"]                 = roundf(snr     * 10) / 10.0f;
  fwd["gateway_distance_estimate_m"] = roundf(distEst * 10) / 10.0f;
  fwd["node_gateway_distance_m"]     = roundf(distEst * 10) / 10.0f;
  fwd["delivery_status"]             = "RECEIVED";
  fwd["message_duplicate"]           = false;

  String fwdStr;
  serializeJson(fwd, fwdStr);

  // Serial debug (also serves as fallback for serial_bridge_ingest.py)
  Serial.print("GW_JSON:");
  Serial.println(fwdStr);

  // HTTP POST to Flask
  int code = httpPost(DATA_URL, fwdStr);
  if (code > 0) {
    Serial.printf("[GW] POST ok → %s  HTTP %d\n", serverBase, code);
  } else if (code == -1) {
    Serial.println("[GW] WiFi not connected — POST skipped");
  } else {
    Serial.printf("[GW] POST FAILED code=%d\n", code);
  }

  Serial.printf("[GW] Forwarded %-10s | RX=%lu DUP=%lu\n",
                nodeId, nodes[idx].rxCount, nodes[idx].dupCount);
  Serial.println("----------------------------------------------------");
}

// ===== LCD: update node status every 1 s =====
// Row 0: "GW:OK  Online:2/3"
// Row 1: "N1:ON N2:ON N3:ON"
void updateLcd() {
  if (millis() - lastLcdMs < 1000UL) return;
  lastLcdMs = millis();

  // Count online nodes
  int onlineCount = 0;
  for (int i = 0; i < NUM_NODES; i++) {
    if (nodes[i].everSeen && (millis() - nodes[i].lastSeenMs) < OFFLINE_MS)
      onlineCount++;
  }

  // -- Row 0: gateway status + online count --
  lcd.setCursor(0, 0);
  char row0[17];
  snprintf(row0, sizeof(row0), "GW:OK Online:%d/%d", onlineCount, NUM_NODES);
  // Pad to exactly 16 chars
  int r0len = strlen(row0);
  while (r0len < 16) row0[r0len++] = ' ';
  row0[16] = '\0';
  lcd.print(row0);

  // -- Row 1: per-node ON/OF status --
  lcd.setCursor(0, 1);
  char row1[17];
  row1[0] = '\0';
  for (int i = 0; i < NUM_NODES; i++) {
    bool on = nodes[i].everSeen &&
              (millis() - nodes[i].lastSeenMs) < OFFLINE_MS;
    char slot[7];
    snprintf(slot, sizeof(slot), "N%d:%s%s",
             i + 1,
             on ? "ON" : "--",
             i < NUM_NODES - 1 ? " " : "");
    strncat(row1, slot, 16 - strlen(row1));
  }
  // Pad to exactly 16 chars
  int len = strlen(row1);
  while (len < 16) row1[len++] = ' ';
  row1[16] = '\0';
  lcd.print(row1);
}


// ===== Gateway status: print every 8 s =====
unsigned long lastStatusMs = 0;

void printAndBroadcastStatus() {
  unsigned long now = millis();
  if (now - lastStatusMs < STATUS_PERIOD) return;
  lastStatusMs = now;

  // ── Serial status ──
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[GW] WiFi OK — IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[GW] WiFi DISCONNECTED");
  }

  Serial.println("\n=== GATEWAY STATUS (8-sec) ===");
  int onlineCount = 0;
  for (int i = 0; i < NUM_NODES; i++) {
    bool online = nodes[i].everSeen &&
                  (millis() - nodes[i].lastSeenMs) < OFFLINE_MS;
    if (online) onlineCount++;
    unsigned long elapsed = nodes[i].everSeen
                            ? (millis() - nodes[i].lastSeenMs) / 1000
                            : 0;
    Serial.printf("  %-10s %s  RX=%-5lu  DUP=%-3lu  last=%lus ago\n",
                  nodes[i].id,
                  online ? "ONLINE " : "OFFLINE",
                  nodes[i].rxCount,
                  nodes[i].dupCount,
                  elapsed);
  }
  Serial.printf("  Online: %d/%d\n", onlineCount, NUM_NODES);
  Serial.println("==============================\n");
}

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  delay(1500);

  initNodes();

  // ── LCD init ──
  Wire.begin(21, 22);   // SDA=21, SCL=22
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Smart Factory GW");
  lcd.setCursor(0, 1);
  lcd.print("Starting up...  ");

  Serial.println("\n=== SMART FACTORY GATEWAY ===");
  Serial.printf("ID: %s\n", GATEWAY_ID);
  Serial.printf("Server: %s\n", serverBase);
  Serial.println("LoRa: 433MHz SF7 BW125 CR4/5 Sync=0x12");
  Serial.println("Mode: PURE RX — gateway never transmits");
  Serial.println("Pins: CS=5 DIO0=2 RST=4 SCK=18 MISO=19 MOSI=23");
  Serial.println("Nodes: NODE_01(0ms) | NODE_02(667ms) | NODE_03(1333ms)");
  Serial.printf("Status: printed every %lu s\n", STATUS_PERIOD / 1000);
  Serial.println("----------------------------------------------");

  // ── WiFi init (up to 15 × 500ms = 7.5s) ──
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.printf("[GW] Connecting to '%s'", ssid);
  int att = 0;
  while (WiFi.status() != WL_CONNECTED && att < 15) {
    delay(500);
    Serial.print(".");
    att++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[GW] WiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[GW] POST endpoint: %s\n", DATA_URL.c_str());
  } else {
    Serial.println("\n[GW] WiFi timeout — Serial-only mode (retries every 15s)");
  }
  Serial.println("----------------------------------------------");

  // ── LoRa init ──
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  int state = radio.begin(LORA_FREQ, LORA_BW_KHZ, LORA_SF, LORA_CR,
                          LORA_SYNC, LORA_POWER, LORA_PREAMBLE);
  if (state != RADIOLIB_ERR_NONE) {
    Serial.printf("[GW] LoRa FAILED code=%d\n", state);
    Serial.println("[GW] Check wiring: CS=5 DIO0=2 RST=4");
    while (true) delay(1000);
  }
  Serial.println("[GW] SX1278 OK");

  radio.setDio0Action(onDio0, RISING);
  state = radio.startReceive();
  if (state != RADIOLIB_ERR_NONE) {
    Serial.printf("[GW] startReceive FAILED code=%d\n", state);
    while (true) delay(1000);
  }

  Serial.println("[GW] Pure RX mode — listening for NODE_01, NODE_02, NODE_03");
  Serial.println("==============================================\n");
}

// ===== LOOP — never blocks =====
void loop() {
  if (packetFlag) {
    packetFlag = false;
    processPacket();
  }
  maintainWifi();              // non-blocking WiFi reconnect
  printAndBroadcastStatus();   // every 8 s: Serial + HTTP status
  updateLcd();                 // every 1 s: refresh 16×2 LCD
  delay(2);                    // yield for ESP32 background tasks
}
