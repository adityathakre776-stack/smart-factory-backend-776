-- Smart Factory — LoRa Column Migration
-- Run this ONCE in phpMyAdmin or MySQL CLI:
--   mysql -u root smartfactory < migrate_lora_columns.sql
--
-- Safe: uses IF NOT EXISTS so re-running is harmless.

USE smartfactory;

-- Add LoRa / GPS / vibration columns to sensor_data
ALTER TABLE sensor_data
  ADD COLUMN IF NOT EXISTS packet_seq     INT           DEFAULT 0         COMMENT 'Sender sequence number',
  ADD COLUMN IF NOT EXISTS lat            FLOAT         DEFAULT NULL      COMMENT 'GPS latitude (0 if no GPS)',
  ADD COLUMN IF NOT EXISTS lon            FLOAT         DEFAULT NULL      COMMENT 'GPS longitude (0 if no GPS)',
  ADD COLUMN IF NOT EXISTS ax             FLOAT         DEFAULT 0         COMMENT 'MPU6050 X acceleration m/s²',
  ADD COLUMN IF NOT EXISTS ay             FLOAT         DEFAULT 0         COMMENT 'MPU6050 Y acceleration m/s²',
  ADD COLUMN IF NOT EXISTS az             FLOAT         DEFAULT 0         COMMENT 'MPU6050 Z acceleration m/s²',
  ADD COLUMN IF NOT EXISTS comm_status    VARCHAR(20)   DEFAULT 'OK'      COMMENT 'Communication status: OK, RETRY, DROPPED',
  ADD COLUMN IF NOT EXISTS gateway_rssi   FLOAT         DEFAULT 0         COMMENT 'LoRa RSSI at gateway (dBm)',
  ADD COLUMN IF NOT EXISTS gateway_snr    FLOAT         DEFAULT 0         COMMENT 'LoRa SNR at gateway (dB)',
  ADD COLUMN IF NOT EXISTS retry_count_col INT          DEFAULT 0         COMMENT 'Retransmit count for this packet';

-- Index for fast node_id + time queries
CREATE INDEX IF NOT EXISTS idx_sensor_node_time
  ON sensor_data (node_id, created_at DESC);

SELECT 'Migration complete.' AS status;
