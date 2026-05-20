import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCEN4V3d6WWHpghD4AKAEk6SKGyF_gRJBo",
  authDomain: "moodi-aea62.firebaseapp.com",
  projectId: "moodi-aea62",
  storageBucket: "moodi-aea62.firebasestorage.app",
  messagingSenderId: "32586665803",
  appId: "1:32586665803:web:65f8294be98c30c21de2ce",
  measurementId: "G-DHXZWMLL09"
};

// Prevent duplicate app initialisation (important in extension context)
const app: FirebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export default app;