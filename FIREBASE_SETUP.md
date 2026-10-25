# LifeLink — Firebase Phone Authentication Setup Guide

This guide walks you step-by-step through setting up Google Firebase to send real SMS OTPs to Indian mobile numbers (+91) on LifeLink.

---

## 🌟 Overview: What Goes Where?

Firebase uses two sets of credentials:

| Type | What is it? | Where does it go? | Is it Secret? |
| :--- | :--- | :--- | :--- |
| **Client Web Config** | API Key, Project ID, App ID, etc. | Loaded by the browser from `/api/config/firebase` (read from `.env`) | Public client identifier (protected by domain restrictions). |
| **Admin Service Account** | Private RSA key used by the Node.js backend to verify tokens | File on your server e.g. `./serviceAccountKey.json` (referenced in `.env`) | ⚠️ **STRICTLY CONFIDENTIAL**. Never share, never commit to GitHub, never put in frontend code. |

---

## Step 1: Create a Firebase Project

1. Open your browser and navigate to the **[Firebase Console](https://console.firebase.google.com/)**.
2. Sign in with your Google account.
3. Click **"Add project"** (or **"Create a project"**).
4. Enter a project name (e.g., `lifelink-blood-network`) and click **Continue**.
5. You can disable or enable Google Analytics (optional for this project) and click **Create project**.
6. Wait a few seconds until the project is ready, then click **Continue**.

---

## Step 2: Enable Phone Authentication & Add Authorized Domains

1. In the left navigation menu of Firebase Console, click on **Build** > **Authentication**.
2. Click **Get Started** (if opening for the first time).
3. Under the **Sign-in method** tab, find **Phone** in the list of providers and click on it.
4. Toggle the **Enable** switch to **ON**.
5. *(Highly Recommended for Testing)* Scroll down to **"Phone numbers for testing"**:
   - Add a test phone number (e.g., `+91 9876543210`) and a fixed 6-digit test code (e.g., `123456`).
   - *Why?* This allows you to test during development without consuming your free monthly SMS quota!
   - Real phone numbers not listed here will receive real SMS OTPs on their mobile handsets.
6. Click **Save**.
7. Now click the **Settings** tab (next to "Sign-in method") in Authentication:
   - Scroll down to **Authorized domains**.
   - Ensure `localhost` and `127.0.0.1` are in the list. (They are added by default).
   - When deploying to production (e.g., your domain or cloud host), add your domain name here.

---

## Step 3: Register a Web App (Get Client Configuration)

1. In the left navigation menu, click the **Settings gear icon (⚙️)** next to "Project Overview" > click **Project settings**.
2. Under the **General** tab, scroll down to the **"Your apps"** section.
3. Click the **Web icon (</>)** to add a web application.
4. Enter an App nickname (e.g. `LifeLink Web`).
5. You do **not** need to check "Firebase Hosting". Click **Register app**.
6. Firebase will show a `firebaseConfig` object with values like:
   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "lifelink-blood-network.firebaseapp.com",
     projectId: "lifelink-blood-network",
     storageBucket: "lifelink-blood-network.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef..."
   };
   ```
7. Open the `.env` file in your LifeLink project folder and copy these values into the corresponding variables:
   ```ini
   FIREBASE_API_KEY=AIzaSy...
   FIREBASE_AUTH_DOMAIN=lifelink-blood-network.firebaseapp.com
   FIREBASE_PROJECT_ID=lifelink-blood-network
   FIREBASE_STORAGE_BUCKET=lifelink-blood-network.appspot.com
   FIREBASE_MESSAGING_SENDER_ID=123456789012
   FIREBASE_APP_ID=1:123456789012:web:abcdef...
   ```

---

## Step 4: Generate Service Account Key (Backend Verification)

To allow the Node.js backend to securely verify that the user's phone was really authenticated by Google:

1. Still in Firebase Console **Project settings (⚙️)**, click on the **Service accounts** tab.
2. Under "Firebase Admin SDK", ensure **Node.js** is selected.
3. Click the button: **"Generate new private key"**.
4. A warning modal will appear: click **"Generate key"**.
5. A JSON file will download to your computer (e.g., `lifelink-blood-network-firebase-adminsdk-xxxxx.json`).
6. **Rename this downloaded file** to: `serviceAccountKey.json`
7. Move `serviceAccountKey.json` into your LifeLink project root folder (`c:\Users\kanna\OneDrive\Desktop\project1\`).
8. In `.env`, ensure the variable points to it:
   ```ini
   FIREBASE_SERVICE_ACCOUNT_KEY=./serviceAccountKey.json
   ```
9. ⚠️ **Security note:** `serviceAccountKey.json` is already ignored in `.gitignore` so it is never committed to GitHub.

---

## Step 5: Start the LifeLink Server and Test!

1. Start the server:
   ```bash
   npm start
   ```
2. Open your browser to `http://localhost:3000`.
3. If everything is configured correctly, the top blue notice banner will disappear.
4. Click **"Register as Donor"**:
   - Enter your name and email.
   - Enter your Indian mobile number (`+91` is auto-filled).
   - Click **"Get OTP"**.
   - Complete the Google reCAPTCHA check if prompted.
   - A real SMS with your 6-digit OTP will arrive on your mobile phone!
   - Enter the 6-digit OTP and click **"Verify OTP"**.
   - Click **"Create Account"**.
5. Your verified donor account is active and protected against hoaxes and duplicate broadcasts!
