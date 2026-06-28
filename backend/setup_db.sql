-- Smart Factory — Full Database Setup
-- Run once to create DB + all tables from scratch.

CREATE DATABASE IF NOT EXISTS smartfactory CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smartfactory;

-- ── USERS ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    company_name  VARCHAR(120)  NOT NULL,
    full_name     VARCHAR(120)  NOT NULL,
    email         VARCHAR(120)  NOT NULL UNIQUE,
    password_hash VARCHAR(255)  NOT NULL,
    role          ENUM('manager','worker') NOT NULL DEFAULT 'worker',
    assigned_node VARCHAR(20)   DEFAULT NULL,
    created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP
);

-- ── SENSOR DATA ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sensor_data (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    gateway_id      VARCHAR(40)  NOT NULL DEFAULT 'GATEWAY_01',
    node_id         VARCHAR(40)  NOT NULL,
    vib             FLOAT        DEFAULT 0,
    flame           TINYINT(1)   DEFAULT 0,
    smoke           FLOAT        DEFAULT 0,
    gas             FLOAT        DEFAULT 0,
    distance        FLOAT        DEFAULT 0,
    anomaly         TINYINT(1)   DEFAULT 0,
    -- LoRa / GPS / vibration extended columns
    packet_seq      INT          DEFAULT 0    COMMENT 'Sender sequence number',
    lat             FLOAT        DEFAULT NULL COMMENT 'GPS latitude',
    lon             FLOAT        DEFAULT NULL COMMENT 'GPS longitude',
    ax              FLOAT        DEFAULT 0    COMMENT 'MPU6050 X m/s2',
    ay              FLOAT        DEFAULT 0    COMMENT 'MPU6050 Y m/s2',
    az              FLOAT        DEFAULT 0    COMMENT 'MPU6050 Z m/s2',
    comm_status     VARCHAR(20)  DEFAULT 'OK' COMMENT 'OK / RETRY / DROPPED',
    gateway_rssi    FLOAT        DEFAULT 0    COMMENT 'LoRa RSSI dBm',
    gateway_snr     FLOAT        DEFAULT 0    COMMENT 'LoRa SNR dB',
    retry_count_col INT          DEFAULT 0    COMMENT 'Retransmit count',
    created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sensor_node_time (node_id, created_at DESC)
);

-- ── CAMERA IMAGES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS camera_images (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    filename   VARCHAR(255) NOT NULL,
    created_at DATETIME     DEFAULT CURRENT_TIMESTAMP
);

-- ── ALERTS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    node_id    VARCHAR(40)  NOT NULL,
    type       VARCHAR(60)  NOT NULL,
    severity   VARCHAR(20)  NOT NULL DEFAULT 'warning',
    message    TEXT,
    resolved   TINYINT(1)   DEFAULT 0,
    created_at DATETIME     DEFAULT CURRENT_TIMESTAMP
);

-- ── NODES ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nodes (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    company_id  INT          DEFAULT 1,
    name        VARCHAR(40)  NOT NULL,
    x_position  FLOAT        DEFAULT 0,
    y_position  FLOAT        DEFAULT 0,
    status      VARCHAR(20)  DEFAULT 'online',
    zone        VARCHAR(60)  DEFAULT '',
    last_seen   DATETIME     DEFAULT CURRENT_TIMESTAMP,
    voltage     FLOAT        DEFAULT 0,
    temperature FLOAT        DEFAULT 0,
    vibration   FLOAT        DEFAULT 0
);

SELECT 'Database setup complete.' AS status;
