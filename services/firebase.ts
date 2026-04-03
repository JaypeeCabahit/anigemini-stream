import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyC_K9Jwhuo-8tXnfcOYyJHqw0eU4LW__FE",
  authDomain: "aniweb-stream.firebaseapp.com",
  projectId: "aniweb-stream",
  storageBucket: "aniweb-stream.firebasestorage.app",
  messagingSenderId: "894705655381",
  appId: "1:894705655381:web:91b1585c01dd6a45443edc",
  databaseURL: "https://aniweb-stream-default-rtdb.asia-southeast1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
