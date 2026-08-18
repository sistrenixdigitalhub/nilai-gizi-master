/**
 * Script to sync menu data from admin panel to Firebase
 * Usage: node sync-to-firebase.js
 */

const axios = require('axios');
const admin = require('firebase-admin');

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCu2grCoNaLdq4cSVPI8vq1Ifarfk-u4eg",
  authDomain: "nilai-gizi-405f5.firebaseapp.com",
  projectId: "nilai-gizi-405f5",
  storageBucket: "nilai-gizi-405f5.firebasestorage.app",
  messagingSenderId: "1032982833997",
  appId: "1:1032982833997:web:d27d4b781cf151d7942504",
  measurementId: "G-SF2NRGQP3V"
};

// Initialize Firebase Admin SDK (requires service account key)
// For now, we'll use REST API which works without service account
const ADMIN_PANEL_URL = 'https://binawidya-simpang-baru-7-nilai-gizi.vercel.app/api/storage';
const FIRESTORE_URL = 'https://firestore.googleapis.com/v1/projects/nilai-gizi-405f5/databases/(default)/documents/sppg/menu-current';
const FIREBASE_KEY = firebaseConfig.apiKey;

async function syncDataToFirebase() {
  try {
    console.log('🔄 Fetching menu data from admin panel...');
    
    // Step 1: Get data from admin panel storage API
    const storageRes = await axios.get(`${ADMIN_PANEL_URL}?key=sppg-menu-current&_=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (!storageRes.data || !storageRes.data.value) {
      console.error('❌ No data found in admin panel storage');
      return;
    }

    let menuData = storageRes.data.value;
    if (typeof menuData === 'string') {
      menuData = JSON.parse(menuData);
    }

    console.log('✓ Data fetched from admin panel');
    console.log('Menu Title:', menuData.title);
    console.log('Menu Items:', menuData.menuItems);

    // Step 2: Add timestamp
    const dataToSave = {
      ...menuData,
      savedAt: new Date().toISOString()
    };

    // Step 3: Convert data to Firestore format
    const firestoreData = convertToFirestoreFormat(dataToSave);

    console.log('🚀 Uploading to Firebase Firestore...');
    
    // Step 4: Upload to Firebase using REST API
    const response = await axios.patch(
      `${FIRESTORE_URL}?key=${FIREBASE_KEY}`,
      firestoreData,
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    console.log('✅ Data successfully synced to Firebase!');
    console.log('Document:', response.data.name);
    
  } catch (error) {
    console.error('❌ Error syncing data:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

function convertToFirestoreFormat(data) {
  // Convert JS object to Firestore REST API format
  const fields = {};
  
  for (const [key, value] of Object.entries(data)) {
    fields[key] = convertValue(value);
  }

  return { fields };
}

function convertValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: value.toString() };
    } else {
      return { doubleValue: value };
    }
  }
  
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(v => convertValue(v))
      }
    };
  }
  
  if (typeof value === 'object') {
    const mapFields = {};
    for (const [k, v] of Object.entries(value)) {
      mapFields[k] = convertValue(v);
    }
    return { mapValue: { fields: mapFields } };
  }
  
  return { stringValue: String(value) };
}

// Run the sync
syncDataToFirebase();
