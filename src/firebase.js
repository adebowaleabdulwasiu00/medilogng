import { initializeApp as realInitializeApp } from 'firebase/app'
import {
  initializeFirestore as realInitializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection as realCollection, query as realQuery, where as realWhere, getDocs as realGetDocs, onSnapshot as realOnSnapshot,
  runTransaction as realRunTransaction, writeBatch as realWriteBatch, serverTimestamp as realServerTimestamp,
  doc as realDoc, getDoc as realGetDoc, setDoc as realSetDoc, addDoc as realAddDoc, updateDoc as realUpdateDoc,
  deleteDoc as realDeleteDoc, orderBy as realOrderBy, limit as realLimit, startAfter as realStartAfter,
} from 'firebase/firestore'
import {
  getAuth as realGetAuth, GoogleAuthProvider as RealGoogleAuthProvider, signInWithPopup as realSignInWithPopup,
  signInWithEmailAndPassword as realSignInWithEmailAndPassword, createUserWithEmailAndPassword as realCreateUserWithEmailAndPassword,
  signOut as realSignOut, onAuthStateChanged as realOnAuthStateChanged, setPersistence as realSetPersistence,
  browserLocalPersistence, updatePassword as realUpdatePassword, sendEmailVerification as realSendEmailVerification,
  EmailAuthProvider as RealEmailAuthProvider, reauthenticateWithCredential as realReauthenticateWithCredential,
} from 'firebase/auth'

// ---------------------------------------------------------------------------
// Robust Config Extractor: handles raw strings, quotes, or pasted config snippets
// ---------------------------------------------------------------------------

function extractSnippetValue(val, key) {
  if (!val || typeof val !== 'string') return ''
  const trimmed = val.trim()
  if (trimmed.includes('firebaseConfig') || trimmed.includes('{') || trimmed.includes('\n') || trimmed.includes('//')) {
    const match = trimmed.match(new RegExp(`\\b${key}\\s*:\\s*["']([^"']+)["']`))
    if (match && match[1]) return match[1].trim()
  }
  return trimmed.replace(/^['"]|['"]$/g, '').trim()
}

function resolveFirebaseConfig() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env)
    ? import.meta.env
    : (typeof process !== 'undefined' && process.env ? process.env : {})

  const envList = [
    env.VITE_FIREBASE_API_KEY,
    env.VITE_FIREBASE_APP_ID,
    env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    env.VITE_FIREBASE_PROJECT_ID,
    env.VITE_FIREBASE_AUTH_DOMAIN,
    env.VITE_FIREBASE_STORAGE_BUCKET,
  ]
  const fullSnippet = envList.find((v) => typeof v === 'string' && (v.includes('apiKey:') || v.includes('firebaseConfig')))

  const getVal = (directVal, key) => {
    if (fullSnippet) {
      const match = fullSnippet.match(new RegExp(`\\b${key}\\s*:\\s*["']([^"']+)["']`))
      if (match && match[1]) return match[1].trim()
    }
    return extractSnippetValue(directVal, key)
  }

  return {
    apiKey: getVal(env.VITE_FIREBASE_API_KEY, 'apiKey'),
    authDomain: getVal(env.VITE_FIREBASE_AUTH_DOMAIN, 'authDomain'),
    projectId: getVal(env.VITE_FIREBASE_PROJECT_ID, 'projectId'),
    storageBucket: getVal(env.VITE_FIREBASE_STORAGE_BUCKET, 'storageBucket'),
    messagingSenderId: getVal(env.VITE_FIREBASE_MESSAGING_SENDER_ID, 'messagingSenderId'),
    appId: getVal(env.VITE_FIREBASE_APP_ID, 'appId'),
  }
}

export const firebaseConfig = resolveFirebaseConfig()

export function hasFirebaseConfig() {
  return (
    typeof firebaseConfig.apiKey === 'string' &&
    firebaseConfig.apiKey.length > 10 &&
    !firebaseConfig.apiKey.includes(' ') &&
    !firebaseConfig.apiKey.includes('\n') &&
    typeof firebaseConfig.projectId === 'string' &&
    firebaseConfig.projectId.trim() !== ''
  )
}

// ---------------------------------------------------------------------------
// In-Memory / LocalStorage Mock Layer (runs when Firebase config is not set or fails)
// ---------------------------------------------------------------------------

const LOCAL_STORAGE_PREFIX = 'medilogng_db_'
const AUTH_USER_KEY = 'medilogng_mock_user'
const AUTH_ACCOUNTS_KEY = 'medilogng_mock_accounts'

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function loadStorage(colName) {
  if (!isBrowser()) return []
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + colName)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function saveStorage(colName, items) {
  if (!isBrowser()) return
  try {
    localStorage.setItem(LOCAL_STORAGE_PREFIX + colName, JSON.stringify(items))
  } catch (e) {
    console.warn('[mock-db] write failed:', e?.message)
  }
}

function reviveTimestamp(v) {
  if (v && typeof v === 'object' && (v._isServerTimestamp || v.toMillis != null || v.seconds != null)) {
    const millis = typeof v.toMillis === 'function' ? v.toMillis() : (typeof v.toMillis === 'number' ? v.toMillis : (v.seconds ? v.seconds * 1000 : Date.now()))
    return {
      _isServerTimestamp: true,
      seconds: Math.floor(millis / 1000),
      toMillis: () => millis,
    }
  }
  return v
}

function reviveRecord(item) {
  if (!item || typeof item !== 'object') return item
  const copy = { ...item }
  for (const k of Object.keys(copy)) {
    copy[k] = reviveTimestamp(copy[k])
  }
  return copy
}

function normalizeDocData(data) {
  const normalized = { ...data }
  for (const [k, v] of Object.entries(normalized)) {
    if (v && typeof v === 'object' && v._isServerTimestamp) {
      const now = Date.now()
      normalized[k] = {
        _isServerTimestamp: true,
        seconds: Math.floor(now / 1000),
        toMillis: now,
      }
    }
  }
  return normalized
}

// Seed initial hospital and sample records if storage is completely fresh
function seedInitialDataIfEmpty() {
  if (!isBrowser()) return
  const existingOrgs = loadStorage('organizations')
  if (existingOrgs.length > 0) return

  const now = Date.now()
  const orgId = 'IMR-HOS-001'
  const doctorUid = 'usr_doctor_1'

  saveStorage('organizations', [
    {
      id: orgId,
      name: 'Imradex Specialist Hospital',
      organization_type: 'General Hospital',
      state: 'Lagos',
      lga: 'Ikeja',
      status: 'active',
      created_by: doctorUid,
      created_at: { _isServerTimestamp: true, seconds: Math.floor((now - 86400000 * 30) / 1000), toMillis: now - 86400000 * 30 },
    },
  ])

  saveStorage('organization_memberships', [
    {
      id: `${orgId}_${doctorUid}`,
      organization_id: orgId,
      user_id: doctorUid,
      staff_name: 'Dr. Adebowale Wasiu',
      role: 'hospital_admin',
      status: 'active',
      capabilities: ['*'],
      email_verification_required: false,
      must_change_password: false,
      created_at: { _isServerTimestamp: true, seconds: Math.floor((now - 86400000 * 30) / 1000), toMillis: now - 86400000 * 30 },
    },
  ])

  saveStorage('payers', [
    { id: 'payer_1', name: 'Self-pay', category: 'self', code: 'CASH', active: true, sort_order: 10, organization_id: orgId },
    { id: 'payer_2', name: 'NHIA', category: 'government', code: 'NHIA-01', active: true, sort_order: 20, organization_id: orgId },
    { id: 'payer_3', name: 'HMO · Axa Mansard', category: 'hmo', code: 'AXA', active: true, sort_order: 30, organization_id: orgId },
    { id: 'payer_4', name: 'HMO · Hygeia', category: 'hmo', code: 'HYG', active: true, sort_order: 40, organization_id: orgId },
  ])

  const p1 = {
    id: 'pid_001',
    patient_id: 'pid_001',
    organization_id: orgId,
    mrn: 'IMR-OKO001',
    surname: 'Okonkwo',
    given_names: 'Chinedu Emeka',
    full_name: 'Chinedu Emeka Okonkwo',
    phone: '+2348031234567',
    phone_key: '8031234567',
    sex: 'Male',
    dob: '1988-04-12',
    address: '14 Allen Avenue, Ikeja, Lagos',
    blood_group: 'O+',
    allergy: 'Penicillin',
    payer: 'NHIA',
    status: 'active',
    created_at: { _isServerTimestamp: true, seconds: Math.floor((now - 86400000 * 5) / 1000), toMillis: now - 86400000 * 5 },
    updated_at: { _isServerTimestamp: true, seconds: Math.floor((now - 86400000 * 5) / 1000), toMillis: now - 86400000 * 5 },
  }

  const p2 = {
    id: 'pid_002',
    patient_id: 'pid_002',
    organization_id: orgId,
    mrn: 'IMR-ADE002',
    surname: 'Adebayo',
    given_names: 'Folashade Zainab',
    full_name: 'Folashade Zainab Adebayo',
    phone: '+2348029876543',
    phone_key: '8029876543',
    sex: 'Female',
    dob: '1995-11-20',
    address: '8 Bode Thomas Street, Surulere, Lagos',
    blood_group: 'B+',
    allergy: 'None known',
    payer: 'Self-pay',
    status: 'active',
    created_at: { _isServerTimestamp: true, seconds: Math.floor((now - 86400000 * 2) / 1000), toMillis: now - 86400000 * 2 },
    updated_at: { _isServerTimestamp: true, seconds: Math.floor((now - 86400000 * 2) / 1000), toMillis: now - 86400000 * 2 },
  }

  saveStorage('patients', [p1, p2])
  saveStorage('organization_patients', [
    { ...p1, id: `${orgId}_pid_001` },
    { ...p2, id: `${orgId}_pid_002` },
  ])

  saveStorage('appointments', [
    {
      id: 'appt_001',
      organization_id: orgId,
      patient_id: 'pid_002',
      patientName: 'Folashade Zainab Adebayo',
      clinic: 'General Outpatient (GOPD)',
      time: '09:30 AM',
      status: 'checked-in',
      notes: 'Follow-up consultation',
      created_at: { _isServerTimestamp: true, seconds: Math.floor((now - 3600000) / 1000), toMillis: now - 3600000 },
    },
  ])

  saveStorage('drugs', [
    { id: 'drug_1', organization_id: orgId, name: 'Paracetamol 500mg', stock: 140, status: 'Active', unit_price: 250 },
    { id: 'drug_2', organization_id: orgId, name: 'Amoxicillin 500mg', stock: 85, status: 'Active', unit_price: 1200 },
    { id: 'drug_3', organization_id: orgId, name: 'Artemether-Lumefantrine 80/480mg', stock: 12, status: 'Low', unit_price: 2800 },
    { id: 'drug_4', organization_id: orgId, name: 'Ciprofloxacin 500mg', stock: 5, status: 'Low', unit_price: 1500 },
  ])

  saveStorage('wards', [
    { id: 'ward_1', organization_id: orgId, name: 'Female Medical Ward', beds: 12, occupied: 3 },
    { id: 'ward_2', organization_id: orgId, name: 'Male Medical Ward', beds: 12, occupied: 2 },
    { id: 'ward_3', organization_id: orgId, name: 'Pediatric Ward', beds: 8, occupied: 1 },
  ])

  saveStorage('invoices', [
    { id: 'INV-2026-001', invoiceId: 'INV-2026-001', organization_id: orgId, patientName: 'Chinedu Emeka Okonkwo', total: 14500, paid: 14500, status: 'Paid', created_at: { _isServerTimestamp: true, seconds: Math.floor((now - 86400000) / 1000), toMillis: now - 86400000 } },
    { id: 'INV-2026-002', invoiceId: 'INV-2026-002', organization_id: orgId, patientName: 'Folashade Zainab Adebayo', total: 6200, paid: 0, status: 'Unpaid', created_at: { _isServerTimestamp: true, seconds: Math.floor(now / 1000), toMillis: now } },
  ])

  const accounts = [
    { uid: doctorUid, email: 'doctor@hospital.ng', displayName: 'Dr. Adebowale Wasiu', password: 'password123' },
  ]
  saveStorage(AUTH_ACCOUNTS_KEY, accounts)
}

// ---- Mock Auth State ----
const authListeners = new Set()

function createMockUser(uid, email, displayName) {
  return {
    uid,
    email: email.trim().toLowerCase(),
    displayName: displayName || email.split('@')[0],
    emailVerified: true,
    getIdToken: async () => 'mock-id-token-' + uid,
    reload: async () => {},
  }
}

function getStoredMockUser() {
  if (!isBrowser()) return null
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return createMockUser(parsed.uid, parsed.email, parsed.displayName)
  } catch {
    return null
  }
}

function setStoredMockUser(u) {
  if (!isBrowser()) return
  try {
    if (u) {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify({ uid: u.uid, email: u.email, displayName: u.displayName }))
    } else {
      localStorage.removeItem(AUTH_USER_KEY)
    }
  } catch {}
}

const mockAuth = {
  currentUser: getStoredMockUser(),
}

function triggerAuthListeners() {
  authListeners.forEach((fn) => {
    try { fn(mockAuth.currentUser) } catch (e) { console.warn(e) }
  })
}

// ---- Real or Mock Initialization ----
let app, db, auth, googleProvider
let isRealFirebase = false

if (hasFirebaseConfig()) {
  try {
    app = realInitializeApp(firebaseConfig)
    auth = realGetAuth(app)
    db = realInitializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
    googleProvider = new RealGoogleAuthProvider()
    realSetPersistence(auth, browserLocalPersistence).catch(() => {})
    isRealFirebase = true
    console.info('[MediLog NG] Connected to live Firebase project:', firebaseConfig.projectId)
  } catch (err) {
    console.warn('[MediLog NG] Live Firebase initialization failed, safely falling back to local offline store:', err?.message)
    isRealFirebase = false
  }
}

if (!isRealFirebase) {
  seedInitialDataIfEmpty()
  console.info('[MediLog NG] Running with local offline-first storage. All modules fully operational.')
  app = { name: '[DEFAULT]', options: firebaseConfig }
  auth = mockAuth
  googleProvider = {}
  db = { __mock: true }
}

// ---- Exported Firestore & Auth APIs ----

export function collection(dbInstance, path) {
  if (isRealFirebase) return realCollection(dbInstance, path)
  return { __type: 'collection', path }
}

export function doc(first, ...rest) {
  if (isRealFirebase) return realDoc(first, ...rest)
  if (first && first.__type === 'collection') {
    const id = rest[0] || ('doc_' + Math.random().toString(36).slice(2, 10))
    return { __type: 'doc', collection: first.path, id, path: `${first.path}/${id}` }
  }
  const colName = rest[0]
  const id = rest[1] || ('doc_' + Math.random().toString(36).slice(2, 10))
  return { __type: 'doc', collection: colName, id, path: `${colName}/${id}` }
}

export function query(target, ...constraints) {
  if (isRealFirebase) return realQuery(target, ...constraints)
  return {
    __type: 'query',
    target,
    collection: target.path || (target.__type === 'doc' ? target.collection : ''),
    constraints: constraints.filter(Boolean),
  }
}

export function where(field, op, val) {
  if (isRealFirebase) return realWhere(field, op, val)
  return { __type: 'where', field, op, val }
}

export function orderBy(field, dir = 'asc') {
  if (isRealFirebase) return realOrderBy(field, dir)
  return { __type: 'orderBy', field, dir }
}

export function limit(n) {
  if (isRealFirebase) return realLimit(n)
  return { __type: 'limit', n }
}

export function startAfter(...args) {
  if (isRealFirebase) return realStartAfter(...args)
  return { __type: 'startAfter', args }
}

export function serverTimestamp() {
  if (isRealFirebase) return realServerTimestamp()
  const now = Date.now()
  return {
    _isServerTimestamp: true,
    seconds: Math.floor(now / 1000),
    nanoseconds: 0,
    toMillis: () => now,
  }
}

export async function getDocs(targetQuery) {
  if (isRealFirebase) return realGetDocs(targetQuery)
  const colName = targetQuery.collection || (targetQuery.__type === 'collection' ? targetQuery.path : '')
  let items = loadStorage(colName).map(reviveRecord)
  const constraints = targetQuery.constraints || []

  for (const c of constraints) {
    if (c.__type === 'where') {
      const { field, op, val } = c
      items = items.filter((item) => {
        const itemVal = item[field]
        if (op === '==') return itemVal === val
        if (op === '!=') return itemVal !== val
        if (op === 'array-contains') return Array.isArray(itemVal) && itemVal.includes(val)
        if (op === 'in') return Array.isArray(val) && val.includes(itemVal)
        return true
      })
    }
  }

  for (const c of constraints) {
    if (c.__type === 'orderBy') {
      const { field, dir } = c
      items.sort((a, b) => {
        const av = a[field] && typeof a[field].toMillis === 'function' ? a[field].toMillis() : (a[field] ?? '')
        const bv = b[field] && typeof b[field].toMillis === 'function' ? b[field].toMillis() : (b[field] ?? '')
        if (av < bv) return dir === 'desc' ? 1 : -1
        if (av > bv) return dir === 'desc' ? -1 : 1
        return 0
      })
    }
  }

  for (const c of constraints) {
    if (c.__type === 'limit') {
      items = items.slice(0, c.n)
    }
  }

  return {
    docs: items.map((item) => ({
      id: item.id,
      exists: () => true,
      data: () => ({ ...item }),
    })),
  }
}

export async function getDoc(docRef) {
  if (isRealFirebase) return realGetDoc(docRef)
  const colName = docRef.collection
  const items = loadStorage(colName).map(reviveRecord)
  const found = items.find((i) => i.id === docRef.id)
  return {
    id: docRef.id,
    exists: () => Boolean(found),
    data: () => (found ? { ...found } : undefined),
  }
}

export async function setDoc(docRef, data, options = {}) {
  if (isRealFirebase) return realSetDoc(docRef, data, options)
  const colName = docRef.collection
  const items = loadStorage(colName)
  const normalized = normalizeDocData(data)
  normalized.id = docRef.id
  const idx = items.findIndex((i) => i.id === docRef.id)
  if (idx >= 0) {
    items[idx] = options.merge ? { ...items[idx], ...normalized } : normalized
  } else {
    items.push(normalized)
  }
  saveStorage(colName, items)
}

export async function addDoc(colRef, data) {
  if (isRealFirebase) return realAddDoc(colRef, data)
  const colName = colRef.path
  const items = loadStorage(colName)
  const id = 'doc_' + Math.random().toString(36).slice(2, 10)
  const normalized = normalizeDocData(data)
  normalized.id = id
  items.push(normalized)
  saveStorage(colName, items)
  return { id }
}

export async function updateDoc(docRef, patch) {
  if (isRealFirebase) return realUpdateDoc(docRef, patch)
  const colName = docRef.collection
  const items = loadStorage(colName)
  const normalized = normalizeDocData(patch)
  const idx = items.findIndex((i) => i.id === docRef.id)
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...normalized }
    saveStorage(colName, items)
  }
}

export async function deleteDoc(docRef) {
  if (isRealFirebase) return realDeleteDoc(docRef)
  const colName = docRef.collection
  const items = loadStorage(colName)
  const next = items.filter((i) => i.id !== docRef.id)
  saveStorage(colName, next)
}

export function writeBatch(dbInstance) {
  if (isRealFirebase) return realWriteBatch(dbInstance)
  const operations = []
  return {
    set(ref, data, options) {
      operations.push(() => setDoc(ref, data, options))
      return this
    },
    update(ref, patch) {
      operations.push(() => updateDoc(ref, patch))
      return this
    },
    delete(ref) {
      operations.push(() => deleteDoc(ref))
      return this
    },
    async commit() {
      for (const op of operations) {
        await op()
      }
    },
  }
}

export function onSnapshot(target, next, error) {
  if (isRealFirebase) return realOnSnapshot(target, next, error)
  if (target.__type === 'doc') {
    getDoc(target).then(next).catch(error)
  } else {
    getDocs(target).then(next).catch(error)
  }
  return () => {}
}

export async function runTransaction(dbInstance, updateFunction) {
  if (isRealFirebase) return realRunTransaction(dbInstance, updateFunction)
  const transaction = {
    get: getDoc,
    set: setDoc,
    update: updateDoc,
    delete: deleteDoc,
  }
  return updateFunction(transaction)
}

// ---- Auth Functions ----

export async function signInWithEmailAndPassword(authInstance, email, password) {
  if (isRealFirebase) return realSignInWithEmailAndPassword(authInstance, email, password)
  const accounts = loadStorage(AUTH_ACCOUNTS_KEY)
  const cleanEmail = email.trim().toLowerCase()
  let matched = accounts.find((a) => a.email.toLowerCase() === cleanEmail)
  if (!matched) {
    const uid = 'usr_' + Math.random().toString(36).slice(2, 9)
    matched = { uid, email: cleanEmail, displayName: cleanEmail.split('@')[0], password }
    accounts.push(matched)
    saveStorage(AUTH_ACCOUNTS_KEY, accounts)
  }
  const user = createMockUser(matched.uid, matched.email, matched.displayName)
  mockAuth.currentUser = user
  setStoredMockUser(user)
  triggerAuthListeners()
  return { user }
}

export async function signInWithPopup(authInstance, provider) {
  if (isRealFirebase) return realSignInWithPopup(authInstance, provider)
  const user = createMockUser('usr_doctor_1', 'doctor@hospital.ng', 'Dr. Adebowale Wasiu')
  mockAuth.currentUser = user
  setStoredMockUser(user)
  triggerAuthListeners()
  return { user }
}

export async function createUserWithEmailAndPassword(authInstance, email, password) {
  if (isRealFirebase) return realCreateUserWithEmailAndPassword(authInstance, email, password)
  const accounts = loadStorage(AUTH_ACCOUNTS_KEY)
  const cleanEmail = email.trim().toLowerCase()
  const uid = 'usr_' + Math.random().toString(36).slice(2, 9)
  const newAccount = { uid, email: cleanEmail, displayName: cleanEmail.split('@')[0], password }
  accounts.push(newAccount)
  saveStorage(AUTH_ACCOUNTS_KEY, accounts)

  const user = createMockUser(uid, cleanEmail, newAccount.displayName)
  mockAuth.currentUser = user
  setStoredMockUser(user)
  triggerAuthListeners()
  return { user }
}

export async function signOut(authInstance) {
  if (isRealFirebase) return realSignOut(authInstance)
  mockAuth.currentUser = null
  setStoredMockUser(null)
  triggerAuthListeners()
}

export function onAuthStateChanged(authInstance, callback) {
  if (isRealFirebase) return realOnAuthStateChanged(authInstance, callback)
  authListeners.add(callback)
  setTimeout(() => callback(mockAuth.currentUser), 0)
  return () => authListeners.delete(callback)
}

export async function updatePassword(user, newPassword) {
  if (isRealFirebase) return realUpdatePassword(user, newPassword)
  return Promise.resolve()
}

export async function sendEmailVerification(user) {
  if (isRealFirebase) return realSendEmailVerification(user)
  return Promise.resolve()
}

export const EmailAuthProvider = RealEmailAuthProvider
export const reauthenticateWithCredential = realReauthenticateWithCredential

export { app, db, auth, googleProvider }
