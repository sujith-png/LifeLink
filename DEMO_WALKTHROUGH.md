# 🎬 LifeLink — College Presentation & Live Demo Walkthrough

> **Companion Guide for College Project Presentation & Faculty Evaluation**  
> Use this step-by-step script during your project demonstration to showcase the complete real-world feature set of **LifeLink**.

---

## ⚡ Quick Preparation Checklist Before the Presentation

1. **Ensure Server is Running**:
   Open a terminal in the project directory and run:
   ```bash
   node src/server.js
   ```
   Confirm console output: `[LifeLink Server] Running on http://localhost:3000`.

2. **Ensure Master Demo Data is Seeded**:
   If needed, run the master seeder once to ensure pristine sample donors and emergency requests:
   ```bash
   node src/db/seedDemoData.js
   ```

3. **Open Two Browser Windows / Tabs**:
   - **Tab 1 (Public / Requester / Donor)**: `http://localhost:3000`
   - **Tab 2 (Admin Portal)**: `http://localhost:3000/admin-dashboard.html`

4. **Have Terminal Visible**:
   Keep the server terminal visible on one side of your screen to highlight the **Mock SMS & Email Alerts** in real time.

---

## 🎭 The 7-Step Live Demonstration Script

---

### Step 1: Introduction & Problem Context (1 Minute)

> **What to Say to Evaluators:**  
> *"Good morning professors. Our project is **LifeLink**, an emergency blood donor mobilization platform. Traditional social media donor broadcasts fail for three reasons: first, phone numbers are often fake or outdated; second, hundreds of donors get spammed at once leading to notification fatigue; and third, requesters have zero visibility into whether an accepted donor is actually traveling. LifeLink solves this using an ABO compatibility matching engine, a 7-layer verification system, staged alert escalations, and real-time donor travel tracking."*

---

### Step 2: Public Emergency Board & Privacy Protection (2 Minutes)

1. Navigate to: `http://localhost:3000/emergency-board.html`.
2. **Point Out Key Features**:
   - **Trust Badges**: Notice the color-coded badges on request cards:
     - 🟢 `Hospital Confirmed`
     - 🔵 `Document Verified`
     - 🟡 `Phone Verified`
     - ⚠️ `Unverified`
   - **Phone Privacy Masking**: Highlight that requester phone numbers are masked (e.g. `982*****12`).
     > **Point to Explain:** *"To protect patients from fraud and spam, phone numbers are never published openly on the web. Only authenticated donors who explicitly accept the emergency are granted access to direct contact details."*
   - **Interactive Filters**: Demonstrate the filtering toolbar:
     - Filter by Blood Group: Select `O-` or `B+`.
     - Filter by City: Select `Mumbai` or `Delhi`.
     - Filter by Urgency: Select `Critical`.

---

### Step 3: Verified Hospital Blood Bank Directory (1 Minute)

1. Navigate to: `http://localhost:3000/blood-banks.html`.
2. **Point Out Key Features**:
   - Display pre-seeded accredited transfusion centers (e.g., KEM Hospital, AIIMS, Lilavati, Manipal).
   - Show the **official switchboard landlines** and 24/7 operating badges.
   - Point out the `tel:` click-to-dial links.
     > **Point to Explain:** *"This directory serves two critical purposes: citizens can directly locate 24/7 blood reserves, and our administrators use these official switchboard numbers to verify hospital admissions without relying on user-submitted contact numbers."*

---

### Step 4: Posting an Emergency with OTP & Requisition Slip (3 Minutes)

1. Navigate to: `http://localhost:3000/post-request.html`.
2. **Fill in Emergency Details**:
   - Patient Name: `Arun Kulkarni`
   - Blood Group: `O+`
   - Units Needed: `2`
   - Hospital Name: `Lilavati Hospital & Research Centre`
   - Attending Doctor: `Dr. S. K. Mehta`
   - Ward / Bed Number: `ICU Bed 04`
   - City: `Mumbai`
   - Contact Phone: `9820112233`
   - Urgency: `Critical`
   - Needed By: *(Select a time 2 hours from now)*
3. **Trigger Phone OTP Verification**:
   - Click **"Send OTP"**.
   - **Switch to Server Terminal**: Show the professors the mock SMS box:
     ```text
     ======================================================
       [MOCK SMS NOTIFICATION SERVICE]
       To:      9820112233
       Purpose: post_request
       Message: Your LifeLink verification OTP is [ xxxxxx ].
       Validity: 5 minutes
     ======================================================
     ```
   - Copy the 6-digit OTP code, paste it into the form, and click **"Verify OTP"**.
   - Observe the green confirmation: `Phone number verified successfully`.
4. **Upload Requisition Slip**:
   - Attach a sample medical image or PDF file.
5. **Submit Request**:
   - Click **"Post Emergency Request"**.
   - Show the evaluator the server terminal:
     - LifeLink calculates ABO compatibility ($O^+$ can receive from $O^+$ and $O^-$).
     - Haversine distance sorts nearest eligible donors in Mumbai.
     - **Stage 1 Escalation Dispatched**: Nearest 3 to 6 donors receive mock SMS and email alerts!

---

### Step 5: Donor Login, Alert Inbox & Travel Progression (3 Minutes)

1. Navigate to: `http://localhost:3000/login.html`.
2. **Log In as a Matched Donor**:
   - Email: `aarav.patel@lifelink.demo`
   - Password: `Donor@123`
3. **Donor Dashboard**:
   - Shows donor medical profile: `O+`, Mumbai, Availability: `ON`, Last donation: 110 days ago (Eligible).
   - In the **Emergency Alerts** section, open the alert for `Arun Kulkarni`.
   - Point out that before acceptance, the requester's phone number is withheld.
4. **Accept the Request**:
   - Click **"I Can Come (Accept)"**.
   - **Show Privacy Unlock**: The requester's phone number (`9820112233`) is now revealed with a click-to-call button.
5. **Demonstrate Commitment Progression**:
   - Step 1: Click **"Confirm Availability"** $\rightarrow$ Status changes to `Availability Confirmed`.
   - Step 2: Click **"On the Way"** (Enter ETA: `20` mins) $\rightarrow$ Status changes to `On the Way (ETA: 20 min)`.
   - Step 3: Click **"Report Arrival"** $\rightarrow$ Status changes to `Arrived — Self-Reported`.
     > **Point to Explain:** *"Notice that arrival is labeled 'Self-Reported'. We never treat arrival as automatic proof of donation. Only clinical fulfillment closes the request."*

---

### Step 6: Requester Live Emergency Progress Tracker (2 Minutes)

1. Navigate to the request details page: `http://localhost:3000/request-details.html?id=<request_id>` (or click from dashboard).
2. **Review the Live Progress Panel**:
   - **Potential Matches**: `6`
   - **Donors Notified**: `6` (Stage 1)
   - **Donors Accepted**: `1`
   - **On the Way**: `0`
   - **Reported Arrival**: `1` (`Aarav Patel`)
   - **Fulfilment Status**: `Pending`
3. **Accepted Donors Roster**:
   - Shows the live roster of responding donors and their self-reported travel states.
4. **Confirm Fulfillment**:
   - Click **"Confirm Requirement Met (Fulfilled)"**.
   - Show that the request status transitions to `Fulfilled` and all further alert escalations are stopped.

---

### Step 7: Admin Verification Queue & Fraud Prevention (3 Minutes)

1. Navigate to: `http://localhost:3000/admin-dashboard.html`.
2. Log In as Administrator:
   - Email: `admin@lifelink.org`
   - Password: `Admin@123`
3. **Overview KPIs**:
   - Point out real-time stats: Total Donors, Active Requests, Pending Verification, Blocked Numbers.
4. **Verification Queue**:
   - Open the **Verification Queue** tab.
   - Point out how each pending emergency displays an **Attending Hospital Official Landline** cross-matched from the accredited hospital directory.
   - Click **"View Slip"**: Securely displays the uploaded requisition slip.
   - Click **"Verify via Hospital Phone"** $\rightarrow$ select `Hospital Confirmed` and enter audit note:
     *"Spoke with ICU Desk Sister in Charge; confirmed patient admission."*
   - Status instantly updates to `Hospital Confirmed` 🟢 across the entire platform.
5. **Community Reporting & Auto-Hide Demo**:
   - Explain the 3-report auto-hide trigger:
     > **Point to Explain:** *"If 3 community members report a request for fraud or commercial solicitation, LifeLink automatically sets `is_hidden = 1` and stops alert broadcasts until an admin investigates."*
6. **Phone Blocklist Management**:
   - Show the blocklist panel where fraudulent numbers can be permanently blocked from generating OTPs.

---

## 🌟 Common Viva Questions & Answers

| Question | Your Answer |
| :--- | :--- |
| **Q1: Why use SQLite instead of MongoDB or MySQL?** | *"SQLite provides atomic ACID transactions with zero configuration and zero external service overhead, making it ultra-reliable for a college project demo. Furthermore, we built a transparent dual-engine database adapter supporting both `better-sqlite3` and Node 24's native `node:sqlite` engine."* |
| **Q2: How is donor privacy protected?** | *"Donor phone numbers are never exposed anywhere publicly. When an emergency is created, the system alerts donors via push/SMS. The requester's contact is shared only with donors who click 'Accept', and only during that active emergency."* |
| **Q3: What if someone posts a fake request without a doctor's slip?** | *"First, they must pass phone OTP verification. Second, the request is flagged with an 'Unverified' badge. Third, the duplicate detection engine catches repeated broadcasts. Fourth, hospital administrators must verify the slip via the hospital's official landline. Finally, community members can report it—3 reports automatically hide the post."* |
| **Q4: How does the matching engine work?** | *"It checks ABO and Rh blood compatibility rules (e.g., O- can donate to anyone, AB+ can receive from anyone). If donors have GPS coordinates, it calculates the Haversine great-circle distance and sorts by proximity. Otherwise, it matches by city and pincode."* |
| **Q5: What happens if an accepted donor cancels?** | *"If a donor changes their status to 'Withdrawn', our staged escalation engine detects the deficit and immediately triggers an out-of-turn alert wave to notify the next nearest eligible donors."* |

---

## 🏁 Summary Table of Demo Credentials

| Portal / Role | URL | Email / Phone | Password |
| :--- | :--- | :--- | :--- |
| **System Admin** | `http://localhost:3000/admin-dashboard.html` | `admin@lifelink.org` | `Admin@123` |
| **Donor (O+)** | `http://localhost:3000/login.html` | `aarav.patel@lifelink.demo` | `Donor@123` |
| **Donor (O-)** | `http://localhost:3000/login.html` | `vikram.joshi@lifelink.demo` | `Donor@123` |
| **Donor (B+)** | `http://localhost:3000/login.html` | `rahul.sharma@lifelink.demo` | `Donor@123` |
| **Public Emergency Board** | `http://localhost:3000/emergency-board.html` | *Public Access* | *No login needed* |
| **Hospital Directory** | `http://localhost:3000/blood-banks.html` | *Public Access* | *No login needed* |
| **Post Emergency Form** | `http://localhost:3000/post-request.html` | *Uses Phone OTP* | *Printed in terminal* |
