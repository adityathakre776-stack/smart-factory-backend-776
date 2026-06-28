import { motion } from "framer-motion";
import { 
  Radio, 
  Brain, 
  Eye, 
  Wrench, 
  Shield, 
  Zap 
} from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Multi-Sensor Integration",
    description: "Comprehensive data acquisition from PZEM004T electrical meters, MPU6050 vibration sensors, flame/gas/smoke detectors, and ultrasonic proximity sensors.",
    color: "text-primary",
    bgGradient: "from-primary/20 to-primary/5",
  },
  {
    icon: Radio,
    title: "LoRa Long-Range",
    description: "SX1278 LoRa modules provide 10km coverage through industrial obstructions with ultra-low power consumption and reliable packet delivery.",
    color: "text-neon-cyan",
    bgGradient: "from-neon-cyan/20 to-neon-cyan/5",
  },
  {
    icon: Brain,
    title: "AI Anomaly Detection",
    description: "Hybrid Statistical-ML model (HSMA) combines edge TinyML with cloud Isolation Forest for 95% detection accuracy while maintaining efficiency.",
    color: "text-accent",
    bgGradient: "from-accent/20 to-accent/5",
  },
  {
    icon: Eye,
    title: "Digital Twin",
    description: "Real-time factory floor visualization with thermal heatmaps, node status mapping, and interactive zone monitoring for complete situational awareness.",
    color: "text-neon-cyan",
    bgGradient: "from-neon-cyan/20 to-neon-cyan/5",
  },
  {
    icon: Wrench,
    title: "Predictive Maintenance",
    description: "RUL estimation and AI-driven root cause analysis reduce unplanned downtime by 87% through proactive equipment servicing recommendations.",
    color: "text-status-warning",
    bgGradient: "from-status-warning/20 to-status-warning/5",
  },
  {
    icon: Shield,
    title: "Safety Compliance",
    description: "Automated hazard response with closed-loop relay control, smart alert triaging, and worker safety interlocks for regulatory compliance.",
    color: "text-status-normal",
    bgGradient: "from-status-normal/20 to-status-normal/5",
  },
];

const Features = () => {
  return (
    <section className="py-24 relative overflow-hidden" id="features">
      <div className="absolute inset-0 bg-gradient-mesh opacity-50" />
      
      <div className="container relative z-10 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            Powerful Features
          </span>
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Everything You Need for
            <span className="block text-primary">Factory Intelligence</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            A complete IoT ecosystem designed for Industry 4.0, combining edge computing, 
            AI analytics, and real-time monitoring.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              whileHover={{ 
                y: -8,
                transition: { duration: 0.2 }
              }}
              className="group"
            >
              <div className="h-full glass-card p-6 hover:border-primary/30 transition-all duration-300">
                {/* Icon */}
                <div className={`relative mb-5`}>
                  <div className={`absolute inset-0 bg-gradient-to-br ${feature.bgGradient} rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity`} />
                  <div className={`relative inline-flex p-4 rounded-2xl bg-gradient-to-br ${feature.bgGradient}`}>
                    <feature.icon className={`w-7 h-7 ${feature.color}`} />
                  </div>
                </div>

                {/* Content */}
                <h3 className="text-xl font-semibold mb-3 text-foreground group-hover:text-primary transition-colors">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
