import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyCAx_UsY1kCL01fobO6fWkXpbLC93XF1Vo",
    authDomain: "invoiceai-flow.firebaseapp.com",
    projectId: "invoiceai-flow",
    storageBucket: "invoiceai-flow.firebasestorage.app",
    messagingSenderId: "242344344796",
    appId: "1:242344344796:web:7c2d5f10a5ca4b40d04819",
    measurementId: "G-ZESE0H37N4"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);