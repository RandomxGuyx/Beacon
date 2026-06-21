import { motion } from "framer-motion";

export default function MessageBubble({ message }) {
  const isUser = message.role === "self";

  return (
    <motion.article
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser && <div className="mt-1 h-9 w-9 shrink-0 rounded-2xl bg-[var(--assistant-avatar)] shadow-glow" />}

      <div className={`max-w-[88%] sm:max-w-[72%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div className="flex items-center gap-2 px-1 text-xs text-[var(--text-muted)]">
          <span>{message.author}</span>
          <span>{message.time}</span>
        </div>
        <div
          className={`rounded-[22px] border px-4 py-3 text-sm leading-relaxed shadow-lg backdrop-blur-glass sm:text-[15px] ${
            isUser
              ? "border-white/20 bg-[var(--user-bubble)] text-white"
              : "border-[var(--glass-border)] bg-[var(--assistant-bubble)] text-[var(--text-primary)]"
          }`}
        >
          {message.text}
        </div>
      </div>

      {isUser && <div className="mt-1 h-9 w-9 shrink-0 rounded-2xl bg-[var(--user-avatar)] shadow-glow" />}
    </motion.article>
  );
}
