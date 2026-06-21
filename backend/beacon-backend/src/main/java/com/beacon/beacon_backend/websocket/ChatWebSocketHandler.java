package com.beacon.beacon_backend.websocket;

import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;


public class ChatWebSocketHandler extends TextWebSocketHandler {

    private static final List<WebSocketSession> sessions =
        new ArrayList<>();

    private static final Map<WebSocketSession, String> usernames =
        new ConcurrentHashMap<>();

    private static final ObjectMapper mapper =
        new ObjectMapper();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
        System.out.println("New user connected");
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
                    String payload = message.getPayload();
                    JsonNode json = mapper.readTree(payload);
                    if (json.has("username")) {
    usernames.put(session, json.get("username").asText());
}
        for (WebSocketSession s : sessions) {
            if (s.isOpen()) {
                s.sendMessage(message);
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
        System.out.println("User disconnected");
    }
}