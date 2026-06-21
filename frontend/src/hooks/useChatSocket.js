import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL = "ws://localhost:8080/chat";

export function useChatSocket(onMessage) {
  const socketRef = useRef(null);
  const [status, setStatus] = useState("offline");

  useEffect(() => {
    let socket;

    try {
      socket = new WebSocket(WS_URL);
      socketRef.current = socket;
      setStatus("connecting");

     socket.onopen = () => {
  console.log("CONNECTED");
  setStatus("online");
};

socket.onclose = (event) => {
  console.log("CLOSED", event.code, event.reason);
  setStatus("offline");
};

socket.onerror = (error) => {
  console.log("ERROR", error);
  setStatus("offline");
};

socket.onmessage = (event) => {
  console.log("MESSAGE", event.data);
  onMessage?.(event.data);
};
    } catch {
      setStatus("offline");
    }

    return () => socket?.close();
  }, []);

  const send = useCallback((payload) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(payload);
      return true;
    }
    return false;
  }, []);

  return { send, status };
}
