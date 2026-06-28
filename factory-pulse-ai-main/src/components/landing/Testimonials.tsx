import { motion } from "framer-motion";
import { Star, Quote } from "lucide-react";

const testimonials = [
  {
    quote: "We reduced our maintenance costs by 40% in the first year. The AI predictions are incredibly accurate - we caught a motor failure 3 days before it would have shut down our entire line.",
    author: "Sarah Chen",
    role: "Plant Manager",
    company: "TechMfg Industries",
    rating: 5,
  },
  {
    quote: "The LoRa coverage is exceptional. We have sensors across 5 buildings and a 2km outdoor yard, all connected reliably through walls and equipment. Zero data loss.",
    author: "Michael Rodriguez",
    role: "Automation Engineer",
    company: "Pacific Logistics",
    rating: 5,
  },
  {
    quote: "Our safety compliance improved dramatically. The gas leak detection and automated shutoffs have prevented two potential incidents. This system pays for itself in peace of mind alone.",
    author: "Dr. Emily Watson",
    role: "HSE Director",
    company: "ChemProcess Ltd",
    rating: 5,
  },
];

const Testimonials = () => {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-mesh opacity-30" />
      
      <div className="container relative z-10 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            Customer Success
          </span>
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Trusted by Industry Leaders
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            See how factories worldwide transform operations with smart monitoring
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.author}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.15 }}
              whileHover={{ y: -5 }}
              className="glass-card p-6 flex flex-col"
            >
              {/* Quote icon */}
              <Quote className="w-10 h-10 text-primary/20 mb-4" />
              
              {/* Rating */}
              <div className="flex gap-1 mb-4">
                {[...Array(testimonial.rating)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-primary text-primary" />
                ))}
              </div>

              {/* Quote text */}
              <blockquote className="text-foreground leading-relaxed mb-6 flex-1">
                "{testimonial.quote}"
              </blockquote>

              {/* Author */}
              <div className="border-t border-border pt-4">
                <div className="font-semibold text-foreground">
                  {testimonial.author}
                </div>
                <div className="text-sm text-muted-foreground">
                  {testimonial.role}
                </div>
                <div className="text-sm text-primary">
                  {testimonial.company}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
