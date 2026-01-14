// Firebase v9+ (modular) via CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

// ✅ REEMPLAZÁ ESTE OBJETO por tu firebaseConfig real:
export const firebaseConfig = {
  apiKey: "REEMPLAZAR",
  authDomain: "REEMPLAZAR",
  projectId: "REEMPLAZAR",
  storageBucket: "REEMPLAZAR",
  messagingSenderId: "REEMPLAZAR",
  appId: "REEMPLAZAR",
};

// Init
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
