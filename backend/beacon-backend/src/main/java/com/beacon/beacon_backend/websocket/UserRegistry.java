// websocket/UserRegistry.java
package com.beacon.beacon_backend.websocket;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

public class UserRegistry {

    private static final Set<String> USERS =
            ConcurrentHashMap.newKeySet();

    public static void add(String username) {
        USERS.add(username);
    }

    public static void remove(String username) {
        USERS.remove(username);
    }

    public static Set<String> getUsers() {
        return USERS;
    }
}