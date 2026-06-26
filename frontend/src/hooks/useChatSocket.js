import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getToken } from '../services/api.js';
const URL = import.meta.env.VITE_WS_URL || `http://localhost:8080`;
export function useChatSocket(handlers={}) {
  const socketRef=useRef(null), handlersRef=useRef(handlers); const [status,setStatus]=useState('connecting');
  useEffect(()=>{handlersRef.current=handlers},[handlers]);
  useEffect(()=>{const socket=io(URL,{auth:{token:getToken()},transports:['websocket'],upgrade:false,reconnection:true,reconnectionDelay:1000,reconnectionDelayMax:5000,timeout:5000});socketRef.current=socket;socket.on('connect',()=>setStatus('online'));socket.on('disconnect',()=>setStatus('reconnecting'));socket.on('connect_error',error=>{setStatus('reconnecting');if(error.message==='unauthorized')handlersRef.current.onError?.('Your session expired. Please log in again.')});['receive_message','message_updated','message_deleted','presence','notification','connection_accept','connection_accepted','connection_rejected','connection_removed','chat_cleared','create_channel','leave_channel','message_read','typing','stop_typing','user_online','user_offline'].forEach(event=>socket.on(event,data=>handlersRef.current.onEvent?.(event,data)));return()=>socket.disconnect()},[]);
  const emit=useCallback((event,payload,ack)=>socketRef.current?.emit(event,payload,ack),[]);
  return {status,emit};
}
