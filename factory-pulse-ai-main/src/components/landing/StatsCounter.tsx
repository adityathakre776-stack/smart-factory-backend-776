import { useEffect, useState, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Activity, Radio, Cpu, Brain } from "lucide-react";

interface CounterProps {
  end: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  duration?: number;
}

const AnimatedCounter = ({ end, suffix = "", prefix = "", decimals = 0, duration = 2 }: CounterProps) => {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  useEffect(() => {
    if (!isInView) return;

    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / (duration * 1000), 1);
      
      // Easing function for smooth animation
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      setCount(easeOutQuart * end);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [end, duration, isInView]);

  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {count.toFixed(decimals)}
      {suffix}
    </span>
  );
};

const stats = [
  {
    icon: Activity,
    value: 99.9,
    suffix: "%",
    label: "System Uptime",
    description: "Reliable 24/7 monitoring",
    color: "text-status-normal",
    bgColor: "bg-status-normal/10",
  },
  {
    icon: Radio,
    value: 10,
    suffix: "km",
    label: "LoRa Coverage",
    description: "Long-range connectivity",
    color: "text-neon-cyan",
    bgColor: "bg-neon-cyan/10",
  },
  {
    icon: Cpu,
    value: 247,
    suffix: "+",
    label: "Active Nodes",
    description: "Distributed sensor network",
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    icon: Brain,
    value: 95,
    suffix: "%",
    label: "AI Accuracy",
    description: "Anomaly detection precision",
    color: "text-accent",
    bgColor: "bg-accent/10",
  },
];

const StatsCounter = () => {
  return (
    <section className="py-20 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/30 to-background" />
      
      <div className="container relative z-10 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Trusted by Industry Leaders
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Our IoT monitoring platform powers factories worldwide with real-time insights
          </p>
        </motion.div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              whileHover={{ y: -5, transition: { duration: 0.2 } }}
              className="glass-card p-6 text-center group cursor-default"
            >
              <div className={`inline-flex p-3 rounded-xl ${stat.bgColor} mb-4 group-hover:scale-110 transition-transform`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
              <div className={`text-4xl md:text-5xl font-bold ${stat.color} mb-2`}>
                <AnimatedCounter
                  end={stat.value}
                  suffix={stat.suffix}
                  decimals={stat.value % 1 !== 0 ? 1 : 0}
                />
              </div>
              <div className="text-lg font-semibold text-foreground mb-1">
                {stat.label}
              </div>
              <div className="text-sm text-muted-foreground">
                {stat.description}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StatsCounter;
