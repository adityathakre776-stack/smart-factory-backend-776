/*
 * ============================================================
 *  Smart Factory — LoRa GATEWAY / RECEIVER (with WiFi Direct POST)
 *  Board  : ESP32 (separate from all 3 sender nodes)
 *  Radio  : SX1278 @ 433 MHz
 *
 *  This firmware:
 *   1. Listens for LoRa packets from NODE_01, NODE_02, NODE_03
 *      simultaneously (interrupt-driven, non-blocking)
 *   2. Sends ACK back to whichever node just transmitted
 *   3. Enriches the packet with RSSI, SNR, distance estimate
 *   4. Forwards JSON over USB Serial as "GW_JSON:{...}"
 *   5. Connects to local WiFi and POSTs JSON directly to the
 *      Flask backend API (no serial bridge required!)
 *
 *  PIN CONNECTIONS (ESP32):
 *    SX1278  CS   → GPIO 5
 *    SX1278  DIO0 → GPIO 2   (interrupt line — MUST be wired!)
 *    SX1278  RST  → GPIO 4
 *    SX1278  SCK  → GPIO 18
 *    SX1278  MISO → GPIO 19
 *    SX1278  MOSI → GPIO 23
 *    3.3V & GND   → SX1278 VCC & GND
 *
 *  Serial baud: 115200
 * ============================================================
 */

#include <ArduinoJson.h>
#include <RadioLib.h>
#include <SPI.h>
#include <WiFi.h>
#include <HTTPClient.h>

// ================= WIFI & DASHBOARD CONFIG =================
// Enter your WiFi details and Flask server IP address below:
const char* ssid      = "YOUR_WIFI_SSID";
const char* password  = "YOUR_WIFI_PASSWORD";
const char* serverUrl = "http://192.168.1.100:5000/api/data"; // Replace with your Flask server IP address

// ================= LORA CONFIG — MUST MATCH ALL SENDERS =================
#define LORA_CS       5
#define LORA_DIO0     2
#define LORA_RST      4
#define LORA_SCK      18
#define LORA_MISO     19
#define LORA_MOSI     23

#define LORA_FREQ     433.0
#define LORA_BW_KHZ   125.0f
#define LORA_SF       7
#define LORA_CR       5           // 4/5
#define LORA_SYNC     0x12
#define LORA_POWER    17
#define LORA_PREAMBLE 8

#define GATEWAY_ID    "GATEWAY_01"

// ================= NODE TRACKING =================
#define MAX_NODES         6
#define NODE_OFFLINE_MS   30000UL    // 30 s without packet = offline

struct NodeRecord {
  char          nodeId[16];
  unsigned long lastSeenMs;
  unsigned long packetsRx;
  unsigned long ackedTx;
  bool          online;
};
NodeRecord trackedNodes[MAX_NODES];
int        trackedCount = 0;

// ================= DUPLICATE DETECTION =================
#define MAX_RECENT 30
struct RecentPkt {
  char          nodeId[16];
  unsigned long seq;
  unsigned long seenAtMs;
};
RecentPkt recentPkts[MAX_RECENT];
int       recentHead = 0;

bool isDuplicate(const char* nodeId, unsigned long seq) {
  for (int i = 0; i < MAX_RECENT; i++) {
    if (recentPkts[i].seenAtMs == 0) continue;
    if (strcmp(recentPkts[i].nodeId, nodeId) == 0 &&
        recentPkts[i].seq == seq &&
        (millis() - recentPkts[i].seenAtMs) < 10000UL) {
      return true;
    }
  }
  strncpy(recentPkts[recentHead].nodeId, nodeId, 15);
  recentPkts[recentHead].seq      = seq;
  recentPkts[recentHead].seenAtMs = millis();
  recentHead = (recentHead + 1) % MAX_RECENT;
  return false;
}

// ================= RADIO =================
SX1278 radio = new Module(LORA_CS, LORA_DIO0, LORA_RST);
volatile bool packetReady = false;

void IRAM_ATTR onReceive() {
  packetReady = true;
}

// ================= DISTANCE ESTIMATE =================
float estimateDistance(float rssi, float snr) {
  const float rssiAt1m = -54.0f;
  const float pathExp  = 2.1f;
  float snrPenalty     = constrain(-snr * 0.9f, 0.0f, 10.0f);
  float adjRssi        = rssi - snrPenalty;
  float exp_val        = (rssiAt1m - adjRssi) / (10.0f * pathExp);
  float dist           = powf(10.0f, exp_val);
  return constrain(dist, 0.5f, 800.0f);
}

// ================= NODE RECORD HELPERS =================
int findOrAddNode(const char* nodeId) {
  for (int i = 0; i < trackedCount; i++)
    if (strcmp(trackedNodes[i].nodeId, nodeId) == 0) return i;

  if (trackedCount < MAX_NODES) {
    strncpy(trackedNodes[trackedCount].nodeId, nodeId, 15);
    trackedNodes[trackedCount].lastSeenMs = 0;
    trackedNodes[trackedCount].packetsRx  = 0;
    trackedNodes[trackedCount].ackedTx    = 0;
    trackedNodes[trackedCount].online     = false;
    return trackedCount++;
  }
  int oldest = 0;
  for (int i = 1; i < MAX_NODES; i++)
    if (trackedNodes[i].lastSeenMs < trackedNodes[oldest].lastSeenMs) oldest = i;
  strncpy(trackedNodes[oldest].nodeId, nodeId, 15);
  trackedNodes[oldest].packetsRx = 0;
  trackedNodes[oldest].ackedTx   = 0;
  return oldest;
}

// ================= SEND ACK =================
bool sendAck(const char* nodeId, unsigned long seq) {
  char ackBuf[48];
  snprintf(ackBuf, sizeof(ackBuf), "ACK:%s:%lu", nodeId, seq);

  radio.standby();
  int state = radio.transmit(ackBuf);
  radio.startReceive();

  if (state == RADIOLIB_ERR_NONE) {
    return true;
  }
  Serial.printf("[GW] ACK TX FAIL code=%d to %s seq=%lu\n", state, nodeId, seq);
  return false;
}

// ================= STRIP JSON FROM RAW PAYLOAD =================
String extractJson(const String& raw) {
  int start = raw.indexOf('{');
  int end   = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.substring(start, end + 1);
  return raw;
}

// ================= HANDLE ONE INCOMING PACKET =================
void handlePacket() {
  String raw;
  int state = radio.readData(raw);
  radio.startReceive();

  if (state != RADIOLIB_ERR_NONE || raw.length() == 0) return;
  if (raw.startsWith("ACK:")) return;

  String payload = extractJson(raw);
  if (!payload.startsWith("{")) {
    Serial.print("[GW] Non-JSON: "); Serial.println(payload);
    return;
  }

  float rssi    = radio.getRSSI();
  float snr     = radio.getSNR();
  float distEst = estimateDistance(rssi, snr);

  StaticJsonDocument<512> rx;
  DeserializationError err = deserializeJson(rx, payload);
  if (err) {
    Serial.printf("[GW] JSON parse fail: %s\n", err.c_str());
    return;
  }

  const char*   nodeId = rx["node_id"] | "UNKNOWN";
  unsigned long seq    = rx["seq"]     | 0UL;

  Serial.printf("[GW] RX from %s seq=%lu RSSI=%.1f SNR=%.1f dist=%.1fm\n",
                nodeId, seq, rssi, snr, distEst);

  bool ackOk = sendAck(nodeId, seq);
  Serial.printf("[GW] ACK %s to %s seq=%lu\n",
                ackOk ? "SENT" : "FAIL", nodeId, seq);

  bool isDup = isDuplicate(nodeId, seq);
  if (isDup) {
    Serial.printf("[GW] Duplicate seq=%lu from %s — NOT forwarded\n", seq, nodeId);
    return;
  }

  int idx = findOrAddNode(nodeId);
  trackedNodes[idx].lastSeenMs = millis();
  trackedNodes[idx].packetsRx++;
  trackedNodes[idx].online = true;
  if (ackOk) trackedNodes[idx].ackedTx++;

  StaticJsonDocument<768> out;
  out["gateway_id"]                  = GATEWAY_ID;
  out["node_id"]                     = nodeId;
  out["packet_seq"]                  = seq;
  out["ts"]                          = rx["ts"] | 0UL;
  out["smoke"]                       = rx["smoke"] | 0;
  out["gas"]                         = rx["gas"]   | 0;
  out["flame"]                       = rx["flame"] | 0;
  out["distance"]                    = rx["dist"]  | 0;
  out["vib"]                         = rx["vib"]   | 0.0f;
  out["ax"]                          = rx["ax"]    | 0.0f;
  out["ay"]                          = rx["ay"]    | 0.0f;
  out["az"]                          = rx["az"]    | 0.0f;
  out["lat"]                         = rx["lat"]   | 0.0f;
  out["lon"]                         = rx["lon"]   | 0.0f;
  out["anomaly"]                     = rx["anomaly"] | 0;

  out["gateway_rssi"]                = roundf(rssi    * 10) / 10.0f;
  out["gateway_snr"]                 = roundf(snr     * 10) / 10.0f;
  out["gateway_distance_estimate_m"] = roundf(distEst * 10) / 10.0f;
  out["node_gateway_distance_m"]     = roundf(distEst * 10) / 10.0f;
  out["gateway_ack_sent"]            = ackOk;
  out["delivery_status"]             = ackOk ? "ACKED" : "RECEIVED";
  out["message_duplicate"]           = false;
  out["retry_count"]                 = 0;

  String outStr;
  serializeJson(out, outStr);
  Serial.print("GW_JSON:");
  Serial.println(outStr);

  // ---- Forward to Flask Dashboard via WiFi HTTP POST ----
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");
    
    int httpResponseCode = http.POST(outStr);
    if (httpResponseCode > 0) {
      Serial.printf("[GW] WiFi HTTP POST success, code: %d\n", httpResponseCode);
    } else {
      Serial.printf("[GW] WiFi HTTP POST fail, error: %s\n", http.errorToString(httpResponseCode).c_str());
    }
    http.end();
  } else {
    Serial.println("[GW] WiFi disconnected — skipped direct HTTP POST");
  }

  Serial.printf("[GW] Stats: rx=%lu ack=%lu | nodes tracked=%d\n",
                trackedNodes[idx].packetsRx, trackedNodes[idx].ackedTx, trackedCount);
  Serial.println("----------------------------------------------------");
}

// ================= PERIODIC STATUS =================
unsigned long lastStatusAt = 0;

void printStatus() {
  if (millis() - lastStatusAt < 15000UL) return;
  lastStatusAt = millis();
  Serial.println("\n=== GATEWAY STATUS ===");
  for (int i = 0; i < trackedCount; i++) {
    bool isOnline = (millis() - trackedNodes[i].lastSeenMs) < NODE_OFFLINE_MS;
    trackedNodes[i].online = isOnline;
    Serial.printf("  %-10s %s | RX=%lu ACK=%lu\n",
                  trackedNodes[i].nodeId,
                  isOnline ? "ONLINE " : "OFFLINE",
                  trackedNodes[i].packetsRx,
                  trackedNodes[i].ackedTx);
  }
  if (trackedCount == 0) Serial.println("  No nodes seen yet.");
  Serial.println("======================");
}

// ================= NON-BLOCKING WIFI RECONNECT CHECKER =================
unsigned long lastWifiRetry = 0;
void checkWifiConnection() {
  if (WiFi.status() != WL_CONNECTED && (millis() - lastWifiRetry > 15000UL)) {
    lastWifiRetry = millis();
    Serial.println("[GW] WiFi disconnected. Attempting non-blocking reconnect...");
    WiFi.disconnect();
    WiFi.begin(ssid, password);
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(2000);

  // Initialize WiFi connection (non-blocking threshold)
  WiFi.begin(ssid, password);
  Serial.print("[GW] Connecting to WiFi SSID: ");
  Serial.println(ssid);
  int connectAttempts = 0;
  while (WiFi.status() != WL_CONNECTED && connectAttempts < 15) {
    delay(500);
    Serial.print(".");
    connectAttempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[GW] WiFi Connected!");
    Serial.print("[GW] Gateway IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[GW] WiFi Connection timeout! Running in Serial-only mode.");
  }

  Serial.println("\n=== SMART FACTORY GATEWAY STARTED ===");
  Serial.printf("Gateway ID : %s\n", GATEWAY_ID);
  Serial.println("Listening for NODE_01, NODE_02, NODE_03 ...");

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);

  int state = radio.begin(LORA_FREQ, LORA_BW_KHZ, LORA_SF, LORA_CR,
                          LORA_SYNC, LORA_POWER, LORA_PREAMBLE);
  if (state != RADIOLIB_ERR_NONE) {
    Serial.printf("[GW] LoRa init FAIL code=%d — halting\n", state);
    while (true) { delay(1000); }
  }
  Serial.println("[GW] LoRa SX1278 OK @ 433 MHz SF7 BW125 CR4/5");

  // Attach DIO0 interrupt — called when a full packet lands in FIFO
  radio.setDio0Action(onReceive, RISING);

  // Start non-blocking receive — never blocks loop()
  radio.startReceive();
  Serial.println("[GW] Non-blocking RX armed via DIO0 interrupt");
  Serial.println("[GW] Serial output: GW_JSON:{...} → serial_bridge_ingest.py");
  Serial.println("----------------------------------------------------");
}

// ================= LOOP =================
void loop() {
  if (packetReady) {
    packetReady = false;   // clear flag before processing
    handlePacket();
  }
  checkWifiConnection();
  printStatus();
  delay(5);   // tiny yield so ESP32 background tasks stay happy
}
