import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getDatabase, type Database } from 'firebase/database'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getAuth, type Auth } from 'firebase/auth'

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

let _app: FirebaseApp | null = null
let _db: Database | null = null
let _fs: Firestore | null = null
let _auth: Auth | null = null

function app() {
  if (!_app) _app = getApps().length ? getApps()[0] : initializeApp(config)
  return _app
}

export function getDb() {
  if (!_db) _db = getDatabase(app())
  return _db
}

export function getFs() {
  if (!_fs) _fs = getFirestore(app())
  return _fs
}

export function getAuthInstance() {
  if (!_auth) _auth = getAuth(app())
  return _auth
}
