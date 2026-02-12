import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";


export const auth = getAuth(app);


export const firebaseConfig = {
  apiKey: "AIzaSyATJicgCiFF3d_EUUw5GQbzPox5M2uSkcw",
  authDomain: "logistica-d964e.firebaseapp.com",
  projectId: "logistica-d964e",
  storageBucket: "logistica-d964e.firebasestorage.app",
  messagingSenderId: "8417668413",
  appId: "1:8417668413:web:22b7b111e797949616a954"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
