/*
 * ============================================================
 *  NODE_02 — CONTINUOUS SENSOR READING (Serial Monitor Only)
 *  Reads MQ2, MQ135, Flame, HC-SR04, and MPU6050 continuously
 *  without blocking on LoRa or running diagnostic tests.
 * ============================================================
 *
 *  PIN MAP:
 *    MQ2 AOUT     → GPIO 32 (Analog Input)
 *    MQ135 AOUT   → GPIO 33 (Analog Input)
 *    Flame DO     → GPIO 26 (Digital Input, LOW when flame present)
 *    HC-SR04 TRIG → GPIO 27 (Digital Output)
 *    HC-SR04 ECHO → GPIO 25 (Digital Input)
 *    MPU6050 SDA  → GPIO 21 (I2C)
 *    MPU6050 SCL  → GPIO 22 (I2C)
 * ============================================================
 */

#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

#define SMOKE_PIN     32   // MQ2 AOUT
#define GAS_PIN       33   // MQ135 AOUT
#define FLAME_PIN     26   // Flame digital (LOW = flame detected)
#define TRIG_PIN      27   // HC-SR04 TRIG
#define ECHO_PIN      25   // HC-SR04 ECHO

Adafruit_MPU6050 mpu;
bool mpuOk = false;

// Function to read HC-SR04 distance
float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  
  // 30ms timeout = ~500cm max range
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000UL);
  if (duration == 0) return -1.0f;
  
  // Calculate distance in cm (Speed of sound is ~0.0343 cm/us)
  float distance = duration * 0.01715f;
  if (distance < 2.0f || distance > 400.0f) return -1.0f;
  return distance;
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n==============================================");
  Serial.println("   NODE_02: Continuous Sensor Reading Program");
  Serial.println("==============================================");

  // Setup pins
  pinMode(SMOKE_PIN, INPUT);
  pinMode(GAS_PIN,   INPUT);
  pinMode(FLAME_PIN, INPUT);
  pinMode(TRIG_PIN,  OUTPUT);
  pinMode(ECHO_PIN,  INPUT);
  digitalWrite(TRIG_PIN, LOW);

  // Initialize I2C and MPU6050
  Wire.begin(21, 22);
  if (mpu.begin()) {
    mpuOk = true;
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    Serial.println("[OK] MPU6050 initialized successfully.");
  } else {
    Serial.println("[ERROR] MPU6050 not detected. Accelerometer data will be 0.");
  }

  Serial.println("\nStarting live console print. Output format:");
  Serial.println("Timestamp | MQ2(Smoke) | MQ135(Gas) | Flame? | Distance (cm) | MPU6050 Accel (m/s^2)");
  Serial.println("----------------------------------------------------------------------------------");
}

void loop() {
  // 1. Read Analog sensors (MQ2 & MQ135)
  int smokeRaw = analogRead(SMOKE_PIN);
  int gasRaw   = analogRead(GAS_PIN);

  // Convert to approximate voltages (assuming 3.3V ADC reference on ESP32)
  float smokeV = (smokeRaw / 4095.0f) * 3.3f;
  float gasV   = (gasRaw / 4095.0f) * 3.3f;

  // 2. Read Flame Sensor (Active LOW)
  bool flameDetected = (digitalRead(FLAME_PIN) == LOW);

  // 3. Read Ultrasonic Distance
  float distance = readDistanceCm();

  // 4. Read Acceleration from MPU6050
  float ax = 0, ay = 0, az = 0, accelMag = 0;
  if (mpuOk) {
    sensors_event_t a, g, t;
    if (mpu.getEvent(&a, &g, &t)) {
      ax = a.acceleration.x;
      ay = a.acceleration.y;
      az = a.acceleration.z;
      accelMag = sqrtf(ax*ax + ay*ay + az*az);
    }
  }

  // 5. Output values in a formatted line
  unsigned long timestamp = millis();
  Serial.printf("[%lu ms] ", timestamp);
  Serial.printf("MQ2: %4d (%.2fV) | ", smokeRaw, smokeV);
  Serial.printf("MQ135: %4d (%.2fV) | ", gasRaw, gasV);
  Serial.printf("Flame: %s | ", flameDetected ? "YES (FLAME!)" : "NO          ");
  
  if (distance > 0) {
    Serial.printf("Dist: %5.1f cm | ", distance);
  } else {
    Serial.print("Dist:  ---   cm | ");
  }

  Serial.printf("Accel Mag: %5.2f m/s^2 (X:%5.2f Y:%5.2f Z:%5.2f)\n", accelMag, ax, ay, az);

  // Delay for 1 second between reads
  delay(1000);
}
