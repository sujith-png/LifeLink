// Emergency Progress Tracker & Accepted Donors Live Roster Client
let activeProgressPollInterval = null;
let currentTrackingRequestId = null;

async function viewEmergencyProgress(requestId) {
  currentTrackingRequestId = requestId;
  openModal('progress-tracker-modal');
  await refreshProgressTrackerData();

  if (activeProgressPollInterval) clearInterval(activeProgressPollInterval);
  activeProgressPollInterval = setInterval(refreshProgressTrackerData, 6000); // 6s poll
}

function closeEmergencyProgressModal() {
  if (activeProgressPollInterval) {
    clearInterval(activeProgressPollInterval);
    activeProgressPollInterval = null;
  }
  closeModal('progress-tracker-modal');
}

async function refreshProgressTrackerData() {
  if (!currentTrackingRequestId) return;
  const requestId = currentTrackingRequestId;

  try {
    const res = await API.request(`/api/requests/${requestId}/progress`);
    if (!res.success) return;
    renderProgressPanel(res.progress);

    // If requester or admin, also load accepted donor details with phone numbers
    const user = API.getUser();
    if (user) {
      try {
        const donorsRes = await API.request(`/api/requests/${requestId}/accepted-donors`);
        if (donorsRes.success) {
          renderAcceptedDonorsRoster(donorsRes.donors, res.progress);
        }
      } catch (_) {
        // Unauthenticated or not owner: roster will be hidden or limited
      }
    }
  } catch (err) {
    console.error('Progress poll error:', err);
  }
}

function renderProgressPanel(p) {
  const titleEl = document.getElementById('tracker-patient-title');
  const detailsEl = document.getElementById('tracker-request-meta');
  const badgeEl = document.getElementById('tracker-verification-badge');

  if (titleEl) {
    titleEl.textContent = `Emergency #${p.requestId}: ${p.patientName} (${p.bloodGroup}) — ${p.unitsNeeded} Unit(s)`;
  }

  if (detailsEl) {
    detailsEl.textContent = `Hospital: ${p.hospitalName}, ${p.city} | Urgency: ${p.urgency} | Status: ${p.requestStatus}`;
  }

  if (badgeEl) {
    badgeEl.className = `badge-verification badge-${(p.verificationStatus || 'unverified').toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    badgeEl.textContent = p.verificationStatus;
  }

  // Populate numeric metrics
  document.getElementById('metric-potential-matches').textContent = p.potentialMatches;
  document.getElementById('metric-donors-notified').textContent = p.donorsNotified;
  document.getElementById('metric-accepted').textContent = p.accepted;
  document.getElementById('metric-confirmed-avail').textContent = p.availabilityConfirmed;
  document.getElementById('metric-on-the-way').textContent = p.onTheWay;
  document.getElementById('metric-arrived').textContent = p.reportedArrival;

  const fulfillEl = document.getElementById('metric-fulfillment');
  if (fulfillEl) {
    fulfillEl.textContent = p.fulfilmentStatus;
    fulfillEl.style.color = p.fulfillmentConfirmed ? 'var(--success)' : '#d97706';
  }

  // Requester action buttons (Fulfill / Cancel)
  const actionsContainer = document.getElementById('tracker-requester-actions');
  const user = API.getUser();
  if (actionsContainer) {
    if (user && p.requestStatus === 'Open') {
      actionsContainer.style.display = 'flex';
      actionsContainer.innerHTML = `
        <button class="btn btn-primary" onclick="confirmFulfillment(${p.requestId})" style="background:var(--success); border-color:var(--success);">
          ✅ Confirm Blood Requirement Met
        </button>
        <button class="btn btn-secondary" onclick="confirmCancelRequest(${p.requestId})" style="color:var(--danger); border-color:var(--danger);">
          Cancel Request
        </button>
      `;
    } else {
      actionsContainer.style.display = p.requestStatus !== 'Open' ? 'block' : 'none';
      if (p.requestStatus !== 'Open') {
        actionsContainer.innerHTML = `
          <div style="padding:10px 14px; background:#f1f5f9; border-radius:6px; color:#475569; font-weight:600; text-align:center;">
            This request is closed (${p.requestStatus}). Active alerting is halted.
          </div>
        `;
      }
    }
  }
}

function renderAcceptedDonorsRoster(donors, progress) {
  const container = document.getElementById('tracker-accepted-roster');
  if (!container) return;

  if (!donors || donors.length === 0) {
    container.innerHTML = `
      <div style="padding:20px; text-align:center; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; color:var(--text-muted); font-size:0.9rem;">
        No donors have confirmed commitment yet. LifeLink is actively notifying eligible donors in stages.
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <h4 style="font-size:1.05rem; color:#0f172a; margin-bottom:12px; display:flex; align-items:center; justify-content:space-between;">
      <span>👥 Committed Donors Live Roster (${donors.length})</span>
      <span style="font-size:0.8rem; color:var(--text-muted); font-weight:normal;">Auto-refreshes live</span>
    </h4>
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${donors.map(d => `
        <div style="padding:12px 16px; background:#ffffff; border:1px solid #cbd5e1; border-radius:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; box-shadow:var(--shadow-sm);">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <strong style="font-size:1rem; color:#0f172a;">${d.donor_name}</strong>
              <span style="background:var(--primary-red); color:#fff; padding:2px 8px; border-radius:4px; font-weight:700; font-size:0.75rem;">${d.blood_group}</span>
              <span style="font-size:0.8rem; font-weight:600; color:#1e293b; background:#f1f5f9; padding:2px 8px; border-radius:4px;">
                ${d.commitment_status}
              </span>
            </div>
            <div style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">
              📍 Location: ${d.city} (${d.area_pincode || 'Nearby'}) 
              ${d.eta_minutes ? ` | ⏱️ ETA: ${d.eta_minutes} mins` : ''}
              ${d.commitment_status === 'Arrived — Self-Reported' ? '<strong style="color:var(--success);"> (Self-reported at hospital)</strong>' : ''}
            </div>
            ${d.withdrawal_reason ? `<div style="font-size:0.8rem; color:var(--danger); margin-top:2px;">Reason: ${d.withdrawal_reason}</div>` : ''}
          </div>

          <div style="text-align:right;">
            <div style="font-size:1.05rem; font-weight:800; color:var(--primary-dark); background:#fef2f2; padding:4px 12px; border-radius:6px; border:1px solid #fecdd3;">
              📞 <a href="tel:${d.phone}" style="color:inherit; text-decoration:none;">${d.phone}</a>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">Call donor directly</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// Requester fulfills request
async function confirmFulfillment(requestId) {
  const notes = prompt('Enter any completion notes (e.g. Donor arrived and completed 1 unit transfusion):', 'Fulfilment confirmed at hospital');
  if (notes === null) return;

  try {
    const res = await API.request(`/api/requests/${requestId}/fulfill`, {
      method: 'PATCH',
      body: JSON.stringify({ notes })
    });
    showToast(res.message, 'success');
    refreshProgressTrackerData();
  } catch (err) {
    showToast(err.message || 'Failed to fulfill request', 'error');
  }
}

// Requester cancels request
async function confirmCancelRequest(requestId) {
  const reason = prompt('Please enter cancellation reason:');
  if (reason === null) return;

  try {
    const res = await API.request(`/api/requests/${requestId}/cancel`, {
      method: 'PATCH',
      body: JSON.stringify({ reason })
    });
    showToast(res.message, 'info');
    refreshProgressTrackerData();
  } catch (err) {
    showToast(err.message || 'Failed to cancel request', 'error');
  }
}

window.LifeLink = window.LifeLink || {};
window.LifeLink.openRequestDetails = viewEmergencyProgress;
