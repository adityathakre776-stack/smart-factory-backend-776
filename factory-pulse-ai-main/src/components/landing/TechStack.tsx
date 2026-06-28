import { motion } from "framer-motion";

const sensors = [
  {
    name: "PZEM004T",
    type: "Electrical Meter",
    specs: "V, A, W, kWh, PF",
    color: "border-neon-cyan/30 bg-neon-cyan/5",
  },
  {
    name: "MPU6050",
    type: "Vibration Sensor",
    specs: "6-axis IMU, RMS",
    color: "border-primary/30 bg-primary/5",
  },
  {
    name: "MQ-2/MQ-5",
    type: "Gas Detector",
    specs: "LPG, CO, Smoke",
    color: "border-status-warning/30 bg-status-warning/5",
  },
  {
    name: "Flame Sensor",
    type: "Fire Detection",
    specs: "IR 760-1100nm",
    color: "border-status-critical/30 bg-status-critical/5",
  },
  {
    name: "HC-SR04",
    type: "Ultrasonic",
    specs: "2-400cm range",
    color: "border-accent/30 bg-accent/5",
  },
  {
    name: "DHT22",
    type: "Environment",
    specs: "Temp & Humidity",
    color: "border-status-normal/30 bg-status-normal/5",
  },
];

const techLayers = [
  {
    title: "Edge Layer",
    items: ["ESP32-WROOM", "LoRa SX1278", "TinyML Runtime", "FreeRTOS"],
  },
  {
    title: "Communication",
    items: ["LoRa 433MHz", "WiFi 802.11", "MQTT Protocol", "JSON Payloads"],
  },
  {
    title: "Backend",
    items: ["Flask API", "PostgreSQL", "TimescaleDB", "Redis Cache"],
  },
  {
    title: "AI/ML",
    items: ["Isolation Forest", "LSTM Predictor", "Scikit-learn", "TensorFlow Lite"],
  },
];

const TechStack = () => {
  return (
    <section className="py-24 relative overflow-hidden bg-muted/30" id="technology">
      <div className="absolute inset-0 grid-pattern opacity-20" />
      
      <div className="container relative z-10 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-status-normal/10 text-status-normal text-sm font-medium mb-4">
            Technology Stack
          </span>
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Industrial-Grade Components
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            Proven hardware and software for mission-critical monitoring
          </p>
        </motion.div>

        {/* Sensor Grid */}
        <div className="mb-16">
          <motion.h3
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-xl font-semibold text-center mb-8"
          >
            Sensor Integrations
          </motion.h3>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {sensors.map((sensor, index) => (
              <motion.div
                key={sensor.name}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                whileHover={{ y: -4 }}
                className={`p-4 rounded-xl border ${sensor.color} text-center`}
              >
                <div className="font-mono text-sm font-semibold text-foreground mb-1">
                  {sensor.name}
                </div>
                <div className="text-xs text-muted-foreground mb-2">
                  {sensor.type}
                </div>
                <div className="text-xs font-mono text-muted-foreground/70">
                  {sensor.specs}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Tech Layers */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {techLayers.map((layer, index) => (
            <motion.div
              key={layer.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="glass-card p-6"
            >
              <h4 className="text-lg font-semibold text-foreground mb-4 pb-2 border-b border-border">
                {layer.title}
              </h4>
              <ul className="space-y-2">
                {layer.items.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-muted-foreground">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                    <span className="font-mono text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TechStack;
