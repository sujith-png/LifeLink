/**
 * LifeLink - Firebase Phone Authentication Helper
 * Handles Firebase Client SDK initialization, reCAPTCHA setup,
 * SMS OTP dispatching, OTP verification, and friendly error translation.
 */
(function() {
  let firebaseInitialized = false;
  let firebaseConfigData = null;
  const recaptchaVerifiers = {};

  const LifeLinkFirebase = {
    /**
     * Fetch client config from backend and initialize Firebase
     */
    async init() {
      if (firebaseInitialized) return true;

      try {
        const response = await fetch('/api/config/firebase');
        const data = await response.json();
        firebaseConfigData = data;

        const banner = document.getElementById('firebase-setup-banner');

        if (!data.configured || !data.config || !data.config.apiKey) {
          console.warn('[Firebase] Client is not configured. Missing variables:', data.missing);
          if (banner) {
            banner.style.display = 'block';
            if (data.missing && data.missing.length > 0) {
              banner.innerHTML = `<span>ℹ️ <strong>Firebase Phone Authentication:</strong> Configuration pending in <code>.env</code>. Missing: <code>${data.missing.slice(0, 3).join(', ')}</code>. Follow the instructions in <code>FIREBASE_SETUP.md</code> to activate real SMS OTP.</span>`;
            }
          }
          return false;
        }

        if (banner) banner.style.display = 'none';

        if (typeof firebase === 'undefined') {
          console.error('[Firebase] Firebase SDK script is not loaded in the webpage.');
          return false;
        }

        if (firebase.apps.length === 0) {
          firebase.initializeApp(data.config);
          firebase.auth().useDeviceLanguage();
        }

        firebaseInitialized = true;
        console.log('[Firebase] Web Client SDK successfully initialized.');
        return true;
      } catch (err) {
        console.error('[Firebase] Initialization error:', err);
        return false;
      }
    },

    /**
     * Check if Firebase is currently configured
     */
    isConfigured() {
      return firebaseInitialized && Boolean(firebaseConfigData?.configured);
    },

    /**
     * Get missing configuration list for diagnostics
     */
    getMissingConfig() {
      return firebaseConfigData?.missing || ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID'];
    },

    /**
     * Translate Firebase error codes into friendly user messages
     */
    getFriendlyErrorMessage(err) {
      if (!err) return 'An unexpected error occurred.';
      const code = err.code || '';

      switch (code) {
        case 'auth/invalid-phone-number':
          return 'Please enter a valid phone number with country code (e.g., +91 9876543210).';
        case 'auth/missing-phone-number':
          return 'Phone number cannot be empty.';
        case 'auth/quota-exceeded':
          return 'SMS quota exceeded for today. Please contact support or try again later.';
        case 'auth/too-many-requests':
          return 'Too many attempts. For security, please wait a few minutes before trying again.';
        case 'auth/invalid-verification-code':
          return 'Incorrect 6-digit OTP. Please check the SMS on your mobile and try again.';
        case 'auth/code-expired':
          return 'This OTP code has expired. Please click "Resend OTP" to request a new code.';
        case 'auth/captcha-check-failed':
          return 'reCAPTCHA verification failed. Please refresh the page and try again.';
        case 'auth/popup-closed-by-user':
          return 'Security verification was dismissed. Please click "Get OTP" again.';
        case 'auth/network-request-failed':
          return 'Network error. Please check your internet connection.';
        case 'auth/internal-error':
          return 'Authentication server error. Please try again shortly.';
        default:
          return err.message || 'SMS OTP operation failed.';
      }
    },

    /**
     * Get or create a RecaptchaVerifier for a container element
     */
    getRecaptchaVerifier(containerId) {
      if (!this.isConfigured()) {
        throw new Error('Firebase Authentication is not configured yet.');
      }

      const container = document.getElementById(containerId);
      if (!container) {
        throw new Error(`reCAPTCHA container #${containerId} not found in DOM.`);
      }

      if (recaptchaVerifiers[containerId]) {
        return recaptchaVerifiers[containerId];
      }

      // Create an invisible reCAPTCHA verifier tied to the container
      const verifier = new firebase.auth.RecaptchaVerifier(containerId, {
        size: 'invisible',
        callback: () => {
          console.log('[Firebase] reCAPTCHA verified successfully.');
        },
        'expired-callback': () => {
          console.warn('[Firebase] reCAPTCHA expired. Resetting verifier...');
          verifier.render().then(widgetId => grecaptcha.reset(widgetId));
        }
      });

      recaptchaVerifiers[containerId] = verifier;
      return verifier;
    },

    /**
     * Send real SMS OTP to phone number using Firebase
     * @param {string} phoneE164 - Formatted E.164 phone number, e.g. +919876543210
     * @param {string} containerId - DOM container ID for reCAPTCHA
     * @returns {Promise<ConfirmationResult>}
     */
    async sendPhoneOtp(phoneE164, containerId) {
      if (!this.isConfigured()) {
        const missing = this.getMissingConfig().join(', ');
        throw new Error(`Firebase Phone Auth is not configured on this server yet. (Missing: ${missing})`);
      }

      const verifier = this.getRecaptchaVerifier(containerId);
      return await firebase.auth().signInWithPhoneNumber(phoneE164, verifier);
    },

    /**
     * Confirm 6-digit OTP code with Firebase and retrieve verified ID token
     * @param {ConfirmationResult} confirmationResult
     * @param {string} code - 6-digit OTP
     * @returns {Promise<{ user: Object, idToken: string, phoneNumber: string }>}
     */
    async verifyOtp(confirmationResult, code) {
      if (!confirmationResult || typeof confirmationResult.confirm !== 'function') {
        throw new Error('No active verification session. Please request a new OTP first.');
      }

      const cleanCode = (code || '').trim();
      if (!cleanCode || cleanCode.length < 6) {
        throw new Error('Please enter the complete 6-digit OTP received via SMS.');
      }

      const userCredential = await confirmationResult.confirm(cleanCode);
      const user = userCredential.user;
      const idToken = await user.getIdToken(true);

      return {
        user,
        idToken,
        phoneNumber: user.phoneNumber
      };
    }
  };

  window.LifeLinkFirebase = LifeLinkFirebase;
})();
