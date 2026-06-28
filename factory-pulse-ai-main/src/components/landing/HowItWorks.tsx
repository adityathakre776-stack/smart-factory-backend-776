import { motion } from "framer-motion";
import { Cpu, Radio, Server, Cloud, Monitor, ArrowRight } from "lucide-react";

const steps = [
  {
    icon: Cpu,
    title: "ESP32 Sensor Nodes",
    description: "Distributed sensors collect electrical, vibration, and environmental data across factory zones",
    color: "bg-primary text-primary-foreground",
  },
  {
    icon: Radio,
    title: "LoRa Transmission",
    description: "SX1278 modules transmit data up to 10km through industrial obstructions with ultra-low power",
    color: "bg-neon-cyan text-secondary-foreground",
  },
  {
    icon: Server,
    title: "Gateway Aggregation",
    description: "Central ESP32 gateway collects, processes, and implements real-time relay control logic",
    color: "bg-accent text-accent-foreground",
  },
  {
    icon: Cloud,
    title: "Cloud Processing",
    description: "Flask backend with PostgreSQL stores time-series data and runs AI anomaly detection",
    color: "bg-status-warning text-secondary-foreground",
  },
  {
    icon: Monitor,
    title: "Real-Time Dashboard",
    description: "Digital twin visualization with predictive analytics, alerts, and maintenance recommendations",
    color: "bg-status-normal text-secondary-foreground",
  },
];

const HowItWorks = () => {
  return (
    <section className="py-24 relative overflow-hidden bg-muted/30" id="how-it-works">
      <div className="absolute inset-0 grid-pattern opacity-20" />
      
      <div className="container relative z-10 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-neon-cyan/10 text-neon-cyan text-sm font-medium mb-4">
            System Architecture
          </span>
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            How It Works
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            Edge-to-cloud architecture enabling real-time monitoring and predictive maintenance
          </p>
        </motion.div>

        {/* Desktop flow */}
        <div className="hidden lg:block">
          <div className="flex items-center justify-between max-w-6xl mx-auto">
            {steps.map((step, index) => (
              <div key={step.title} className="flex items-center">
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.15 }}
                  className="flex flex-col items-center text-center max-w-[180px]"
                >
                  <div className={`w-16 h-16 rounded-2xl ${step.color} flex items-center justify-center mb-4 shadow-lg`}>
                    <step.icon className="w-8 h-8" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-snug">{step.description}</p>
                </motion.div>

                {index < steps.length - 1 && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.3, delay: index * 0.15 + 0.2 }}
                    className="mx-4"
                  >
                    <ArrowRight className="w-6 h-6 text-muted-foreground" />
                  </motion.div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Mobile/Tablet flow */}
        <div className="lg:hidden">
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary via-neon-cyan to-status-normal" />

            <div className="space-y-8">
              {steps.map((step, index) => (
                <motion.div
                  key={step.title}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="flex items-start gap-6 relative"
                >
                  <div className={`relative z-10 w-16 h-16 rounded-2xl ${step.color} flex items-center justify-center flex-shrink-0 shadow-lg`}>
                    <step.icon className="w-8 h-8" />
                  </div>
                  <div className="glass-card p-4 flex-1">
                    <h3 className="font-semibold text-foreground mb-1">{step.title}</h3>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* Data flow visualization */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-16 glass-card p-6 md:p-8 max-w-4xl mx-auto"
        >
          <div className="text-center mb-6">
            <h3 className="text-xl font-semibold mb-2">Real-Time Data Flow</h3>
            <p className="text-muted-foreground">Continuous monitoring with sub-second latency</p>
          </div>
          
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              Sensor Sampling: 100ms
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-neon-cyan/10 text-neon-cyan">
              <span className="w-2 h-2 rounded-full bg-neon-cyan animate-pulse" />
              LoRa Interval: 5s
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 text-accent">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              AI Processing: 1s
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-status-normal/10 text-status-normal">
              <span className="w-2 h-2 rounded-full bg-status-normal animate-pulse" />
              Dashboard Update: Live
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default HowItWorks;
