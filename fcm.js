// fcm.js — Módulo de notificaciones push (Firebase Cloud Messaging)
// Para activar FCM completamente necesitás:
//   1. Obtener tu VAPID key en Firebase Console → Project Settings → Cloud Messaging
//   2. Reemplazar VAPID_KEY_PLACEHOLDER con tu clave pública
//   3. Crear Cloud Functions para enviar notificaciones server-side

import { app, db } from "./firebase-init.js";

import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

import {
  getMessaging,
  getToken,
  onMessage
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-messaging.js";

// Reemplazar con la clave VAPID de Firebase Console
// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
const VAPID_KEY = ""; // TODO: pegar tu VAPID key pública aquí

let _messaging = null;

function getMsg() {
  if (!_messaging) {
    try {
      _messaging = getMessaging(app);
    } catch (e) {
      console.warn("FCM no disponible:", e);
      return null;
    }
  }
  return _messaging;
}

/**
 * Solicita permiso de notificaciones y registra el token FCM en Firestore.
 * Devuelve el token o null si el usuario rechaza o hay error.
 */
export async function requestNotificationPermission(uid) {
  if (!uid) return null;
  if (!("Notification" in window)) {
    console.warn("FCM: navegador no soporta notificaciones");
    return null;
  }

  const messaging = getMsg();
  if (!messaging) return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.info("FCM: permiso denegado por el usuario");
      return null;
    }

    const swReg = await navigator.serviceWorker.ready;

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg
    });

    if (token) {
      await saveFcmToken(uid, token);
      console.info("FCM: token registrado");
    }

    return token;
  } catch (e) {
    console.warn("FCM: error al obtener token", e);
    return null;
  }
}

/**
 * Guarda el token FCM en Firestore bajo /fcmTokens/{uid}
 */
async function saveFcmToken(uid, token) {
  await setDoc(doc(db, "fcmTokens", uid), {
    token,
    updatedAt: serverTimestamp(),
    userAgent: navigator.userAgent || "",
    platform: navigator.platform || ""
  }, { merge: true });
}

/**
 * Escucha mensajes en foreground (cuando la app está abierta)
 * onNotification(payload) recibe el mensaje
 */
export function listenForegroundMessages(onNotification) {
  const messaging = getMsg();
  if (!messaging) return () => {};

  return onMessage(messaging, (payload) => {
    console.log("FCM foreground message:", payload);
    if (typeof onNotification === "function") onNotification(payload);
  });
}

/**
 * Muestra un toast de notificación en la app (para mensajes en foreground)
 */
export function showInAppNotification(payload, toastFn) {
  const title = payload?.notification?.title || payload?.data?.title || "Nueva notificación";
  const body = payload?.notification?.body || payload?.data?.body || "";
  const msg = body ? `${title}: ${body}` : title;
  if (typeof toastFn === "function") toastFn(msg);
}
