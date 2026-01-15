

  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
 
  const firebaseConfig = {
    apiKey: "AIzaSyATJicgCiFF3d_EUUw5GQbzPox5M2uSkcw",
    authDomain: "logistica-d964e.firebaseapp.com",
    projectId: "logistica-d964e",
    storageBucket: "logistica-d964e.firebasestorage.app",
    messagingSenderId: "8417668413",
    appId: "1:8417668413:web:22b7b111e797949616a954"
  };

  const app = initializeApp(firebaseConfig);
  export const db = getFirestore(app);



