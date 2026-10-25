// In-App Notification Center & Donor Alert Handling Client
let notificationPollInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  initNotifications();

  // Listen for login/logout session events
  window.addEventListener('lifelink:session-updated', () => {
    checkNotifications();
  });
});

function initNotifications() {
  checkNotifications();

  // Poll for updates every 15 seconds
  if (notificationPollInterval) clearInterval(notificationPollInterval);
  notificationPollInterval = setInterval(checkNotifications, 15000);

  // Hook notification bell
  const btnToggle = document.getElementById('btn-notifications-toggle');
  if (btnToggle) {
    btnToggle.addEventListener('click', () => {
      openModal('notifications-drawer-modal');
      loadNotificationsList();
    });
  }

  // Hook Mark All as Read button
  const btnMarkAll = document.getElementById('btn-mark-all-read');
  if (btnMarkAll) {
    btnMarkAll.addEventListener('click', async () => {
      try {
        await API.request('/api/notifications/mark-all-read', { method: 'PATCH' });
        showToast('All notifications marked as read.', 'info');
        checkNotifications();
        loadNotificationsList();
      } catch (err) {
        showToast(err.message || 'Failed to mark as read', 'error');
      }
    });
  }
}

async function checkNotifications() {
  const token = API.getToken();
  const badgeEl = document.getElementById('nav-unread-badge');
  if (!token) {
    if (badgeEl) badgeEl.style.display = 'none';
    return;
  }

  try {
    const res = await API.request('/api/notifications?limit=10');
    if (res.success) {
      if (badgeEl) {
        if (res.unreadCount > 0) {
          badgeEl.textContent = res.unreadCount;
          badgeEl.style.display = 'inline-block';
        } else {
          badgeEl.style.display = 'none';
        }
      }

      // If on donor dashboard, also refresh active alerts card
      const donorAlertsList = document.getElementById('donor-alerts-list');
      if (donorAlertsList && document.getElementById('view-donor-dashboard').style.display !== 'none') {
        renderDonorAlertsFeed(res.notifications);
      }
    }
  } catch (_) {}
}

async function loadNotificationsList() {
  const container = document.getElementById('notifications-drawer-content');
  if (!container) return;

  container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:20px;">Loading alerts...</p>';

  try {
    const res = await API.request('/api/notifications?limit=30');
    if (!res.success || !res.notifications || res.notifications.length === 0) {
      container.innerHTML = '<p style="color:var(--text-light); text-align:center; padding:30px;">No notifications yet.</p>';
      return;
    }

    container.innerHTML = res.notifications.map(n => renderNotificationItem(n)).join('');
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger); text-align:center;">Failed to load notifications: ${err.message}</p>`;
  }
}

function renderNotificationItem(n) {
  const isEmergency = n.type === 'emergency_alert';
  const badgeHtml = n.verification_badge ? `
    <span class="badge-verification badge-${n.verification_badge.toLowerCase().replace(/[^a-z0-9]/g, '-')}">
      ${n.verification_badge}
    </span>
  ` : '';

  return `
    <div class="card" style="margin-bottom:12px; padding:16px; border-left: 4px solid ${isEmergency ? 'var(--primary-red)' : '#3b82f6'}; ${n.is_read ? 'opacity:0.85;' : 'background:#fffbfb;'}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <strong style="font-size:0.95rem; color:#0f172a;">${n.title}</strong>
            ${badgeHtml}
          </div>
          <p style="font-size:0.88rem; color:var(--text-main); margin-bottom:8px;">${n.message}</p>
          <div style="font-size:0.75rem; color:var(--text-muted);">${new Date(n.created_at).toLocaleString()}</div>
        </div>
        ${!n.is_read ? `
          <button class="btn btn-secondary" onclick="markOneRead(${n.id})" style="font-size:0.75rem; padding:4px 8px;">
            Mark read
          </button>
        ` : ''}
      </div>

      ${isEmergency && n.request_id ? `
        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;" id="alert-actions-${n.request_id}">
          <button class="btn btn-primary" onclick="handleDonorResponse(${n.request_id}, 'Accepted')" style="font-size:0.85rem; padding:6px 14px;">
            ❤️ I Can Come
          </button>
          <button class="btn btn-secondary" onclick="handleDonorResponse(${n.request_id}, 'Declined')" style="font-size:0.85rem; padding:6px 14px;">
            Can't Make It
          </button>
          <button class="btn btn-outline-red" onclick="viewEmergencyProgress(${n.request_id})" style="font-size:0.85rem; padding:6px 14px;">
            📊 View Tracker
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

// Render alerts inside the donor dashboard view
async function renderDonorAlertsFeed(notifications) {
  const container = document.getElementById('donor-alerts-list');
  if (!container) return;

  const emergencyAlerts = notifications.filter(n => n.type === 'emergency_alert' && n.request_id);

  if (emergencyAlerts.length === 0) {
    container.innerHTML = '<p style="color: var(--text-light); font-style: italic;">No active emergency alerts at this moment.</p>';
    return;
  }

  // Load donor responses for each active request
  const alertCards = await Promise.all(emergencyAlerts.map(async (n) => {
    let myResp = null;
    try {
      const respData = await API.request(`/api/requests/${n.request_id}/my-response`);
      myResp = respData.response;
    } catch (_) {}

    const isAccepted = myResp && ['Accepted', 'Availability Confirmed', 'On the Way', 'Arrived — Self-Reported'].includes(myResp.status);
    const badgeHtml = n.verification_badge ? `
      <span class="badge-verification badge-${n.verification_badge.toLowerCase().replace(/[^a-z0-9]/g, '-')}">
        ${n.verification_badge}
      </span>
    ` : '';

    return `
      <div class="card" style="margin-bottom:14px; padding:16px; border-left: 5px solid ${isAccepted ? 'var(--success)' : 'var(--primary-red)'}; background:#ffffff;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <h4 style="font-size:1.05rem; color:#0f172a;">${n.title}</h4>
              ${badgeHtml}
            </div>
            <p style="font-size:0.9rem; color:var(--text-main); margin-top:6px;">${n.message}</p>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">Dispatched: ${new Date(n.created_at).toLocaleString()}</div>
          </div>
          <div>
            <button class="btn btn-outline-red" onclick="viewEmergencyProgress(${n.request_id})" style="font-size:0.8rem; padding:4px 10px;">
              📊 Progress Tracker
            </button>
          </div>
        </div>

        <!-- Donor Commitment State -->
        <div style="margin-top:14px; padding-top:12px; border-top:1px solid #f1f5f9;">
          ${!myResp || myResp.status === 'Declined' || myResp.status === 'Withdrawn' ? `
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
              <span style="font-size:0.85rem; font-weight:600; color:var(--text-muted);">
                ${myResp ? 'Status: ' + myResp.status : 'Respond to Alert:'}
              </span>
              <button class="btn btn-primary" onclick="handleDonorResponse(${n.request_id}, 'Accepted')" style="font-size:0.85rem; padding:6px 14px;">
                ❤️ I Can Come
              </button>
              ${!myResp ? `
                <button class="btn btn-secondary" onclick="handleDonorResponse(${n.request_id}, 'Declined')" style="font-size:0.85rem; padding:6px 14px;">
                  Can't Make It
                </button>
              ` : ''}
            </div>
          ` : `
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <div>
                  <span style="display:inline-block; background:var(--success); color:#fff; font-weight:700; font-size:0.75rem; padding:2px 8px; border-radius:9999px;">
                    ${myResp.status}
                  </span>
                  <span style="font-size:0.9rem; font-weight:600; color:#166534; margin-left:8px;">
                    You are committed to this patient.
                  </span>
                  ${myResp.eta_minutes ? `<div style="font-size:0.8rem; color:#14532d; margin-top:2px;">ETA: ${myResp.eta_minutes} mins</div>` : ''}
                </div>
                ${myResp.can_view_contact || myResp.contact_phone ? `
                  <div style="font-size:0.95rem; font-weight:700; color:#0f172a; background:#ffffff; padding:4px 10px; border-radius:6px; border:1px solid #cbd5e1;">
                    📞 Patient Contact: <span>${myResp.contact_phone}</span>
                  </div>
                ` : ''}
              </div>

              <!-- Commitment Transition Buttons -->
              <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
                ${myResp.status === 'Accepted' ? `
                  <button class="btn btn-secondary" onclick="updateDonorCommitmentStatus(${n.request_id}, 'Availability Confirmed')" style="font-size:0.8rem; padding:4px 10px;">
                    ✅ Confirm Availability
                  </button>
                ` : ''}
                ${['Accepted', 'Availability Confirmed'].includes(myResp.status) ? `
                  <button class="btn btn-secondary" onclick="promptUpdateEtaAndStatus(${n.request_id}, 'On the Way')" style="font-size:0.8rem; padding:4px 10px;">
                    🚗 I'm On the Way
                  </button>
                ` : ''}
                ${['Accepted', 'Availability Confirmed', 'On the Way'].includes(myResp.status) ? `
                  <button class="btn btn-secondary" onclick="updateDonorCommitmentStatus(${n.request_id}, 'Arrived — Self-Reported')" style="font-size:0.8rem; padding:4px 10px;">
                    🏥 I Have Arrived (Self-Report)
                  </button>
                ` : ''}
                <button class="btn btn-outline-red" onclick="promptDonorWithdrawal(${n.request_id})" style="font-size:0.8rem; padding:4px 10px; color:#b91c1c; border-color:#f87171;">
                  Withdraw (Cannot Attend)
                </button>
              </div>
            </div>
          `}
        </div>
      </div>
    `;
  }));

  container.innerHTML = alertCards.join('');
}

// Mark single notification as read
async function markOneRead(id) {
  try {
    await API.request(`/api/notifications/${id}/read`, { method: 'PATCH' });
    checkNotifications();
    loadNotificationsList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Donor Response Action ("I can come" / "Can't make it")
async function handleDonorResponse(requestId, status) {
  try {
    let eta_minutes = null;
    if (status === 'Accepted') {
      const etaInput = prompt('Optional: What is your estimated arrival time in minutes? (e.g. 30)', '30');
      if (etaInput) eta_minutes = parseInt(etaInput, 10);
    }

    const res = await API.request(`/api/requests/${requestId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ status, eta_minutes })
    });

    showToast(res.message, status === 'Accepted' ? 'success' : 'info');
    checkNotifications();
    loadNotificationsList();

    if (status === 'Accepted' && res.contact_phone) {
      alert(`🎉 Thank you! Requester contact phone number unlocked:\n\n📞 ${res.contact_phone}\n\nPlease proceed to ${res.request?.hospital_name || 'the hospital'}.`);
    }
  } catch (err) {
    showToast(err.message || 'Failed to submit response', 'error');
  }
}

// Update commitment status
async function updateDonorCommitmentStatus(requestId, status, extra = {}) {
  try {
    const res = await API.request(`/api/requests/${requestId}/response-status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, ...extra })
    });
    showToast(res.message, 'success');
    checkNotifications();
    loadNotificationsList();
  } catch (err) {
    showToast(err.message || 'Failed to update status', 'error');
  }
}

function promptUpdateEtaAndStatus(requestId, status) {
  const eta = prompt('Estimated arrival time in minutes (e.g. 25):', '25');
  const etaNum = eta ? parseInt(eta, 10) : null;
  updateDonorCommitmentStatus(requestId, status, { eta_minutes: etaNum });
}

function promptDonorWithdrawal(requestId) {
  const reason = prompt('Please state why you need to withdraw (e.g. Stuck in traffic, medical emergency):');
  if (reason === null) return; // user cancelled prompt
  updateDonorCommitmentStatus(requestId, 'Withdrawn', { withdrawal_reason: reason });
}
