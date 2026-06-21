import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FiMenu } from "react-icons/fi";
import { initialMessages } from "../../data/mockMessages.js";
import { useChatSocket } from "../../hooks/useChatSocket.js";
import IconButton from "../ui/IconButton.jsx";
import Sidebar from "./Sidebar.jsx";
import ChatPanel from "./ChatPanel.jsx";


export default function AppShell() {
  const [username] = useState(
  () => localStorage.getItem("username") || prompt("Enter your username")
);
useEffect(() => {
  if (username) {
    localStorage.setItem("username", username);
  }
}, [username]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeChannel, setActiveChannel] = useState("general");
  const [messages, setMessages] = useState(initialMessages);

const addIncomingMessage = useCallback((payload) => {

  const data = JSON.parse(payload);

  setMessages((current) => [
    ...current,
    {
      id: crypto.randomUUID(),
      author: data.username,
      role: data.username === username ? "self" : "other",
      text: data.message,
      time: new Intl.DateTimeFormat([], {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date()),
    }
  ]);

}, [username]);

  const { send, status } = useChatSocket(addIncomingMessage);
const handleSend = useCallback(
  (text) => {

    send(
      JSON.stringify({
        username,
        message: text,
      })
    );
},
  [send, username]
);
const channelName = useMemo(
  () =>
    activeChannel
      .replace("-", " ")
      .replace(/\b\w/g, (char) => char.toUpperCase()),
  [activeChannel]
);
  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--page-bg)] text-[var(--text-primary)] transition-colors duration-500">
      <div className="ambient-bg" aria-hidden="true" />
      <div className="noise-layer" aria-hidden="true" />

      <div className="relative z-10 flex min-h-screen p-3 sm:p-4 lg:p-6">
        <motion.aside
          initial={false}
          animate={{ width: sidebarOpen ? 292 : 84 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className="hidden shrink-0 md:block"
        >
          <Sidebar
            activeChannel={activeChannel}
            collapsed={!sidebarOpen}
            onChannelChange={setActiveChannel}
            onToggle={() => setSidebarOpen((value) => !value)}
            status={status}
          />
        </motion.aside>

        <div className="flex min-w-0 flex-1 flex-col gap-3 md:pl-4">
          <div className="flex items-center gap-2 md:hidden">
            <IconButton label="Toggle menu" onClick={() => setSidebarOpen((value) => !value)}>
              <FiMenu />
            </IconButton>
            <span className="text-sm font-semibold">Beacon</span>
          </div>

          {sidebarOpen && (
            <div className="md:hidden">
              <Sidebar
                activeChannel={activeChannel}
                collapsed={false}
                onChannelChange={setActiveChannel}
                onToggle={() => setSidebarOpen(false)}
                status={status}
              />
            </div>
          )}

          <ChatPanel
            channelName={channelName}
            messages={messages}
            onSend={handleSend}
            socketStatus={status}
          />
        </div>
      </div>
    </main>
  );
}
