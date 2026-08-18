import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

// Konfigurasi Firebase untuk project: nilai-gizi-405f5
const firebaseConfig = {
  apiKey: "AIzaSyCu2grCoNaLdq4cSVPI8vq1Ifarfk-u4eg",
  authDomain: "nilai-gizi-405f5.firebaseapp.com",
  projectId: "nilai-gizi-405f5",
  storageBucket: "nilai-gizi-405f5.firebasestorage.app",
  messagingSenderId: "1032982833997",
  appId: "1:1032982833997:web:d27d4b781cf151d7942504",
  measurementId: "G-SF2NRGQP3V"
}

// Inisialisasi Firebase
const app = initializeApp(firebaseConfig)

export const db = getFirestore(app)
export const storage = getStorage(app)
export default app
