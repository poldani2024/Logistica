<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  const firebaseConfig = {
    apiKey: "AIzaSyATJicgCiFF3d_EUUw5GQbzPox5M2uSkcw",
    authDomain: "logistica-d964e.firebaseapp.com",
    projectId: "logistica-d964e",
    storageBucket: "logistica-d964e.firebasestorage.app",
    messagingSenderId: "8417668413",
    appId: "1:8417668413:web:22b7b111e797949616a954"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
</script>


