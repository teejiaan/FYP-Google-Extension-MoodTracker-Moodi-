import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCEN4V3d6WWHpghD4AKAEk6SKGyF_gRJBo",
  authDomain: "moodi-aea62.firebaseapp.com",
  projectId: "moodi-aea62",
  storageBucket: "moodi-aea62.firebasestorage.app",
  messagingSenderId: "32586665803",
  appId: "1:32586665803:web:65f8294be98c30c21de2ce",
  measurementId: "G-DHXZWMLL09",
};

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
