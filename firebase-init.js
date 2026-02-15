
// firebase-init.js
// 1) Pegá tu firebaseConfig del proyecto (Firebase Console > Project settings > SDK setup)
// 2) Asegurate de habilitar Auth Google y Firestore en modo producción o reglas seguras.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

// ⚠️ Reemplazar por tu config real:
export const firebaseConfig = {
  apiKey: "REEMPLAZAR",
  authDomain: "REEMPLAZAR",
  projectId: "REEMPLAZAR",
  storageBucket: "REEMPLAZAR",
  messagingSenderId: "REEMPLAZAR",
  appId: "REEMPLAZAR"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
