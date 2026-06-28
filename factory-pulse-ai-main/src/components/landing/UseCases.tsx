import { motion } from "framer-motion";
import { Factory, Warehouse, Zap, FlaskConical } from "lucide-react";

const useCases = [
  {
    icon: Factory,
    title: "Manufacturing Plants",
    description: "Monitor CNC machines, assembly lines, and production equipment. Detect motor bearing wear, power anomalies, and optimize throughput.",
    stats: ["40% faster fault detection", "3x longer equipment life"],
    image: "linear-gradient(135deg, hsl(var(--primary) / 0.2), hsl(var(--neon-cyan) / 0.1))",
  },
  {
    icon: Warehouse,
    title: "Warehousing & Logistics",
    description: "Track conveyor systems, automated storage, and climate control. Ensure optimal conditions for sensitive goods storage.",
    stats: ["99.5% inventory accuracy", "50% energy savings"],
    image: "linear-gradient(135deg, hsl(var(--neon-cyan) / 0.2), hsl(var(--accent) / 0.1))",
  },
  {
    icon: Zap,
    title: "Power Plants & Utilities",
    description: "Monitor transformers, switchgear, and distribution networks. Predict failures before they cause outages.",
    stats: ["87% less downtime", "Real-time grid monitoring"],
    image: "linear-gradient(135deg, hsl(var(--status-warning) / 0.2), hsl(var(--primary) / 0.1))",
  },
  {
    icon: FlaskConical,
    title: "Chemical & Pharma",
    description: "Ensure safety compliance with gas leak detection, temperature monitoring, and automated emergency response systems.",
    stats: ["100% safety compliance", "Zero incident tracking"],
    image: "linear-gradient(135deg, hsl(var(--accent) / 0.2), hsl(var(--status-normal) / 0.1))",
  },
];

const UseCases = () => {
  return (
    <section className="py-24 relative overflow-hidden" id="use-cases">
      <div className="container relative z-10 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-accent/10 text-accent text-sm font-medium mb-4">
            Industry Applications
          </span>
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Built for Your Industry
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            Flexible architecture adapts to diverse industrial environments
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {useCases.map((useCase, index) => (
            <motion.div
              key={useCase.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              whileHover={{ scale: 1.02 }}
              className="group"
            >
              <div className="h-full glass-card overflow-hidden">
                {/* Header with gradient */}
                <div 
                  className="h-32 flex items-center justify-center relative"
                  style={{ background: useCase.image }}
                >
                  <useCase.icon className="w-16 h-16 text-foreground/80 group-hover:scale-110 transition-transform" />
                  <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />
                </div>

                {/* Content */}
                <div className="p-6">
                  <h3 className="text-xl font-semibold mb-3 text-foreground">
                    {useCase.title}
                  </h3>
                  <p className="text-muted-foreground mb-4 leading-relaxed">
                    {useCase.description}
                  </p>
                  
                  {/* Stats */}
                  <div className="flex flex-wrap gap-2">
                    {useCase.stats.map((stat) => (
                      <span
                        key={stat}
                        className="inline-flex items-center px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium"
                      >
                        {stat}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default UseCases;
