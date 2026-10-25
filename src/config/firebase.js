const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let firebaseAdminInitialized = false;

/**
 * Firebase Configuration & Admin SDK Manager
 * Handles server-side ID token verification, client configuration delivery,
 * and clear missing-configuration diagnostics.
 */
class FirebaseConfig {
  /**
   * Check if Firebase Client variables are present in environment
   */
  static isClientConfigured() {
    return Boolean(
      process.env.FIREBASE_API_KEY &&
      process.env.FIREBASE_AUTH_DOMAIN &&
      process.env.FIREBASE_PROJECT_ID
    );
  }

  /**
   * Check if Firebase Admin SDK credentials are present in environment
   */
  static isAdminConfigured() {
    if (firebaseAdminInitialized) return true;

    // Check service account key file path or inline JSON
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      return true;
    }

    // Check individual service account credentials
    if (process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY) {
      return true;
    }

    // Check standard Google Application Credentials
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return true;
    }

    return false;
  }

  /**
   * Return list of missing environment variable names for diagnostics
   */
  static getMissingConfig() {
    const missing = [];
    if (!process.env.FIREBASE_API_KEY) missing.push('FIREBASE_API_KEY');
    if (!process.env.FIREBASE_AUTH_DOMAIN) missing.push('FIREBASE_AUTH_DOMAIN');
    if (!process.env.FIREBASE_PROJECT_ID) missing.push('FIREBASE_PROJECT_ID');
    if (!process.env.FIREBASE_STORAGE_BUCKET) missing.push('FIREBASE_STORAGE_BUCKET');
    if (!process.env.FIREBASE_MESSAGING_SENDER_ID) missing.push('FIREBASE_MESSAGING_SENDER_ID');
    if (!process.env.FIREBASE_APP_ID) missing.push('FIREBASE_APP_ID');

    // Admin missing
    if (!this.isAdminConfigured()) {
      missing.push('FIREBASE_SERVICE_ACCOUNT_KEY (or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY)');
    }

    return missing;
  }

  /**
   * Returns safe public client configuration for the web browser
   */
  static getPublicClientConfig() {
    return {
      apiKey: process.env.FIREBASE_API_KEY || null,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || null,
      projectId: process.env.FIREBASE_PROJECT_ID || null,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || null,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || null,
      appId: process.env.FIREBASE_APP_ID || null
    };
  }

  /**
   * Initialize Firebase Admin SDK lazily
   */
  static initializeAdmin() {
    if (firebaseAdminInitialized) return admin;

    // In test environment, bypass live initialization if credentials aren't set
    if (process.env.NODE_ENV === 'test' && !this.isAdminConfigured()) {
      return admin;
    }

    try {
      if (admin.apps.length > 0) {
        firebaseAdminInitialized = true;
        return admin;
      }

      let credential = null;

      // 1. Service account file or inline JSON string
      if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY.trim();
        if (raw.startsWith('{')) {
          const parsed = JSON.parse(raw);
          credential = admin.credential.cert(parsed);
        } else {
          const resolvedPath = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
          if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Firebase service account file not found at: ${resolvedPath}`);
          }
          const fileContent = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
          credential = admin.credential.cert(fileContent);
        }
      } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        // 2. Individual environment variables
        const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
        credential = admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey
        });
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        // 3. Application default credentials
        credential = admin.credential.applicationDefault();
      }

      if (credential) {
        admin.initializeApp({
          credential,
          projectId: process.env.FIREBASE_PROJECT_ID
        });
        firebaseAdminInitialized = true;
        console.log('[Firebase] Admin SDK successfully initialized for project:', process.env.FIREBASE_PROJECT_ID);
      }
    } catch (err) {
      console.error('[Firebase] Failed to initialize Firebase Admin SDK:', err.message);
      throw err;
    }

    return admin;
  }

  /**
   * Cryptographically verify a Firebase ID Token using Firebase Admin SDK
   * @param {string} idToken
   * @returns {Promise<{ uid: string, phone_number: string, auth_time: number }>}
   */
  static async verifyIdToken(idToken) {
    if (!idToken || typeof idToken !== 'string') {
      throw new Error('A valid Firebase ID token string is required.');
    }

    // Support simulated test tokens in automated test suites
    if (process.env.NODE_ENV === 'test' && idToken.startsWith('test_firebase_token_')) {
      const parts = idToken.split(':');
      // Format: test_firebase_token_valid:<phone>:<uid>
      const status = parts[0];
      if (status === 'test_firebase_token_invalid') {
        throw new Error('Firebase ID token has invalid signature or is malformed.');
      }
      if (status === 'test_firebase_token_expired') {
        throw new Error('Firebase ID token has expired. Please verify your phone number again.');
      }
      const phone = parts[1] || '+919876543210';
      const uid = parts[2] || `test_fb_uid_${Date.now()}`;
      return {
        uid,
        phone_number: phone,
        auth_time: Math.floor(Date.now() / 1000)
      };
    }

    if (!this.isAdminConfigured()) {
      const missing = this.getMissingConfig();
      throw new Error(
        `Firebase Admin is not configured on the server. Please set: ${missing.join(', ')} in your backend .env file.`
      );
    }

    this.initializeAdmin();
    return await admin.auth().verifyIdToken(idToken);
  }
}

module.exports = FirebaseConfig;
